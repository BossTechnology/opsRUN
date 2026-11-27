/**
 * Arma el modelo de la Job window (spec OPR-26 §3, §4 y §8.2) con lo de opsRUN
 * y lo leído de BzzzBX. Función pura: sin base, sin puerto, sin reloj propio.
 *
 * La etapa, el nombre y el estado salen de `armarTablero` (OPR-25), con la
 * misma request como única fila: la ventana y la tarjeta nunca discrepan.
 */
import type { AlertResult, Job } from "../bzzzbx/tipos";
import { armarTablero } from "../tablero/armar";
import { fechaYVentana } from "../tablero/formato";
import { SIN_VALOR, TITULOS, type Tablero, type Tarjeta } from "../tablero/tipos";

import {
  PESTANAS_EN_URL,
  type AlertaVista,
  type CampoPropiedad,
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
  const po = job ? job.po_number : fila.po_number;
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
  const pestanas = armarPestanas({ etapa, nombre: nombreDePestana(espacio, property?.name), conteo: alertas.length });
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
    { clave: "po", etiqueta: "PO", valor: po ?? SIN_VALOR, noEncontrado: false },
    { clave: "access", etiqueta: "Access notes", valor: fila.access_notes?.trim() || SIN_VALOR, noEncontrado: false },
  ];

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
      tienePropiedad: Boolean(propertyId),
      poRequerido: Boolean(customer?.po_required),
      tienePo: Boolean(po),
      faltanDetalles: faltanDetalles(fila),
      tieneCliente: Boolean(fila.bzzzbx_customer_id),
      tieneEquipo: Boolean(fila.bzzzbx_team_id),
      respuestaDelCleaner: entrada.respuestaDelCleaner ?? null,
      sugerencias: entrada.sugerencias ?? [],
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

/** Alertas abiertas de la request, de su job o de un mensaje de su hilo (S-8). */
function alertasAbiertas({ fila, leidos, hilos }: EntradaVentana): AlertResult[] {
  const mensajes = new Set(
    leidos.mensajes.filter((m) => m.bzzzbx_thread_id !== null && hilos.includes(m.bzzzbx_thread_id)).map((m) => m.bzzzbx_message_id),
  );
  return leidos.alertas
    .filter((a) => {
      if (a.cleared_at !== null) return false;
      switch (a.sujeto.tipo) {
        case "request":
          return a.sujeto.request_id === fila.id;
        case "job":
          return fila.bzzzbx_job_id !== null && a.sujeto.bzzzbx_job_id === fila.bzzzbx_job_id;
        case "message":
          return mensajes.has(a.sujeto.bzzzbx_message_id);
      }
    })
    .sort((a, b) => a.opened_at.localeCompare(b.opened_at) || a.bzzzbx_alert_id.localeCompare(b.bzzzbx_alert_id));
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
}: {
  etapa: EtapaVentana;
  nombre: string;
  conteo: number;
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
    { id: "alerts", nombre: "Alerts", deshabilitada: false, conteo },
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
