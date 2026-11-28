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
  // La demo local: el stand-in de BzzzBX y el selector "Acting as" de la Job
  // window (OPR-26, P-2), que solo existe con las dos variables y sin OPSRUN_SERVIDOR.
  // La zona de la operación (OPR-29, P-6): provisional hasta OPR-4; Delayed ("1:00 PM") se lee en ella.
  env: {
    ...process.env,
    ...entornoSupabaseLocal(),
    BZZZBX_MODO: "falso",
    OPSRUN_ACTOR_DEMO: "1",
    OPSRUN_ZONA_HORARIA: "America/New_York",
  },
});

for (const senal of ["SIGINT", "SIGTERM"]) {
  process.on(senal, () => app.kill(senal));
}
app.on("exit", (codigo) => process.exit(codigo ?? 0));
