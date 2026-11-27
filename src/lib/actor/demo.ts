/**
 * Actor de demo (OPR-26, P-2). Mientras no haya login (OPR-21, bloqueado por
 * OPR-2), las funciones de escritura no tienen operador que declarar. Para la
 * demo local, un selector "Acting as" elige un operador de la seed y el
 * servidor declara su `auth_user_id` inventado y fijo.
 *
 * Existe solo si se cumplen LAS TRES condiciones a la vez; si falta cualquiera
 * falla cerrado (sin selector, cookie ignorada, ningún actor):
 *   1. opt-in explícito: `OPSRUN_ACTOR_DEMO=1`;
 *   2. el stand-in de BzzzBX: `BZZZBX_MODO=falso`, escrito (no vale el valor
 *      por defecto);
 *   3. fuera del servidor: sin `OPSRUN_SERVIDOR=1`.
 * Además, `OPSRUN_ACTOR_DEMO` está en `PROHIBIDAS_EN_SERVIDOR`
 * (`src/lib/db/entorno.ts`): con `OPSRUN_SERVIDOR=1` el servidor no arranca si
 * está definida.
 *
 * Sin imports de otros archivos del proyecto salvo tipos: lo usan pruebas y
 * código de servidor.
 */
import type { Actor } from "../db/pool";

type Entorno = Record<string, string | undefined>;

/** Cookie con el id del operador elegido (nunca su auth_user_id). */
export const COOKIE_ACTOR = "opsrun_actor_demo";

/** Un operador activo que el selector ofrece. `authUserId` es de la seed y es inventado. */
export type OperadorElegible = { id: string; nombre: string; authUserId: string | null };

export function actorDemoActivo(env: Entorno = process.env): boolean {
  if (env.OPSRUN_ACTOR_DEMO !== "1") return false;
  if (env.BZZZBX_MODO?.trim() !== "falso") return false;
  if (env.OPSRUN_SERVIDOR === "1") return false;
  return true;
}

/** El actor que declara la cookie; null si la demo no está activa, si no hay cookie o no es de un operador con auth_user_id. */
export function actorDeLaCookie(
  env: Entorno,
  valor: string | undefined,
  operadores: OperadorElegible[],
): Extract<Actor, { tipo: "operador" }> | null {
  if (!actorDemoActivo(env) || !valor) return null;
  const elegido = operadores.find((o) => o.id === valor);
  if (!elegido?.authUserId) return null;
  return { tipo: "operador", authUserId: elegido.authUserId };
}
