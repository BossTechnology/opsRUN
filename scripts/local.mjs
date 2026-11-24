// `pnpm local`: levanta Supabase local y la app en modo desarrollo, en un comando.
//
// 1. `supabase start` (Docker): aplica las migraciones de supabase/migrations
//    la primera vez. Para volver a cargarlas desde cero: `pnpm db:reset`.
// 2. `next dev` con el entorno del Supabase local, sin archivos .env.
import { spawn } from "node:child_process";

import { entornoSupabaseLocal, supabase } from "./supabase-local.mjs";

supabase(["start"], { stdio: "inherit" });

const app = spawn("pnpm", ["exec", "next", "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ...entornoSupabaseLocal() },
});

for (const senal of ["SIGINT", "SIGTERM"]) {
  process.on(senal, () => app.kill(senal));
}
app.on("exit", (codigo) => process.exit(codigo ?? 0));
