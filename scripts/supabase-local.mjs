// Entorno de la app apuntando al Supabase local (`supabase start`).
//
// Lee las URLs y llaves de `supabase status` en memoria y las pasa al proceso
// hijo. No escribe ningún archivo .env ni imprime las llaves.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const raiz = fileURLToPath(new URL("..", import.meta.url));
const cli = process.platform === "win32" ? "supabase.cmd" : "supabase";

export function supabase(args, opciones = {}) {
  return execFileSync(`${raiz}node_modules/.bin/${cli}`, args, {
    cwd: raiz,
    encoding: "utf8",
    ...opciones,
  });
}

/** Variables de entorno de opsRUN para el Supabase local. Falla si no está arriba. */
export function entornoSupabaseLocal() {
  let estado;
  try {
    estado = JSON.parse(supabase(["status", "--output", "json"], { stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    throw new Error("Supabase local no está corriendo. Levántalo con `pnpm local` o `pnpm db:start`.");
  }

  const url = estado.API_URL;
  const publishableKey = estado.PUBLISHABLE_KEY ?? estado.ANON_KEY;
  const secretKey = estado.SECRET_KEY ?? estado.SERVICE_ROLE_KEY;
  if (!url || !publishableKey || !secretKey) {
    throw new Error("`supabase status` no trajo API_URL y las llaves. ¿Cambió la versión de la CLI?");
  }

  return {
    SUPABASE_URL: url,
    SUPABASE_SECRET_KEY: secretKey,
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  };
}
