// SOLO LOCAL Y CI: deja el Supabase local como la base de la caja.
//
// 1. Imita el alta de opsRUN en Bzzz (supabase/alta-local.sql) con el rol
//    administrador local: crea los esquemas y los roles de opsRUN. En la caja
//    esto lo hace Bzzz, nunca este script.
// 2. Aplica las migraciones pendientes como opsrun_migrador (scripts/migrar.mjs).
// 3. Si existe supabase/seed.sql (datos inventados), lo carga como
//    opsrun_migrador cuando esta corrida aplicó migraciones: tras un reset o
//    una base nueva.
//
// La CLI de Supabase no aplica las migraciones ni la seed por su cuenta
// (desactivadas en supabase/config.toml): lo hace esto, en el orden de la caja.
// Lo llaman `pnpm local`, `pnpm db:start`, `pnpm db:reset`, `pnpm test:db`, el
// E2E y el CI. Es idempotente.
//
// Con --solo-alta hace solo el paso 1: la prueba del ciclo de deploy
// (scripts/servidor/prueba-ciclo.sh) deja que el deploy aplique las
// migraciones, como en el servidor.
import { access, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import pg from "pg";

import { migrar } from "./migrar.mjs";
import { urlsSupabaseLocal } from "./supabase-local.mjs";

const ALTA_LOCAL = new URL("../supabase/alta-local.sql", import.meta.url);
const SEED = new URL("../supabase/seed.sql", import.meta.url);

async function ejecutar(url, sql) {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    return await cliente.query(sql);
  } finally {
    await cliente.end();
  }
}

export async function prepararBaseLocal({ avisar = console.log, soloAlta = false } = {}) {
  const { admin, migrador } = urlsSupabaseLocal();

  // Una base local creada antes de la conexión directa tiene public.opsrun_health(),
  // que la CLI aplicaba como postgres. Ya no es de opsRUN: hay que empezar de cero.
  const { rows } = await ejecutar(admin, "select to_regprocedure('public.opsrun_health()') is not null as vieja");
  if (rows[0]?.vieja) {
    throw new Error("La base local es de antes de la conexión directa (tiene public.opsrun_health). Corre `pnpm db:reset`.");
  }

  await ejecutar(admin, await readFile(ALTA_LOCAL, "utf8"));
  avisar("Alta local de opsRUN: esquemas y roles listos.");
  if (soloAlta) return;

  const aplicadas = await migrar(migrador, { avisar });

  const haySeed = await access(SEED).then(
    () => true,
    () => false,
  );
  if (haySeed && aplicadas.length > 0) {
    await ejecutar(migrador, await readFile(SEED, "utf8"));
    avisar("Seed cargada: supabase/seed.sql.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepararBaseLocal({ soloAlta: process.argv.includes("--solo-alta") }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
