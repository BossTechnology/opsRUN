/**
 * El modelo puro de Alerts (spec OPR-34 §3 a §6): qué alertas son de una
 * request, las tres secciones de la pestaña (Needs action, Waiting y Resolved),
 * su insignia y el panel de la barra superior. Funciones puras: sin base, sin
 * puerto, sin reloj propio.
 *
 * Si una alerta está abierta lo dice BzzzBX (llega ya leída en `abiertas`); el
 * historial (cuándo se resolvió, quién y cómo) y las preguntas al cleaner son de
 * opsRUN. Nada de BzzzBX se copia: el motivo de Needs action es el vivo.
 */
import type { AlertResult, Message } from "../bzzzbx/tipos";
import { duracion, fechaYVentana, horaConFecha, horaOFecha } from "../tablero/formato";
import { ETAPAS, SIN_VALOR, TITULOS, type Etapa, type FilaRequest } from "../tablero/tipos";

import { MENSAJE_NO_ENCONTRADO } from "../conversacion/armar-hilo";
import type { DatosDeConversacion } from "../conversacion/leer";
import { RAZON_BZZZBX_CAIDO } from "../conversacion/composer";

import { arregloDe, reglaConNombre, TEXTO_DEL_ARREGLO } from "./reglas";
import type {
  BotonDeAlerta,
  EsperaDeOpsrun,
  FilaNeedsAction,
  FilaResolved,
  FilaWaiting,
  FilaDelPanel,
  FiltrosDelPanel,
  Insignia,
  MensajeDeAlerta,
  OcurrenciaDeOpsrun,
  OpcionDeFiltro,
  PanelAlertas,
  VistaAlertas,
  VistaDelPanel,
} from "./tipos";

// ---------------------------------------------------------------------------
// §3.2 Qué alertas son de una request
// ---------------------------------------------------------------------------

export type EntradaDeAlertasDeLaRequest = {
  fila: Pick<FilaRequest, "id" | "bzzzbx_job_id" | "alertas_limpiadas" | "alertas_de_mensaje">;
  /** Las leídas de BzzzBX, abiertas o no, por sujeto y por id. */
  alertas: AlertResult[];
  /** Los hilos de la request (`request_message.bzzzbx_thread_id`). */
  hilos?: string[];
  /** Los mensajes vinculados a la request (`request_message.bzzzbx_message_id`). */
  mensajesDeLaRequest?: string[];
  /** Mensajes leídos de BzzzBX, para saber el hilo de cada uno. */
  mensajes?: Pick<Message, "bzzzbx_message_id" | "bzzzbx_thread_id">[];
};

/**
 * Las alertas abiertas de una request: la única función que cuentan el tablero,
 * la barra, el panel y la ventana. Una alerta es de la request si su sujeto es la
 * request, su job o un mensaje suyo (por `request_message`, por un hilo de la
 * request o por una ocurrencia abierta de opsRUN que la apunta), y no está
 * resuelta en opsRUN de ninguna forma (P-7): aunque BzzzBX la siga dando abierta.
 * Una alerta cuyo sujeto no lleva a ninguna request no entra en ninguna parte.
 */
export function alertasDeLaRequest({
  fila,
  alertas,
  hilos = [],
  mensajesDeLaRequest = [],
  mensajes = [],
}: EntradaDeAlertasDeLaRequest): AlertResult[] {
  const resueltas = new Set(fila.alertas_limpiadas);
  const deMensaje = new Set(fila.alertas_de_mensaje);
  const hilosDeLaRequest = new Set(hilos);
  const mensajesVinculados = new Set(mensajesDeLaRequest);
  const mensajesDelHilo = new Set(
    mensajes.filter((m) => m.bzzzbx_thread_id !== null && hilosDeLaRequest.has(m.bzzzbx_thread_id)).map((m) => m.bzzzbx_message_id),
  );

  return alertas
    .filter((a) => {
      if (a.cleared_at !== null || resueltas.has(a.bzzzbx_alert_id)) return false;
      switch (a.sujeto.tipo) {
        case "request":
          return a.sujeto.request_id === fila.id;
        case "job":
          return fila.bzzzbx_job_id !== null && a.sujeto.bzzzbx_job_id === fila.bzzzbx_job_id;
        case "message":
          return (
            deMensaje.has(a.bzzzbx_alert_id) ||
            mensajesVinculados.has(a.sujeto.bzzzbx_message_id) ||
            mensajesDelHilo.has(a.sujeto.bzzzbx_message_id)
          );
      }
    })
    .sort((a, b) => a.opened_at.localeCompare(b.opened_at) || a.bzzzbx_alert_id.localeCompare(b.bzzzbx_alert_id));
}

// ---------------------------------------------------------------------------
// §5.2 Insignia
// ---------------------------------------------------------------------------

/** Roja o ámbar con el conteo de Needs action; gris con el de Waiting si no hay Needs action (P-4); si no, nada. */
export function insigniaDe(abiertas: { level: "amber" | "red" }[], esperando: number): Insignia | null {
  if (abiertas.length > 0) {
    const nivel = abiertas.some((a) => a.level === "red") ? "red" : "amber";
    return { nivel, conteo: abiertas.length, nombreAccesible: `Alerts, ${abiertas.length} need action, ${nivel}` };
  }
  if (esperando > 0) return { nivel: "gray", conteo: esperando, nombreAccesible: `Alerts, ${esperando} waiting` };
  return null;
}

// ---------------------------------------------------------------------------
// §5.1 La pestaña
// ---------------------------------------------------------------------------

export type EntradaDeAlertas = {
  /** Needs action: `alertasDeLaRequest` ya aplicada. */
  abiertas: AlertResult[];
  /** Todas las ocurrencias de la request en opsRUN (abiertas y resueltas). */
  ocurrencias: OcurrenciaDeOpsrun[];
  esperas: EsperaDeOpsrun[];
  /** Nombre del cleaner por `bzzzbx_team_id`, ya leído; sin nombre, "— —". */
  equipos: Record<string, string>;
  /** Lo leído de BzzzBX de los mensajes de las alertas de mensaje, por `bzzzbx_message_id` (OPR-19). */
  mensajes?: Record<string, MensajeDeAlerta>;
  ahora: Date;
  zona: string;
};

const porNivelYAntiguedad = <T extends { nivel: "amber" | "red"; abiertaIso: string; id: string }>(a: T, b: T) =>
  Number(b.nivel === "red") - Number(a.nivel === "red") || a.abiertaIso.localeCompare(b.abiertaIso) || a.id.localeCompare(b.id);

/**
 * El botón que arregla la alerta: abre su acción en la action bar, sin ejecutar nada (§5.3). El de Message not
 * delivered hereda del Composer (OPR-19 §6.3): habilitado si el modo de su canal está disponible; en gris con el
 * mismo motivo si no; en gris con "Message not found in BzzzBX" si BzzzBX no conoce el mensaje. Sin lectura del
 * mensaje, en gris con "BzzzBX unavailable": lo conservador.
 */
export function botonDe(a: AlertResult, mensaje?: MensajeDeAlerta): BotonDeAlerta {
  const arreglo = arregloDe(a.rule_id);
  switch (arreglo.tipo) {
    case "accion":
      return {
        tipo: "accion",
        codigo: arreglo.codigo,
        prellenado:
          arreglo.prellenado === "asignarme"
            ? { asignarme: true }
            : arreglo.prellenado === "alerta"
              ? { bzzzbx_alert_id: a.bzzzbx_alert_id }
              : null,
      };
    case "reenviar":
      return {
        tipo: "reenviar",
        mensajeId: a.sujeto.tipo === "message" ? a.sujeto.bzzzbx_message_id : null,
        estado: !mensaje
          ? { disponible: false, razon: RAZON_BZZZBX_CAIDO }
          : !mensaje.encontrado
            ? { disponible: false, razon: MENSAJE_NO_ENCONTRADO }
            : mensaje.modo,
      };
    case "ninguno":
      return { tipo: "texto", texto: arreglo.texto };
  }
}

function quienYComo(o: OcurrenciaDeOpsrun): { quien: string; razon: string | null } {
  switch (o.resolution) {
    case "fixed_by_action":
      return {
        quien: `Fixed by ${o.resolved_by_nombre ?? SIN_VALOR}${o.fixing_label ? ` · ${o.fixing_label}` : ""}`,
        razon: null,
      };
    case "cleared_by_operator":
      return { quien: `Cleared by ${o.resolved_by_nombre ?? SIN_VALOR}`, razon: o.resolution_reason ? `Reason: ${o.resolution_reason}` : null };
    default:
      return { quien: "Cleared automatically", razon: null };
  }
}

export function queSeEspera(e: EsperaDeOpsrun): string {
  if (e.purpose === "initial") return "Cleaner confirmation";
  return `Reschedule · ${fechaYVentana(e.new_service_date, e.new_window_start, e.new_window_end)}`;
}

/**
 * Lo que la fila de Message not delivered muestra del mensaje (OPR-19 §6.2 y §6.3): el destinatario, si BzzzBX
 * conoce el mensaje y qué puede hacer el Composer en el modo de su canal. Sale de la misma lectura que la
 * conversación (el mismo hilo, la misma memoria de lo último leído), sin una segunda ruta a BzzzBX.
 */
export function mensajesDeLasAlertas(abiertas: AlertResult[], conversacion: DatosDeConversacion | null): Record<string, MensajeDeAlerta> {
  const salida: Record<string, MensajeDeAlerta> = {};
  if (!conversacion) return salida;
  for (const a of abiertas) {
    if (a.sujeto.tipo !== "message" || arregloDe(a.rule_id).tipo !== "reenviar") continue;
    const id = a.sujeto.bzzzbx_message_id;
    const entrada = conversacion.entradas.find((e) => e.id === `msg:${id}`);
    // Solo se declara desconocido un mensaje con BzzzBX respondiendo ahora: con BzzzBX caído, lo que falta no se sabe.
    if (!entrada && conversacion.bzzzbx.disponible) {
      salida[id] = { encontrado: false, destinatario: null, modo: { disponible: false, razon: MENSAJE_NO_ENCONTRADO } };
      continue;
    }
    const modo = entrada?.tipo === "text" ? conversacion.modos.cleaner : conversacion.modos.customer;
    salida[id] = { encontrado: true, destinatario: entrada?.destinatario ?? null, modo };
  }
  return salida;
}

export function armarAlertas({ abiertas, ocurrencias, esperas, equipos, mensajes = {}, ahora, zona }: EntradaDeAlertas): VistaAlertas {
  // Cuántas veces se abrió cada regla en la request, contando la que está abierta aunque opsRUN no la haya anotado todavía.
  const idsPorRegla = new Map<string, Set<string>>();
  for (const [regla, id] of [
    ...ocurrencias.map((o) => [o.rule_id, o.bzzzbx_alert_id] as const),
    ...abiertas.map((a) => [a.rule_id, a.bzzzbx_alert_id] as const),
  ]) {
    idsPorRegla.set(regla, (idsPorRegla.get(regla) ?? new Set()).add(id));
  }
  const repeticiones = (regla: string) => {
    const n = idsPorRegla.get(regla)?.size ?? 0;
    return n > 1 ? n : null;
  };

  const needsAction: FilaNeedsAction[] = abiertas
    .map((a) => {
      const deMensaje = a.sujeto.tipo === "message" && arregloDe(a.rule_id).tipo === "reenviar";
      const mensaje = a.sujeto.tipo === "message" ? mensajes[a.sujeto.bzzzbx_message_id] : undefined;
      return {
        id: a.bzzzbx_alert_id,
        regla: a.rule_id,
        nombreRegla: reglaConNombre(a.rule_id),
        nivel: a.level,
        motivo: a.reason_text,
        abiertaTexto: `Opened ${horaConFecha(a.opened_at, ahora, zona)}`,
        abiertaIso: a.opened_at,
        duracion: `Open ${duracion(a.opened_at, ahora)}`,
        repeticiones: repeticiones(a.rule_id),
        destinatario: deMensaje ? `To: ${mensaje?.destinatario ?? SIN_VALOR}` : null,
        arreglo: TEXTO_DEL_ARREGLO[a.rule_id] ?? null,
        boton: botonDe(a, mensaje),
      };
    })
    .sort(porNivelYAntiguedad);

  const waiting: FilaWaiting[] = [...esperas]
    .sort((a, b) => a.asked_at.localeCompare(b.asked_at) || a.id.localeCompare(b.id))
    .map((e) => ({
      id: e.id,
      que: queSeEspera(e),
      aQuien: equipos[e.bzzzbx_team_id] ?? SIN_VALOR,
      estado: e.status === "replied" ? "Reply received" : "Asked",
      desde: `Waiting ${duracion(e.asked_at, ahora)}`,
    }));

  const resolved: FilaResolved[] = ocurrencias
    .filter((o): o is OcurrenciaDeOpsrun & { resolved_at: string } => o.resolved_at !== null)
    .sort((a, b) => b.resolved_at.localeCompare(a.resolved_at) || a.bzzzbx_alert_id.localeCompare(b.bzzzbx_alert_id))
    .map((o) => ({
      id: o.bzzzbx_alert_id,
      regla: o.rule_id,
      nombreRegla: reglaConNombre(o.rule_id),
      nivel: o.level,
      motivo: o.reason_text,
      abiertaYResuelta: `Opened ${horaConFecha(o.opened_at, ahora, zona)} · Resolved ${horaOFecha(o.resolved_at, new Date(o.opened_at), zona)}`,
      abiertaIso: o.opened_at,
      resueltaIso: o.resolved_at,
      duracion: `Open ${duracion(o.opened_at, o.resolved_at)}`,
      ...quienYComo(o),
      repeticiones: repeticiones(o.rule_id),
    }));

  return {
    needsAction,
    waiting,
    resolved,
    insignia: insigniaDe(abiertas, esperas.length),
    idsRojos: abiertas.filter((a) => a.level === "red").map((a) => a.bzzzbx_alert_id),
    zona,
  };
}

// ---------------------------------------------------------------------------
// §6 El panel de la barra
// ---------------------------------------------------------------------------

/** Las filas que el tablero arma en el servidor para el panel: una por alerta abierta de cada tarjeta. */
export function filaDelPanel(
  a: AlertResult,
  tarjeta: { requestId: string; nombre: string; numero: string; etapa: Etapa; dueno: { id: string; nombre: string } | null },
  ahora: Date,
): FilaDelPanel {
  return {
    id: a.bzzzbx_alert_id,
    requestId: tarjeta.requestId,
    nivel: a.level,
    regla: a.rule_id,
    nombreRegla: reglaConNombre(a.rule_id),
    job: tarjeta.nombre,
    numero: tarjeta.numero,
    etapa: tarjeta.etapa,
    etapaTitulo: TITULOS[tarjeta.etapa],
    asignadoId: tarjeta.dueno?.id ?? null,
    asignadoNombre: tarjeta.dueno?.nombre ?? null,
    abiertaIso: a.opened_at,
    duracion: `Open ${duracion(a.opened_at, ahora)}`,
  };
}

export const TEXTO_SIN_COINCIDENCIAS = "No alerts match these filters";

type Dimension = keyof FiltrosDelPanel;

function pasa(f: { nivel?: string; regla?: string; etapa: Etapa; asignadoId: string | null }, filtros: FiltrosDelPanel, omitir?: Dimension): boolean {
  if (omitir !== "nivel" && filtros.nivel !== "all" && f.nivel !== filtros.nivel) return false;
  if (omitir !== "regla" && filtros.regla !== "all" && f.regla !== filtros.regla) return false;
  if (omitir !== "etapa" && filtros.etapa !== "all" && f.etapa !== filtros.etapa) return false;
  if (omitir !== "asignado" && filtros.asignado !== "all") {
    if (filtros.asignado === "unassigned" ? f.asignadoId !== null : f.asignadoId !== filtros.asignado) return false;
  }
  return true;
}

/**
 * El panel con los filtros aplicados (§6.2): las filas de Needs action en el
 * orden de la pestaña (rojo primero, la más vieja arriba), las preguntas de
 * Waiting, y los conteos de cada opción con los demás filtros puestos. Waiting no
 * tiene nivel ni regla: con Level o Rule elegidos no hay qué mostrar.
 */
export function armarPanelAlertas(panel: PanelAlertas, filtros: FiltrosDelPanel): VistaDelPanel {
  const ordenadas = [...panel.filas].sort(porNivelYAntiguedad);
  const filas = ordenadas.filter((f) => pasa(f, filtros));
  const sinNivelNiRegla = filtros.nivel === "all" && filtros.regla === "all";
  const esperas = sinNivelNiRegla ? panel.esperas.filter((e) => pasa(e, filtros)) : [];

  const contar = (omitir: Dimension, extra: (f: FilaDelPanel) => boolean) =>
    ordenadas.filter((f) => pasa(f, filtros, omitir) && extra(f)).length;
  const opcion = (valor: string, texto: string, conteo: number): OpcionDeFiltro => ({ valor, texto, conteo });

  const reglas = [...new Map(ordenadas.map((f) => [f.regla, f.nombreRegla])).entries()].sort(([a], [b]) => a.localeCompare(b));

  return {
    filas,
    esperas,
    opciones: {
      nivel: [
        opcion("all", "All", contar("nivel", () => true)),
        opcion("red", "Red", contar("nivel", (f) => f.nivel === "red")),
        opcion("amber", "Amber", contar("nivel", (f) => f.nivel === "amber")),
      ],
      regla: [
        opcion("all", "All", contar("regla", () => true)),
        ...reglas.map(([regla, nombre]) => opcion(regla, nombre, contar("regla", (f) => f.regla === regla))),
      ],
      etapa: [
        opcion("all", "All", contar("etapa", () => true)),
        ...ETAPAS.map((e) => opcion(e, TITULOS[e], contar("etapa", (f) => f.etapa === e))),
      ],
      asignado: [
        opcion("all", "All", contar("asignado", () => true)),
        opcion("unassigned", "Unassigned", contar("asignado", (f) => f.asignadoId === null)),
        ...panel.operadores.map((o) => opcion(o.id, o.nombre, contar("asignado", (f) => f.asignadoId === o.id))),
      ],
    },
    sinCoincidencias: panel.filas.length + panel.esperas.length > 0 && filas.length === 0 && esperas.length === 0,
  };
}
