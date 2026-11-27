// @vitest-environment node
/**
 * Controles del falso de instrucciones: los pasos del Runbook §7.1, la
 * aprobación, el error forzado y los efectos en la lectura (spec OPR-22 §4).
 */
import { describe, expect, it } from "vitest";

import { BzzzbxNoDisponible, InstruccionRechazada } from "../errores";
import type { Instruccion, Resultado, TipoInstruccion } from "../tipos";

import { crearFalso, RelojManual } from ".";

const OPERADOR = { tipo: "operator", operator_id: "0a000000-0000-4000-8000-0000000000a1" } as const;

function montar() {
  const reloj = new RelojManual(new Date("2030-03-10T15:00:00Z"));
  const falso = crearFalso({ reloj });
  const paso = () => reloj.adelantar(falso.instrucciones.pasoMs);
  const cerrar = async (clave: string): Promise<Resultado> => {
    for (let i = 0; i < 20; i++) {
      const r = await falso.instrucciones.estado(clave);
      if (r && r.estado !== "en_curso") return r;
      paso();
    }
    throw new Error("no cerró");
  };
  return { reloj, falso, paso, cerrar };
}

const texto = (clave: string, extra: Partial<Instruccion> = {}): Instruccion => ({
  idempotency_key: clave,
  tipo: "send_text",
  payload: { bzzzbx_team_id: "bx-team-0001", body: "Can you confirm?" },
  actor: OPERADOR,
  sujeto: { bzzzbx_job_id: "bx-job-0003" },
  ...extra,
});

describe("instrucciones falsas: pasos", () => {
  it("recorre requested → authorized → dispatched → executed → observed → confirmada", async () => {
    const { falso, paso } = montar();
    await falso.instrucciones.entregar(texto("k1"));
    const vistos: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = (await falso.instrucciones.estado("k1"))!;
      vistos.push(r.estado === "en_curso" ? r.paso : r.estado);
      paso();
    }
    expect(vistos).toEqual(["requested", "authorized", "dispatched", "executed", "observed", "confirmada"]);
  });

  it("con aprobación exigida, espera en awaiting_approval hasta aprobar", async () => {
    const { falso, paso, cerrar } = montar();
    falso.instrucciones.exigirAprobacion("record_validation");
    await falso.instrucciones.entregar({
      idempotency_key: "k2",
      tipo: "record_validation",
      payload: {},
      actor: OPERADOR,
      sujeto: { bzzzbx_job_id: "bx-job-0006" },
    });
    for (let i = 0; i < 5; i++) paso();
    expect(await falso.instrucciones.estado("k2")).toMatchObject({ estado: "en_curso", paso: "awaiting_approval" });
    falso.instrucciones.aprobar("k2");
    expect(await cerrar("k2")).toMatchObject({ estado: "confirmada" });
  });

  it("los pasos avanzan con el tiempo, sin temporizadores", async () => {
    const { reloj, falso } = montar();
    await falso.instrucciones.entregar(texto("k3"));
    reloj.adelantar(falso.instrucciones.pasoMs * 10);
    expect(await falso.instrucciones.estado("k3")).toMatchObject({ estado: "confirmada" });
  });
});

describe("instrucciones falsas: rechazo al entregar", () => {
  it("un tipo desconocido se rechaza", async () => {
    const { falso } = montar();
    await expect(
      falso.instrucciones.entregar(texto("k4", { tipo: "launch_rocket" as TipoInstruccion })),
    ).rejects.toMatchObject({ error_code: "unknown_type" });
  });

  it("una acción sobre un job que no existe se rechaza", async () => {
    const { falso } = montar();
    await expect(
      falso.instrucciones.entregar({ ...texto("k5"), tipo: "cancel_job", payload: {}, sujeto: { bzzzbx_job_id: "bx-job-9999" } }),
    ).rejects.toBeInstanceOf(InstruccionRechazada);
  });

  it("el rechazo es definitivo para la clave", async () => {
    const { falso } = montar();
    const mala = { ...texto("k6"), payload: {} };
    await expect(falso.instrucciones.entregar(mala)).rejects.toBeInstanceOf(InstruccionRechazada);
    await expect(falso.instrucciones.entregar(texto("k6"))).rejects.toBeInstanceOf(InstruccionRechazada);
  });
});

describe("instrucciones falsas: error forzado", () => {
  it("al_entregar: entregar lanza InstruccionRechazada con el código pedido", async () => {
    const { falso } = montar();
    falso.instrucciones.forzarError({ tipo: "send_text", cuando: "al_entregar", error_code: "forced", error_message: "Forced error" });
    await expect(falso.instrucciones.entregar(texto("k7"))).rejects.toMatchObject({
      error_code: "forced",
      error_message: "Forced error",
    });
  });

  it("al_ejecutar: acusa y cierra fallida", async () => {
    const { falso, cerrar } = montar();
    falso.instrucciones.forzarError({ idempotency_key: "k8", cuando: "al_ejecutar" });
    await falso.instrucciones.entregar(texto("k8"));
    expect(await cerrar("k8")).toMatchObject({ estado: "fallida", error_code: "forced_error" });
  });

  it("sin_confirmar: cierra sin confirmar y no toca la lectura", async () => {
    const { falso, cerrar } = montar();
    const antes = falso.lectura.todos("message").length;
    falso.instrucciones.forzarError({ cuando: "sin_confirmar" });
    await falso.instrucciones.entregar(texto("k9"));
    expect(await cerrar("k9")).toMatchObject({ estado: "sin_confirmar" });
    expect(falso.lectura.todos("message")).toHaveLength(antes);
  });

  it("no_disponible: no se entrega, y el reintento con la misma clave sí", async () => {
    const { falso, cerrar } = montar();
    falso.instrucciones.forzarError({ cuando: "no_disponible" });
    await expect(falso.instrucciones.entregar(texto("k10"))).rejects.toBeInstanceOf(BzzzbxNoDisponible);
    expect(await falso.instrucciones.estado("k10")).toBeNull();
    await falso.instrucciones.entregar(texto("k10"));
    expect(await cerrar("k10")).toMatchObject({ estado: "confirmada" });
  });

  it("veces: el error se repite las veces pedidas y luego deja pasar", async () => {
    const { falso } = montar();
    falso.instrucciones.forzarError({ cuando: "no_disponible", veces: 2 });
    await expect(falso.instrucciones.entregar(texto("k11"))).rejects.toBeInstanceOf(BzzzbxNoDisponible);
    await expect(falso.instrucciones.entregar(texto("k11"))).rejects.toBeInstanceOf(BzzzbxNoDisponible);
    await expect(falso.instrucciones.entregar(texto("k11"))).resolves.toMatchObject({ idempotency_key: "k11" });
  });

  it("un error para otro tipo no afecta a este", async () => {
    const { falso } = montar();
    falso.instrucciones.forzarError({ tipo: "write_po", cuando: "al_entregar" });
    await expect(falso.instrucciones.entregar(texto("k12"))).resolves.toBeDefined();
  });

  it("la marca __forzar_error del payload sirve para los E2E", async () => {
    const { falso, cerrar } = montar();
    await falso.instrucciones.entregar(texto("k13", { payload: { bzzzbx_team_id: "bx-team-0001", body: "x", __forzar_error: "al_ejecutar" } }));
    expect(await cerrar("k13")).toMatchObject({ estado: "fallida" });
    await expect(
      falso.instrucciones.entregar(texto("k14", { payload: { bzzzbx_team_id: "bx-team-0001", body: "x", __forzar_error: "al_entregar" } })),
    ).rejects.toBeInstanceOf(InstruccionRechazada);
  });

  it("BzzzBX caído en la lectura también deja caer las instrucciones", async () => {
    const { falso } = montar();
    falso.lectura.noDisponible(true);
    await expect(falso.instrucciones.entregar(texto("k15"))).rejects.toBeInstanceOf(BzzzbxNoDisponible);
    await expect(falso.instrucciones.estado("k15")).rejects.toBeInstanceOf(BzzzbxNoDisponible);
  });
});

describe("instrucciones falsas: efectos en la lectura", () => {
  it("create_job crea el job y su asignación, y confirma con bzzzbx_job_id y job_number", async () => {
    const { falso, cerrar } = montar();
    const { cursor } = await falso.lectura.cambiosDesde(null);
    await falso.instrucciones.entregar({
      idempotency_key: "k20",
      tipo: "create_job",
      payload: {
        bzzzbx_customer_id: "bx-cust-0001",
        bzzzbx_contact_id: "bx-cont-0001",
        bzzzbx_property_id: "bx-prop-0002",
        bzzzbx_space_id: "bx-space-0002",
        bzzzbx_service_id: "bx-svc-0001",
        service_date: "2030-03-12",
        window_start: "09:00",
        window_end: "12:00",
        bzzzbx_team_id: "bx-team-0001",
        po_number: null,
      },
      actor: OPERADOR,
      sujeto: { request_id: "b0000000-0000-4000-8000-0000000000a2" },
    });
    const cierre = await cerrar("k20");
    expect(cierre.estado).toBe("confirmada");
    const datos = (cierre as Extract<Resultado, { estado: "confirmada" }>).datos!;
    const job = await falso.lectura.obtener("job", datos.bzzzbx_job_id as string);
    expect(job).toMatchObject({ job_number: datos.job_number, bzzzbx_property_id: "bx-prop-0002", status: "scheduled" });
    expect(await falso.lectura.listarPor("assignment", { bzzzbx_job_id: job!.bzzzbx_job_id })).toHaveLength(1);
    const cambios = (await falso.lectura.cambiosDesde(cursor)).cambios.map((c) => c.entidad);
    expect(cambios).toEqual(expect.arrayContaining(["job", "assignment"]));
  });

  it("create_job sin propiedad o sin fecha se rechaza", async () => {
    const { falso } = montar();
    await expect(
      falso.instrucciones.entregar({ idempotency_key: "k21", tipo: "create_job", payload: { bzzzbx_property_id: "bx-prop-0002" }, actor: OPERADOR }),
    ).rejects.toBeInstanceOf(InstruccionRechazada);
  });

  it("reschedule_job cambia fecha y ventana", async () => {
    const { falso, cerrar } = montar();
    await falso.instrucciones.entregar({
      idempotency_key: "k22",
      tipo: "reschedule_job",
      payload: { service_date: "2030-03-20", window_start: "13:00", window_end: "15:00" },
      actor: OPERADOR,
      sujeto: { bzzzbx_job_id: "bx-job-0003" },
    });
    await cerrar("k22");
    expect(await falso.lectura.obtener("job", "bx-job-0003")).toMatchObject({
      service_date: "2030-03-20",
      window_start: "13:00",
      window_end: "15:00",
    });
  });

  it("cancel_job deja el job cancelado", async () => {
    const { falso, cerrar } = montar();
    await falso.instrucciones.entregar({ idempotency_key: "k23", tipo: "cancel_job", payload: {}, actor: OPERADOR, sujeto: { bzzzbx_job_id: "bx-job-0003" } });
    await cerrar("k23");
    expect((await falso.lectura.obtener("job", "bx-job-0003"))?.status).toBe("cancelled");
  });

  it("write_po llena el PO del job", async () => {
    const { falso, cerrar } = montar();
    await falso.instrucciones.entregar({
      idempotency_key: "k24",
      tipo: "write_po",
      payload: { po_number: "PO-EX-0005" },
      actor: OPERADOR,
      sujeto: { bzzzbx_job_id: "bx-job-0005" },
    });
    await cerrar("k24");
    expect((await falso.lectura.obtener("job", "bx-job-0005"))?.po_number).toBe("PO-EX-0005");
  });

  it("send_text y send_email crean el mensaje saliente, y la confirmación trae su ID", async () => {
    const { falso, cerrar } = montar();
    await falso.instrucciones.entregar(texto("k25"));
    await falso.instrucciones.entregar({
      idempotency_key: "k26",
      tipo: "send_email",
      payload: { body: "Scheduled.", bzzzbx_thread_id: "bx-thread-0002" },
      actor: OPERADOR,
    });
    for (const [clave, canal] of [["k25", "text"], ["k26", "email"]] as const) {
      const cierre = (await cerrar(clave)) as Extract<Resultado, { estado: "confirmada" }>;
      const mensaje = await falso.lectura.obtener("message", cierre.datos!.bzzzbx_message_id as string);
      expect(mensaje).toMatchObject({ channel: canal, direction: "outbound", delivery: "sent" });
    }
    const hilo = await falso.lectura.listarPor("message", { bzzzbx_thread_id: "bx-thread-0002" });
    expect(hilo.map((m) => m.direction)).toContain("outbound");
  });

  it("la misma clave dos veces produce un solo efecto", async () => {
    const { falso, cerrar } = montar();
    const antes = falso.lectura.todos("message").length;
    await falso.instrucciones.entregar(texto("k27"));
    await falso.instrucciones.entregar(texto("k27"));
    await cerrar("k27");
    await falso.instrucciones.entregar(texto("k27"));
    expect(falso.lectura.todos("message")).toHaveLength(antes + 1);
  });

  it("el efecto llega a la lectura en el paso observed, antes del cierre", async () => {
    const { falso, paso } = montar();
    await falso.instrucciones.entregar({ idempotency_key: "k28", tipo: "cancel_job", payload: {}, actor: OPERADOR, sujeto: { bzzzbx_job_id: "bx-job-0003" } });
    for (let i = 0; i < 4; i++) paso();
    expect(await falso.instrucciones.estado("k28")).toMatchObject({ paso: "observed" });
    expect((await falso.lectura.obtener("job", "bx-job-0003"))?.status).toBe("cancelled");
  });

  it("los tipos sin efecto (IA, End manually, Validate) solo confirman", async () => {
    const { falso, cerrar } = montar();
    const foto = () => JSON.stringify(falso.lectura.todos("job"));
    const antes = foto();
    await falso.instrucciones.entregar({ idempotency_key: "k29", tipo: "end_job_manually", payload: {}, actor: OPERADOR, sujeto: { bzzzbx_job_id: "bx-job-0005" } });
    await falso.instrucciones.entregar({ idempotency_key: "k30", tipo: "ai_analyze_request", payload: {}, actor: { tipo: "system", proceso: "intake" } });
    expect(await cerrar("k29")).toMatchObject({ estado: "confirmada" });
    expect(await cerrar("k30")).toMatchObject({ estado: "confirmada" });
    expect(foto()).toBe(antes);
  });
});

describe("instrucciones falsas: envíos con crosswalk IDs (OPR-27, P-2)", () => {
  const correo = (clave: string, payload: Record<string, unknown>): Instruccion => ({
    idempotency_key: clave,
    tipo: "send_email",
    payload,
    actor: OPERADOR,
    sujeto: { request_id: "b0000000-0000-4000-8000-0000000000a2" },
  });

  it("send_email resuelve el destinatario: el remitente del original del hilo, en el mismo hilo", async () => {
    const { falso, cerrar } = montar();
    await falso.instrucciones.entregar(correo("k40", { bzzzbx_thread_id: "bx-thread-0002", body: "Scheduled for Friday." }));
    const cierre = (await cerrar("k40")) as Extract<Resultado, { estado: "confirmada" }>;
    const mensaje = await falso.lectura.obtener("message", cierre.datos!.bzzzbx_message_id as string);
    expect(mensaje).toMatchObject({
      channel: "email",
      direction: "outbound",
      bzzzbx_thread_id: "bx-thread-0002",
      to: ["contact.one@example.test"],
      subject: "Re: Clean for Sample Court unit 12",
      body: "Scheduled for Friday.",
    });
  });

  it("send_text resuelve el teléfono del equipo", async () => {
    const { falso, cerrar } = montar();
    await falso.instrucciones.entregar({ ...texto("k41"), payload: { bzzzbx_team_id: "bx-team-0002", body: "Ready?" } });
    const cierre = (await cerrar("k41")) as Extract<Resultado, { estado: "confirmada" }>;
    const mensaje = await falso.lectura.obtener("message", cierre.datos!.bzzzbx_message_id as string);
    expect(mensaje).toMatchObject({ channel: "text", direction: "outbound", to: ["+1 555 0112"], bzzzbx_thread_id: null });
  });

  it("ya no exige `to`, y rechaza con invalid_payload un hilo, un equipo o un cuerpo que no conoce", async () => {
    const { falso } = montar();
    const rechazo = { error_code: "invalid_payload" };
    await expect(falso.instrucciones.entregar(correo("k42", { bzzzbx_thread_id: "bx-thread-9999", body: "x" }))).rejects.toMatchObject(rechazo);
    await expect(falso.instrucciones.entregar(correo("k43", { body: "x" }))).rejects.toMatchObject(rechazo);
    await expect(falso.instrucciones.entregar(correo("k44", { bzzzbx_thread_id: "bx-thread-0002" }))).rejects.toMatchObject(rechazo);
    await expect(falso.instrucciones.entregar({ ...texto("k45"), payload: { bzzzbx_team_id: "bx-team-9999", body: "x" } })).rejects.toMatchObject(rechazo);
    await expect(falso.instrucciones.entregar({ ...texto("k46"), payload: { to: ["bx-team-0001"], body: "x" } })).rejects.toMatchObject(rechazo);
  });

  it("los IDs de los mensajes nuevos no se repiten aunque se cree otro falso", async () => {
    const primero = montar();
    await primero.falso.instrucciones.entregar(texto("k47"));
    const a = ((await primero.cerrar("k47")) as Extract<Resultado, { estado: "confirmada" }>).datos!.bzzzbx_message_id;
    const segundo = montar();
    await segundo.falso.instrucciones.entregar(texto("k47"));
    const b = ((await segundo.cerrar("k47")) as Extract<Resultado, { estado: "confirmada" }>).datos!.bzzzbx_message_id;
    expect(a).not.toBe(b);
  });
});
