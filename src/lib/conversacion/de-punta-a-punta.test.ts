// @vitest-environment node
/**
 * La conversación de punta a punta contra la base con la seed (spec OPR-27 §11):
 * los ejecutores, las funciones SQL de la migración `20261130120000`, el
 * despacho de instrucciones y el falso de BzzzBX, como `opsrun_app` y con el
 * actor de la transacción.
 *
 * Corre con OPSRUN_REQUIERE_BASE=1 (el job de Postgres del CI). Todo pasa en
 * una transacción que se deshace al final: el E2E que viene después ve la seed
 * intacta. Para eso se conecta como el administrador local y se concede
 * opsrun_app (para actuar como el servidor), igual que las pruebas pgTAP.
 * `OPSRUN_PRUEBA_ADMIN_URL` deja apuntar a otra base local (por ejemplo, una
 * temporal); si no, usa la del Supabase local.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ContextoAccion } from "@/lib/acciones/tipos";
import { crearFalso, RelojManual } from "@/lib/bzzzbx/falso";
import { ajusteDeActor, type Actor } from "@/lib/db/pool";
import { crearDatosDeDespacho, type Ejecutar } from "@/lib/instrucciones/datos-sql";
import { entregarPorClave, reconciliarInstrucciones } from "@/lib/instrucciones/despacho";
import type { VentanaJob } from "@/lib/ventana/tipos";

import { urlsSupabaseLocal } from "../../../scripts/supabase-local.mjs";

import { leerConversacionDeOpsrun } from "./consultas";
import { crearEjecutoresDeConversacion } from "./ejecutores";
import { leerConversacion } from "./leer";

const R1 = "b0000000-0000-4000-8000-0000000000a1";
const R2 = "b0000000-0000-4000-8000-0000000000a2";
const OPERADOR_ID = "0a000000-0000-4000-8000-0000000000a1";
const OPERADOR: Actor = { tipo: "operador", authUserId: "de000000-0000-4000-8000-0000000000a1" };
const BORRADOR_R2 = "5a000000-0000-4000-8000-0000000000d2";
const BORRADOR_R1 = "5a000000-0000-4000-8000-0000000000d1";

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

conBase("conversación contra la base: notas, envíos, borradores, despacho y reconciliación", () => {
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
    return { falso, ejecutores, despacho, entregas, pasos, reloj };
  }

  const ventana = (hilos: string[], equipoId: string | null) => ({ hilos, equipoId }) as unknown as VentanaJob;
  const ctx = (v: VentanaJob): ContextoAccion => ({ actor: OPERADOR as ContextoAccion["actor"], ventana: v });
  const entrada = (requestId: string, codigo: string, datos: Record<string, unknown>) => ({ requestId, codigo, motivo: null, datos, version: "1" });

  async function hilo(requestId: string, falso: ReturnType<typeof montar>["falso"], etapa = "requests") {
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

  it("R2 de la seed: el original, el texto al cleaner entregado y la nota; el borrador sin decidir", async () => {
    const { falso } = montar();
    const d = await hilo(R2, falso);
    expect(d.entradas.map((e) => [e.tipo, e.estado?.texto])).toEqual([
      ["original", "Received"],
      ["text", "Delivered"],
      ["note", "Internal · not sent"],
    ]);
    expect(d.entradas[2]!.cuerpo).toBe("Requester prefers mornings.");
    expect(d.entradas.map((e) => e.id)).not.toContain("ins:c0000000-0000-4000-8000-0000000000a2");
    expect(d.borradores.customer).toMatchObject({ id: BORRADOR_R2, field: "draft_customer_reply" });
    expect(d.borradores.cleaner).toBeNull();
    expect(d.para.customer.to).toBe("contact.one@example.test");
    expect(d.modos).toEqual({ customer: { disponible: true }, cleaner: { disponible: true }, note: { disponible: true } });
  });

  it("una nota queda en la base con su Audit y se ve en el hilo con su autor", async () => {
    const { falso, ejecutores } = montar();
    const r = await ejecutores.add_note(ctx(ventana([], null)), entrada(R2, "add_note", { body: "  Call before arriving. " }));
    expect(r).toEqual({ tipo: "guardada" });
    const { rows } = await cliente.query(
      `select a.actor_operator_id, (a.details ->> 'note_id')::uuid = n.id as enlazada
         from opsrun.audit_event as a join opsrun.note as n on n.request_id = a.request_id
        where a.request_id = $1 and a.event_type = 'note_added' and n.body = 'Call before arriving.'`,
      [R2],
    );
    expect(rows).toEqual([{ actor_operator_id: OPERADOR_ID, enlazada: true }]);
    const d = await hilo(R2, falso);
    expect(d.entradas.find((e) => e.cuerpo === "Call before arriving.")).toMatchObject({ tipo: "note", contraparte: "Ops Uno" });
  });

  it("un correo: pending → sent → confirmed, una sola burbuja que termina siendo el mensaje leído de BzzzBX", async () => {
    const { falso, ejecutores, despacho, entregas, pasos } = montar();
    const clave = "msg-prueba-correo-0001";
    const r = await ejecutores.send_email(
      ctx(ventana(["bx-thread-0002"], "bx-team-0001")),
      entrada(R2, "send_email", { body: "We can do Friday morning.", idempotency_key: clave }),
    );
    expect(r).toEqual({ tipo: "instruccion", idempotency_key: clave });
    expect(entregas).toEqual([clave]);

    // Guardado: "Sending…", con el cuerpo que escribió el operador.
    let d = await hilo(R2, falso);
    expect(d.entradas.find((e) => e.id.startsWith("ins:"))).toMatchObject({ tipo: "email", cuerpo: "We can do Friday morning.", estado: { texto: "Sending…" } });
    const { rows: guardada } = await cliente.query("select payload, status::text as status from opsrun.instruction where idempotency_key = $1", [clave]);
    expect(guardada).toEqual([{ payload: { bzzzbx_thread_id: "bx-thread-0002", body: "We can do Friday morning." }, status: "pending" }]);

    // Entregado: BzzzBX acusa y queda sent.
    expect(await entregarPorClave(despacho, entregas[0]!)).toBe("entregada");
    d = await hilo(R2, falso);
    expect(d.entradas.find((e) => e.id.startsWith("ins:"))!.estado!.texto).toBe("Sent");

    // BzzzBX ya creó el mensaje pero la instrucción sigue abierta: el duplicado breve se oculta.
    pasos(5);
    d = await hilo(R2, falso);
    expect(d.entradas.filter((e) => e.cuerpo === "We can do Friday morning.")).toHaveLength(1);
    expect(d.entradas.find((e) => e.cuerpo === "We can do Friday morning.")!.id.startsWith("ins:")).toBe(true);

    // Cierra: se crea el request_message y se ve el mensaje leído.
    await reconciliarInstrucciones(despacho);
    pasos(5);
    await reconciliarInstrucciones(despacho);
    const { rows: cerrada } = await cliente.query(
      `select i.status::text as status, m.channel::text as channel, m.direction::text as direction, m.bzzzbx_thread_id
         from opsrun.instruction as i join opsrun.request_message as m on m.instruction_id = i.id where i.idempotency_key = $1`,
      [clave],
    );
    expect(cerrada).toEqual([{ status: "confirmed", channel: "email", direction: "outbound", bzzzbx_thread_id: "bx-thread-0002" }]);
    d = await hilo(R2, falso);
    const burbujas = d.entradas.filter((e) => e.cuerpo === "We can do Friday morning.");
    expect(burbujas).toHaveLength(1);
    expect(burbujas[0]).toMatchObject({ tipo: "email", direccion: "outbound", estado: { texto: "Sent" }, asunto: "Re: Clean for Sample Court unit 12" });
    expect(burbujas[0]!.id.startsWith("msg:")).toBe(true);
  });

  it("repetir el envío con la misma clave no duplica nada", async () => {
    const { ejecutores } = montar();
    const clave = "msg-prueba-repetida-01";
    const enviar = () =>
      ejecutores.send_email(ctx(ventana(["bx-thread-0002"], null)), entrada(R2, "send_email", { body: "Same message.", idempotency_key: clave }));
    await enviar();
    await enviar();
    const { rows } = await cliente.query(
      `select (select count(*)::int from opsrun.instruction where idempotency_key = $1) as instrucciones,
              (select count(*)::int from opsrun.audit_event where event_type = 'email_sent' and instruction_id =
                 (select id from opsrun.instruction where idempotency_key = $1)) as audits`,
      [clave],
    );
    expect(rows).toEqual([{ instrucciones: 1, audits: 1 }]);
  });

  it("un texto al cleaner: sale con el crosswalk ID del equipo y BzzzBX resuelve el teléfono", async () => {
    const { falso, ejecutores, despacho, entregas, pasos } = montar();
    const clave = "msg-prueba-texto-00001";
    const r = await ejecutores.send_text(
      ctx(ventana(["bx-thread-0002"], "bx-team-0001")),
      entrada(R2, "send_text", { body: "Can you take it Friday?", idempotency_key: clave }),
    );
    expect(r.tipo).toBe("instruccion");
    await entregarPorClave(despacho, entregas[0]!);
    pasos(10);
    await reconciliarInstrucciones(despacho);
    const d = await hilo(R2, falso);
    const texto = d.entradas.find((e) => e.cuerpo === "Can you take it Friday?")!;
    expect(texto).toMatchObject({ tipo: "text", contraparte: "Team Alpha", estado: { texto: "Sent" } });
    const { rows } = await cliente.query("select payload from opsrun.instruction where idempotency_key = $1", [clave]);
    expect(rows[0]!.payload).toEqual({ bzzzbx_team_id: "bx-team-0001", body: "Can you take it Friday?" });
  });

  it("un borrador de IA editado se decide corrected al enviar; no sale solo", async () => {
    const { falso, ejecutores, despacho, entregas, pasos } = montar();
    // El borrador existe y nada salió: ninguna instrucción lo tiene como origen.
    const antes = await cliente.query("select decision from opsrun.ai_suggestion where id = $1", [BORRADOR_R2]);
    expect(antes.rows).toEqual([{ decision: null }]);
    pasos(10);
    expect((await reconciliarInstrucciones(despacho)).entregadas).toBe(0);

    const clave = "msg-prueba-borrador-01";
    await ejecutores.send_email(
      ctx(ventana(["bx-thread-0002"], null)),
      entrada(R2, "send_email", { body: "Edited reply from the operator.", idempotency_key: clave, ai_suggestion_id: BORRADOR_R2 }),
    );
    const { rows } = await cliente.query(
      "select decision::text as decision, final_value, decided_by from opsrun.ai_suggestion where id = $1",
      [BORRADOR_R2],
    );
    expect(rows).toEqual([{ decision: "corrected", final_value: { body: "Edited reply from the operator." }, decided_by: OPERADOR_ID }]);
    expect((await hilo(R2, falso)).borradores.customer).toBeNull();
    expect(entregas).toEqual([clave]);

    // Un borrador ya decidido no se usa otra vez.
    const otra = await ejecutores.send_email(
      ctx(ventana(["bx-thread-0002"], null)),
      entrada(R2, "send_email", { body: "Again.", idempotency_key: "msg-prueba-borrador-02", ai_suggestion_id: BORRADOR_R2 }),
    );
    expect(otra).toMatchObject({ tipo: "rechazada", codigo: "borrador_invalido" });
  });

  it("Discard rechaza el borrador sin enviar nada y deja su Audit", async () => {
    const { falso, ejecutores, entregas } = montar();
    const r = await ejecutores.discard_ai_draft(ctx(ventana([], null)), entrada(R1, "discard_ai_draft", { ai_suggestion_id: BORRADOR_R1 }));
    expect(r).toEqual({ tipo: "guardada" });
    expect(entregas).toEqual([]);
    const { rows } = await cliente.query(
      `select s.decision::text as decision, a.event_type from opsrun.ai_suggestion as s
         join opsrun.audit_event as a on a.ai_suggestion_id = s.id where s.id = $1`,
      [BORRADOR_R1],
    );
    expect(rows).toEqual([{ decision: "rejected", event_type: "ai_suggestion_rejected" }]);
    expect((await hilo(R1, falso)).borradores.customer).toBeNull();
    expect((await cliente.query("select count(*)::int as n from opsrun.instruction where request_id = $1 and type = 'send_email'", [R1])).rows[0]!.n).toBe(0);
  });

  it("un fallo en BzzzBX se ve como 'Failed · …' en rojo, queda en Audit y se puede reenviar", async () => {
    const { falso, ejecutores, despacho, entregas, pasos } = montar();
    falso.instrucciones.forzarError({ tipo: "send_email", cuando: "al_ejecutar" });
    const clave = "msg-prueba-fallo-000001";
    await ejecutores.send_email(
      ctx(ventana(["bx-thread-0001"], null)),
      entrada(R1, "send_email", { body: "This one fails.", idempotency_key: clave }),
    );
    await entregarPorClave(despacho, entregas[0]!);
    pasos(10);
    await reconciliarInstrucciones(despacho);
    const d = await hilo(R1, falso);
    const e = d.entradas.find((x) => x.cuerpo === "This one fails.")!;
    expect(e.estado).toEqual({ texto: "Failed · Forced error (stand-in).", tono: "error" });
    expect(e.reenviar).toEqual({ modo: "customer", cuerpo: "This one fails." });
    const audit = await cliente.query(
      "select details ->> 'error_code' as codigo, actor_kind::text as actor from opsrun.audit_event where request_id = $1 and event_type = 'instruction_failed'",
      [R1],
    );
    expect(audit.rows).toEqual([{ codigo: "forced_error", actor: "system" }]);
  });

  it("sin operador, la base no guarda ni una nota ni un correo", async () => {
    const sinActor = crearEjecutoresDeConversacion({
      escribir: (_actor, fn) => ejecutar(fn, { escritura: true }),
      equipo: async () => null,
      entregar: () => {},
    });
    // La función SQL exige un operador (42501): el ejecutor lo dice como "sin actor" y no queda nada.
    expect(await sinActor.add_note(ctx(ventana([], null)), entrada(R2, "add_note", { body: "x" }))).toMatchObject({ codigo: "sin_actor" });
    expect(
      await sinActor.send_email(ctx(ventana(["bx-thread-0002"], null)), entrada(R2, "send_email", { body: "x", idempotency_key: "msg-prueba-sin-actor-01" })),
    ).toMatchObject({ codigo: "sin_actor" });
    const { rows } = await cliente.query(
      "select (select count(*)::int from opsrun.note where body = 'x') as notas, (select count(*)::int from opsrun.instruction where idempotency_key = 'msg-prueba-sin-actor-01') as envios",
    );
    expect(rows).toEqual([{ notas: 0, envios: 0 }]);
  });
});
