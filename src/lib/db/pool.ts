/**
 * La única forma en que opsRUN llega a Postgres: directo, como opsrun_app
 * (ADR 0003). Sin PostgREST, sin supabase-js, sin service role. Sigue el
 * patrón de bob-web (`lib/bob/db.ts`).
 *
 * Cada lectura o escritura corre en una transacción que pasa a opsrun_app con
 * SET LOCAL ROLE y comprueba que el cambio se sostiene; si no, no corre nada.
 * En el servidor y en local el login ya es opsrun_app, así que el SET ROLE no
 * cambia nada y sirve de prueba.
 *
 * Acotado: pedir un cliente se rinde a los connectionTimeoutMillis, cada
 * transacción lleva statement_timeout, y un cliente inactivo que muere
 * (Postgres reiniciando) queda en el log en vez de tumbar el proceso.
 *
 * Cada transacción puede declarar quién actúa (`actor`): un operador (el id
 * de su usuario en el GoTrue de la caja) o un proceso del sistema. Se fija con
 * set_config local, solo para esa transacción, en `opsrun.auth_user_id` u
 * `opsrun.system_actor`; las funciones de escritura de OPR-20 lo leen de ahí y
 * lo escriben en Audit. Validar la sesión del operador es de OPR-2.
 *
 * El login no puede saltarse RLS: el pool de la app comprueba una vez que el
 * session_user no es superusuario ni BYPASSRLS, ni miembro de uno, y rechaza
 * toda consulta si lo es. SET ROLE solo prueba current_user; un login
 * privilegiado podría hacer RESET ROLE.
 */
import { Pool, type PoolClient } from "pg";

import { destinoBase, type DestinoBase } from "./entorno";

export const TIEMPO_MAXIMO_SENTENCIA = "5s";
export const OPCIONES_POOL = { max: 4, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30_000 };

export class LoginPrivilegiadoError extends Error {}

/** Pools cuyo login hay que probar sin privilegios, y la prueba cuando la hay. */
const vigilados = new WeakMap<Pool, Promise<void> | null>();

export function crearPool(destino: DestinoBase): Pool {
  const pool =
    destino.tipo === "url"
      ? new Pool({ connectionString: destino.url, ...OPCIONES_POOL })
      : new Pool({
          host: destino.host,
          port: destino.puerto,
          database: destino.base,
          user: destino.usuario,
          password: destino.clave,
          ...OPCIONES_POOL,
        });
  pool.on("error", (e) => console.error("[opsRUN] db: falló un cliente inactivo:", e.message));
  vigilados.set(pool, null);
  return pool;
}

let poolDeLaApp: Pool | null = null;

export function obtenerPool(): Pool {
  poolDeLaApp ??= crearPool(destinoBase());
  return poolDeLaApp;
}

export type Tx = PoolClient;

export async function loginPrivilegiado(db: Tx): Promise<boolean> {
  const { rows } = await db.query<{ privilegiado: boolean }>(`
    select exists (
      select 1 from pg_roles r
      where (r.rolsuper or r.rolbypassrls) and pg_has_role(session_user, r.oid, 'member')
    ) as privilegiado`);
  return rows[0]?.privilegiado === true;
}

async function probarLogin(origen: Pool, db: Tx): Promise<void> {
  if (!vigilados.has(origen)) return;
  let prueba = vigilados.get(origen);
  if (!prueba) {
    prueba = loginPrivilegiado(db).then((privilegiado) => {
      if (privilegiado) {
        throw new LoginPrivilegiadoError(
          "el login de opsRUN es superusuario o BYPASSRLS: opsRUN no consulta con él",
        );
      }
    });
    vigilados.set(origen, prueba);
    // Un login rechazado sigue rechazado; un fallo de conexión se reintenta.
    prueba.catch((e) => {
      if (!(e instanceof LoginPrivilegiadoError)) vigilados.set(origen, null);
    });
  }
  await prueba;
}

/** Al arrancar en el servidor: no arranca con un login privilegiado. Si la base aún no responde, arranca y la primera consulta vuelve a probar. */
export async function comprobarLoginAlArrancar(origen: Pool = obtenerPool()): Promise<void> {
  let db: Tx;
  try {
    db = await origen.connect();
  } catch (e) {
    console.error(
      "[opsRUN] db: login sin comprobar al arrancar, la base no responde:",
      e instanceof Error ? e.message : e,
    );
    return;
  }
  try {
    await probarLogin(origen, db);
  } finally {
    db.release();
  }
}

/** Quién actúa en una transacción. Nunca los dos a la vez. */
export type Actor = { tipo: "operador"; authUserId: string } | { tipo: "sistema"; proceso: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROCESO = /^[a-z][a-z0-9_.-]{0,62}$/;

/** El ajuste y el valor que declaran al actor. Rechaza un actor mal formado. */
export function ajusteDeActor(actor: Actor): { ajuste: string; valor: string } {
  if (actor.tipo === "operador") {
    if (!UUID.test(actor.authUserId)) throw new Error("actor: authUserId no es un uuid");
    return { ajuste: "opsrun.auth_user_id", valor: actor.authUserId.toLowerCase() };
  }
  if (!PROCESO.test(actor.proceso)) throw new Error("actor: el nombre del proceso no es válido");
  return { ajuste: "opsrun.system_actor", valor: actor.proceso };
}

export async function comoOpsrunApp<T>(
  fn: (db: Tx) => Promise<T>,
  {
    origen = obtenerPool(),
    escritura = false,
    actor,
  }: { origen?: Pool; escritura?: boolean; actor?: Actor } = {},
): Promise<T> {
  const declarado = actor ? ajusteDeActor(actor) : null;
  const db = await origen.connect();
  try {
    await probarLogin(origen, db);
    await db.query(escritura ? "begin" : "begin read only");
    await db.query(`set local statement_timeout = '${TIEMPO_MAXIMO_SENTENCIA}'`);
    await db.query("set local role opsrun_app");
    const { rows } = await db.query<{ rol: string }>("select current_user as rol");
    if (rows[0]?.rol !== "opsrun_app") throw new Error(`consulta como ${rows[0]?.rol}, no como opsrun_app`);
    if (declarado) {
      await db.query("select set_config($1, $2, true)", [declarado.ajuste, declarado.valor]);
    }
    const resultado = await fn(db);
    await db.query("commit");
    return resultado;
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}
