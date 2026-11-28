// @vitest-environment node
/**
 * Las plantillas contra la base y el falso de BzzzBX (spec OPR-18 §10.2): el catálogo de código y las plantillas
 * activas de `message_template` son las mismas, en los dos sentidos; un texto con plantilla pasa por el ejecutor, la
 * base y el despacho como cualquier otro y deja `template_key` y `template_version` en el Audit; y aprobar un job
 * (Approve & confirm) no crea ningún envío ni avisa al requester (T9, "nada sale solo").
 *
 * Corre con OPSRUN_REQUIERE_BASE=1 (el job de Postgres del CI). Todo pasa en una transacción que se deshace al
 * final: el E2E que viene después ve la seed intacta. `OPSRUN_PRUEBA_ADMIN_URL` deja apuntar a otra base local.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ContextoAccion } from "@/lib/acciones/tipos";
import { crearFalso, RelojManual } from "@/lib/bzzzbx/falso";
import { leerConversacionDeOpsrun } from "@/lib/conversacion/consultas";
import { crearEjecutoresDeConversacion } from "@/lib/conversacion/ejecutores";
import { leerConversacion } from "@/lib/conversacion/leer";
import { ajusteDeActor, type Actor } from "@/lib/db/pool";
import { crearDatosDeDespacho, type Ejecutar } from "@/lib/instrucciones/datos-sql";
import { entregarPorClave, reconciliarInstrucciones } from "@/lib/instrucciones/despacho";
import type { VentanaJob } from "@/lib/ventana/tipos";

import { urlsSupabaseLocal } from "../../../scripts/supabase-local.mjs";

import { CLAVES } from "./catalogo";

const R2 = "b0000000-0000-4000-8000-0000000000a2";
const OPERADOR_ID = "0a000000-0000-4000-8000-0000000000a1";
const OPERADOR: Actor = { tipo: "operador", authUserId: "de000000-0000-4000-8000-0000000000a1" };

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

/** Las claves que están en un lado y no en el otro. */
export function diferencias(codigo: readonly string[], base: readonly string[]) {
  return {
    soloEnCodigo: codigo.filter((c) => !base.includes(c)).sort(),
    soloEnBase: base.filter((b) => !codigo.includes(b)).sort(),
  };
}

conBase("plantillas contra la base: catálogo, envío con plantilla y 'nada sale solo'", () => {
  let cliente: Client;
  let llamada = 0;
  let cola: Promise<unknown> = Promise.resolve();

  /** Como `comoOpsrunApp`, pero dentro de la transacción de la prueba, con un savepoint por llamada. */
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

  beforeAll(async () => {
    const url = urlAdmin();
    expect(url, "Supabase local no responde a `supabase status`").not.toBeNull();
    cliente = new Client({ connectionString: url! });
    await cliente.connect();
    await cliente.query("begin");
    await cliente.query("grant opsrun_app to current_user with inherit false, set true");
  });

  afterAll(async () => {
    await cliente?.query("rollback").catch(() => {});
    await cliente?.end();
  });

  const clavesActivas = async () =>
    (await ejecutar((db) => db.query<{ key: string }>("select key from opsrun.message_template where active order by key"))).rows.map((r) => r.key);

  it("el catálogo de código y las plantillas activas de la base son las mismas, en los dos sentidos", async () => {
    expect(diferencias(CLAVES, await clavesActivas())).toEqual({ soloEnCodigo: [], soloEnBase: [] });
  });

  it("se ve fallar: una fila extra en la base, o una clave que falta, se marca (y se deshace)", async () => {
    await cliente.query("savepoint extra");
    try {
      await cliente.query("grant opsrun_migrador to current_user with inherit true, set true");
      await cliente.query("set local role opsrun_migrador");
      await cliente.query("insert into opsrun.message_template (key, version, channel, body, active) values ('extra_de_prueba', 1, 'text', 'Hola {{property}}', true)");
      await cliente.query("update opsrun.message_template set active = false where key = 'requester_done'");
      await cliente.query("reset role");
      expect(diferencias(CLAVES, await clavesActivas())).toEqual({ soloEnCodigo: ["requester_done"], soloEnBase: ["extra_de_prueba"] });
    } finally {
      await cliente.query("rollback to savepoint extra");
      await cliente.query("reset role");
    }
    expect(diferencias(CLAVES, await clavesActivas())).toEqual({ soloEnCodigo: [], soloEnBase: [] });
  });

  function montar() {
    const reloj = new RelojManual(new Date());
    const falso = crearFalso({ reloj });
    const entregas: string[] = [];
    const ejecutores = crearEjecutoresDeConversacion({
      escribir: (actor, fn) => ejecutar(fn, { escritura: true, actor }),
      equipo: (id) => falso.lectura.obtener("cleaner_team", id),
      entregar: (clave) => void entregas.push(clave),
    });
    const despacho = { instrucciones: falso.instrucciones, datos: crearDatosDeDespacho(ejecutar) };
    const pasos = (n: number) => reloj.adelantar(falso.instrucciones.pasoMs * n);
    return { falso, ejecutores, despacho, entregas, pasos };
  }

  async function leer(requestId: string, falso: ReturnType<typeof montar>["falso"], etapa: string) {
    const opsrun = (await ejecutar((db) => leerConversacionDeOpsrun(db, requestId)))!;
    return leerConversacion({
      requestId,
      etapa,
      hilos: [...new Set(opsrun.vinculos.map((v) => v.bzzzbx_thread_id).filter((h): h is string => h !== null))],
      puedeEnviar: true,
      zona: "UTC",
      opsrun,
      lectura: falso.lectura,
      ahora: new Date(),
      memoria: new Map(),
    });
  }

  /**
   * Una request propia de esta prueba (como el dueño de las tablas; se deshace al final), para no compartir filas con otras
   * pruebas que corren a la vez contra la misma base: dos transacciones largas con `for share` sobre la misma request
   * (la de la seed) acaban en un deadlock.
   */
  async function requestPropia(): Promise<string> {
    await cliente.query("savepoint propia");
    await cliente.query("grant opsrun_migrador to current_user with inherit true, set true");
    await cliente.query("set local role opsrun_migrador");
    const sufijo = Math.random().toString(36).slice(2, 8);
    const { rows } = await cliente.query<{ id: string }>(
      `insert into opsrun.request (received_at, owner_operator_id, bzzzbx_customer_id, bzzzbx_property_id, bzzzbx_space_id, unit,
                                   service_date, window_start, window_end, bzzzbx_team_id)
       values (now(), $1, 'bx-cust-0001', 'bx-prop-0002', 'bx-space-0002', '12', current_date + 2, '09:00', '12:00', 'bx-team-0001')
       returning id::text`,
      [OPERADOR_ID],
    );
    await cliente.query(
      `insert into opsrun.request_message (request_id, bzzzbx_message_id, bzzzbx_thread_id, channel, direction, is_original, actor_kind)
       values ($1, $2, $3, 'email', 'inbound', true, 'system')`,
      [rows[0]!.id, `bx-msg-pl-${sufijo}`, `bx-thread-pl-${sufijo}`],
    );
    await cliente.query("reset role");
    await cliente.query("release savepoint propia");
    return rows[0]!.id;
  }

  const ventana = (etapa: string) => ({ etapa, hilos: ["bx-thread-0002"], equipoId: "bx-team-0001" }) as unknown as VentanaJob;
  const ctx = (etapa: string): ContextoAccion => ({ actor: OPERADOR as ContextoAccion["actor"], ventana: ventana(etapa) });
  const entrada = (requestId: string, codigo: string, datos: Record<string, unknown>) => ({ requestId, codigo, motivo: null, datos, version: "1" });

  it("R2 de la seed en Requests: la lectura trae Confirmation request llena con la propiedad, el espacio, la fecha y la ventana", async () => {
    const { falso } = montar();
    const d = await leer(R2, falso, "requests");
    expect(d.plantillas.cleaner.map((p) => p.clave)).toEqual(["cleaner_confirmation_request"]);
    const p = d.plantillas.cleaner[0]!;
    expect(p.version).toBe(1);
    expect(p.texto).toMatch(/^New job: Sample Court Unit 12 on \w{3}, \w{3} \d{1,2}, 9:00 AM-12:00 PM\. Can you confirm\?$/);
    expect(p.faltan).toEqual([]);
    expect(d.plantillas.customer).toEqual([]);
    expect(d.plantillas.avisos).toEqual([]);
  });

  it("un texto con plantilla: la instrucción es la de siempre, el Audit lleva la plantilla y el falso lo entrega", async () => {
    const { falso, ejecutores, despacho, entregas, pasos } = montar();
    const propia = await requestPropia();
    const { texto } = (await leer(propia, falso, "requests")).plantillas.cleaner[0]!;
    const clave = "msg-plantilla-texto-0001";
    const r = await ejecutores.send_text(
      ctx("requests"),
      entrada(propia, "send_text", { body: `${texto} Thanks!`, idempotency_key: clave, template_key: "cleaner_confirmation_request", template_version: 1 }),
    );
    expect(r).toEqual({ tipo: "instruccion", idempotency_key: clave });
    expect(entregas).toEqual([clave]);

    const { rows } = await cliente.query(
      `select i.payload, a.event_type, a.details
         from opsrun.instruction as i join opsrun.audit_event as a on a.instruction_id = i.id
        where i.idempotency_key = $1`,
      [clave],
    );
    expect(rows).toEqual([
      {
        payload: { bzzzbx_team_id: "bx-team-0001", body: `${texto} Thanks!` },
        event_type: "text_sent",
        details: { bzzzbx_team_id: "bx-team-0001", template_key: "cleaner_confirmation_request", template_version: 1 },
      },
    ]);

    // Sale por el mismo camino: entrega, el falso lo acusa y se cierra con su mensaje.
    expect(await entregarPorClave(despacho, entregas[0]!)).toBe("entregada");
    await reconciliarInstrucciones(despacho);
    pasos(5);
    await reconciliarInstrucciones(despacho);
    const { rows: cerrada } = await cliente.query("select status::text as status from opsrun.instruction where idempotency_key = $1", [clave]);
    expect(cerrada).toEqual([{ status: "confirmed" }]);
  });

  it("la base rechaza un cuerpo con {{date}} y una plantilla de otro canal, y no deja nada", async () => {
    const { ejecutores } = montar();
    const propia = await requestPropia();
    const sinLlenar = await ejecutores.send_text(
      ctx("requests"),
      entrada(propia, "send_text", { body: "Move it to {{date}}?", idempotency_key: "msg-plantilla-sinllenar-1", template_key: "cleaner_confirmation_request", template_version: 1 }),
    );
    expect(sinLlenar).toMatchObject({ tipo: "rechazada", codigo: "faltan_datos" });
    // El servidor también la rechaza antes de llegar a la base si no es del catálogo para el modo y la etapa.
    const deCorreo = await ejecutores.send_text(
      ctx("requests"),
      entrada(propia, "send_text", { body: "Hola", idempotency_key: "msg-plantilla-otrocanal-1", template_key: "requester_scheduled", template_version: 1 }),
    );
    expect(deCorreo).toMatchObject({ tipo: "rechazada", codigo: "plantilla_no_disponible" });
    const { rows } = await cliente.query("select count(*)::int as n from opsrun.instruction where idempotency_key like 'msg-plantilla-%'");
    expect(rows[0].n).toBe(1); // solo la del caso bueno de arriba
  });

  it("T9: Approve & confirm no crea ningún envío ni avisa al requester, ni en la vuelta del ciclo", async () => {
    const { falso, despacho } = montar();
    // Un job programado propio de esta prueba (como el dueño de las tablas; todo se deshace al final).
    await cliente.query("savepoint aprobar");
    await cliente.query("grant opsrun_migrador to current_user with inherit true, set true");
    await cliente.query("set local role opsrun_migrador");
    const { rows: abierta } = await cliente.query<{ id: string }>(
      `insert into opsrun.request (received_at, owner_operator_id, bzzzbx_customer_id, bzzzbx_property_id)
       values (now() - interval '2 days', $1, 'bx-cust-0001', 'bx-prop-0003') returning id::text`,
      [OPERADOR_ID],
    );
    await cliente.query(
      `insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id, confirmed_at)
       select $1, k, case when k = 'cleaner' then 'phone'::opsrun.confirmation_method else 'operator' end, '{}', $2, now() - interval '47 hours'
         from unnest(enum_range(null::opsrun.confirmation_kind)) as k`,
      [abierta[0]!.id, OPERADOR_ID],
    );
    const { rows: creada } = await cliente.query<{ id: string; change_seq: string }>(
      `update opsrun.request set status = 'scheduled', bzzzbx_job_id = 'bx-job-prueba-t9', job_number = 'EX-PRUEBA-T9',
              scheduled_at = now() - interval '1 day'
        where id = $1 returning id::text, change_seq::text`,
      [abierta[0]!.id],
    );
    await cliente.query("reset role");
    const { id, change_seq } = creada[0]!;

    const antes = await cliente.query("select (select count(*) from opsrun.instruction where request_id = $1)::int as instrucciones", [id]);
    const mensajesAntes = (await falso.lectura.listarPor("message", { bzzzbx_thread_id: "bx-thread-0003" })).length;

    await ejecutar((db) => db.query("select opsrun.approve_job($1::uuid, $2::bigint)", [id, change_seq]), { escritura: true, actor: OPERADOR });
    await reconciliarInstrucciones(despacho);

    const { rows } = await cliente.query(
      `select (select count(*) from opsrun.instruction where request_id = $1 and type in ('send_email', 'send_text'))::int as envios,
              (select count(*) from opsrun.instruction where request_id = $1)::int as instrucciones,
              (select count(*) from opsrun.audit_event where request_id = $1 and event_type = 'requester_notified')::int as avisos,
              (select count(*) from opsrun.audit_event where request_id = $1 and event_type = 'job_approved')::int as aprobaciones,
              (select approved_at is not null from opsrun.request where id = $1) as aprobado`,
      [id],
    );
    expect(rows[0]).toEqual({ envios: 0, instrucciones: antes.rows[0].instrucciones, avisos: 0, aprobaciones: 1, aprobado: true });
    expect((await falso.lectura.listarPor("message", { bzzzbx_thread_id: "bx-thread-0003" })).length).toBe(mensajesAntes);
    await cliente.query("rollback to savepoint aprobar");
    await cliente.query("reset role");
  });
});
