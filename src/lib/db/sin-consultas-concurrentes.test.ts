// @vitest-environment node
/**
 * Guard: las lecturas que comparten un cliente de `pg` van una tras otra.
 * `pg` solo avisa ("Calling client.query() when the client is already
 * executing a query is deprecated") y en una versión futura será un error;
 * aquí falla ya.
 *
 * Descubre en vez de enumerar: toda función `leer…(db, requestId)` exportada
 * por un `src/lib/<módulo>/consultas.ts` se prueba con un cliente que lanza si
 * llega una consulta mientras otra sigue en curso. Un módulo de consultas nuevo
 * entra solo.
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { crearClienteSecuencial } from "./prueba-cliente-secuencial";

const RAIZ = join(__dirname, "..");

const MODULOS = readdirSync(RAIZ, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(RAIZ, d.name, "consultas.ts")))
  .map((d) => d.name)
  .sort();

const UUID = "b0000000-0000-4000-8000-0000000000a1";

describe("el cliente falso", () => {
  it("lanza si llega una consulta mientras otra está en curso", async () => {
    const { db } = crearClienteSecuencial();
    await expect(Promise.all([db.query("select 1"), db.query("select 2")])).rejects.toThrow(/concurrente/);
  });

  it("deja pasar las consultas una tras otra", async () => {
    const { db, consultas } = crearClienteSecuencial();
    await db.query("select 1");
    await db.query("select 2");
    expect(consultas).toEqual(["select 1", "select 2"]);
  });
});

describe("las lecturas sobre un mismo cliente no lanzan consultas concurrentes", () => {
  it("el descubrimiento ve los módulos de consultas conocidos", () => {
    expect(MODULOS).toEqual(expect.arrayContaining(["audit", "conversacion", "ventana"]));
  });

  it.each(MODULOS)("%s/consultas.ts", async (modulo) => {
    const exportado = (await import(`../${modulo}/consultas.ts`)) as Record<string, unknown>;
    const lecturas = Object.entries(exportado).filter(
      (par): par is [string, (db: unknown, requestId: string) => Promise<unknown>] =>
        typeof par[1] === "function" && /^leer/.test(par[0]) && par[1].length >= 1,
    );
    expect(lecturas.length).toBeGreaterThan(0);
    let consultadas = 0;
    for (const [nombre, lectura] of lecturas) {
      const { db, consultas } = crearClienteSecuencial();
      try {
        await lectura(db, UUID);
      } catch (e) {
        throw new Error(`${modulo}/consultas.ts ${nombre}: ${e instanceof Error ? e.message : String(e)}`);
      }
      consultadas += consultas.length;
    }
    // Que el guard no pase en vacío: alguna lectura del módulo sí llegó al cliente.
    expect(consultadas).toBeGreaterThan(0);
  });
});
