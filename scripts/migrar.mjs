// Aplica las migraciones de supabase/migrations como el dueño de los esquemas
// de opsRUN (opsrun_migrador).
//
// Por qué no `supabase db push` ni las migraciones de la CLI: la CLI las aplica
// como postgres y lleva la cuenta en supabase_migrations, que es de Supabase.
// Con las convenciones de las vecinas de Bzzz, las migraciones de opsRUN corren
// como opsrun_migrador, que solo alcanza lo suyo y no puede crear esquemas. La
// cuenta vive en opsrun.schema_migration (la crea la primera migración).
//
// Cada migración va en su propia transacción, junto con su fila en
// opsrun.schema_migration: o entra entera o no entra. Usa una sola conexión:
// opsrun_migrador tiene CONNECTION LIMIT 1.
//
// En local y en CI lo llama scripts/base-local.mjs. A mano:
//   OPSRUN_MIGRADOR_URL=... node scripts/migrar.mjs
// Cómo se aplican en la caja se acuerda con el equipo de BzzzBX.
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import pg from "pg";

export const DIRECTORIO_MIGRACIONES = new URL("../supabase/migrations/", import.meta.url);
const PATRON = /^(\d{14})_([a-z0-9_]+)\.sql$/;

/** Las migraciones en disco, en orden. Falla si un .sql no sigue el patrón. */
export async function migracionesEnDisco(directorio = DIRECTORIO_MIGRACIONES) {
  const archivos = (await readdir(directorio)).filter((archivo) => archivo.endsWith(".sql")).sort();
  return archivos.map((archivo) => {
    const partes = PATRON.exec(archivo);
    if (!partes) {
      throw new Error(`${archivo}: el nombre debe ser <14 dígitos>_<nombre_en_minusculas>.sql`);
    }
    return { version: partes[1], nombre: partes[2], url: new URL(archivo, directorio) };
  });
}

/**
 * Aplica las migraciones pendientes. Devuelve las versiones aplicadas.
 * @param {string} url conexión como el dueño de los esquemas de opsRUN
 */
export async function migrar(url, { directorio = DIRECTORIO_MIGRACIONES, avisar = console.log } = {}) {
  const enDisco = await migracionesEnDisco(directorio);
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    const {
      rows: [sesion],
    } = await cliente.query(
      `select current_user::text as usuario,
              (select n.nspowner::regrole::text from pg_catalog.pg_namespace as n
               where n.nspname = 'opsrun') as dueno,
              to_regclass('opsrun.schema_migration') is not null as hay_cuenta`,
    );
    if (sesion.dueno === null) {
      throw new Error("No existe el esquema opsrun: falta el alta de opsRUN (en local, supabase/alta-local.sql).");
    }
    if (sesion.usuario !== sesion.dueno) {
      throw new Error(
        `Las migraciones se aplican como el dueño del esquema opsrun (${sesion.dueno}), no como ${sesion.usuario}.`,
      );
    }

    const aplicadas = sesion.hay_cuenta
      ? new Set((await cliente.query("select version from opsrun.schema_migration")).rows.map((f) => f.version))
      : new Set();

    const enDiscoVersiones = new Set(enDisco.map((m) => m.version));
    const huerfanas = [...aplicadas].filter((version) => !enDiscoVersiones.has(version));
    if (huerfanas.length > 0) {
      throw new Error(`La base tiene migraciones que no están en disco: ${huerfanas.sort().join(", ")}.`);
    }

    const pendientes = enDisco.filter((m) => !aplicadas.has(m.version));
    const ultimaAplicada = [...aplicadas].sort().at(-1);
    const atrasada = pendientes.find((m) => ultimaAplicada !== undefined && m.version < ultimaAplicada);
    if (atrasada) {
      throw new Error(
        `La migración ${atrasada.version} es anterior a la última aplicada (${ultimaAplicada}): renómbrala con una versión nueva.`,
      );
    }

    for (const migracion of pendientes) {
      const sql = await readFile(migracion.url, "utf8");
      await cliente.query("begin");
      try {
        await cliente.query(sql);
        await cliente.query("insert into opsrun.schema_migration (version, name) values ($1, $2)", [
          migracion.version,
          migracion.nombre,
        ]);
        await cliente.query("commit");
      } catch (error) {
        await cliente.query("rollback");
        throw new Error(`Falló la migración ${migracion.version}_${migracion.nombre}: ${error.message}`, {
          cause: error,
        });
      }
      avisar(`Migración aplicada: ${migracion.version}_${migracion.nombre}`);
    }
    if (pendientes.length === 0) avisar("Migraciones al día.");
    return pendientes.map((m) => m.version);
  } finally {
    await cliente.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.OPSRUN_MIGRADOR_URL;
  if (!url) {
    console.error("Falta OPSRUN_MIGRADOR_URL (la conexión como opsrun_migrador).");
    process.exit(1);
  }
  migrar(url).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
