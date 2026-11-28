/**
 * Modelo de la pestaña Alerts y del panel de la barra (spec OPR-34 §3 a §6). Lo
 * arman `armarAlertas` y `armarPanelAlertas` (puros) con lo de opsRUN y lo leído
 * de BzzzBX; los componentes solo lo pintan. Nada de esto se guarda.
 */
import type { Etapa, NivelAlerta } from "../tablero/tipos";

export type Resolucion = "auto_cleared" | "fixed_by_action" | "cleared_by_operator";

/**
 * Una `alert_occurrence` de opsRUN con lo que la pestaña necesita: la
 * instantánea de la apertura, la resolución y quién la hizo. El historial es de
 * opsRUN (principio 1); si la alerta sigue abierta lo dice BzzzBX, no esto.
 */
export type OcurrenciaDeOpsrun = {
  bzzzbx_alert_id: string;
  request_id: string;
  rule_id: string;
  level: NivelAlerta;
  /** Como llegó al abrirse (`bzzzbx-snapshot`). */
  reason_text: string;
  bzzzbx_message_id: string | null;
  /** ISO UTC. */
  opened_at: string;
  resolved_at: string | null;
  resolution: Resolucion | null;
  /** Nombre del operador que la resolvió; null con `auto_cleared`. */
  resolved_by_nombre: string | null;
  resolution_reason: string | null;
  /** `audit_event_type.label` del evento que la arregló ("Assigned"); null si no se sabe. */
  fixing_label: string | null;
};

/** Una pregunta al cleaner sin cerrar (`cleaner_confirmation` asked o replied). */
export type EsperaDeOpsrun = {
  id: string;
  request_id: string;
  purpose: "initial" | "reschedule";
  bzzzbx_team_id: string;
  status: "asked" | "replied";
  /** ISO UTC. */
  asked_at: string;
  new_service_date: string | null;
  new_window_start: string | null;
  new_window_end: string | null;
};

/** Lo que hace el botón de una alerta (§5.3). Nunca ejecuta nada: abre una acción de la barra. */
export type BotonDeAlerta =
  | { tipo: "accion"; codigo: string; prellenado: Record<string, unknown> | null }
  /**
   * Edit and resend (OPR-19 §6.3): lleva el foco al mensaje. `estado` hereda la disponibilidad del modo del canal del
   * Composer, o dice "Message not found in BzzzBX"; en gris nunca lleva a ninguna parte desde aquí.
   */
  | { tipo: "reenviar"; mensajeId: string | null; estado: DisponibilidadDelBoton }
  | { tipo: "texto"; texto: string };

export type DisponibilidadDelBoton = { disponible: true } | { disponible: false; razon: string };

/**
 * Lo que la pestaña sabe del mensaje de una alerta de mensaje (OPR-19 §6.2 y §6.3), leído de BzzzBX al pintar por la
 * misma lectura que la conversación. Nada de esto se guarda.
 */
export type MensajeDeAlerta = {
  /** BzzzBX respondió y no conoce el mensaje: el botón dice "Message not found in BzzzBX". */
  encontrado: boolean;
  /** El correo, o el equipo y su teléfono; null si no se sabe (se ve "— —"). */
  destinatario: string | null;
  /** Lo que puede hacer el Composer en el modo del canal del mensaje. */
  modo: DisponibilidadDelBoton;
};

export type FilaNeedsAction = {
  id: string;
  regla: string;
  nombreRegla: string;
  nivel: NivelAlerta;
  motivo: string;
  /** "Opened Nov 27, 10:05 AM". */
  abiertaTexto: string;
  /** ISO, para el `<time datetime>`. */
  abiertaIso: string;
  /** "Open 1 h 5 min". */
  duracion: string;
  /** Veces que se abrió esta regla en la request, contando esta; null si fue una sola. */
  repeticiones: number | null;
  /** Solo en una regla de mensaje y solo en la pestaña (OPR-19 §6.2): "To: …", de solo lectura. */
  destinatario: string | null;
  /** El texto fijo del arreglo de la regla, si lo tiene (OPR-19 §6.2). */
  arreglo: string | null;
  boton: BotonDeAlerta;
};

export type FilaWaiting = {
  id: string;
  /** "Cleaner confirmation" o "Reschedule · Wed, Dec 2 · 10:00 AM–2:00 PM". */
  que: string;
  /** Nombre del cleaner, o "— —". */
  aQuien: string;
  estado: "Asked" | "Reply received";
  /** "Waiting 2 h 10 min". */
  desde: string;
};

export type FilaResolved = {
  id: string;
  regla: string;
  nombreRegla: string;
  nivel: NivelAlerta;
  motivo: string;
  /** "Opened Nov 27, 10:05 AM · Resolved 11:10 AM". */
  abiertaYResuelta: string;
  abiertaIso: string;
  resueltaIso: string;
  /** "Open 1 h 5 min" (`resolved_at - opened_at`). */
  duracion: string;
  /** "Cleared automatically", "Fixed by Ops Uno · Assigned" o "Cleared by Ops Dos". */
  quien: string;
  /** "Reason: …" solo con Clear alert. */
  razon: string | null;
  repeticiones: number | null;
};

/** La insignia de la pestaña (§5.2). */
export type Insignia = { nivel: "red" | "amber" | "gray"; conteo: number; nombreAccesible: string };

export type VistaAlertas = {
  needsAction: FilaNeedsAction[];
  waiting: FilaWaiting[];
  resolved: FilaResolved[];
  insignia: Insignia | null;
  /** Los `bzzzbx_alert_id` rojos de Needs action: lo que compara `usarPulso`. */
  idsRojos: string[];
  zona: string;
};

// ---------------------------------------------------------------------------
// Panel de la barra superior (§6)
// ---------------------------------------------------------------------------

export type FilaDelPanel = {
  id: string;
  requestId: string;
  nivel: NivelAlerta;
  regla: string;
  nombreRegla: string;
  /** El nombre de la tarjeta ("Demo Lofts 7C"). */
  job: string;
  /** `R<n>` o el job number. */
  numero: string;
  etapa: Etapa;
  etapaTitulo: string;
  /** Dueño de la request; null si no tiene. */
  asignadoId: string | null;
  asignadoNombre: string | null;
  abiertaIso: string;
  /** "Open 45 min". */
  duracion: string;
};

export type EsperaDelPanel = {
  id: string;
  requestId: string;
  job: string;
  numero: string;
  etapa: Etapa;
  etapaTitulo: string;
  asignadoId: string | null;
  asignadoNombre: string | null;
  /** "Cleaner confirmation" o "Reschedule · …". */
  que: string;
  /** "Waiting 2 h 10 min". */
  desde: string;
};

/** Lo que el tablero arma en el servidor para el panel: toda la operación, sin filtrar. */
export type PanelAlertas = {
  filas: FilaDelPanel[];
  esperas: EsperaDelPanel[];
  /** Los operadores activos, para el filtro Assigned to. */
  operadores: { id: string; nombre: string }[];
};

export const PANEL_VACIO: PanelAlertas = { filas: [], esperas: [], operadores: [] };

export type FiltrosDelPanel = {
  nivel: "all" | NivelAlerta;
  regla: "all" | string;
  etapa: "all" | Etapa;
  /** "all", "unassigned" o el id de un operador. */
  asignado: "all" | "unassigned" | string;
};

export const SIN_FILTROS: FiltrosDelPanel = { nivel: "all", regla: "all", etapa: "all", asignado: "all" };

export type OpcionDeFiltro = { valor: string; texto: string; conteo: number };

export type VistaDelPanel = {
  filas: FilaDelPanel[];
  esperas: EsperaDelPanel[];
  opciones: { nivel: OpcionDeFiltro[]; regla: OpcionDeFiltro[]; etapa: OpcionDeFiltro[]; asignado: OpcionDeFiltro[] };
  /** Hay alertas en la operación pero los filtros no dejan ninguna ("No alerts match these filters"). */
  sinCoincidencias: boolean;
};
