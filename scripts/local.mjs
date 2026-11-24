// `pnpm local`: levanta Supabase local y la app en modo desarrollo, en un comando.
//
// 1. `supabase start` (Docker).
// 2. Imita el alta de opsRUN en Bzzz y aplica las migraciones pendientes como
//    opsrun_migrador (scripts/base-local.mjs). Para empezar desde cero:
//    `pnpm db:reset`.
// 3. `next dev` con el entorno del Supabase local, sin archivos .env.
import { spawn } from "node:child_process";

import { prepararBaseLocal } from "./base-local.mjs";
import { entornoSupabaseLocal, raiz, supabase } from "./supabase-local.mjs";

supabase(["start"], { stdio: "inherit" });
await prepararBaseLocal();

const next = process.platform === "win32" ? "next.cmd" : "next";
const app = spawn(`${raiz}node_modules/.bin/${next}`, ["dev", ...process.argv.slice(2)], {
  cwd: raiz,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, ...entornoSupabaseLocal() },
});

for (const senal of ["SIGINT", "SIGTERM"]) {
  process.on(senal, () => app.kill(senal));
}
app.on("exit", (codigo) => process.exit(codigo ?? 0));
