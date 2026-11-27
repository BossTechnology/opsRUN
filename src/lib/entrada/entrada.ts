/**
 * La entrada de correo (spec OPR-15 §4 y §5): lee los correos nuevos del
 * puerto de lectura de BzzzBX y le pide a la base, uno por uno, que cree la
 * request o vincule la respuesta (`opsrun.ingest_request_email`). No lee Gmail,
 * no manda nada y no guarda datos de PINCH: a la base solo viajan el ID del
 * mensaje, el del hilo y la hora de llegada.
 *
 * Es pura respecto a sus dependencias (el puerto, los datos y el reloj), que es
 * lo que prueban los unitarios. La vuelta la corre el ciclo de fondo
 * (`../ciclo`); este módulo no abre temporizadores.
 *
 * Los errores del puerto se reconocen por nombre, no con `instanceof` (Next
 * empaqueta por separado rutas y páginas).
 */
import { esCursorCaducado, esNoDisponible } from "../bzzzbx/errores";
import type { LecturaBzzzbx } from "../bzzzbx/puertos";
import type { Cursor, Leido, Message } from "../bzzzbx/tipos";

export type Resultado = "created" | "linked" | "duplicate";

export type CorreoEntrante = {
  bzzzbx_message_id: string;
  bzzzbx_thread_id: string | null;
  /** `Message.sent_at`: la única hora que trae el puerto (S-10). */
  received_at: string;
};

/** Lo que la entrada lee y escribe en opsRUN. */
export type DatosDeEntrada = {
  /** `max(request.received_at)` en ISO, o null si no hay ninguna request. */
  marcaDeAgua(): Promise<string | null>;
  /** `opsrun.ingest_request_email`, en su propia transacción y con el actor `entrada_correo`. */
  ingerir(correo: CorreoEntrante): Promise<{ request_id: string; outcome: Resultado }>;
};

export type DependenciasDeEntrada = {
  lectura: LecturaBzzzbx;
  datos: DatosDeEntrada;
  /** Se llama tras confirmar la transacción de un `created` (§7). En esta tarjeta no hace nada; lo llena OPR-36. */
  alCrearRequest?: (requestId: string) => void | Promise<void>;
  log?: Pick<Console, "info" | "warn" | "error">;
};

export type ResultadoDeVuelta =
  | { estado: "ok"; creadas: number; vinculadas: number; duplicadas: number; saltadas: number }
  | { estado: "no_disponible" }
  | { estado: "cursor_caducado" };

/** Lotes de cambios que mira como mucho en una vuelta (S-2). */
export const LOTES_POR_VUELTA = 10;
/** Cuánto antes de la marca de agua recupera (S-4). */
export const MARGEN_DE_RECUPERACION_MS = 24 * 60 * 60 * 1000;
/** Cuántos mensajes pide a `obtenerVarios` de una vez. */
const POR_LECTURA = 100;

/** Códigos de la base que ningún reintento arregla: el mensaje se salta con log (S-12). */
const CODIGOS_QUE_SE_SALTAN = new Set(["22023", "OP030"]);

const codigoDe = (e: unknown): string | undefined => (e as { code?: unknown } | null)?.code as string | undefined;

/** El orden de la entrada: la hora y, a igual hora, el ID, para que el original vaya antes que sus respuestas. */
function ordenar(mensajes: Leido<Message>[]): Leido<Message>[] {
  return [...mensajes].sort((a, b) => {
    const porHora = Date.parse(a.sent_at) - Date.parse(b.sent_at);
    if (porHora !== 0) return porHora;
    return a.bzzzbx_message_id < b.bzzzbx_message_id ? -1 : a.bzzzbx_message_id > b.bzzzbx_message_id ? 1 : 0;
  });
}

const esCorreoEntrante = (m: Message) => m.channel === "email" && m.direction === "inbound";

export function crearEntrada({ lectura, datos, alCrearRequest, log = console }: DependenciasDeEntrada) {
  /** Null al arrancar y tras `CursorCaducado`: la vuelta siguiente recupera. */
  let cursor: Cursor | null = null;
  /** Para avisar una vez al caer y una al volver, no cada vuelta. */
  let caido = false;

  type Cuenta = { creadas: number; vinculadas: number; duplicadas: number; saltadas: number };

  /** Procesa mensajes en orden, uno por transacción. Lanza ante un error que sí se reintenta. */
  async function ingerir(mensajes: Leido<Message>[], cuenta: Cuenta): Promise<void> {
    for (const m of ordenar(mensajes.filter(esCorreoEntrante))) {
      let respuesta: { request_id: string; outcome: Resultado };
      try {
        respuesta = await datos.ingerir({
          bzzzbx_message_id: m.bzzzbx_message_id,
          bzzzbx_thread_id: m.bzzzbx_thread_id,
          received_at: m.sent_at,
        });
      } catch (e) {
        const codigo = codigoDe(e);
        if (codigo && CODIGOS_QUE_SE_SALTAN.has(codigo)) {
          log.error(`[opsRUN] entrada: la base rechaza el mensaje ${m.bzzzbx_message_id} (${codigo}); se salta`);
          cuenta.saltadas += 1;
          continue;
        }
        throw e;
      }
      if (respuesta.outcome === "created") {
        cuenta.creadas += 1;
        try {
          await alCrearRequest?.(respuesta.request_id);
        } catch (e) {
          // El enganche no frena la entrada: OPR-36 además barre las requests sin análisis (§7).
          log.error("[opsRUN] entrada: alCrearRequest falló:", e instanceof Error ? e.message : e);
        }
      } else if (respuesta.outcome === "linked") cuenta.vinculadas += 1;
      else cuenta.duplicadas += 1;
    }
  }

  /** §4.3: lo llegado mientras no se miraba, desde la marca de agua menos 24 h. Sin requests, no hay nada que recuperar (P-5). */
  async function recuperar(cuenta: Cuenta): Promise<void> {
    const marca = await datos.marcaDeAgua();
    if (marca === null) return;
    const desde = new Date(Date.parse(marca) - MARGEN_DE_RECUPERACION_MS).toISOString();
    let despuesDe: string | undefined;
    for (;;) {
      const pagina = await lectura.buscarMensajes({
        channel: "email",
        direction: "inbound",
        desde,
        ...(despuesDe ? { despuesDe } : {}),
      });
      await ingerir(pagina.mensajes, cuenta);
      const ultimo = pagina.mensajes.at(-1);
      if (!pagina.hay_mas) return;
      // Sin avance no hay página siguiente: no se queda dando vueltas.
      if (!ultimo || ultimo.bzzzbx_message_id === despuesDe) {
        throw new Error("buscarMensajes dice hay_mas pero no avanza");
      }
      despuesDe = ultimo.bzzzbx_message_id;
    }
  }

  /** Los mensajes que cambiaron desde el cursor, hasta `LOTES_POR_VUELTA` lotes. */
  async function cambiosDeMensajes(desde: Cursor): Promise<{ ids: string[]; cursor: Cursor }> {
    const ids = new Set<string>();
    let actual = desde;
    for (let lotes = 0; lotes < LOTES_POR_VUELTA; lotes++) {
      const lote = await lectura.cambiosDesde(actual);
      for (const c of lote.cambios) if (c.entidad === "message") ids.add(c.id);
      actual = lote.cursor;
      if (!lote.hay_mas) break;
    }
    return { ids: [...ids], cursor: actual };
  }

  async function leerMensajes(ids: string[]): Promise<Leido<Message>[]> {
    const leidos: Leido<Message>[] = [];
    // Uno tras otro: el puerto real puede ser una sola conexión.
    for (let i = 0; i < ids.length; i += POR_LECTURA) {
      leidos.push(...(await lectura.obtenerVarios("message", ids.slice(i, i + POR_LECTURA))));
    }
    return leidos;
  }

  async function trabajar(): Promise<ResultadoDeVuelta> {
    const cuenta: Cuenta = { creadas: 0, vinculadas: 0, duplicadas: 0, saltadas: 0 };

    if (cursor === null) {
      // El cursor de "ahora" primero, la recuperación después: lo que llegue durante la recuperación sale en la
      // vuelta siguiente (a lo sumo se ve dos veces y la base lo deduplica). El cursor se guarda solo si la
      // recuperación termina; si no, la vuelta siguiente vuelve a empezar sin cursor.
      const { cursor: deAhora } = await lectura.cambiosDesde(null);
      await recuperar(cuenta);
      cursor = deAhora;
    } else {
      const { ids, cursor: siguiente } = await cambiosDeMensajes(cursor);
      if (ids.length > 0) await ingerir(await leerMensajes(ids), cuenta);
      cursor = siguiente;
    }
    return { estado: "ok", ...cuenta };
  }

  return {
    /** El cursor de la entrada, para pruebas y diagnóstico. */
    get cursor(): Cursor | null {
      return cursor;
    },

    /**
     * Una vuelta. Si BzzzBX está caído no toca el cursor ni la base; si el cursor
     * caducó, lo deja en null para recuperar en la vuelta siguiente. Cualquier
     * otro error (la base, por ejemplo) sube, con el cursor donde estaba.
     */
    async vuelta(): Promise<ResultadoDeVuelta> {
      try {
        const resultado = await trabajar();
        if (caido) {
          caido = false;
          log.info("[opsRUN] entrada: BzzzBX volvió");
        }
        return resultado;
      } catch (e) {
        if (esNoDisponible(e)) {
          if (!caido) {
            caido = true;
            log.warn("[opsRUN] entrada: BzzzBX no está disponible; los correos esperan en BzzzBX");
          }
          return { estado: "no_disponible" };
        }
        if (esCursorCaducado(e)) {
          cursor = null;
          log.info("[opsRUN] entrada: el cursor caducó; se recupera en la vuelta siguiente");
          return { estado: "cursor_caducado" };
        }
        throw e;
      }
    },
  };
}

export type Entrada = ReturnType<typeof crearEntrada>;
