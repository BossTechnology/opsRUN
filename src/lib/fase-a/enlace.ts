/**
 * Fase A: enlace de una request con el job que el operador creó en las
 * herramientas de PINCH (spec `docs/spec/fase-a-enlace.md`).
 *
 * opsRUN busca en BzzzBX los jobs que pueden ser el de la request y se los
 * propone al operador; él confirma uno o rechaza un candidato. Las propuestas
 * no se guardan: se calculan cada vez. Del job solo se guarda su crosswalk ID
 * y su job number, y cada decisión queda en Audit (lo hacen las funciones SQL
 * de la migración de la Fase A). No sale ninguna instrucción a BzzzBX.
 */
import type { LecturaBzzzbx } from "@/lib/bzzzbx/puertos";
import { BUSCAR_JOBS_MAX, type FiltroDeJobs, type Job, type Leido } from "@/lib/bzzzbx/tipos";
import type { Actor } from "@/lib/db/pool";

/** Lo que el enlace necesita de la request: su estado y el borrador. */
export type RequestParaEnlace = {
  id: string;
  status: "open" | "scheduled";
  /** El job enlazado hoy; null si todavía no hay (OPR-29: Change linked job lo descarta de las propuestas). */
  bzzzbx_job_id: string | null;
  /** `change_seq` de la request, texto (es un bigint). */
  change_seq: string;
  /** ISO 8601. */
  received_at: string;
  bzzzbx_customer_id: string | null;
  bzzzbx_property_id: string | null;
  /** YYYY-MM-DD. */
  service_date: string | null;
  /** HH:MM. */
  window_start: string | null;
  window_end: string | null;
  bzzzbx_team_id: string | null;
};

/** Lo que el enlace lee y escribe en opsRUN. La implementación real es `datos-sql.ts`. */
export interface DatosDeEnlace {
  leerRequest(requestId: string): Promise<RequestParaEnlace | null>;
  /** De los jobs dados, los que ya están enlazados a una request distinta de esta. */
  jobsEnlazadosAOtra(requestId: string, bzzzbxJobIds: string[]): Promise<Set<string>>;
  /** Los jobs que un operador rechazó para esta request. */
  jobsRechazados(requestId: string): Promise<Set<string>>;
  /** Los jobs que dejaron de ser de esta request por un Change linked job (`from_bzzzbx_job_id`, OPR-29). */
  jobsReenlazados(requestId: string): Promise<Set<string>>;
  enlazar(enlace: { requestId: string; bzzzbxJobId: string; jobNumber: string }, actor: Actor): Promise<void>;
  rechazar(rechazo: { requestId: string; bzzzbxJobId: string; motivo: string | null }, actor: Actor): Promise<void>;
  /** Change linked job (OPR-29): `opsrun.relink_observed_job`, con la versión que vio el operador. */
  cambiar(
    cambio: { requestId: string; version: string; bzzzbxJobId: string; jobNumber: string; motivo: string },
    actor: Actor,
  ): Promise<void>;
}

export type DependenciasDeEnlace = { lectura: LecturaBzzzbx; datos: DatosDeEnlace };

export type Coincidencia = "misma_propiedad" | "mismo_cliente" | "misma_fecha" | "misma_ventana" | "mismo_equipo";

export type Candidato = {
  job: Leido<Job>;
  /** Por qué encaja con el borrador, para mostrarlo. */
  coincide: Coincidencia[];
  /** Suggested: el primero, si coincide en propiedad, fecha y, si el borrador lo tiene, cliente (supuesto S-4). */
  sugerido: boolean;
};

export type MotivoVacio = "request_no_abierta" | "sin_cliente_ni_propiedad" | "sin_candidatos";

export type Propuesta = {
  candidatos: Candidato[];
  /**
   * BzzzBX devolvió el máximo de `buscarJobs`: puede haber más jobs que no
   * llegaron. La pantalla lo avisa.
   */
  truncado: boolean;
  motivo_vacio?: MotivoVacio;
};

export type CodigoEnlaceInvalido =
  | "request_no_encontrada"
  | "request_no_abierta"
  | "gate_incompleto"
  | "job_no_encontrado"
  | "job_cancelado"
  | "job_ya_enlazado"
  // Change linked job (OPR-29)
  | "request_no_programada"
  | "cambio_concurrente"
  | "con_hechos_del_job"
  | "mismo_job"
  | "job_actual_con_checkin"
  | "motivo_requerido"
  | "dato_invalido";

/** El enlace no se puede hacer con esos datos. No se escribió nada. */
export class EnlaceInvalido extends Error {
  constructor(readonly codigo: CodigoEnlaceInvalido) {
    super(`enlace inválido: ${codigo}`);
    this.name = "EnlaceInvalido";
  }
}

/**
 * Next empaqueta por separado rutas y páginas: la clase puede venir de otra
 * copia del módulo y `instanceof` falla. Se reconoce por el nombre, como los
 * errores de BzzzBX (`src/lib/bzzzbx/errores.ts`).
 */
export const esEnlaceInvalido = (e: unknown): e is EnlaceInvalido =>
  e instanceof Error && e.name === "EnlaceInvalido" && typeof (e as { codigo?: unknown }).codigo === "string";

/** Días alrededor de la fecha del borrador (supuesto S-3). */
export const DIAS_ALREDEDOR = 3;
/**
 * Sin fecha en el borrador: desde el día UTC anterior a la llegada (una
 * request que llega de noche en América ya es "mañana" en UTC) hasta 30 días
 * después (supuesto S-3).
 */
export const DIAS_ANTES_DE_LA_LLEGADA = 1;
export const DIAS_SIN_FECHA = 30;

const DIA_MS = 86_400_000;

function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);
}

function distanciaEnDias(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DIA_MS;
}

/**
 * La búsqueda que sale del borrador; null si no hay con qué buscar. Por
 * propiedad si la hay: es el criterio más estrecho, así el tope de
 * `buscarJobs` no deja fuera el job bueno de un cliente grande. Por cliente
 * solo sin propiedad.
 */
function filtroDesdeBorrador(request: RequestParaEnlace): FiltroDeJobs | null {
  const criterio = request.bzzzbx_property_id
    ? { bzzzbx_property_id: request.bzzzbx_property_id }
    : request.bzzzbx_customer_id
      ? { bzzzbx_customer_id: request.bzzzbx_customer_id }
      : null;
  if (!criterio) return null;
  if (request.service_date) {
    return {
      ...criterio,
      desde: sumarDias(request.service_date, -DIAS_ALREDEDOR),
      hasta: sumarDias(request.service_date, DIAS_ALREDEDOR),
    };
  }
  const llegada = request.received_at.slice(0, 10);
  return { ...criterio, desde: sumarDias(llegada, -DIAS_ANTES_DE_LA_LLEGADA), hasta: sumarDias(llegada, DIAS_SIN_FECHA) };
}

function coincidencias(request: RequestParaEnlace, job: Job): Coincidencia[] {
  const lista: Coincidencia[] = [];
  if (request.bzzzbx_property_id && job.bzzzbx_property_id === request.bzzzbx_property_id) lista.push("misma_propiedad");
  if (request.bzzzbx_customer_id && job.bzzzbx_customer_id === request.bzzzbx_customer_id) lista.push("mismo_cliente");
  if (request.service_date && job.service_date === request.service_date) lista.push("misma_fecha");
  if (request.window_start && job.window_start === request.window_start && job.window_end === request.window_end) {
    lista.push("misma_ventana");
  }
  if (request.bzzzbx_team_id && job.bzzzbx_team_id === request.bzzzbx_team_id) lista.push("mismo_equipo");
  return lista;
}

async function leerRequest(datos: DatosDeEnlace, requestId: string): Promise<RequestParaEnlace> {
  const request = await datos.leerRequest(requestId);
  if (!request) throw new EnlaceInvalido("request_no_encontrada");
  return request;
}

/**
 * Los jobs de BzzzBX que pueden ser el de la request, del más probable al
 * menos. Puede lanzar `BzzzbxNoDisponible`: sin BzzzBX no se propone nada.
 */
export async function proponerEnlaces(
  { lectura, datos }: DependenciasDeEnlace,
  requestId: string,
  { paraCambio = false }: { paraCambio?: boolean } = {},
): Promise<Propuesta> {
  const request = await leerRequest(datos, requestId);
  // Enlazar es de una request abierta; Change linked job (OPR-29, `paraCambio`) es de una ya programada.
  if (request.status !== (paraCambio ? "scheduled" : "open")) {
    return { candidatos: [], truncado: false, motivo_vacio: "request_no_abierta" };
  }
  const filtro = filtroDesdeBorrador(request);
  if (!filtro) return { candidatos: [], truncado: false, motivo_vacio: "sin_cliente_ni_propiedad" };

  const devueltos = await lectura.buscarJobs(filtro);
  const truncado = devueltos.length >= BUSCAR_JOBS_MAX;
  const encontrados = devueltos.filter((job) => job.status !== "cancelled");
  // Una tras otra: comparten el pool de la base.
  const enlazados = await datos.jobsEnlazadosAOtra(request.id, encontrados.map((job) => job.bzzzbx_job_id));
  const rechazados = await datos.jobsRechazados(request.id);
  // Para un cambio, el job actual y los que ya dejaron de ser de la request tampoco se proponen (OPR-29 §8.1).
  const descartados = new Set(rechazados);
  if (paraCambio) {
    for (const id of await datos.jobsReenlazados(request.id)) descartados.add(id);
    if (request.bzzzbx_job_id) descartados.add(request.bzzzbx_job_id);
  }
  const referencia = request.service_date ?? request.received_at.slice(0, 10);

  const candidatos = encontrados
    .filter((job) => !enlazados.has(job.bzzzbx_job_id) && !descartados.has(job.bzzzbx_job_id))
    .map((job) => ({ job, coincide: coincidencias(request, job), sugerido: false }))
    .sort(
      (a, b) =>
        Number(b.coincide.includes("misma_propiedad")) - Number(a.coincide.includes("misma_propiedad")) ||
        distanciaEnDias(a.job.service_date, referencia) - distanciaEnDias(b.job.service_date, referencia) ||
        Number(b.coincide.includes("mismo_cliente")) - Number(a.coincide.includes("mismo_cliente")) ||
        Number(b.coincide.includes("misma_ventana")) - Number(a.coincide.includes("misma_ventana")) ||
        a.job.job_number.localeCompare(b.job.job_number),
    );

  const primero = candidatos[0];
  if (!primero) return { candidatos: [], truncado, motivo_vacio: "sin_candidatos" };
  primero.sugerido =
    primero.coincide.includes("misma_propiedad") &&
    primero.coincide.includes("misma_fecha") &&
    (!request.bzzzbx_customer_id || primero.coincide.includes("mismo_cliente"));
  return { candidatos, truncado };
}

/**
 * El operador confirma que el job es el de la request. Se relee el job en
 * BzzzBX (tiene que existir y no estar cancelado) y la función SQL lo enlaza:
 * la request queda Scheduled, si cumple el gate de Schedule, con su Audit.
 */
export async function confirmarEnlace(
  { lectura, datos }: DependenciasDeEnlace,
  { requestId, bzzzbxJobId }: { requestId: string; bzzzbxJobId: string },
  actor: Actor,
): Promise<void> {
  const job = await lectura.obtener("job", bzzzbxJobId);
  if (!job) throw new EnlaceInvalido("job_no_encontrado");
  if (job.status === "cancelled") throw new EnlaceInvalido("job_cancelado");
  await datos.enlazar({ requestId, bzzzbxJobId, jobNumber: job.job_number }, actor);
}

/**
 * Change linked job (OPR-29, P-2): el operador cambia el job enlazado de una request que sigue Scheduled, por un
 * enlace equivocado o porque PINCH canceló el job y creó otro. Se releen los dos jobs en BzzzBX: el nuevo tiene que
 * existir, no estar cancelado ni ser el actual, y el actual no puede tener check-in (el job ya tiene hechos, S-11).
 * Lo de opsRUN lo comprueba la función SQL (hechos del job, `OP040`). Solo cambia el crosswalk; el borrador y las
 * confirmaciones no.
 */
export async function cambiarEnlaceDeJob(
  { lectura, datos }: DependenciasDeEnlace,
  { requestId, version, bzzzbxJobId, motivo }: { requestId: string; version: string; bzzzbxJobId: string; motivo: string },
  actor: Actor,
): Promise<void> {
  const limpio = motivo.trim();
  if (!limpio) throw new EnlaceInvalido("motivo_requerido");
  const request = await leerRequest(datos, requestId);
  if (request.status !== "scheduled" || !request.bzzzbx_job_id) throw new EnlaceInvalido("request_no_programada");
  if (request.bzzzbx_job_id === bzzzbxJobId) throw new EnlaceInvalido("mismo_job");

  const nuevo = await lectura.obtener("job", bzzzbxJobId);
  if (!nuevo) throw new EnlaceInvalido("job_no_encontrado");
  if (nuevo.status === "cancelled") throw new EnlaceInvalido("job_cancelado");

  // El actual: con check-in ya tiene hechos en PINCH y no se cambia. Se lee fresco, no de la ventana.
  const eventos = await lectura.listarPor("jobtracker_event", { bzzzbx_job_id: request.bzzzbx_job_id });
  if (eventos.some((e) => e.kind === "checked_in")) throw new EnlaceInvalido("job_actual_con_checkin");

  await datos.cambiar({ requestId, version, bzzzbxJobId, jobNumber: nuevo.job_number, motivo: limpio }, actor);
}

/** El operador dice que ese job no es el de la request. No se le vuelve a proponer para ella. */
export async function rechazarEnlace(
  { datos }: DependenciasDeEnlace,
  { requestId, bzzzbxJobId, motivo }: { requestId: string; bzzzbxJobId: string; motivo?: string | null },
  actor: Actor,
): Promise<void> {
  const limpio = motivo?.trim() || null;
  await datos.rechazar({ requestId, bzzzbxJobId, motivo: limpio }, actor);
}
