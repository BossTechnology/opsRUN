/**
 * El ejecutor de Accept, Change y Reject de una sugerencia de IA (spec OPR-36 §10.2): la
 * acción interna `decide_ai_suggestion`. Pasa por `ejecutarAccion`, que ya comprobó la
 * disponibilidad, el motivo y la versión; aquí solo se revisa la forma de lo que llegó del
 * navegador, se llama a la base con el actor de la transacción y se traducen sus errores a un
 * mensaje para el operador. La función SQL deja el Audit en la misma transacción.
 *
 * Es una decisión de opsRUN, no una instrucción a BzzzBX: corre con BzzzBX caído. Los datos
 * sin decisión, o con un valor final que no tiene la forma de su campo, se rechazan sin
 * llamar a la base.
 *
 * Las dependencias entran por una función para no cargar el módulo de servidor (`server-only`,
 * pool de la base) hasta que la acción corre de verdad.
 */
import { DECISIONES_DE_IA, esDecisionInvalida, MENSAJES_DE_DECISION, type DatosDeDecision, type DecisionDeIa } from "../analisis-ia/decidir";
import { valorValido } from "../analisis-ia/forma";
import { CAMPOS_DE_IA, type CampoDeIa } from "../bzzzbx/tipos-ia";

import type { DefinicionAccion, ResultadoAccion } from "./tipos";

export const MENSAJE_SIN_SUGERENCIA = "Choose an AI suggestion first.";
export const MENSAJE_SIN_DECISION = "Choose what to do with the AI suggestion first.";
export const MENSAJE_SIN_VALOR = "Enter a value first.";
export const MENSAJE_VALOR_INVALIDO = "That value can't be saved.";

type ObtenerDatos = () => Promise<DatosDeDecision>;
type Ejecutor = NonNullable<DefinicionAccion["ejecutor"]>;

const rechazada = (codigo: string, mensaje: string): ResultadoAccion => ({ tipo: "rechazada", codigo, mensaje });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function crearEjecutoresDeIa(obtener: ObtenerDatos): Record<"decide_ai_suggestion", Ejecutor> {
  return {
    decide_ai_suggestion: async ({ actor, ventana }, entrada) => {
      const id = typeof entrada.datos.suggestion_id === "string" && UUID.test(entrada.datos.suggestion_id.trim()) ? entrada.datos.suggestion_id.trim() : null;
      if (!id) return rechazada("sugerencia_no_elegida", MENSAJE_SIN_SUGERENCIA);
      const decision = DECISIONES_DE_IA.find((d) => d === entrada.datos.decision) as DecisionDeIa | undefined;
      if (!decision) return rechazada("decision_no_elegida", MENSAJE_SIN_DECISION);

      let finalValue: unknown | null = null;
      if (decision === "corrected") {
        if (entrada.datos.final_value === undefined || entrada.datos.final_value === null) return rechazada("valor_no_puesto", MENSAJE_SIN_VALOR);
        finalValue = entrada.datos.final_value;
        // El campo sale de la sugerencia que la ventana tiene abierta; si ya no está, la base dirá qué pasó.
        const campo = (CAMPOS_DE_IA as readonly string[]).find((c) => ventana.datos.ia?.campos[c as CampoDeIa]?.abierta?.id === id) as CampoDeIa | undefined;
        if (campo && !valorValido(campo, finalValue)) return rechazada("decision_invalida", MENSAJE_VALOR_INVALIDO);
      }

      try {
        await (await obtener()).decidir({ suggestionId: id, decision, version: entrada.version, finalValue, motivo: entrada.motivo }, actor);
        return { tipo: "guardada" };
      } catch (e) {
        // Los errores que el operador puede provocar son un resultado; el resto sube y `ejecutarAccion` lo registra.
        if (esDecisionInvalida(e)) return rechazada(e.codigo, MENSAJES_DE_DECISION[e.codigo]);
        throw e;
      }
    },
  };
}
