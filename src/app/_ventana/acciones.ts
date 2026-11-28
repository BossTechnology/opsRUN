"use server";

/**
 * Server Actions de la Job window (spec OPR-26 §5.4 y §7.2). Todo lo que el
 * navegador pide pasa por `ejecutarAccion`, que vuelve a calcular la
 * disponibilidad en el servidor: la interfaz no es la defensa.
 */
import { refresh } from "next/cache";
import { cookies } from "next/headers";

import { ejecutarAccionReal } from "@/lib/acciones/servidor";
import type { EntradaAccion, ResultadoAccion } from "@/lib/acciones/tipos";
import { actorDemoActivo, COOKIE_ACTOR } from "@/lib/actor/demo";
import { operadoresElegibles } from "@/lib/actor/servidor";

/** El único camino para correr una acción. */
export async function ejecutarAccion(entrada: EntradaAccion): Promise<ResultadoAccion> {
  return ejecutarAccionReal(entrada, async () => refresh());
}

/**
 * Ranura del enlace de la Fase A (OPR-28): confirmar el job observado. Pasa por
 * `ejecutarAccion` con la acción `schedule`, así hereda el chequeo de
 * disponibilidad, el actor y el refresco.
 */
export async function confirmarEnlace(requestId: string, version: string, bzzzbxJobId: string): Promise<ResultadoAccion> {
  return ejecutarAccion({ requestId, codigo: "schedule", motivo: null, datos: { bzzzbx_job_id: bzzzbxJobId }, version });
}

/** Ranura del enlace de la Fase A (OPR-28): rechazar un candidato (acción interna `reject_job_link`). */
export async function rechazarEnlace(
  requestId: string,
  version: string,
  bzzzbxJobId: string,
  motivo: string | null,
): Promise<ResultadoAccion> {
  return ejecutarAccion({ requestId, codigo: "reject_job_link", motivo, datos: { bzzzbx_job_id: bzzzbxJobId }, version });
}

/**
 * Accept, Change y Reject de una sugerencia de IA (OPR-36 §10.2): pasa por `ejecutarAccion` con la acción interna
 * `decide_ai_suggestion`, así hereda el chequeo de disponibilidad, la versión, el actor y el refresco.
 */
export async function decidirSugerenciaDeIa(
  requestId: string,
  version: string,
  entrada: { suggestionId: string; decision: "accepted" | "corrected" | "rejected"; finalValue?: unknown },
): Promise<ResultadoAccion> {
  return ejecutarAccion({
    requestId,
    codigo: "decide_ai_suggestion",
    motivo: null,
    datos: { suggestion_id: entrada.suggestionId, decision: entrada.decision, ...(entrada.finalValue === undefined ? {} : { final_value: entrada.finalValue }) },
    version,
  });
}

/**
 * El selector "Acting as" de la demo local (P-2). Falla cerrado: sin las tres
 * condiciones (`actorDemoActivo`) no hace nada, y solo acepta a un operador
 * activo de la base que tenga `auth_user_id`.
 */
export async function elegirActor(operadorId: string): Promise<{ ok: boolean }> {
  if (!actorDemoActivo()) return { ok: false };
  const jar = await cookies();
  if (operadorId === "") {
    jar.delete(COOKIE_ACTOR);
    refresh();
    return { ok: true };
  }
  const elegido = (await operadoresElegibles()).find((o) => o.id === operadorId);
  if (!elegido?.authUserId) return { ok: false };
  jar.set(COOKIE_ACTOR, elegido.id, { httpOnly: true, sameSite: "lax", path: "/" });
  refresh();
  return { ok: true };
}
