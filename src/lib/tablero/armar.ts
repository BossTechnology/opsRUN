/**
 * Arma el modelo del tablero (spec OPR-25 §1) con lo de opsRUN y lo leído de
 * BzzzBX. Función pura: sin base, sin puerto, sin reloj propio.
 */
import type { AlertResult, JobTrackerEvent } from "../bzzzbx/tipos";
import { poVigente } from "../billing/po";

import { diaCorto, fechaYVentana, horaOFecha, iniciales } from "./formato";
import {
  ETAPAS,
  SIN_VALOR,
  TITULOS,
  type Color,
  type Columna,
  type Etapa,
  type FilaRequest,
  type Leidos,
  type ResumenAlertas,
  type Tablero,
  type Tarjeta,
} from "./tipos";

export type EntradaTablero = {
  filas: FilaRequest[];
  leidos: Leidos;
  ahora: Date;
  /** Zona de la operación para las horas (S-6). */
  zona: string;
  bzzzbx: Tablero["bzzzbx"];
};

const porClave = <T, K extends keyof T>(filas: T[], clave: K) =>
  new Map(filas.map((f) => [f[clave] as unknown as string, f]));

function agrupar<T>(filas: T[], clave: (f: T) => string | null): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const f of filas) {
    const k = clave(f);
    if (k === null) continue;
    grupos.set(k, [...(grupos.get(k) ?? []), f]);
  }
  return grupos;
}

export function resumirAlertas(alertas: Pick<AlertResult, "level">[]): ResumenAlertas {
  if (alertas.length === 0) return { total: 0, nivel: null };
  return { total: alertas.length, nivel: alertas.some((a) => a.level === "red") ? "red" : "amber" };
}

function sumar(resumenes: ResumenAlertas[]): ResumenAlertas {
  const total = resumenes.reduce((s, r) => s + r.total, 0);
  if (total === 0) return { total: 0, nivel: null };
  return { total, nivel: resumenes.some((r) => r.nivel === "red") ? "red" : "amber" };
}

export function armarTablero({ filas, leidos, ahora, zona, bzzzbx }: EntradaTablero): Tablero {
  const jobs = porClave(leidos.jobs, "bzzzbx_job_id");
  const properties = porClave(leidos.properties, "bzzzbx_property_id");
  const customers = porClave(leidos.customers, "bzzzbx_customer_id");
  const services = porClave(leidos.services, "bzzzbx_service_id");
  const pagos = porClave(leidos.pagos, "bzzzbx_job_id");
  const salud = porClave(leidos.salud, "bzzzbx_job_id");
  const eventos = agrupar(leidos.eventos, (e) => e.bzzzbx_job_id);
  const mensajes = agrupar(leidos.mensajes, (m) => m.bzzzbx_thread_id);

  const requestDeJob = new Map(filas.filter((f) => f.bzzzbx_job_id).map((f) => [f.bzzzbx_job_id!, f.id]));
  // Una alerta que el operador ya limpió en opsRUN no cuenta aunque BzzzBX la siga dando abierta (OPR-30, P-7).
  const limpiadas = new Set(filas.flatMap((f) => f.alertas_limpiadas));
  const abiertas = agrupar(
    leidos.alertas.filter((a) => a.cleared_at === null && !limpiadas.has(a.bzzzbx_alert_id)),
    (a) =>
      a.sujeto.tipo === "request"
        ? a.sujeto.request_id
        : a.sujeto.tipo === "job"
          ? (requestDeJob.get(a.sujeto.bzzzbx_job_id) ?? null)
          : null,
  );

  const tarjetas: Tarjeta[] = [];
  for (const fila of filas) {
    const job = fila.bzzzbx_job_id ? jobs.get(fila.bzzzbx_job_id) : undefined;
    if (job?.status === "cancelled") continue;

    // En Requests manda el borrador; después, el job de PINCH.
    const propertyId = job?.bzzzbx_property_id ?? fila.bzzzbx_property_id;
    const spaceId = job ? job.bzzzbx_space_id : fila.bzzzbx_space_id;
    const serviceId = job?.bzzzbx_service_id ?? fila.bzzzbx_service_id;
    const customerId = job?.bzzzbx_customer_id ?? fila.bzzzbx_customer_id;
    // El PO vigente (OPR-32, P-2): el capturado en opsRUN, el del job en PINCH o el del borrador.
    const po = poVigente({ capturado: fila.entered_po_number, pinch: job?.po_number, borrador: fila.po_number });

    const property = propertyId ? properties.get(propertyId) : undefined;
    const service = serviceId ? services.get(serviceId) : undefined;
    const customer = customerId ? customers.get(customerId) : undefined;
    const pago = fila.bzzzbx_job_id ? pagos.get(fila.bzzzbx_job_id) : undefined;
    const evs = fila.bzzzbx_job_id ? (eventos.get(fila.bzzzbx_job_id) ?? []) : [];
    const alertas = abiertas.get(fila.id) ?? [];

    const checkIn = primero(evs, "checked_in");
    const fin = primero(evs, "completed")?.occurred_at ?? fila.ended_manually_at;
    const etapa: Etapa =
      fila.status === "open"
        ? "requests"
        : fila.approved_at
          ? "validation"
          : fin
            ? "complete"
            : checkIn
              ? "in_progress"
              : "scheduled";

    const espacio = property?.units.find((u) => u.bzzzbx_space_id === spaceId)?.label ?? fila.unit;
    const nombre = property ? [property.name, espacio].filter(Boolean).join(" ") : SIN_VALOR;

    const pagada = Boolean(pago?.paid);
    const delayed = etapa === "scheduled" && alertas.some((a) => a.rule_id === "OPS-010");
    const estado: Tarjeta["estado"] = (() => {
      switch (etapa) {
        case "requests":
          return { tipo: "recibida", texto: horaOFecha(fila.received_at, ahora, zona) };
        case "scheduled":
          return delayed
            ? { tipo: "delayed", texto: "Delayed" }
            : {
                tipo: "programada",
                texto: fechaYVentana(
                  job?.service_date ?? fila.service_date,
                  job ? job.window_start : fila.window_start,
                  job ? job.window_end : fila.window_end,
                ),
              };
        case "in_progress":
          return { tipo: "en_curso", texto: `Checked in ${horaOFecha(checkIn!.occurred_at, ahora, zona)}` };
        case "complete":
          return { tipo: "terminada", texto: `Ended ${horaOFecha(fin!, ahora, zona)}` };
        case "validation":
          if (pagada && pago?.paid_at) return { tipo: "paid", texto: `Paid ${diaCorto(pago.paid_at, zona)}` };
          // Validada y sin pagar (OPR-32, S-10).
          if (fila.validated_at) return { tipo: "validada", texto: `Validated ${diaCorto(fila.validated_at, zona)}` };
          return { tipo: "aprobada", texto: `Approved ${diaCorto(fila.approved_at!, zona)}` };
      }
    })();

    const resumen = resumirAlertas(alertas);
    const health = fila.bzzzbx_job_id ? salud.get(fila.bzzzbx_job_id)?.status : undefined;
    const color: Color = pagada
      ? "pagada"
      : health === "breached" || resumen.nivel === "red"
        ? "sombreada"
        : health === "at_risk" || resumen.nivel === "amber"
          ? "borde"
          : fila.owner_operator_id === null
            ? "sin_dueno"
            : "normal";

    const flags: string[] = [];
    if (po) flags.push("PO");
    else if (customer?.po_required) flags.push("PO missing");
    if (fila.oss_mark === "oss") flags.push("OSS");

    const hilo = fila.bzzzbx_thread_id ? (mensajes.get(fila.bzzzbx_thread_id) ?? []) : [];
    const original = hilo.reduce<string | null>((min, m) => (min === null || m.sent_at < min ? m.sent_at : min), null);
    const chat = hilo.some((m) => m.direction === "inbound" && original !== null && m.sent_at > original);

    tarjetas.push({
      requestId: fila.id,
      etapa,
      numero: fila.job_number ?? `R${fila.r_number}`,
      nombre,
      estado,
      ciudad: property?.city ?? SIN_VALOR,
      tipo: service?.type ?? SIN_VALOR,
      servicio: service?.name ?? SIN_VALOR,
      chat,
      flags,
      color,
      dueno:
        fila.owner_operator_id && fila.owner_display_name
          ? { id: fila.owner_operator_id, nombre: fila.owner_display_name, iniciales: iniciales(fila.owner_display_name) }
          : null,
      alertas: resumen,
      orden: claveDeOrden(etapa, fila, job?.service_date, job?.window_start, checkIn?.occurred_at, fin),
    });
  }

  const columnas: Columna[] = ETAPAS.map((etapa) => {
    const deEtapa = tarjetas.filter((t) => t.etapa === etapa).sort((a, b) => a.orden.localeCompare(b.orden));
    const pagadas = etapa === "validation" ? deEtapa.filter((t) => t.color === "pagada") : [];
    return {
      etapa,
      titulo: TITULOS[etapa],
      tarjetas: deEtapa.filter((t) => !pagadas.includes(t)),
      pagadas,
      alertas: sumar(deEtapa.map((t) => t.alertas)),
    };
  });

  return { columnas, alertasAbiertas: sumar(columnas.map((c) => c.alertas)), bzzzbx };
}

function primero(eventos: JobTrackerEvent[], kind: JobTrackerEvent["kind"]): JobTrackerEvent | undefined {
  return eventos
    .filter((e) => e.kind === kind)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))[0];
}

/** Orden dentro de la columna (S-1): lo más antiguo o lo más próximo arriba. */
function claveDeOrden(
  etapa: Etapa,
  fila: FilaRequest,
  fechaJob: string | undefined,
  inicioJob: string | null | undefined,
  checkIn: string | undefined,
  fin: string | null | undefined,
): string {
  const instante = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString() : "~");
  switch (etapa) {
    case "requests":
      return instante(fila.received_at);
    case "scheduled":
      return `${fechaJob ?? fila.service_date ?? "~"}T${inicioJob ?? fila.window_start ?? "~"}`;
    case "in_progress":
      return instante(checkIn);
    case "complete":
      return instante(fin);
    case "validation":
      return instante(fila.approved_at);
  }
}
