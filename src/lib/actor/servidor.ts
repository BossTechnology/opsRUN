import "server-only";

/**
 * Quién actúa, en el servidor (OPR-26, P-2). Hoy solo existe el actor de demo
 * (`./demo.ts`, con sus tres condiciones); el login real llega con OPR-21 y
 * reemplaza esto sin que cambie quien lo llama.
 */
import { cookies } from "next/headers";

import { comoOpsrunApp } from "../db/servidor";

import { actorDeLaCookie, actorDemoActivo, COOKIE_ACTOR, type OperadorElegible } from "./demo";

/** Operadores activos de los que se puede elegir. Vacío (y sin tocar la base) si la demo no está activa. */
export async function operadoresElegibles(): Promise<OperadorElegible[]> {
  if (!actorDemoActivo()) return [];
  return comoOpsrunApp(async (db) => {
    const { rows } = await db.query<{ id: string; nombre: string; auth_user_id: string | null }>(
      `select id::text as id, display_name as nombre, auth_user_id::text as auth_user_id
         from opsrun.operator where active order by display_name, id`,
    );
    return rows.map((r) => ({ id: r.id, nombre: r.nombre, authUserId: r.auth_user_id }));
  });
}

/** El operador que eligió el selector, o null: sin demo activa, sin cookie o con una cookie que no sirve. */
export async function actorDeLaSesion() {
  if (!actorDemoActivo()) return null;
  const valor = (await cookies()).get(COOKIE_ACTOR)?.value;
  if (!valor) return null;
  return actorDeLaCookie(process.env, valor, await operadoresElegibles());
}

/** El id del operador elegido, para marcarlo en el selector. */
export async function operadorElegidoId(): Promise<string | null> {
  if (!actorDemoActivo()) return null;
  return (await cookies()).get(COOKIE_ACTOR)?.value ?? null;
}
