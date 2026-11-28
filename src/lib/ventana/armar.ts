/**
 * Arma el modelo de la Job window (spec OPR-26 §3, §4 y §8.2) con lo de opsRUN
 * y lo leído de BzzzBX. Función pura: sin base, sin puerto, sin reloj propio.
 *
 * La etapa, el nombre y el estado salen de `armarTablero` (OPR-25), con la
 * misma request como única fila: la ventana y la tarjeta nunca discrepan.
 */
import { alertasDeLaRequest, insigniaDe } from "../alertas/armar";
import type { EsperaDeOpsrun } from "../alertas/tipos";
import { poVigente } from "../billing/po";
import type { AlertResult, Job } from "../bzzzbx/tipos";
import { esReglaLimpiable } from "../etapas/reglas";
import { armarTablero } from "../tablero/armar";
import { diaCorto, fechaYVentana, hace, horaConFecha } from "../tablero/formato";
import { SIN_VALOR, TITULOS, type Tablero, type Tarjeta } from "../tablero/tipos";

import {
  PESTANAS_EN_URL,
  type AlertaVista,
  type CampoPropiedad,
  type CandidatoDeCambio,
  type Confirmaciones,
  type EtapaVentana,
  type FilaVentana,
  type IdPestana,
  type LeidosVentana,
  type OperadorConCarga,
  type Pestana,
  type RespuestaDelCleaner,
  type SugerenciaAbierta,
  type VentanaJob,
} from "./tipos";

export type EntradaVentana = {
  fila: FilaVentana;
  leidos: LeidosVentana;
  /** Hilos de la request (`request_message.bzzzbx_thread_id`), el original primero. */
  hilos: string[];
  operadores: OperadorConCarga[];
  confirmaciones: Confirmaciones;
  /** Hay una instrucción de la request sin cerrar. */
  instruccionAbierta: boolean;
  ahora: Date;
  /** Zona de la operación (S-6 de OPR-25). */
  zona: string;
  bzzzbx: Tablero["bzzzbx"];
  /** El `?tab=` de la URL, tal cual llegó. */
  tab?: string | null;
  /** La respuesta del cleaner que Confirm cleaner puede aceptar (OPR-28); null si no hay. */
  respuestaDelCleaner?: RespuestaDelCleaner | null;
  /** Sugerencias de IA abiertas de los campos del borrador (OPR-28): las que marcan AI en los paneles. */
  sugerencias?: SugerenciaAbierta[];
  /** Los jobs a los que Change linked job puede cambiar el enlace (OPR-29); el servidor los lee solo en Scheduled o con el job cancelado. */
  candidatosDeCambio?: CandidatoDeCambio[];
  candidatosTruncado?: boolean;
  /** Las preguntas abiertas al cleaner (Waiting): dan la insignia gris de Alerts, no abren la ventana en Alerts (OPR-34, P-4 y P-5). */
  esperas?: EsperaDeOpsrun[];
};

export const NO_DISPONIBLE_EN_RELEASE = "Not available in this release";

/** "$185.00"; si la moneda no es de las que conoce `Intl`, "185.00 XYZ". */
export function formatearPrecio(price: NonNullable<Job["price"]>): string {
  const monto = price.amount_cents / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency }).format(monto);
  } catch {
    return `${monto.toFixed(2)} ${price.currency}`;
  }
}

export function armarVentana(entrada: EntradaVentana): VentanaJob {
  const { fila, leidos, hilos, operadores, confirmaciones, ahora, zona, bzzzbx } = entrada;

  const job = fila.bzzzbx_job_id ? leidos.jobs.find((j) => j.bzzzbx_job_id === fila.bzzzbx_job_id) : undefined;
  const cancelado = job?.status === "cancelled";

  // El tablero no muestra un job cancelado: para sacar su tarjeta se lo lee como programado.
  const paraTarjeta = cancelado
    ? { ...leidos, jobs: leidos.jobs.map((j) => (j === job ? { ...j, status: "scheduled" as const } : j)) }
    : leidos;
  const tablero = armarTablero({ filas: [fila], leidos: paraTarjeta, ahora, zona, bzzzbx });
  const tarjeta = tablero.columnas.flatMap((c) => [...c.tarjetas, ...c.pagadas])[0] as Tarjeta;
  const etapa: EtapaVentana = cancelado ? "cancelled" : tarjeta.etapa;

  // En Requests manda el borrador; después, el job de PINCH (como en el tablero).
  const propertyId = job?.bzzzbx_property_id ?? fila.bzzzbx_property_id;
  const spaceId = job ? job.bzzzbx_space_id : fila.bzzzbx_space_id;
  const serviceId = job?.bzzzbx_service_id ?? fila.bzzzbx_service_id;
  const customerId = job?.bzzzbx_customer_id ?? fila.bzzzbx_customer_id;
  const teamId = job ? job.bzzzbx_team_id : fila.bzzzbx_team_id;
  // El PO vigente (OPR-32, P-2): el capturado en opsRUN, el del job en PINCH o el del borrador.
  const vigente = poVigente({ capturado: fila.entered_po_number, pinch: job?.po_number, borrador: fila.po_number });
  const fecha = job?.service_date ?? fila.service_date;
  const inicio = job ? job.window_start : fila.window_start;
  const fin = job ? job.window_end : fila.window_end;

  const property = propertyId ? leidos.properties.find((p) => p.bzzzbx_property_id === propertyId) : undefined;
  const customer = customerId ? leidos.customers.find((c) => c.bzzzbx_customer_id === customerId) : undefined;
  const service = serviceId ? leidos.services.find((s) => s.bzzzbx_service_id === serviceId) : undefined;
  const contact = fila.bzzzbx_contact_id
    ? leidos.contactos.find((c) => c.bzzzbx_contact_id === fila.bzzzbx_contact_id)
    : undefined;
  const team = teamId ? leidos.equipos.find((t) => t.bzzzbx_team_id === teamId) : undefined;
  const espacio = property?.units.find((u) => u.bzzzbx_space_id === spaceId)?.label ?? fila.unit;

  // Lo que BzzzBX respondió que no conoce; con BzzzBX caído solo hay lo último leído, y no es "no encontrado".
  const noEncontrado = (id: string | null | undefined, hallado: unknown) =>
    Boolean(id) && !hallado && bzzzbx.disponible;

  const abiertas = alertasAbiertas(entrada);
  const alertas = abiertas.map(vistaDeAlerta);
  const pestanas = armarPestanas({
    etapa,
    nombre: nombreDePestana(espacio, property?.name),
    conteo: alertas.length,
    insignia: insigniaDe(abiertas, entrada.esperas?.length ?? 0),
    idsRojos: abiertas.filter((a) => a.level === "red").map((a) => a.bzzzbx_alert_id),
  });
  const inicial = elegirInicial(pestanas, entrada.tab);

  const maximo = Math.max(1, ...operadores.map((o) => o.abiertas));

  const campos: CampoPropiedad[] = [
    { clave: "customer", etiqueta: "Customer", valor: customer?.name ?? SIN_VALOR, noEncontrado: noEncontrado(customerId, customer) },
    {
      clave: "contact",
      etiqueta: "Contact",
      valor: contact ? [contact.name, contact.email].filter(Boolean).join(" · ") : SIN_VALOR,
      noEncontrado: noEncontrado(fila.bzzzbx_contact_id, contact),
    },
    { clave: "property", etiqueta: "Property", valor: property?.name ?? SIN_VALOR, noEncontrado: noEncontrado(propertyId, property) },
    { clave: "space", etiqueta: "Space", valor: espacio ?? SIN_VALOR, noEncontrado: false },
    { clave: "service", etiqueta: "Service", valor: service?.name ?? SIN_VALOR, noEncontrado: noEncontrado(serviceId, service) },
    { clave: "date", etiqueta: "Date and window", valor: fechaYVentana(fecha, inicio, fin), noEncontrado: false },
    { clave: "cleaner", etiqueta: "Cleaner", valor: team?.name ?? SIN_VALOR, noEncontrado: noEncontrado(teamId, team) },
    { clave: "po", etiqueta: "PO", valor: vigente?.valor ?? SIN_VALOR, noEncontrado: false },
    { clave: "access", etiqueta: "Access notes", valor: fila.access_notes?.trim() || SIN_VALOR, noEncontrado: false },
  ];
  // OPR-29: el job enlazado y quién lo enlazó o lo cambió por última vez (de Audit), desde Scheduled.
  if (fila.job_number) {
    const cuando = fila.linked_at ? ` · Linked ${diaCorto(fila.linked_at, zona)}${fila.linked_by_nombre ? ` by ${fila.linked_by_nombre}` : ""}` : "";
    campos.push({ clave: "linked", etiqueta: "Linked job", valor: `${fila.job_number}${cuando}`, noEncontrado: false });
  }

  return {
    requestId: fila.id,
    version: fila.change_seq,
    etapa,
    bzzzbx,
    zona,
    encabezado: {
      stage: {
        etapa,
        texto: cancelado ? "Cancelled" : TITULOS[tarjeta.etapa],
        pagada: !cancelado && tarjeta.color === "pagada",
      },
      oss: fila.oss_mark === "oss",
      // La misma condición que la tarjeta (S-6, S-10): solo en Scheduled; con el check-in sale aunque la alerta siga abierta.
      delayed: !cancelado && tarjeta.etapa === "scheduled" && tarjeta.estado.tipo === "delayed",
      nombre: tarjeta.nombre,
      linea: {
        numero: tarjeta.numero,
        fecha: fecha ? fechaYVentana(fecha, inicio, fin) : "Not scheduled",
        servicio: service?.name ?? SIN_VALOR,
        cleaner: team?.name ?? SIN_VALOR,
      },
      precio: job?.price ? formatearPrecio(job.price) : SIN_VALOR,
      asignado: {
        operadorId: fila.owner_operator_id,
        nombre: fila.owner_display_name ?? "Unassigned",
      },
      cargas: operadores.map((o) => ({ id: o.id, nombre: o.nombre, abiertas: o.abiertas, proporcion: o.abiertas / maximo })),
    },
    pestanas,
    inicial,
    propiedad: { tab: nombreDePestana(espacio, property?.name), campos },
    alertas,
    alertasLeidas: abiertas,
    hilos,
    equipoId: teamId ?? null,
    gate: { dueno: fila.owner_operator_id !== null, ...confirmaciones },
    datos: {
      bzzzbxJobId: fila.bzzzbx_job_id,
      tienePropiedad: Boolean(propertyId),
      poRequerido: Boolean(customer?.po_required),
      tienePo: vigente !== null,
      poVigente: vigente,
      // Solo las del job o la request (no las de un mensaje) y de las reglas limpiables (OPR-30, P-6).
      alertasLimpiables: abiertas
        .filter((a) => a.sujeto.tipo !== "message" && esReglaLimpiable(a.rule_id))
        .map((a) => ({ id: a.bzzzbx_alert_id, regla: a.rule_id, nivel: a.level, razon: a.reason_text, abierta: hace(a.opened_at, ahora) })),
      oss: fila.oss_mark,
      ossAuto: fila.oss_mark !== null && fila.oss_source === "auto",
      aprobada: fila.approved_at !== null,
      validada: fila.validated_at !== null,
      fin: instanteDeFin(fila, leidos) ? horaConFecha(instanteDeFin(fila, leidos)!, ahora, zona) : null,
      faltanDetalles: faltanDetalles(fila),
      tieneCliente: Boolean(fila.bzzzbx_customer_id),
      tieneEquipo: Boolean(fila.bzzzbx_team_id),
      respuestaDelCleaner: entrada.respuestaDelCleaner ?? null,
      sugerencias: entrada.sugerencias ?? [],
      candidatosDeCambio: entrada.candidatosDeCambio ?? [],
      candidatosTruncado: entrada.candidatosTruncado ?? false,
    },
    instruccionAbierta: entrada.instruccionAbierta,
  };
}

/**
 * Lo obligatorio de Confirm details que el borrador no tiene (OPR-28, P-3), en
 * el orden del panel: propiedad, servicio, fecha y ventana. Espacio, unidad,
 * camas, notas y PO son opcionales.
 */
function faltanDetalles(fila: FilaVentana): string[] {
  return [
    fila.bzzzbx_property_id ? null : "Property",
    fila.bzzzbx_service_id ? null : "Service",
    fila.service_date ? null : "Date",
    fila.window_start && fila.window_end ? null : "Window",
  ].filter((campo): campo is string => campo !== null);
}

/** Nombre de la pestaña de la propiedad (§4.1): el espacio o unidad; si no, la propiedad; si no, "Property". */
function nombreDePestana(espacio: string | null | undefined, propiedad: string | undefined): string {
  return espacio?.trim() || propiedad || "Property";
}

/** Cuándo terminó el job: el `completed` del Job Tracker (el primero) o End manually. */
function instanteDeFin(fila: FilaVentana, leidos: LeidosVentana): string | null {
  const completado = leidos.eventos
    .filter((e) => fila.bzzzbx_job_id !== null && e.bzzzbx_job_id === fila.bzzzbx_job_id && e.kind === "completed")
    .map((e) => e.occurred_at)
    .sort()[0];
  return completado ?? fila.ended_manually_at;
}

/**
 * Alertas abiertas de la request, de su job o de un mensaje suyo (OPR-34 §3.2):
 * la misma función que usan el tablero, la barra y el panel. Una alerta que
 * opsRUN ya tiene resuelta de cualquier forma no cuenta aunque BzzzBX la siga
 * dando abierta (OPR-30, P-7).
 */
export function alertasAbiertas({
  fila,
  leidos,
  hilos,
}: Pick<EntradaVentana, "fila" | "leidos" | "hilos">): AlertResult[] {
  return alertasDeLaRequest({ fila, alertas: leidos.alertas, hilos, mensajes: leidos.mensajes });
}

const vistaDeAlerta = (a: AlertResult): AlertaVista => ({
  id: a.bzzzbx_alert_id,
  regla: a.rule_id,
  nivel: a.level,
  razon: a.reason_text,
  pideAccion: true,
});

/** En el orden de §4.1 [S-6]. Una pestaña que aún no toca no se muestra [S-7]. */
function armarPestanas({
  etapa,
  nombre,
  conteo,
  insignia,
  idsRojos,
}: {
  etapa: EtapaVentana;
  nombre: string;
  conteo: number;
  insignia: Pestana["insignia"];
  idsRojos: string[];
}): Pestana[] {
  const desdeScheduled = etapa !== "requests";
  const desdeInProgress = etapa === "in_progress" || etapa === "complete" || etapa === "validation";
  const pestanas: Pestana[] = [{ id: "property", nombre, deshabilitada: false }];
  if (desdeScheduled) pestanas.push({ id: "audit", nombre: "Audit", deshabilitada: false });
  if (desdeInProgress) pestanas.push({ id: "tracker", nombre: "Job tracker", deshabilitada: false });
  if (etapa === "validation") pestanas.push({ id: "billing", nombre: "Billing", deshabilitada: false });
  pestanas.push(
    { id: "dollar", nombre: "$", deshabilitada: true, titulo: NO_DISPONIBLE_EN_RELEASE },
    { id: "people", nombre: "People", deshabilitada: true, titulo: NO_DISPONIBLE_EN_RELEASE },
    { id: "alerts", nombre: "Alerts", deshabilitada: false, conteo, insignia, idsRojos },
  );
  return pestanas;
}

/** §4.2: un `?tab=` válido para la etapa; si no, Alerts si alguna pide acción; si no, la propiedad. */
function elegirInicial(pestanas: Pestana[], tab: string | null | undefined): VentanaJob["inicial"] {
  const pedida = (PESTANAS_EN_URL as readonly string[]).includes(tab ?? "") ? (tab as IdPestana) : null;
  if (pedida && pestanas.some((p) => p.id === pedida && !p.deshabilitada)) return { id: pedida, porRegla: false };
  const alertas = pestanas.find((p) => p.id === "alerts");
  if (alertas?.conteo) return { id: "alerts", porRegla: true };
  return { id: "property", porRegla: false };
}
