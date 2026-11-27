/**
 * Arma la pestaña Job tracker (spec OPR-30 §4.1 y §4.2) con lo leído de BzzzBX:
 * estado y ventana, llegada, inicio, fin, duración con la esperada, y la galería
 * de fotos Before / After. Función pura: sin base, sin puerto, sin reloj propio.
 * Nada de esto se guarda: la duración, el "running" y la hora se calculan al pintar.
 */
import type { AlertResult, Job, JobTrackerEvent, Photo } from "../bzzzbx/tipos";
import { fechaYVentana, horaConFecha } from "../tablero/formato";
import { SIN_VALOR } from "../tablero/tipos";

/** Una miniatura de la galería. La imagen llega por `/api/fotos/[id]`, nunca de la base. */
export type FotoVista = {
  id: string;
  fase: "before" | "after";
  /** "Before photo, Nov 27, 10:05 AM". */
  alt: string;
  /** "Nov 27, 10:05 AM". */
  hora: string;
  /** La ruta del servidor que pide la imagen al puerto. */
  src: string;
};

export type VistaTracker = {
  /** "In Progress", "Complete", "Validation": la etapa de la ventana. */
  etapa: string;
  /** Hay una Running long (MEC-003) abierta. */
  runningLong: boolean;
  /** "Wed, Nov 25 · 10:00 AM–2:00 PM", o `— —`. */
  ventana: string;
  llegada: string;
  inicio: string;
  fin: string;
  duracion: {
    /** "1h 05m", o `— —` si no empezó. */
    valor: string;
    /** El job empezó y no terminó: la duración es ahora − inicio. */
    corriendo: boolean;
    /** La de la ventana del job [S-2], o `— —`. */
    esperada: string;
  };
  fotos: { before: FotoVista[]; after: FotoVista[] };
  /** BzzzBX respondió: con false las miniaturas se ven como "Photo unavailable". */
  fotosDisponibles: boolean;
};

export type EntradaTracker = {
  requestId: string;
  /** El texto de la etapa de la ventana ("In Progress"). */
  etapa: string;
  job: Pick<Job, "service_date" | "window_start" | "window_end"> | undefined;
  /** Los eventos del Job Tracker del job (de cualquier tipo). */
  eventos: JobTrackerEvent[];
  fotos: Photo[];
  /** Las alertas abiertas de la ventana (sin las limpiadas en opsRUN). */
  alertas: Pick<AlertResult, "rule_id">[];
  /** End manually (Fase B) o el fin que opsRUN guardó: solo si el Job Tracker no trae `completed`. */
  finAMano?: string | null;
  ahora: Date;
  zona: string;
  bzzzbxDisponible: boolean;
};

/** El primero del tipo, por hora [S-3]: igual que `armarTablero`. */
function primero(eventos: JobTrackerEvent[], kind: JobTrackerEvent["kind"]): JobTrackerEvent | undefined {
  return eventos.filter((e) => e.kind === kind).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))[0];
}

/** "1h 05m" o "45m". Una duración negativa (reloj torcido) se pinta como 0. */
export function duracionTexto(ms: number): string {
  const minutos = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Los minutos de un "HH:MM". */
const minutosDeReloj = (hhmm: string): number => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const FASES = { before: "Before", after: "After" } as const;

export function armarTracker(entrada: EntradaTracker): VistaTracker {
  const { requestId, job, eventos, ahora, zona } = entrada;

  const llegada = primero(eventos, "checked_in")?.occurred_at ?? null;
  const inicio = primero(eventos, "started")?.occurred_at ?? null;
  const fin = primero(eventos, "completed")?.occurred_at ?? entrada.finAMano ?? null;
  const hora = (instante: string | null) => (instante ? horaConFecha(instante, ahora, zona) : SIN_VALOR);

  const corriendo = inicio !== null && fin === null;
  const hasta = fin !== null ? Date.parse(fin) : ahora.getTime();
  const esperadaMinutos =
    job?.window_start && job.window_end ? minutosDeReloj(job.window_end) - minutosDeReloj(job.window_start) : null;

  const fotos = (fase: Photo["phase"]): FotoVista[] =>
    entrada.fotos
      .filter((f) => f.phase === fase)
      .sort((a, b) => a.taken_at.localeCompare(b.taken_at) || a.bzzzbx_photo_id.localeCompare(b.bzzzbx_photo_id))
      .map((f) => ({
        id: f.bzzzbx_photo_id,
        fase: f.phase,
        alt: `${FASES[f.phase]} photo, ${horaConFecha(f.taken_at, ahora, zona)}`,
        hora: horaConFecha(f.taken_at, ahora, zona),
        src: `/api/fotos/${encodeURIComponent(f.bzzzbx_photo_id)}?request=${encodeURIComponent(requestId)}`,
      }));

  return {
    etapa: entrada.etapa,
    runningLong: entrada.alertas.some((a) => a.rule_id === "MEC-003"),
    ventana: job ? fechaYVentana(job.service_date, job.window_start, job.window_end) : SIN_VALOR,
    llegada: hora(llegada),
    inicio: hora(inicio),
    fin: hora(fin),
    duracion: {
      valor: inicio !== null ? duracionTexto(hasta - Date.parse(inicio)) : SIN_VALOR,
      corriendo,
      esperada: esperadaMinutos !== null && esperadaMinutos > 0 ? duracionTexto(esperadaMinutos * 60_000) : SIN_VALOR,
    },
    fotos: { before: fotos("before"), after: fotos("after") },
    fotosDisponibles: entrada.bzzzbxDisponible,
  };
}
