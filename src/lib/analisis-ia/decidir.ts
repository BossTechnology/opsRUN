/**
 * Tipos de Accept, Change y Reject de una sugerencia de IA (spec OPR-36 §8.3 y §10.2):
 * lo que la base puede rechazar y lo que el servidor le pide a `opsrun.decide_ai_suggestion`.
 * Sin imports del servidor: lo usa el ejecutor del registro de acciones, que también se carga
 * en el navegador por sus tipos.
 */
import type { Actor } from "../db/pool";

/** Los errores de `decide_ai_suggestion` que el operador puede provocar (§8.3). */
export type CodigoDeDecisionInvalida =
  | "request_no_encontrada"
  | "request_no_abierta"
  | "cambio_concurrente"
  | "sugerencia_no_encontrada"
  | "ya_decidida"
  | "decision_invalida";

/** La decisión no se pudo guardar. No se escribió nada. */
export class DecisionInvalida extends Error {
  constructor(readonly codigo: CodigoDeDecisionInvalida) {
    super(`decisión inválida: ${codigo}`);
    this.name = "DecisionInvalida";
  }
}

/**
 * Next empaqueta por separado rutas y páginas: la clase puede venir de otra copia del módulo y
 * `instanceof` falla. Se reconoce por el nombre, como `esRequestInvalida`.
 */
export const esDecisionInvalida = (e: unknown): e is DecisionInvalida =>
  e instanceof Error && e.name === "DecisionInvalida" && typeof (e as { codigo?: unknown }).codigo === "string";

export type DecisionDeIa = "accepted" | "corrected" | "rejected";

export const DECISIONES_DE_IA: readonly DecisionDeIa[] = ["accepted", "corrected", "rejected"];

/** Lo que el operador firma sobre una sugerencia, con el actor de la transacción: la base deja el Audit. */
export type DatosDeDecision = {
  decidir(
    entrada: { suggestionId: string; decision: DecisionDeIa; version: string; finalValue: unknown | null; motivo: string | null },
    actor: Actor,
  ): Promise<void>;
};

/** Lo que el operador lee cuando la decisión no se pudo guardar (§8.3). */
export const MENSAJES_DE_DECISION: Record<CodigoDeDecisionInvalida, string> = {
  request_no_encontrada: "Job not found.",
  request_no_abierta: "This request is not open anymore.",
  cambio_concurrente: "This job changed. Review and try again.",
  sugerencia_no_encontrada: "That AI suggestion is gone. Refresh and try again.",
  ya_decidida: "Someone already decided this.",
  decision_invalida: "That value can't be saved.",
};
