// @vitest-environment node
/**
 * Lo que el registrador de alertas lee y escribe en opsRUN (spec OPR-34 §4, §8.2 y
 * §10.2).
 *
 * Sin base: escribe solo como el actor de sistema `registrador_alertas`, nunca
 * como un operador (se ve fallar declarándolo), y las lecturas no declaran
 * actor ni piden escritura.
 *
 * Con base (OPSRUN_REQUIERE_BASE=1, el job de Postgres del CI): contra la seed
 * y el falso, en una transacción que se deshace al final, como opsrun_app:
 * al arrancar no escribe nada; una alerta nueva queda anotada con su Audit; la
 * misma otra vez no escribe nada; el cierre queda `auto_cleared` o
 * `fixed_by_action` según el Audit; y la pestaña lee de Resolved quién y cómo en
 * R4, R5 y R6. `OPSRUN_PRUEBA_ADMIN_URL` deja apuntar a otra base local.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { crearFalso, RelojManual } from "@/lib/bzzzbx/falso";
import { ajusteDeActor, type Actor, type Tx } from "@/lib/db/pool";

import { urlsSupabaseLocal } from "../../../scripts/supabase-local.mjs";

import { armarAlertas } from "./armar";
import { leerAlertas } from "./consultas";
import { ACTOR_REGISTRADOR, crearDatosDelRegistrador, LLAMADA_UPSERT, type Ejecutar } from "./datos-sql";
import { crearRegistrador, type AlertaARegistrar } from "./registrador";

const R = (n: number) => `b0000000-0000-4000-8000-0000000000a${n}`;

const alerta: AlertaARegistrar = {
  bzzzbx_alert_id: "bx-alert-t34",
  request_id: R(3),
  rule_id: "OPS-010",
  rule_version: "1",
  level: "red",
  reason_text: "Not started by 1:00 PM.",
  bzzzbx_message_id: null,
  opened_at: "2026-11-27T15:00:00.000Z",
  cleared_at: null,
};

describe("datos del registrador: quién escribe", () => {
  function espia() {
    const llamadas: { sql: string; escritura?: boolean; actor?: Actor }[] = [];
    const ejecutar: Ejecutar = async (fn, opciones) => {
      const db = {
        query: vi.fn(async (sql: string) => {
          llamadas.push({ sql, escritura: opciones?.escritura, actor: opciones?.actor });
          return { rows: [{ id: "ocurrencia-1", clave: "x", request_id: "y", bzzzbx_alert_id: "bx-alert-1" }] };
        }),
      };
      return fn(db as unknown as Tx);
    };
    return { llamadas, datos: crearDatosDelRegistrador(ejecutar) };
  }

  it("el registrador escribe como actor de sistema `registrador_alertas`, nunca como un operador", async () => {
    const { datos, llamadas } = espia();
    await datos.registrar(alerta);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!.sql).toBe(LLAMADA_UPSERT);
    expect(llamadas[0]!.escritura).toBe(true);
    expect(llamadas[0]!.actor).toEqual({ tipo: "sistema", proceso: "registrador_alertas" });
    expect(llamadas[0]!.actor!.tipo).not.toBe("operador");
    expect(ACTOR_REGISTRADOR).toEqual({ tipo: "sistema", proceso: "registrador_alertas" });
    // El ajuste que llega a la base es opsrun.system_actor, nunca opsrun.auth_user_id.
    expect(ajusteDeActor(ACTOR_REGISTRADOR)).toEqual({ ajuste: "opsrun.system_actor", valor: "registrador_alertas" });
  });

  it("las lecturas no declaran actor ni piden escritura (corren en solo lectura)", async () => {
    const { datos, llamadas } = espia();
    await datos.requestsActivas();
    await datos.hilosActivos();
    await datos.alertasAbiertas();
    await datos.requestsExistentes([R(1)]);
    await datos.requestsDeJobs(["bx-job-0003"]);
    await datos.requestsDeMensajes(["bx-msg-0001"]);
    await datos.requestsDeHilos(["bx-thread-0001"]);
    expect(llamadas.length).toBe(7);
    for (const l of llamadas) {
      expect(l.escritura).toBeUndefined();
      expect(l.actor).toBeUndefined();
    }
  });

  it("sin ids no consulta nada, y un id que no es un uuid no llega a la base", async () => {
    const { datos, llamadas } = espia();
    expect(await datos.requestsDeJobs([])).toEqual(new Map());
    expect(await datos.requestsExistentes(["no-es-uuid"])).toEqual(new Set());
    expect(llamadas).toHaveLength(0);
  });

  it("pasa los nueve argumentos de upsert_alert_occurrence en su orden", async () => {
    const llamadas: unknown[][] = [];
    const ejecutar: Ejecutar = (fn) => fn({ query: async (_sql: string, params: unknown[]) => (llamadas.push(params), { rows: [{ id: "x" }] }) } as unknown as Tx);
    await crearDatosDelRegistrador(ejecutar).registrar({ ...alerta, bzzzbx_message_id: "bx-msg-1", cleared_at: "2026-11-27T16:00:00.000Z" });
    expect(llamadas[0]).toEqual(["bx-alert-t34", R(3), "OPS-010", "1", "red", "Not started by 1:00 PM.", "bx-msg-1", "2026-11-27T15:00:00.000Z", "2026-11-27T16:00:00.000Z"]);
  });
});

function urlAdmin(): string | null {
  if (process.env.OPSRUN_PRUEBA_ADMIN_URL) return process.env.OPSRUN_PRUEBA_ADMIN_URL;
  try {
    return urlsSupabaseLocal().admin;
  } catch {
    return null;
  }
}

const requiereBase = process.env.OPSRUN_REQUIERE_BASE === "1";
const conBase = requiereBase ? describe : describe.skip;

conBase("el registrador contra la base con la seed", () => {
  let cliente: Client;
  let llamada = 0;
  let cola: Promise<unknown> = Promise.resolve();

  /** Como `comoOpsrunApp`, pero dentro de la transacción de la prueba, con un savepoint por llamada y en fila. */
  const ejecutar: Ejecutar = (fn, opciones) => {
    const turno = cola.then(() => ejecutarUna(fn, opciones));
    cola = turno.catch(() => {});
    return turno;
  };

  const ejecutarUna: Ejecutar = async (fn, { actor } = {}) => {
    const punto = `llamada_${++llamada}`;
    await cliente.query(`savepoint ${punto}`);
    try {
      await cliente.query("set local role opsrun_app");
      const declarado = actor ? ajusteDeActor(actor) : null;
      await cliente.query("select set_config('opsrun.auth_user_id', $1, true), set_config('opsrun.system_actor', $2, true)", [
        declarado?.ajuste === "opsrun.auth_user_id" ? declarado.valor : "",
        declarado?.ajuste === "opsrun.system_actor" ? declarado.valor : "",
      ]);
      const resultado = await fn(cliente as never);
      await cliente.query("reset role");
      await cliente.query(`release savepoint ${punto}`);
      return resultado;
    } catch (e) {
      await cliente.query(`rollback to savepoint ${punto}`);
      await cliente.query("reset role");
      throw e;
    }
  };

  const marca = async () =>
    (await cliente.query<{ eventos: string; seq: string; ocurrencias: string }>(
      `select (select count(*) from opsrun.audit_event)::text as eventos,
              (select coalesce(max(change_seq), 0) from opsrun.alert_occurrence)::text as seq,
              (select count(*) from opsrun.alert_occurrence)::text as ocurrencias`,
    )).rows[0]!;

  const ocurrencia = async (id: string) =>
    (await cliente.query<{ level: string; resolved_at: string | null; resolution: string | null; resolved_by: string | null; bzzzbx_message_id: string | null }>(
      "select level::text, resolved_at::text, resolution::text, resolved_by::text, bzzzbx_message_id from opsrun.alert_occurrence where bzzzbx_alert_id = $1",
      [id],
    )).rows[0];

  const eventos = async (id: string) =>
    (await cliente.query<{ event_type: string; actor_kind: string; actor_operator_id: string | null }>(
      `select e.event_type, e.actor_kind::text, e.actor_operator_id::text
         from opsrun.audit_event as e join opsrun.alert_occurrence as a on a.id = e.alert_occurrence_id
        where a.bzzzbx_alert_id = $1 order by e.id`,
      [id],
    )).rows;

  beforeAll(async () => {
    const url = urlAdmin();
    expect(url, "Supabase local no responde a `supabase status`").not.toBeNull();
    cliente = new Client({ connectionString: url! });
    await cliente.connect();
    await cliente.query("begin");
    await cliente.query("grant opsrun_app to current_user with inherit false, set true");
    // Para dejar datos de prueba como el dueño de los esquemas (el administrador local no es dueño).
    await cliente.query("grant opsrun_migrador to current_user with inherit true, set true");
  });

  afterAll(async () => {
    await cliente?.query("rollback").catch(() => {});
    await cliente?.end();
  });

  const preparar = () => {
    const falso = crearFalso({ reloj: new RelojManual(new Date()) });
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const datos = crearDatosDelRegistrador(ejecutar);
    return { falso, log, registrador: crearRegistrador(() => ({ lectura: falso.lectura, datos, log })) };
  };

  it("al arrancar, contra la seed y el falso, la pasada completa no escribe nada (la seed y el falso coinciden)", async () => {
    const antes = await marca();
    const { registrador, log } = preparar();
    const r = await registrador.vuelta();
    expect(r).toMatchObject({ estado: "ok", completa: true, saltadas: 0 });
    // Las de las requests que no están en Paid: R6 ya lo está, y su TRN-005 resuelta no se vuelve a leer.
    expect(r.estado === "ok" && r.registradas).toBe(7);
    expect(await marca()).toEqual(antes);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("una alerta nueva queda anotada con su alert_opened; la misma otra vez no escribe nada; el cierre la resuelve sola", async () => {
    const { registrador, falso } = preparar();
    await registrador.vuelta();
    const abierta = "2026-11-27T09:00:00.000Z";
    falso.lectura.poner("alert_result", {
      bzzzbx_alert_id: "bx-alert-t34-a",
      sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0003" },
      rule_id: "OPS-010",
      rule_version: "1",
      level: "amber",
      reason_text: "Not started by 1:00 PM.",
      opened_at: abierta,
      cleared_at: null,
    });
    await registrador.vuelta();
    expect(await ocurrencia("bx-alert-t34-a")).toMatchObject({ level: "amber", resolved_at: null });
    expect(await eventos("bx-alert-t34-a")).toEqual([{ event_type: "alert_opened", actor_kind: "bzzzbx", actor_operator_id: null }]);
    const a = (await cliente.query<{ occurred_at: string }>("select occurred_at::text from opsrun.audit_event where alert_occurrence_id = (select id from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t34-a')")).rows[0]!;
    expect(new Date(a.occurred_at).toISOString()).toBe(abierta);

    // La misma otra vez: la llama y la base no escribe.
    const antes = await marca();
    const datos = crearDatosDelRegistrador(ejecutar);
    await datos.registrar({ ...alerta, bzzzbx_alert_id: "bx-alert-t34-a", request_id: R(3), level: "amber", opened_at: abierta });
    expect(await marca()).toEqual(antes);

    falso.lectura.cambiar("alert_result", "bx-alert-t34-a", { level: "red" });
    await registrador.vuelta();
    expect((await eventos("bx-alert-t34-a")).map((e) => e.event_type)).toEqual(["alert_opened", "alert_level_changed"]);

    falso.lectura.cambiar("alert_result", "bx-alert-t34-a", { cleared_at: "2026-11-27T10:00:00.000Z" });
    await registrador.vuelta();
    expect(await ocurrencia("bx-alert-t34-a")).toMatchObject({ level: "red", resolution: "auto_cleared", resolved_by: null });
    expect((await eventos("bx-alert-t34-a")).map((e) => e.event_type)).toEqual(["alert_opened", "alert_level_changed", "alert_resolved"]);
  });

  it("con un Assign de un operador entre la apertura y el cierre, la OPS-001 queda fixed_by_action con ese operador y su alert_resolved", async () => {
    const { registrador, falso } = preparar();
    await registrador.vuelta();
    // Ops Uno asigna R1 (el evento lo deja la función de Assign; aquí, directo, como administrador).
    await cliente.query(
      `insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at)
       values ($1, 'request_assigned', 'operator', '0a000000-0000-4000-8000-0000000000a1', now())`,
      [R(1)],
    );
    falso.lectura.cambiar("alert_result", "bx-alert-0001", { cleared_at: new Date(Date.now() + 1000).toISOString() });
    await registrador.vuelta();
    expect(await ocurrencia("bx-alert-0001")).toMatchObject({ resolution: "fixed_by_action", resolved_by: "0a000000-0000-4000-8000-0000000000a1" });
    expect(await eventos("bx-alert-0001")).toContainEqual({ event_type: "alert_resolved", actor_kind: "operator", actor_operator_id: "0a000000-0000-4000-8000-0000000000a1" });
  });

  it("una alerta de mensaje de R2 se anota con su bzzzbx_message_id", async () => {
    const { registrador, falso } = preparar();
    await registrador.vuelta();
    falso.lectura.poner("alert_result", {
      bzzzbx_alert_id: "bx-alert-t34-m",
      sujeto: { tipo: "message", bzzzbx_message_id: "bx-msg-0102" },
      rule_id: "MSG-001",
      rule_version: "1",
      level: "red",
      reason_text: "Text not delivered.",
      opened_at: "2026-11-27T09:30:00.000Z",
      cleared_at: null,
    });
    await registrador.vuelta();
    expect(await ocurrencia("bx-alert-t34-m")).toMatchObject({ level: "red", bzzzbx_message_id: "bx-msg-0102" });
    const request = (await cliente.query<{ request_id: string }>("select request_id::text from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t34-m'")).rows[0]!.request_id;
    expect(request).toBe(R(2));
  });

  it("la pestaña lee de Resolved quién y cómo: R4 automática con una repetición, R5 Cleared by con su motivo y R6 Fixed by con su evento", async () => {
    const ahora = new Date();
    const resolved = async (n: number) => {
      const { ocurrencias, esperas } = await leerAlertas(R(n), ejecutar);
      return armarAlertas({ abiertas: [], ocurrencias, esperas, equipos: {}, ahora, zona: "UTC" }).resolved;
    };
    const r4 = await resolved(4);
    expect(r4.map((f) => [f.id, f.nombreRegla, f.quien, f.repeticiones])).toEqual([
      ["bx-alert-0002", "OPS-010 Delayed", "Cleared automatically", 2],
      ["bx-alert-0009", "OPS-010 Delayed", "Cleared automatically", 2],
    ]);
    const r5 = await resolved(5);
    expect(r5.map((f) => [f.quien, f.razon])).toEqual([["Cleared by Ops Dos", "Reason: Large unit, cleaner called ahead."]]);
    const r6 = await resolved(6);
    expect(r6.map((f) => f.quien)).toEqual(["Fixed by Finance Uno · PO entered"]);
  });

  it("R2 tiene una pregunta abierta al cleaner (Waiting) y R1, ninguna", async () => {
    expect((await leerAlertas(R(2), ejecutar)).esperas).toMatchObject([{ purpose: "initial", status: "asked", bzzzbx_team_id: "bx-team-0001" }]);
    expect((await leerAlertas(R(1), ejecutar)).esperas).toEqual([]);
    expect(await leerAlertas("no-es-un-uuid", ejecutar)).toEqual({ ocurrencias: [], esperas: [] });
  });
});
