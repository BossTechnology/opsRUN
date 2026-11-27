/**
 * Contrato de props de las ranuras de la Job window (spec OPR-26 §7). Cada
 * ranura es un componente que la tarjeta dueña reemplaza: OPR-26 fija el
 * lugar, las props y el marcador (`data-ranura`). Las props son solo datos ya
 * leídos y Server Actions; ninguna ranura lee de BzzzBX desde el navegador.
 */
import type { Propuesta } from "../fase-a/enlace";
import type { AlertResult } from "../bzzzbx/tipos";
import type { ResultadoAccion } from "../acciones/tipos";

import type { EtapaVentana } from "./tipos";

/** Props comunes a todas. */
export type PropsRanuraBase = {
  requestId: string;
  etapa: EtapaVentana;
  bzzzbx: { disponible: boolean; actualizadoEn: string | null };
  /** `OPSRUN_ZONA_HORARIA` (OPR-25, S-6). */
  zona: string;
};

/** Conversación (OPR-27): columna izquierda, con su propio `Suspense`. Lee sus mensajes en su propio server component. */
export type PropsRanuraConversacion = PropsRanuraBase & {
  /** Hilos de la request (`request_message.bzzzbx_thread_id`), el original primero. */
  hilos: string[];
  /** Si el composer puede enviar; false con BzzzBX caído o job cancelado. */
  puedeEnviar: boolean;
};

/** Enlace de la Fase A (OPR-28): arriba de la pestaña de la propiedad, solo en Requests. */
export type PropsRanuraEnlace = PropsRanuraBase & {
  /** De `proponerEnlaces` (src/lib/fase-a), o el error si BzzzBX no respondió. */
  propuesta: Propuesta | { error: "bzzzbx_no_disponible" };
  /** Estado del gate de Schedule, para decir qué falta antes de enlazar. */
  gate: { dueno: boolean; details: boolean; sender: boolean; cleaner: boolean };
  /** Server Action: pasa por `ejecutarAccion` con la acción `schedule`. */
  confirmar: (bzzzbxJobId: string) => Promise<ResultadoAccion>;
  /** Server Action: pasa por `ejecutarAccion` con la acción interna `reject_job_link`. */
  rechazar: (bzzzbxJobId: string, motivo: string | null) => Promise<ResultadoAccion>;
};

/** Audit (OPR-35): pestaña Audit, desde Scheduled. La ranura lee `audit_event` de la request. */
export type PropsRanuraAudit = PropsRanuraBase;

/** Alerts (OPR-34): además de lo común, las alertas ya leídas. */
export type PropsRanuraAlertas = PropsRanuraBase & { alertas: AlertResult[] };

/** Job tracker (OPR-30), desde In Progress. */
export type PropsRanuraTracker = PropsRanuraBase;

/** Billing (OPR-32), en Validation. */
export type PropsRanuraBilling = PropsRanuraBase;

/** El marcador de las ranuras que aún no tienen su tarjeta [S-10]. */
export const TEXTO_RANURA_PENDIENTE = "Coming in a later build";
