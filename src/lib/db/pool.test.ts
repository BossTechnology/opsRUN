// @vitest-environment node
/**
 * La conexión: no se cuelga, no tumba el proceso si Postgres se reinicia,
 * acota cada sentencia, consulta como opsrun_app y rechaza un login que podría
 * saltarse RLS.
 *
 * Las pruebas contra la base corren si Supabase local está arriba; si no, se
 * saltan. Con OPSRUN_REQUIERE_BASE=1 (job de E2E del CI) no se saltan: fallan,
 * para que una base caída no pase por verde.
 */
import { afterAll, describe, expect, it } from "vitest";

// Compartido con `pnpm local` y Playwright.
import { migrar } from "../../../scripts/migrar.mjs";
import { urlsSupabaseLocal } from "../../../scripts/supabase-local.mjs";

import {
  ajusteDeActor,
  comoOpsrunApp,
  comprobarLoginAlArrancar,
  crearPool,
  LoginPrivilegiadoError,
  OPCIONES_POOL,
  TIEMPO_MAXIMO_SENTENCIA,
} from "./pool";

function urlsLocales(): { admin: string; app: string; migrador: string } | null {
  try {
    return urlsSupabaseLocal();
  } catch {
    return null;
  }
}

const urls = urlsLocales();
const requiereBase = process.env.OPSRUN_REQUIERE_BASE === "1";
const conBase = urls || requiereBase ? describe : describe.skip;

if (requiereBase) {
  it("Supabase local está arriba (OPSRUN_REQUIERE_BASE=1)", () => {
    expect(urls, "Supabase local no responde a `supabase status`").not.toBeNull();
  });
}

describe("actor de la transacción", () => {
  it("un operador se declara con el id de su usuario de GoTrue", () => {
    expect(
      ajusteDeActor({ tipo: "operador", authUserId: "0F8FAD5B-D9CB-469F-A165-70867728950E" }),
    ).toEqual({ ajuste: "opsrun.auth_user_id", valor: "0f8fad5b-d9cb-469f-a165-70867728950e" });
  });

  it("un proceso del sistema se declara con su nombre", () => {
    expect(ajusteDeActor({ tipo: "sistema", proceso: "intake" })).toEqual({
      ajuste: "opsrun.system_actor",
      valor: "intake",
    });
  });

  it("rechaza un actor mal formado", () => {
    expect(() => ajusteDeActor({ tipo: "operador", authUserId: "no-es-uuid" })).toThrow();
    expect(() => ajusteDeActor({ tipo: "sistema", proceso: "" })).toThrow();
    expect(() => ajusteDeActor({ tipo: "sistema", proceso: "x'; drop" })).toThrow();
  });
});

describe("pool sin base", () => {
  it("se rinde al conectar en vez de esperar para siempre", async () => {
    const pool = crearPool({ tipo: "url", url: "postgresql://nadie:nada@127.0.0.1:1/ninguna" });
    try {
      expect(pool.listenerCount("error")).toBeGreaterThanOrEqual(1);
      const inicio = Date.now();
      await expect(comoOpsrunApp(async () => 1, { origen: pool })).rejects.toThrow();
      expect(Date.now() - inicio).toBeLessThan(OPCIONES_POOL.connectionTimeoutMillis + 2000);
    } finally {
      await pool.end();
    }
  });
});

conBase("pool contra Supabase local", () => {
  const app = crearPool({ tipo: "url", url: urls?.app ?? "" });
  const admin = crearPool({ tipo: "url", url: urls?.admin ?? "" });
  afterAll(async () => {
    await Promise.all([app.end(), admin.end()]);
  });

  it("consulta como opsrun_app, con statement_timeout", async () => {
    const fila = await comoOpsrunApp(
      async (db) =>
        (await db.query("select current_user as rol, current_setting('statement_timeout') as tope")).rows[0],
      { origen: app },
    );
    expect(fila).toEqual({ rol: "opsrun_app", tope: TIEMPO_MAXIMO_SENTENCIA });
  });

  it("lee la salud de la base", async () => {
    const [fila] = await comoOpsrunApp(
      async (db) => (await db.query("select status from opsrun.opsrun_health()")).rows,
      { origen: app },
    );
    expect(fila).toEqual({ status: "ok" });
  });

  it("lee las migraciones aplicadas, pero no las escribe", async () => {
    const filas = await comoOpsrunApp(
      async (db) => (await db.query("select version from opsrun.schema_migration")).rows,
      { origen: app },
    );
    expect(filas.length).toBeGreaterThan(0);
    await expect(
      comoOpsrunApp(
        async (db) => db.query("insert into opsrun.schema_migration (version, name) values ('0', 'x')"),
        { origen: app, escritura: true },
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("no entra a opsrun_private ni a opsrun_writeback", async () => {
    for (const esquema of ["opsrun_private", "opsrun_writeback"]) {
      await expect(
        comoOpsrunApp(async (db) => db.query(`create temporary view v as select 1 from ${esquema}.nada`), {
          origen: app,
          escritura: true,
        }),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("declara el actor solo dentro de la transacción", async () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const dentro = await comoOpsrunApp(
      async (db) =>
        (
          await db.query(
            "select current_setting('opsrun.auth_user_id', true) as operador, current_setting('opsrun.system_actor', true) as sistema",
          )
        ).rows[0],
      { origen: app, actor: { tipo: "operador", authUserId: id } },
    );
    expect(dentro).toEqual({ operador: id, sistema: null });

    const despues = await comoOpsrunApp(
      async (db) => (await db.query("select current_setting('opsrun.auth_user_id', true) as operador")).rows[0],
      { origen: app },
    );
    expect(despues?.operador ?? "").toBe("");
  });

  it("es de solo lectura salvo que se pida escritura", async () => {
    await expect(
      comoOpsrunApp(async (db) => db.query("create temporary table t (id int)"), { origen: app }),
    ).rejects.toMatchObject({ code: "25006" });
  });

  it("no llega a auth ni a storage", async () => {
    for (const tabla of ["auth.users", "storage.objects"]) {
      await expect(
        comoOpsrunApp(async (db) => db.query(`select 1 from ${tabla} limit 1`), { origen: app }),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("rechaza un login privilegiado, y lo sigue rechazando", async () => {
    // El login `postgres` del Supabase local tiene BYPASSRLS.
    await expect(comoOpsrunApp(async () => 1, { origen: admin })).rejects.toBeInstanceOf(LoginPrivilegiadoError);
    await expect(comoOpsrunApp(async () => 1, { origen: admin })).rejects.toBeInstanceOf(LoginPrivilegiadoError);
    await expect(comprobarLoginAlArrancar(admin)).rejects.toBeInstanceOf(LoginPrivilegiadoError);
  });

  it("las migraciones están al día y se aplican como el dueño, con una sola conexión", async () => {
    // opsrun_migrador tiene CONNECTION LIMIT 1: si migrar abriera dos, fallaría.
    await expect(migrar(urls?.migrador ?? "", { avisar: () => {} })).resolves.toEqual([]);
    await expect(migrar(urls?.app ?? "", { avisar: () => {} })).rejects.toThrow(/dueño del esquema opsrun/);
  });

  it("deja arrancar con el login de opsrun_app", async () => {
    await expect(comprobarLoginAlArrancar(app)).resolves.toBeUndefined();
  });
});
