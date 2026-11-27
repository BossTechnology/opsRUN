/**
 * Ejecutores de Assign / Reassign y Confirm details, sender y cleaner (spec
 * OPR-28 §7). Los cuatro pasan por `ejecutarAccion`, que ya comprobó la
 * disponibilidad, el motivo y la versión; aquí solo se llama a la base con el
 * actor de la transacción y se traducen sus errores a un mensaje para el
 * operador. La función SQL deja el Audit en la misma transacción.
 *
 * Ninguna es una instrucción a BzzzBX: son decisiones de opsRUN y corren con
 * BzzzBX caído (OPR-26 S-13). Lo que viaja a la base son el id de la request,
 * el operador destino, el método, el id de la respuesta y la versión: el valor
 * confirmado lo calcula la base desde la fila bloqueada, nunca el navegador.
 *
 * Las dependencias entran por una función para no cargar el módulo de servidor
 * (`server-only`, pool de la base) hasta que la acción corre de verdad.
 */
import { esRequestInvalida, type CodigoRequestInvalida, type DatosDeRequests, type MetodoDeCleaner } from "../requests/tipos";

import type { DefinicionAccion, ResultadoAccion } from "./tipos";

export const TEXTO_YA_CONFIRMADA = "Already confirmed";
export const TEXTO_FALTAN_DETALLES = "Complete the details first";
export const TEXTO_SIN_CLIENTE = "Choose who it is from first";
export const TEXTO_SIN_EQUIPO = "Choose a cleaner first";

/** Lo que el operador lee cuando la acción no se pudo hacer. Nada se escribió. */
export const MENSAJES_DE_REQUESTS: Record<CodigoRequestInvalida, string> = {
  request_no_encontrada: "Job not found.",
  request_no_abierta: "This request is not open anymore.",
  cambio_concurrente: "This job changed. Review and try again.",
  operador_invalido: "That operator is not active.",
  ya_es_dueno: "That operator already owns this request.",
  faltan_datos: "Complete the data first.",
  ya_confirmada: "Already confirmed.",
  respuesta_invalida: "That reply can't confirm this cleaner.",
};

export const MENSAJE_SIN_OPERADOR = "Choose an operator first.";
export const MENSAJE_SIN_METODO = "Choose how the cleaner confirmed first.";
export const MENSAJE_SIN_RESPUESTA = "Choose the cleaner's reply first.";

type ObtenerDatos = () => Promise<DatosDeRequests>;
type Ejecutor = NonNullable<DefinicionAccion["ejecutor"]>;

const rechazada = (codigo: string, mensaje: string): ResultadoAccion => ({ tipo: "rechazada", codigo, mensaje });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un uuid que llegó de `datos` (viene del navegador); null si no vino o no lo es. */
function uuidDe(datos: Record<string, unknown>, clave: string): string | null {
  const valor = datos[clave];
  return typeof valor === "string" && UUID.test(valor.trim()) ? valor.trim() : null;
}

/** Lo que falta de los detalles, con lo que la ventana leyó; sin eso, un texto general. */
export const textoFaltanDetalles = (faltan: string[]) => (faltan.length > 0 ? `${TEXTO_FALTAN_DETALLES}: ${faltan.join(", ")}` : `${TEXTO_FALTAN_DETALLES}.`);

/** Los errores que el operador puede provocar son un resultado; el resto sube y `ejecutarAccion` lo registra. */
function comoResultado(e: unknown, faltanDatos: string): ResultadoAccion {
  if (esRequestInvalida(e)) return rechazada(e.codigo, e.codigo === "faltan_datos" ? faltanDatos : (MENSAJES_DE_REQUESTS[e.codigo] ?? "That is not valid."));
  throw e;
}

export function crearEjecutoresDeRequests(
  obtener: ObtenerDatos,
): Record<"assign" | "confirm_details" | "confirm_sender" | "confirm_cleaner", Ejecutor> {
  return {
    assign: async ({ actor }, entrada) => {
      const operatorId = uuidDe(entrada.datos, "operator_id");
      if (!operatorId) return rechazada("operador_no_elegido", MENSAJE_SIN_OPERADOR);
      try {
        await (await obtener()).asignar({ requestId: entrada.requestId, operatorId, version: entrada.version, motivo: entrada.motivo }, actor);
        return { tipo: "guardada" };
      } catch (e) {
        return comoResultado(e, MENSAJES_DE_REQUESTS.faltan_datos);
      }
    },

    confirm_details: async ({ actor, ventana }, entrada) => {
      try {
        await (await obtener()).confirmarDetalles({ requestId: entrada.requestId, version: entrada.version }, actor);
        return { tipo: "guardada" };
      } catch (e) {
        return comoResultado(e, textoFaltanDetalles(ventana.datos.faltanDetalles));
      }
    },

    confirm_sender: async ({ actor }, entrada) => {
      try {
        await (await obtener()).confirmarSender({ requestId: entrada.requestId, version: entrada.version }, actor);
        return { tipo: "guardada" };
      } catch (e) {
        return comoResultado(e, TEXTO_SIN_CLIENTE);
      }
    },

    confirm_cleaner: async ({ actor }, entrada) => {
      // `operator` no se acepta para el cleaner (P-6): la tarjeta dice "confirm on reply or Confirm by phone".
      const metodo: MetodoDeCleaner | null =
        entrada.datos.method === "phone" || entrada.datos.method === "cleaner_text" ? entrada.datos.method : null;
      if (!metodo) return rechazada("metodo_no_elegido", MENSAJE_SIN_METODO);
      const respuesta = metodo === "cleaner_text" ? uuidDe(entrada.datos, "cleaner_confirmation_id") : null;
      if (metodo === "cleaner_text" && !respuesta) return rechazada("respuesta_no_elegida", MENSAJE_SIN_RESPUESTA);
      try {
        await (await obtener()).confirmarCleaner(
          { requestId: entrada.requestId, metodo, cleanerConfirmationId: respuesta, version: entrada.version, motivo: entrada.motivo },
          actor,
        );
        return { tipo: "guardada" };
      } catch (e) {
        return comoResultado(e, TEXTO_SIN_EQUIPO);
      }
    },
  };
}
