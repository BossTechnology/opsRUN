/**
 * Arma el hilo de la conversación (spec OPR-27 §4). Función pura: sin base, sin
 * puerto y sin reloj propio. Une cuatro fuentes:
 *
 *  1. los mensajes vinculados (`request_message`), leídos de BzzzBX;
 *  2. los mensajes de los hilos de la request que nadie vinculó todavía (P-7);
 *  3. los envíos en curso o fallidos que aún no tienen mensaje (instrucciones);
 *  4. las notas.
 *
 * Un mensaje aparece una sola vez. El original va primero; el resto, por hora,
 * la más vieja arriba. Los cuerpos son texto plano: nunca HTML (S-5).
 */
import type { Message } from "../bzzzbx/tipos";
import { horaOFecha } from "../tablero/formato";

import type {
  EntradaDeHilo,
  EnvioDeOpsrun,
  HiloArmado,
  NotaDeOpsrun,
  OperadorDeHilo,
  TipoDeEntrada,
  Vinculo,
} from "./tipos";

export type EntradaDeArmarHilo = {
  vinculos: Vinculo[];
  /** Lo leído de BzzzBX: los mensajes vinculados y los de los hilos de la request. */
  mensajes: Message[];
  instrucciones: EnvioDeOpsrun[];
  notas: NotaDeOpsrun[];
  operadores: OperadorDeHilo[];
  ahora: Date;
  /** Zona de la operación (OPR-25 S-6). */
  zona: string;
  /**
   * De dónde salen `mensajes`: `vivo` si BzzzBX respondió ahora (un mensaje
   * vinculado que no viene es "Message not found in BzzzBX"); `recordado` si es
   * lo último leído con BzzzBX caído (lo que falta no se declara
   * desconocido); `ninguno` si nunca se leyó. Por defecto, `vivo`.
   */
  lectura?: "vivo" | "recordado" | "ninguno";
  /**
   * Teléfonos que BzzzBX asocia a un equipo conocido, para ver "Team Alpha" en
   * lugar del número en un texto (§4.2: "equipo o teléfono"). Solo para
   * mostrar; no se guarda.
   */
  equiposPorTelefono?: Record<string, string>;
};

export const MENSAJE_NO_ENCONTRADO = "Message not found in BzzzBX";

const ETIQUETAS: Record<TipoDeEntrada, string> = {
  original: "Original request",
  email: "Email",
  text: "Text",
  note: "Internal note",
};

/** "Failed" o "Bounced", con el motivo del proveedor si vino (OPR-19 §4.2). */
const conDetalle = (etiqueta: string, detalle: string | null | undefined) => {
  const motivo = detalle?.trim();
  return motivo ? `${etiqueta} · ${motivo}` : etiqueta;
};

/** El estado de entrega de un mensaje leído (§4.3, OPR-19 §4.2). */
function estadoDeMensaje(m: Message): EntradaDeHilo["estado"] {
  if (m.direction === "inbound") return { texto: "Received", tono: "normal" };
  switch (m.delivery) {
    case "queued":
      return { texto: "Queued", tono: "normal" };
    case "sent":
      return { texto: "Sent", tono: "normal" };
    case "delivered":
      return { texto: "Delivered", tono: "normal" };
    case "failed":
      return { texto: conDetalle("Failed", m.delivery_detail), tono: "error" };
    case "bounced":
      return { texto: conDetalle("Bounced", m.delivery_detail), tono: "error" };
  }
}

/** Un saliente que no llegó: se puede copiar su cuerpo al Composer (OPR-19 §6.1). */
const noLlego = (m: Message) => m.direction === "outbound" && (m.delivery === "failed" || m.delivery === "bounced");

/** El estado de un envío que todavía no es un mensaje (§4.3). */
function estadoDeEnvio(e: EnvioDeOpsrun): NonNullable<EntradaDeHilo["estado"]> {
  switch (e.status) {
    case "pending":
      return { texto: "Sending…", tono: "normal" };
    case "sent":
    case "confirmed":
      return { texto: "Sent", tono: "normal" };
    case "failed":
      return { texto: `Failed · ${e.error_message?.trim() || "The message was not sent."}`, tono: "error" };
    case "timed_out":
      return { texto: "Couldn't confirm", tono: "normal" };
  }
}

const normalizar = (texto: string) => texto.trim();

export function armarHilo(entrada: EntradaDeArmarHilo): HiloArmado {
  const { vinculos, mensajes, instrucciones, notas, operadores, ahora, zona } = entrada;
  const lectura = entrada.lectura ?? "vivo";
  const hora = (instante: string) => horaOFecha(instante, ahora, zona);
  const equipos = entrada.equiposPorTelefono ?? {};
  const nombre = (m: Message, direccion: string) => {
    const bruto = direccion === "inbound" ? m.from : m.to.join(", ");
    if (m.channel !== "text") return bruto || null;
    return (direccion === "inbound" ? equipos[m.from] : m.to.length === 1 ? equipos[m.to[0]!] : undefined) ?? (bruto || null);
  };

  /** "To": el correo, o el equipo y su teléfono en un texto (OPR-19 §6.2). Solo para mostrar. */
  const destinatario = (m: Message): string | null => {
    if (m.to.length === 0) return null;
    if (m.channel !== "text") return m.to.join(", ");
    return m.to.map((t) => (equipos[t] ? `${equipos[t]} · ${t}` : t)).join(", ");
  };

  const porId = new Map(mensajes.map((m) => [m.bzzzbx_message_id, m]));
  const vinculados = new Set(vinculos.map((v) => v.bzzzbx_message_id));
  const hilosDeLaRequest = new Set(vinculos.map((v) => v.bzzzbx_thread_id).filter((h): h is string => h !== null));

  const entradas: EntradaDeHilo[] = [];

  const deMensaje = (m: Message, esOriginal: boolean): EntradaDeHilo => {
    const tipo: TipoDeEntrada = esOriginal ? "original" : m.channel;
    const saliente = m.direction === "outbound";
    return {
      id: `msg:${m.bzzzbx_message_id}`,
      tipo,
      direccion: m.direction,
      etiqueta: ETIQUETAS[tipo],
      contraparte: nombre(m, m.direction),
      hora: hora(m.sent_at),
      instante: m.sent_at,
      asunto: m.channel === "email" ? m.subject : null,
      cuerpo: m.body,
      noEncontrado: false,
      estado: estadoDeMensaje(m),
      entrega: saliente ? m.delivery : null,
      destinatario: saliente ? destinatario(m) : null,
      reenviar: !esOriginal && noLlego(m) ? { modo: m.channel === "email" ? "customer" : "cleaner", cuerpo: m.body } : null,
    };
  };

  // 1. Los vinculados.
  for (const v of vinculos) {
    const m = porId.get(v.bzzzbx_message_id);
    if (m) {
      entradas.push(deMensaje(m, v.is_original));
    } else if (lectura === "vivo") {
      const tipo: TipoDeEntrada = v.is_original ? "original" : v.channel;
      entradas.push({
        id: `link:${v.bzzzbx_message_id}`,
        tipo,
        direccion: v.direction,
        etiqueta: ETIQUETAS[tipo],
        contraparte: null,
        hora: hora(v.linked_at),
        instante: v.linked_at,
        asunto: null,
        cuerpo: null,
        noEncontrado: true,
        estado: null,
        entrega: null,
        destinatario: null,
        reenviar: null,
      });
    }
  }

  // Los envíos abiertos que todavía no son un mensaje: ocultan su duplicado breve (S-3).
  const abiertos = instrucciones.filter((e) => !e.tieneMensaje && (e.status === "pending" || e.status === "sent"));
  const duplicaUnEnvio = (m: Message) =>
    m.direction === "outbound" &&
    m.channel === "email" &&
    abiertos.some(
      (e) => e.tipo === "send_email" && e.bzzzbx_thread_id === m.bzzzbx_thread_id && normalizar(e.body) === normalizar(m.body),
    );

  // 2. Los de los hilos de la request que nadie vinculó (P-7), sin el duplicado breve.
  for (const m of porId.values()) {
    if (vinculados.has(m.bzzzbx_message_id)) continue;
    if (m.bzzzbx_thread_id === null || !hilosDeLaRequest.has(m.bzzzbx_thread_id)) continue;
    if (duplicaUnEnvio(m)) continue;
    entradas.push(deMensaje(m, false));
  }

  // 3. Los envíos sin mensaje: el cuerpo que escribió el operador.
  for (const e of instrucciones) {
    if (e.tieneMensaje) continue;
    const tipo: TipoDeEntrada = e.tipo === "send_email" ? "email" : "text";
    entradas.push({
      id: `ins:${e.id}`,
      tipo,
      direccion: "outbound",
      etiqueta: ETIQUETAS[tipo],
      contraparte: null,
      hora: hora(e.created_at),
      instante: e.created_at,
      asunto: null,
      cuerpo: e.body,
      noEncontrado: false,
      estado: estadoDeEnvio(e),
      entrega: null,
      destinatario: null,
      reenviar: e.status === "failed" ? { modo: e.tipo === "send_email" ? "customer" : "cleaner", cuerpo: e.body } : null,
    });
  }

  // 4. Las notas.
  const autores = new Map(operadores.map((o) => [o.id, o.nombre]));
  for (const n of notas) {
    entradas.push({
      id: `note:${n.id}`,
      tipo: "note",
      direccion: "internal",
      etiqueta: ETIQUETAS.note,
      contraparte: autores.get(n.author_operator_id) ?? null,
      hora: hora(n.created_at),
      instante: n.created_at,
      asunto: null,
      cuerpo: n.body,
      noEncontrado: false,
      estado: { texto: "Internal · not sent", tono: "normal" },
      entrega: null,
      destinatario: null,
      reenviar: null,
    });
  }

  entradas.sort(
    (a, b) =>
      Number(b.tipo === "original") - Number(a.tipo === "original") ||
      Date.parse(a.instante) - Date.parse(b.instante) ||
      a.id.localeCompare(b.id),
  );

  return { entradas, mensajesNoDisponibles: lectura === "ninguno" && vinculos.length > 0 };
}
