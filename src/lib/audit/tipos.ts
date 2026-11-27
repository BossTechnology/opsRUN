/**
 * Modelo de la pestaña Audit (spec OPR-35). `leerAudit` entrega `FilaDeAudit`
 * desde opsRUN; `armarAudit` (pura) arma la `VistaAudit` que solo se pinta.
 * Nada de esto se guarda: la pestaña solo lee.
 */

export type ActorKind = "operator" | "system" | "ai" | "bzzzbx";

/**
 * Un `audit_event` de la request con lo que la pestaña necesita de las tablas
 * unidas (§7.1). Todo ya resuelto en SQL a texto: nunca llega el `details` en
 * crudo ni un id interno que se pueda pintar por error.
 */
export type FilaDeAudit = {
  /** `audit_event.id`, bigint como texto: desempata el orden. */
  id: string;
  event_type: string;
  /** `audit_event_type.label`. */
  label: string;
  /** `audit_event.source`: `bzzzbx_observed` es un hecho de PINCH. */
  source: "opsrun" | "bzzzbx_observed";
  actor_kind: ActorKind;
  /** `operator.display_name` del actor, si es un operador. */
  actor_nombre: string | null;
  reason: string | null;
  /** ISO 8601 UTC con microsegundos. */
  occurred_at: string;
  /** `details.to_operator_id` / `from_operator_id`, ya como nombre. */
  a_operador: string | null;
  de_operador: string | null;
  /** `details.method`: operator, cleaner_text o phone. */
  metodo: string | null;
  /** `details.mode`: `linked` en el enlace de la Fase A. */
  modo: string | null;
  /** `details.job_number` (un valor de opsRUN). */
  job_number: string | null;
  /** `details.bzzzbx_job_id`: solo para pedir el nombre al puerto. */
  bzzzbx_job_id: string | null;
  /** Sugerencias de `details.ai_analysis_id`; null si el evento no lo trae. */
  sugerencias: number | null;
  // alert_occurrence
  alerta_regla: string | null;
  alerta_nivel: "amber" | "red" | null;
  alerta_texto: string | null;
  alerta_resolucion: "auto_cleared" | "fixed_by_action" | "cleared_by_operator" | null;
  // ai_suggestion + ai_field
  ia_campo: string | null;
  ia_campo_label: string | null;
  ia_valor: unknown;
  ia_valor_final: unknown;
  // instruction + instruction_type
  instruccion_label: string | null;
  instruccion_error: string | null;
  // cleaner_confirmation
  equipo_id: string | null;
};

/** Los identificadores de arriba de la lista (§2.2). */
export type IdentificadoresDeAudit = { r_number: number; job_number: string | null };

/** Lo que `leerAudit` devuelve; sin request, lista vacía y sin identificadores. */
export type LecturaDeAudit = { identificadores: IdentificadoresDeAudit | null; filas: FilaDeAudit[] };

export const ENTIDADES_CON_NOMBRE = ["job", "cleaner_team", "property", "service"] as const;
export type EntidadConNombre = (typeof ENTIDADES_CON_NOMBRE)[number];

/**
 * Nombres de PINCH leídos del puerto al pintar (§7.2), nunca guardados.
 * `disponible` es false si BzzzBX no se pudo leer: ahí todo nombre es "— —".
 */
export type Nombres = { disponible: boolean } & { [E in EntidadConNombre]: Record<string, string> };

export const SIN_NOMBRES: Nombres = { disponible: false, job: {}, cleaner_team: {}, property: {}, service: {} };

export type FilaDeVista = {
  id: string;
  /** El instante en ISO UTC, para `<time datetime>`. */
  instante: string;
  /** "Nov 25, 9:30 AM", en la zona de la operación. */
  hora: string;
  tipo: string;
  evento: string;
  complemento: string | null;
  /** El primer `request_assigned` de la request. */
  original: boolean;
  /** Un hecho observado de PINCH, no una acción en opsRUN. */
  observado: boolean;
  persona: string;
  motivo: string | null;
};

export type VistaAudit = {
  request: string;
  jobNumber: string;
  workAppNumber: string;
  /** "Times in EST". */
  zona: string;
  filas: FilaDeVista[];
};
