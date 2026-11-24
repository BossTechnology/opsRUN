// SOLO LOCAL Y CI: deja el Supabase local como la base de la caja.
//
// 1. Imita el alta de opsRUN en Bzzz (supabase/alta-local.sql) con el rol
//    administrador local: crea los esquemas y los roles de opsRUN. En la caja
//    esto lo hace Bzzz, nunca este script.
// 2. Aplica las migraciones pendientes como opsrun_migrador (scripts/migrar.mjs).
//
// La CLI de Supabase no aplica las migraciones ni la seed por su cuenta
// (desactivadas en supabase/config.toml): lo hace esto, en el orden de la caja.
// Lo llaman `pnpm local`, `pnpm db:start`, `pnpm db:reset`, `pnpm test:db`, el
// E2E y el CI. Es idempotente.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import pg from "pg";

import { migrar } from "./migrar.mjs";
import { urlsSupabaseLocal } from "./supabase-local.mjs";

const ALTA_LOCAL = new URL("../supabase/alta-local.sql", import.meta.url);

export async function prepararBaseLocal({ avisar = console.log } = {}) {
  const { admin, migrador } = urlsSupabaseLocal();

  const alta = await readFile(ALTA_LOCAL, "utf8");
  const cliente = new pg.Client({ connectionString: admin });
  await cliente.connect();
  try {
    await cliente.query(alta);
  } finally {
    await cliente.end();
  }
  avisar("Alta local de opsRUN: esquemas y roles listos.");

  await migrar(migrador, { avisar });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepararBaseLocal().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
