/**
 * `ejecutarAccion`: el único camino para correr una acción (spec OPR-26 §5.4).
 *
 *  1. lee la ventana de nuevo y calcula la disponibilidad: si no es
 *     `disponible`, rechaza sin llamar al ejecutor, sin escribir en la base y
 *     sin mandar nada a BzzzBX. La interfaz no es la defensa;
 *  2. valida el motivo (recortado, no vacío si es obligatorio);
 *  3. si `version` no es el `change_seq` actual de la request, rechaza por
 *     cambio concurrente (S-12), salvo en las acciones con
 *     `concurrencia: "ninguna"` (OPR-27, P-6);
 *  4. llama al ejecutor con el actor de la transacción (P-2). El ejecutor
 *     escribe por funciones SQL, que dejan su Audit (principio 5); el marco no
 *     escribe nada por su cuenta;
 *  5. pide el refresco de la ventana y del tablero.
 *
 * Esta función es pura respecto de Next: lo que necesita (leer la ventana, el
 * actor, el refresco) entra por `DependenciasDeEjecucion`. La Server Action
 * que la expone está en `src/app/_ventana/acciones.ts`.
 */
import type { Actor } from "../db/pool";
import type { VentanaJob } from "../ventana/tipos";

import { disponibilidadDe, nota } from "./disponibilidad";
import type { DefinicionAccion, EntradaAccion, ResultadoAccion } from "./tipos";

/** Largo máximo del motivo (Audit guarda texto libre; esto acota lo que llega del navegador). */
export const MOTIVO_MAX = 500;

export type DependenciasDeEjecucion = {
  registro: DefinicionAccion[];
  /** La ventana de la request con los datos de este momento; null si no existe. */
  leerVentana: (requestId: string) => Promise<VentanaJob | null>;
  /** Quién actúa, declarado por el servidor (P-2); null si nadie. */
  actor: () => Promise<Extract<Actor, { tipo: "operador" }> | null>;
  /** Pide el refresco de la ventana y del tablero. */
  refrescar: () => Promise<void>;
};

const rechazada = (codigo: string, mensaje: string): ResultadoAccion => ({ tipo: "rechazada", codigo, mensaje });

/**
 * Lo que está en la interfaz pero no corre en V1.1 beta (OPR-27, spec §5.2):
 * Edit To, Cc y Temporary number. No hay Server Action que los atienda: si
 * alguien los manda de todos modos, se rechazan aquí, antes de leer nada.
 */
export const CAMPOS_DE_UN_RELEASE_POSTERIOR = ["to", "cc", "from_number"] as const;

/** Lo que llega de la Server Action viene del navegador: se revisa la forma. */
function esEntrada(valor: unknown): valor is EntradaAccion {
  if (typeof valor !== "object" || valor === null) return false;
  const e = valor as Record<string, unknown>;
  return (
    typeof e.requestId === "string" &&
    e.requestId !== "" &&
    typeof e.codigo === "string" &&
    e.codigo !== "" &&
    typeof e.version === "string" &&
    e.version !== "" &&
    (e.motivo === null || typeof e.motivo === "string") &&
    typeof e.datos === "object" &&
    e.datos !== null &&
    !Array.isArray(e.datos)
  );
}

export async function ejecutar(deps: DependenciasDeEjecucion, entrada: EntradaAccion): Promise<ResultadoAccion> {
  if (!esEntrada(entrada)) return rechazada("entrada_invalida", "That request is not valid.");

  const def = deps.registro.find((d) => d.codigo === entrada.codigo);
  if (!def) return rechazada("no_disponible", "Unknown action.");

  if (CAMPOS_DE_UN_RELEASE_POSTERIOR.some((campo) => Object.hasOwn(entrada.datos, campo))) {
    return rechazada("no_disponible", "Available in a later release");
  }

  const ventana = await deps.leerVentana(entrada.requestId);
  if (!ventana) return rechazada("no_encontrada", "Job not found.");

  // Principio 8: este chequeo es el guard. Quitarlo hace fallar las pruebas de este archivo.
  const disponibilidad = disponibilidadDe(def, ventana);
  if (disponibilidad.tipo !== "disponible") {
    return rechazada("no_disponible", nota(disponibilidad) ?? "This action does not apply to this job.");
  }

  const motivo = entrada.motivo?.trim() || null;
  if (def.motivo === "obligatorio" && motivo === null) {
    return rechazada("motivo_requerido", "A reason is required.");
  }
  if (motivo !== null && motivo.length > MOTIVO_MAX) {
    return rechazada("motivo_invalido", `The reason is too long (${MOTIVO_MAX} characters at most).`);
  }

  if (def.concurrencia !== "ninguna" && entrada.version !== ventana.version) {
    return rechazada("cambio_concurrente", "This job changed. Review and try again.");
  }

  const actor = await deps.actor();
  if (!actor) return rechazada("sin_actor", "Choose who is acting first.");
  // Solo un operador actúa por aquí: un proceso del sistema o de la IA no corre acciones (principio 3).
  if (actor.tipo !== "operador") return rechazada("sin_actor", "Only an operator can run this action.");

  let resultado: ResultadoAccion;
  try {
    resultado = await def.ejecutor!({ actor, ventana }, { ...entrada, motivo: def.motivo === "no" ? null : motivo });
  } catch (e) {
    // Sin detalles técnicos hacia el navegador. Algo pudo cambiar: se refresca igual.
    console.error(`[opsRUN] acción ${def.codigo} falló:`, e instanceof Error ? e.message : e);
    await deps.refrescar();
    return rechazada("error", "Something went wrong. Try again.");
  }

  if (resultado.tipo !== "rechazada") await deps.refrescar();
  return resultado;
}
