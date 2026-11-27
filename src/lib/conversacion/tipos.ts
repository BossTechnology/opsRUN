/**
 * Modelo de la conversación del job (spec OPR-27). Lo arma `armarHilo` con lo de
 * opsRUN (vínculos, envíos, notas) y lo leído de BzzzBX (los mensajes); los
 * componentes solo lo pintan. Nada de esto se guarda: el cuerpo, el remitente
 * y la entrega de cada mensaje son de PINCH y se leen por BzzzBX.
 */

/** Los tres modos del Composer (§5.1). */
export type ModoComposer = "customer" | "cleaner" | "note";

/** `request_message` de la request: solo el vínculo (OPR-20 §4.6). */
export type Vinculo = {
  bzzzbx_message_id: string;
  bzzzbx_thread_id: string | null;
  channel: "email" | "text";
  direction: "inbound" | "outbound";
  is_original: boolean;
  /** El envío desde opsRUN que lo originó, si lo hubo. */
  instruction_id: string | null;
  /** ISO. */
  linked_at: string;
};

export type EstadoDeInstruccion = "pending" | "sent" | "confirmed" | "failed" | "timed_out";

/** Una instrucción `send_email` o `send_text` de la request (§4.1, tercera fuente). */
export type EnvioDeOpsrun = {
  id: string;
  tipo: "send_email" | "send_text";
  status: EstadoDeInstruccion;
  /** Lo que escribió el operador (`payload.body`). */
  body: string;
  bzzzbx_thread_id: string | null;
  bzzzbx_team_id: string | null;
  error_message: string | null;
  /** ISO. */
  created_at: string;
  actor_operator_id: string | null;
  /** Ya existe su `request_message`: se ve el mensaje leído de BzzzBX, no la instrucción. */
  tieneMensaje: boolean;
};

export type NotaDeOpsrun = {
  id: string;
  body: string;
  /** ISO. */
  created_at: string;
  author_operator_id: string;
};

export type OperadorDeHilo = { id: string; nombre: string };

/** Un borrador de IA sin decidir del Composer (§5.5). */
export type BorradorDeIA = {
  id: string;
  /** `draft_customer_reply` o `draft_cleaner_text`. */
  field: "draft_customer_reply" | "draft_cleaner_text";
  body: string;
  reason: string | null;
};

export type TipoDeEntrada = "original" | "email" | "text" | "note";
export type DireccionDeEntrada = "inbound" | "outbound" | "internal";

/** Cada burbuja del hilo (§4.2). Serializable: pasa al componente de cliente. */
export type EntradaDeHilo = {
  /** Estable entre refrescos. */
  id: string;
  tipo: TipoDeEntrada;
  direccion: DireccionDeEntrada;
  /** "Original request", "Email", "Text" o "Internal note". */
  etiqueta: string;
  /** Remitente o destinatario, o el autor de la nota; null si no se sabe. */
  contraparte: string | null;
  /** La hora en la zona de la operación. */
  hora: string;
  /** ISO: el orden. */
  instante: string;
  asunto: string | null;
  /** Texto plano; null si BzzzBX no conoce el mensaje. */
  cuerpo: string | null;
  /** BzzzBX respondió y no conoce un mensaje vinculado. */
  noEncontrado: boolean;
  /** El estado de entrega de §4.3; null si no aplica. */
  estado: { texto: string; tono: "normal" | "error" } | null;
  /** `Edit and resend`: solo en un envío fallido (§4.3). */
  reenviar: { modo: "customer" | "cleaner"; cuerpo: string } | null;
};

export type HiloArmado = {
  entradas: EntradaDeHilo[];
  /** Los mensajes no se pudieron leer nunca (BzzzBX caído sin lectura previa): "Messages unavailable". */
  mensajesNoDisponibles: boolean;
};

/** Límites del Composer por modo (S-9). */
export const LIMITE_DE_CARACTERES: Record<ModoComposer, number> = { note: 4000, customer: 10_000, cleaner: 1600 };
