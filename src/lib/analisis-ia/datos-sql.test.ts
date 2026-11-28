// @vitest-environment node
/**
 * La tarea de análisis contra la base (spec OPR-36 §15.2): `crearDatosDeAnalisis` llama a
 * `opsrun.start_ai_analysis` y `opsrun.record_ai_analysis` como opsrun_app con el actor de
 * sistema `analisis_ia`; el barrido salta lo que la seed ya analizó; y las dos carreras
 * (dos conexiones a la vez) dejan un solo pending y un solo resultado.
 *
 * Corre si Supabase local está arriba; con OPSRUN_REQUIERE_BASE=1 (el job de E2E del CI)
 * no se salta: falla. Las carreras necesitan dos conexiones que confirmen de verdad, así
 * que esta prueba no puede deshacerse con un rollback: usa requests propias de la corrida
 * y, al terminar, borra lo suyo como el administrador local (sin disparadores, porque
 * Audit es append-only). Así el E2E que viene después ve la seed intacta.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoOpsrunApp, crearPool } from "@/lib/db/pool";

import { urlsSupabaseLocal } from "../../../scripts/supabase-local.mjs";

import type { PendienteDeAnalisis } from "./analisis";
import { crearDatosDeAnalisis } from "./datos-sql";

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

conBase("el análisis de IA contra la base", () => {
  const corrida = `ia${Date.now().toString(36)}`;
  let pool: ReturnType<typeof crearPool>;
  let admin: Client;
  const creadas: string[] = [];

  const datos = () => crearDatosDeAnalisis((fn, opciones) => comoOpsrunApp(fn, { ...opciones, origen: pool }));

  /** Una request open con su correo original (lo que deja la entrada), como el administrador. */
  async function nuevaRequest(n: string, opciones: { recibidaHaceMin?: number; creadaHaceHoras?: number } = {}): Promise<string> {
    const { rows } = await admin.query<{ id: string }>(
      `insert into opsrun.request (received_at, created_at) values (now() - make_interval(mins => $1), now() - make_interval(hours => $2)) returning id::text`,
      [opciones.recibidaHaceMin ?? 1, opciones.creadaHaceHoras ?? 0],
    );
    const id = rows[0]!.id;
    creadas.push(id);
    await admin.query(
      `insert into opsrun.request_message (request_id, bzzzbx_message_id, bzzzbx_thread_id, channel, direction, is_original, actor_kind)
       values ($1, $2, $3, 'email', 'inbound', true, 'system')`,
      [id, `bx-msg-${corrida}-${n}`, `bx-thread-${corrida}-${n}`],
    );
    return id;
  }

  const analisisDe = async (requestId: string) =>
    (await admin.query<{ id: string; status: string }>("select id::text, status::text from opsrun.ai_analysis where request_id = $1 order by requested_at", [requestId])).rows;

  beforeAll(async () => {
    expect(urls, "Supabase local no responde a `supabase status`").not.toBeNull();
    pool = crearPool({ tipo: "url", url: urls!.app });
    admin = new Client({ connectionString: urls!.admin });
    await admin.connect();
  });

  afterAll(async () => {
    try {
      if (admin) {
        await admin.query("begin");
        await admin.query("set local session_replication_role = replica");
        await admin.query("grant opsrun_migrador to current_user with inherit true, set true");
        await admin.query("set local role opsrun_migrador");
        await admin.query(
          "grant delete on opsrun.audit_event, opsrun.ai_suggestion, opsrun.ai_analysis, opsrun.request_message, opsrun.request to opsrun_migrador",
        );
        if (creadas.length > 0) {
          await admin.query("delete from opsrun.audit_event where request_id = any($1::uuid[])", [creadas]);
          await admin.query("delete from opsrun.ai_suggestion where request_id = any($1::uuid[])", [creadas]);
          await admin.query("delete from opsrun.ai_analysis where request_id = any($1::uuid[])", [creadas]);
          await admin.query("delete from opsrun.request_message where request_id = any($1::uuid[])", [creadas]);
          await admin.query("delete from opsrun.request where id = any($1::uuid[])", [creadas]);
        }
        await admin.query(
          "revoke delete on opsrun.audit_event, opsrun.ai_suggestion, opsrun.ai_analysis, opsrun.request_message, opsrun.request from opsrun_migrador",
        );
        await admin.query("reset role");
        await admin.query("revoke opsrun_migrador from current_user");
        await admin.query("commit");
      }
    } finally {
      await admin?.end();
      await pool?.end();
    }
  });

  it("el barrido propone la request nueva y salta las que la seed ya analizó (R1, R2, R7 y R8)", async () => {
    const id = await nuevaRequest("barrido");
    const candidatas = await datos().candidatasDelBarrido(200);
    expect(candidatas).toContain(id);
    const { rows } = await admin.query<{ id: string }>(
      "select r.id::text from opsrun.request as r join opsrun.ai_analysis as a on a.request_id = r.id where a.status = 'completed' and r.id <> all ($1::uuid[])",
      [creadas],
    );
    for (const analizada of rows) expect(candidatas).not.toContain(analizada.id);
  });

  it("el barrido no propone una request de hace más de 24 h", async () => {
    const vieja = await nuevaRequest("vieja", { creadaHaceHoras: 30, recibidaHaceMin: 30 * 60 });
    expect(await datos().candidatasDelBarrido(200)).not.toContain(vieja);
  });

  it("iniciar abre un pending sin instrucción; la segunda vez devuelve null; y el pendiente trae solo los IDs del original", async () => {
    const id = await nuevaRequest("iniciar");
    const analisis = await datos().iniciar(id);
    expect(analisis).toMatch(/^[0-9a-f-]{36}$/);
    expect(await datos().iniciar(id)).toBeNull();
    const { rows } = await admin.query<{ instruction_id: string | null; status: string }>("select instruction_id::text, status::text from opsrun.ai_analysis where id = $1", [analisis]);
    expect(rows[0]).toEqual({ instruction_id: null, status: "pending" });

    const pendientes = await datos().pendientes(200);
    const suyo = pendientes.find((p: PendienteDeAnalisis) => p.id === analisis);
    expect(suyo).toEqual({
      id: analisis,
      request_id: id,
      requested_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      bzzzbx_message_id: `bx-msg-${corrida}-iniciar`,
      bzzzbx_thread_id: `bx-thread-${corrida}-iniciar`,
    });
    // El barrido ya no la propone: tiene uno en curso.
    expect(await datos().candidatasDelBarrido(200)).not.toContain(id);
  });

  it("registrar guarda el resultado con el actor de sistema y deja el Audit del actor ai; un segundo registro es duplicate", async () => {
    const id = await nuevaRequest("registrar");
    const analisis = (await datos().iniciar(id))!;
    const cierre = {
      analisisId: analisis,
      estado: "completed" as const,
      modelo: "example-model",
      errorCode: null,
      definitivo: false,
      propuestas: [
        { field: "unit" as const, rank: 1 as const, value: "4B", reason: "Subject line." },
        { field: "beds" as const, rank: 1 as const, value: 3, reason: null },
      ],
    };
    expect(await datos().registrar(cierre)).toBe("recorded");
    expect(await datos().registrar(cierre)).toBe("duplicate");
    const { rows } = await admin.query<{ unit: string; beds: number }>("select unit, beds from opsrun.request where id = $1", [id]);
    expect(rows[0]).toEqual({ unit: "4B", beds: 3 });
    const audit = await admin.query<{ event_type: string; actor_kind: string }>(
      "select event_type, actor_kind::text from opsrun.audit_event where request_id = $1 and event_type like 'ai_%'",
      [id],
    );
    expect(audit.rows).toEqual([{ event_type: "ai_analysis_completed", actor_kind: "ai" }]);
  });

  it("un resultado inválido llega a la base y la base lo rechaza con OP046 sin escribir nada", async () => {
    const id = await nuevaRequest("invalida");
    const analisis = (await datos().iniciar(id))!;
    await expect(
      datos().registrar({
        analisisId: analisis,
        estado: "completed",
        modelo: null,
        errorCode: null,
        definitivo: false,
        propuestas: [{ field: "cleaner_team" as never, rank: 1, value: "bx-team-0001", reason: null }],
      }),
    ).rejects.toMatchObject({ code: "OP046" });
    expect((await analisisDe(id))[0]!.status).toBe("pending");
  });

  it("la carrera: dos conexiones que abren el análisis de la misma request dejan un solo pending", async () => {
    const id = await nuevaRequest("carrera-inicio");
    const [x, y] = await Promise.all([datos().iniciar(id), datos().iniciar(id)]);
    expect([x, y].filter((v) => v !== null)).toHaveLength(1);
    expect((await analisisDe(id)).filter((a) => a.status === "pending")).toHaveLength(1);
  });

  it("la carrera: dos registros del mismo análisis a la vez dejan un solo resultado", async () => {
    const id = await nuevaRequest("carrera-registro");
    const analisis = (await datos().iniciar(id))!;
    const cierre = {
      analisisId: analisis,
      estado: "completed" as const,
      modelo: "example-model",
      errorCode: null,
      definitivo: false,
      propuestas: [{ field: "unit" as const, rank: 1 as const, value: "9Z", reason: null }],
    };
    const resultados = await Promise.all([datos().registrar(cierre), datos().registrar(cierre)]);
    expect([...resultados].sort()).toEqual(["duplicate", "recorded"]);
    const { rows } = await admin.query<{ n: string }>("select count(*)::text as n from opsrun.ai_suggestion where request_id = $1", [id]);
    expect(rows[0]!.n).toBe("1");
    const eventos = await admin.query<{ n: string }>(
      "select count(*)::text as n from opsrun.audit_event where request_id = $1 and event_type = 'ai_analysis_completed'",
      [id],
    );
    expect(eventos.rows[0]!.n).toBe("1");
  });

  it("un timed_out y su reintento: no hay reintento antes de 60 s, y un rechazo definitivo no se reintenta", async () => {
    const id = await nuevaRequest("reintento");
    const primero = (await datos().iniciar(id))!;
    await datos().registrar({ analisisId: primero, estado: "timed_out", modelo: null, propuestas: [], errorCode: null, definitivo: false });
    expect(await datos().iniciar(id)).toBeNull();
    // El barrido todavía la propone (no hay pending ni completed), y la base decide que no toca.
    expect(await datos().candidatasDelBarrido(200)).toContain(id);

    const definitiva = await nuevaRequest("definitiva");
    const unico = (await datos().iniciar(definitiva))!;
    await datos().registrar({ analisisId: unico, estado: "failed", modelo: null, propuestas: [], errorCode: "message_unknown", definitivo: true });
    expect(await datos().candidatasDelBarrido(200)).not.toContain(definitiva);
  });
});
