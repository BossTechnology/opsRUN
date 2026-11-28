/**
 * Lo que Accept, Change y Reject escriben en opsRUN (spec OPR-36 §8.1), por SQL como
 * opsrun_app: solo `opsrun.decide_ai_suggestion`, con el actor de la transacción (el
 * operador). La base escribe la decisión, el borrador si toca y su Audit en la misma
 * transacción. Lo que viaja a la base son el id de la sugerencia, la decisión, la versión,
 * el valor final y el motivo: nada de PINCH.
 */
import type { DatabaseError } from "pg";

import { comoOpsrunApp, type Actor, type Tx } from "@/lib/db/pool";

import { DecisionInvalida, type CodigoDeDecisionInvalida, type DatosDeDecision } from "./decidir";

/** Cómo corre cada llamada: por defecto `comoOpsrunApp`; las pruebas pasan su propia transacción. */
export type Ejecutar = <T>(fn: (db: Tx) => Promise<T>, opciones?: { escritura?: boolean; actor?: Actor }) => Promise<T>;

/** Errores de la función SQL que el operador puede provocar, con su código de opsRUN. */
const CODIGOS_SQL: Record<string, CodigoDeDecisionInvalida> = {
  OP006: "request_no_encontrada",
  OP007: "request_no_abierta",
  OP013: "cambio_concurrente",
  OP045: "sugerencia_no_encontrada",
  OP047: "ya_decidida",
  OP048: "decision_invalida",
};

export const LLAMADA_DECIDIR = `select opsrun.decide_ai_suggestion($1::uuid, $2::opsrun.ai_decision, $3::bigint, $4::jsonb, $5)`;

export function crearDatosDeDecision(ejecutar: Ejecutar = (fn, opciones) => comoOpsrunApp(fn, opciones)): DatosDeDecision {
  return {
    async decidir({ suggestionId, decision, version, finalValue, motivo }, actor) {
      try {
        await ejecutar(
          (db) =>
            db.query(LLAMADA_DECIDIR, [suggestionId, decision, version, finalValue === null ? null : JSON.stringify(finalValue), motivo]),
          { escritura: true, actor },
        );
      } catch (e) {
        const codigo = CODIGOS_SQL[(e as Partial<DatabaseError> | undefined)?.code ?? ""];
        if (codigo) throw new DecisionInvalida(codigo);
        throw e;
      }
    },
  };
}
