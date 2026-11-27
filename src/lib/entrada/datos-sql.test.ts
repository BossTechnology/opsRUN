// @vitest-environment node
/**
 * La entrada contra la base (spec OPR-15 §9.2): `crearDatosDeEntrada` llama a
 * `opsrun.ingest_request_email` como opsrun_app con el actor de sistema
 * `entrada_correo`, y la carrera (dos conexiones a la vez sobre un hilo nuevo)
 * deja una sola request.
 *
 * Corre si Supabase local está arriba; con OPSRUN_REQUIERE_BASE=1 (el job de
 * E2E del CI) no se salta: falla. La carrera necesita dos conexiones que
 * confirmen de verdad, así que esta prueba no puede deshacerse con un rollback:
 * usa ids propios de la corrida y, al terminar, borra lo suyo como el
 * administrador local (sin disparadores, porque Audit es append-only). Así el
 * E2E que viene después ve la seed intacta.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoOpsrunApp, crearPool } from "@/lib/db/pool";

import { urlsSupabaseLocal } from "../../../scripts/supabase-local.mjs";

import { crearDatosDeEntrada } from "./datos-sql";

function urlsLocales(): { admin: string; app: string } | null {
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

conBase("la entrada contra la base", () => {
  const corrida = `it${Date.now().toString(36)}`;
  const id = (n: string) => `bx-msg-${corrida}-${n}`;
  const hilo = (n: string) => `bx-thread-${corrida}-${n}`;
  const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

  let pool: ReturnType<typeof crearPool>;
  let admin: Client;

  const datos = () =>
    crearDatosDeEntrada((fn, opciones) => comoOpsrunApp(fn, { ...opciones, origen: pool }));

  const requestsDelHilo = async (h: string) =>
    (
      await admin.query<{ id: string }>(
        "select distinct request_id::text as id from opsrun.request_message where bzzzbx_thread_id = $1",
        [h],
      )
    ).rows;

  beforeAll(async () => {
    expect(urls, "Supabase local no responde a `supabase status`").not.toBeNull();
    pool = crearPool({ tipo: "url", url: urls!.app });
    admin = new Client({ connectionString: urls!.admin });
    await admin.connect();
  });

  afterAll(async () => {
    try {
      if (admin) {
        // Solo lo de esta corrida, por el ID de sus mensajes.
        await admin.query("begin");
        await admin.query("set local session_replication_role = replica");
        // Las tablas son del dueño de los esquemas: se actúa como él solo en esta transacción.
        await admin.query("grant opsrun_migrador to current_user with inherit true, set true");
        await admin.query("set local role opsrun_migrador");
        // Audit es append-only: ni su dueño tiene DELETE. Se lo da solo dentro de esta transacción, para estas tablas.
        await admin.query("grant delete on opsrun.audit_event, opsrun.request_message, opsrun.request to opsrun_migrador");
        const { rows } = await admin.query<{ request_id: string }>(
          "select distinct request_id::text as request_id from opsrun.request_message where bzzzbx_message_id like $1",
          [`bx-msg-${corrida}-%`],
        );
        const ids = rows.map((r) => r.request_id);
        if (ids.length > 0) {
          await admin.query("delete from opsrun.audit_event where request_id = any($1::uuid[])", [ids]);
          await admin.query("delete from opsrun.request_message where request_id = any($1::uuid[])", [ids]);
          await admin.query("delete from opsrun.request where id = any($1::uuid[])", [ids]);
        }
        await admin.query("revoke delete on opsrun.audit_event, opsrun.request_message, opsrun.request from opsrun_migrador");
        await admin.query("reset role");
        await admin.query("revoke opsrun_migrador from current_user");
        await admin.query("commit");
      }
    } finally {
      await admin?.end();
      await pool?.end();
    }
  });

  it("created, linked y duplicate, con el actor de sistema en Audit", async () => {
    const d = datos();
    const creado = await d.ingerir({ bzzzbx_message_id: id("a1"), bzzzbx_thread_id: hilo("a"), received_at: hace(5) });
    expect(creado.outcome).toBe("created");
    const vinculado = await d.ingerir({ bzzzbx_message_id: id("a2"), bzzzbx_thread_id: hilo("a"), received_at: hace(4) });
    expect(vinculado).toEqual({ request_id: creado.request_id, outcome: "linked" });
    const repetido = await d.ingerir({ bzzzbx_message_id: id("a1"), bzzzbx_thread_id: hilo("a"), received_at: hace(5) });
    expect(repetido).toEqual({ request_id: creado.request_id, outcome: "duplicate" });

    const { rows } = await admin.query<{ event_type: string; actor_kind: string; actor_operator_id: string | null }>(
      "select event_type, actor_kind::text as actor_kind, actor_operator_id::text from opsrun.audit_event where request_id = $1 order by id",
      [creado.request_id],
    );
    expect(rows).toEqual([
      { event_type: "request_received", actor_kind: "system", actor_operator_id: null },
      { event_type: "email_received", actor_kind: "system", actor_operator_id: null },
    ]);
  });

  it("la marca de agua es la última received_at en ISO", async () => {
    const marca = await datos().marcaDeAgua();
    expect(marca).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("la carrera: dos conexiones con dos mensajes de un hilo nuevo dejan una request, un original y un vinculado", async () => {
    const d = datos();
    const [x, y] = await Promise.all([
      d.ingerir({ bzzzbx_message_id: id("b1"), bzzzbx_thread_id: hilo("b"), received_at: hace(3) }),
      d.ingerir({ bzzzbx_message_id: id("b2"), bzzzbx_thread_id: hilo("b"), received_at: hace(2) }),
    ]);
    expect([x.outcome, y.outcome].sort()).toEqual(["created", "linked"]);
    expect(x.request_id).toBe(y.request_id);
    expect(await requestsDelHilo(hilo("b"))).toHaveLength(1);
    const { rows } = await admin.query<{ originales: string }>(
      "select count(*) filter (where is_original)::text as originales from opsrun.request_message where bzzzbx_thread_id = $1",
      [hilo("b")],
    );
    expect(rows[0]!.originales).toBe("1");
  });

  it("la carrera con el mismo mensaje en las dos conexiones deja un solo request_received", async () => {
    const d = datos();
    const [x, y] = await Promise.all([
      d.ingerir({ bzzzbx_message_id: id("c1"), bzzzbx_thread_id: hilo("c"), received_at: hace(1) }),
      d.ingerir({ bzzzbx_message_id: id("c1"), bzzzbx_thread_id: hilo("c"), received_at: hace(1) }),
    ]);
    expect([x.outcome, y.outcome].sort()).toEqual(["created", "duplicate"]);
    const { rows } = await admin.query<{ n: string }>(
      "select count(*)::text as n from opsrun.audit_event where request_id = $1 and event_type = 'request_received'",
      [x.request_id],
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("la entrada no crea instrucciones ni análisis de IA (P-7)", async () => {
    const { rows } = await admin.query<{ instrucciones: string; analisis: string }>(
      `select (select count(*) from opsrun.instruction as i join opsrun.request_message as m on m.request_id = i.request_id
                where m.bzzzbx_message_id like $1)::text as instrucciones,
              (select count(*) from opsrun.ai_analysis as a join opsrun.request_message as m on m.request_id = a.request_id
                where m.bzzzbx_message_id like $1)::text as analisis`,
      [`bx-msg-${corrida}-%`],
    );
    expect(rows[0]).toEqual({ instrucciones: "0", analisis: "0" });
  });
});
