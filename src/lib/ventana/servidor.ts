import "server-only";

/**
 * La Job window en el servidor (spec OPR-26 §8): opsRUN por el pool de
 * `opsrun_app` en una transacción de solo lectura, y BzzzBX por su puerto, con
 * el presupuesto de §2. Nada de esto se lee desde el navegador.
 */
import { cache } from "react";

import { armarIa } from "../analisis-ia/armar";
import { armarBilling, type VistaBilling } from "../billing/armar";
import { comoOpsrunApp } from "../db/servidor";
import { crearDatosDeEnlace } from "../fase-a/datos-sql";
import type { DependenciasDeEnlace } from "../fase-a/enlace";
import { lecturaOAusente, zonaDeLaOperacion } from "../tablero/servidor";
import { armarTracker, type VistaTracker } from "../tracker/armar";

import { alertasAbiertas, armarVentana, type EntradaVentana } from "./armar";
import { leerParaConfirmar } from "./confirmar";
import { idsProponidos, leerIa, nombresParaIa } from "./ia";
import { esIdDeRequest, leerDeOpsrun } from "./consultas";
import { leerVentanaDeBzzzbx, type MemoriaVentana } from "./leer";
import { candidatosParaElCambio, propuestaParaLaVentana, type PropuestaDeRanura } from "./propuesta";
import type { VentanaJob } from "./tipos";

const global = globalThis as typeof globalThis & { __opsrunMemoriaVentana?: MemoriaVentana };

/** Lo último que BzzzBX respondió por request: por proceso, nunca en la base. */
const memoria = (): MemoriaVentana => (global.__opsrunMemoriaVentana ??= new Map());

/** Vuelve a cero lo recordado (el control de los E2E que reinicia el falso). */
export function olvidarVentanas(): void {
  global.__opsrunMemoriaVentana = new Map();
}

/** Lo leído de opsRUN y de BzzzBX para una request, listo para armar la ventana y las ranuras que leen lo mismo. */
async function leerEntrada(requestId: string): Promise<Omit<EntradaVentana, "tab"> | null> {
  if (!esIdDeRequest(requestId)) return null;
  // Todo de opsRUN en una sola transacción de solo lectura: la ventana y lo que piden los paneles de Confirm (OPR-28).
  const leido = await comoOpsrunApp(async (db) => {
    const base = await leerDeOpsrun(db, requestId);
    if (!base) return null;
    const confirmar = await leerParaConfirmar(db, requestId);
    // El análisis de IA (OPR-36) solo se ve en Requests: una lectura, nunca un pedido.
    const ia = base.fila.status === "open" ? await leerIa(db, requestId) : null;
    return { base, confirmar, ia };
  });
  if (!leido) return null;
  const { base: deOpsrun, confirmar, ia } = leido;

  const ahora = new Date();
  const { leidos, bzzzbx } = await leerVentanaDeBzzzbx({
    fila: deOpsrun.fila,
    hilos: deOpsrun.hilos,
    lectura: lecturaOAusente(),
    ahora,
    memoria: memoria(),
    // Los nombres de lo que propuso la IA, dentro del mismo presupuesto (nunca se guardan).
    extras: ia ? idsProponidos(ia.sugerencias) : undefined,
  });
  const propiedad = leidos.properties.find((p) => p.bzzzbx_property_id === deOpsrun.fila.bzzzbx_property_id);
  return {
    fila: deOpsrun.fila,
    leidos,
    hilos: deOpsrun.hilos,
    operadores: deOpsrun.operadores,
    confirmaciones: deOpsrun.confirmaciones,
    instruccionAbierta: deOpsrun.instruccionAbierta,
    ahora,
    zona: zonaDeLaOperacion(),
    bzzzbx,
    respuestaDelCleaner: confirmar.respuestaDelCleaner,
    sugerencias: confirmar.sugerencias,
    esperas: deOpsrun.esperas,
    ia: ia
      ? armarIa({
          borrador: deOpsrun.fila,
          analisis: ia.analisis,
          sugerencias: ia.sugerencias,
          nombres: nombresParaIa(leidos),
          espacios: propiedad?.units.map((u) => ({ id: u.bzzzbx_space_id, label: u.label })),
        })
      : null,
  };
}

/**
 * La ventana de una request, recalculada con los datos de este momento; null si
 * el id no es un uuid o la request no existe. `tab` es el `?tab=` de la URL.
 */
export async function obtenerVentana(requestId: string, tab: string | null = null): Promise<VentanaJob | null> {
  const entrada = await leerEntrada(requestId);
  if (!entrada) return null;
  const ventana = armarVentana({ ...entrada, tab });
  // Change linked job (OPR-29) solo aplica en Scheduled o con el job cancelado, y necesita BzzzBX: ahí se leen los candidatos.
  const puedeCambiarElJob = entrada.fila.status === "scheduled" && (ventana.etapa === "scheduled" || ventana.etapa === "cancelled");
  if (!puedeCambiarElJob || !ventana.bzzzbx.disponible) return ventana;
  return armarVentana({ ...entrada, tab, ...(await candidatosDeCambio(requestId)) });
}

/**
 * Los jobs a los que se puede cambiar el enlace de la request, con el nombre de su cleaner. Una lectura que falla
 * no rompe la ventana: sin candidatos, Change linked job sale bloqueada.
 */
async function candidatosDeCambio(requestId: string) {
  try {
    const propuesta = await propuestaParaLaVentana(dependenciasDeEnlaceDeLaVentana(), requestId, { paraCambio: true });
    const equipos = "error" in propuesta ? {} : await nombresDeEquipos(propuesta.candidatos.flatMap((c) => (c.job.bzzzbx_team_id ? [c.job.bzzzbx_team_id] : [])));
    return candidatosParaElCambio(propuesta, equipos);
  } catch (e) {
    console.error("[opsRUN] ventana: no se pudieron leer los candidatos de Change linked job:", e instanceof Error ? e.message : e);
    return { candidatosDeCambio: [], candidatosTruncado: false };
  }
}

/** Lo leído de la request, una vez por render: lo piden las ranuras Job tracker y Billing (React `cache`). */
const entradaParaRanura = cache(leerEntrada);

export type DatosDeTracker = { vista: VistaTracker; etapa: string };

/** La pestaña Job tracker de una request (OPR-30), con las fotos y las alertas ya leídas; null si no existe. */
export async function datosDeTracker(requestId: string): Promise<DatosDeTracker | null> {
  const entrada = await entradaParaRanura(requestId);
  if (!entrada) return null;
  const { fila, leidos, hilos, ahora, zona, bzzzbx } = entrada;
  const ventana = armarVentana({ ...entrada, tab: null });
  const jobId = fila.bzzzbx_job_id;
  const vista = armarTracker({
    requestId: fila.id,
    etapa: ventana.encabezado.stage.texto,
    job: jobId ? leidos.jobs.find((j) => j.bzzzbx_job_id === jobId) : undefined,
    eventos: jobId ? leidos.eventos.filter((e) => e.bzzzbx_job_id === jobId) : [],
    fotos: jobId ? leidos.fotos.filter((f) => f.bzzzbx_job_id === jobId) : [],
    alertas: alertasAbiertas({ fila, leidos, hilos }),
    finAMano: fila.ended_manually_at,
    ahora,
    zona,
    bzzzbxDisponible: bzzzbx.disponible,
  });
  return { vista, etapa: ventana.etapa };
}

export type DatosDeBilling = { vista: VistaBilling; etapa: string; version: string };

/** La pestaña Billing de una request (OPR-32); null si no existe. */
export async function datosDeBilling(requestId: string): Promise<DatosDeBilling | null> {
  const entrada = await entradaParaRanura(requestId);
  if (!entrada) return null;
  const { fila, leidos, zona, bzzzbx } = entrada;
  const ventana = armarVentana({ ...entrada, tab: null });
  const jobId = fila.bzzzbx_job_id;
  const job = jobId ? leidos.jobs.find((j) => j.bzzzbx_job_id === jobId) : undefined;
  const clienteId = job?.bzzzbx_customer_id ?? fila.bzzzbx_customer_id;
  const vista = armarBilling({
    fila,
    job,
    customer: clienteId ? leidos.customers.find((c) => c.bzzzbx_customer_id === clienteId) : undefined,
    pago: jobId ? leidos.pagos.find((p) => p.bzzzbx_job_id === jobId) : undefined,
    zona,
    bzzzbxDisponible: bzzzbx.disponible,
  });
  return { vista, etapa: ventana.etapa, version: ventana.version };
}

/**
 * Lo que el enlace de la Fase A necesita: el puerto de BzzzBX (o uno que dice
 * "no disponible") y los datos de opsRUN. Lo usan la propuesta de la ranura y
 * los ejecutores de `schedule` y `reject_job_link`.
 */
export function dependenciasDeEnlaceDeLaVentana(): DependenciasDeEnlace {
  return { lectura: lecturaOAusente(), datos: crearDatosDeEnlace() };
}

/**
 * Nombre del cleaner de cada equipo dado, para la línea de los candidatos. Si
 * BzzzBX no responde, vacío: la ranura muestra "— —" y no pierde la lista.
 */
export async function nombresDeEquipos(ids: string[]): Promise<Record<string, string>> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return {};
  try {
    const equipos = await dependenciasDeEnlaceDeLaVentana().lectura.obtenerVarios("cleaner_team", unicos);
    return Object.fromEntries(equipos.map((t) => [t.bzzzbx_team_id, t.name]));
  } catch {
    return {};
  }
}

/** La propuesta de enlace de una request en Requests, para la ranura de la Fase A (§7.2). */
export function propuestaDeLaRequest(requestId: string): Promise<PropuestaDeRanura> {
  return propuestaParaLaVentana(dependenciasDeEnlaceDeLaVentana(), requestId);
}
