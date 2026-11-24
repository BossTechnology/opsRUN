// Entorno de la app apuntando al Supabase local (`supabase start`).
//
// Lee las URLs de `supabase status` en memoria y arma la conexión como
// opsrun_app, el mismo rol sin privilegios que usa el servidor (ADR 0003).
// No escribe ningún archivo .env ni imprime credenciales.
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const raiz = fileURLToPath(new URL("..", import.meta.url));
const cli = process.platform === "win32" ? "supabase.cmd" : "supabase";

// Las mismas claves que pone supabase/alta-local.sql. Solo local.
const CLAVE_LOCAL_OPSRUN_APP = "opsrun_app_local";
const CLAVE_LOCAL_OPSRUN_MIGRADOR = "opsrun_migrador_local";

export function supabase(args, opciones = {}) {
  return execFileSync(`${raiz}node_modules/.bin/${cli}`, args, {
    cwd: raiz,
    encoding: "utf8",
    ...opciones,
  });
}

/**
 * URLs del Supabase local: la base como postgres (admin), como opsrun_app y
 * como opsrun_migrador, y la API.
 */
export function urlsSupabaseLocal() {
  // `supabase status` sale con código 1 si algún servicio auxiliar (Studio,
  // realtime) está detenido o enfermo, aunque imprima el JSON completo. Se
  // confía en el JSON, no en el código de salida.
  const salida = spawnSync(`${raiz}node_modules/.bin/${cli}`, ["status", "--output", "json"], {
    cwd: raiz,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  let estado;
  try {
    estado = JSON.parse(salida.stdout);
  } catch {
    throw new Error("Supabase local no está corriendo. Levántalo con `pnpm local` o `pnpm db:start`.");
  }
  // Solo los nombres de los campos, nunca sus valores.
  const faltaCampo = (campo) =>
    new Error(
      `\`supabase status\` no trajo ${campo} (¿cambió la CLI o falta el servicio?). ` +
        `Campos recibidos: ${Object.keys(estado).join(", ") || "ninguno"}.`,
    );
  if (!estado.DB_URL) throw faltaCampo("DB_URL");
  const comoRol = (usuario, clave) => {
    const url = new URL(estado.DB_URL);
    url.username = usuario;
    url.password = clave;
    return url.toString();
  };
  return {
    admin: estado.DB_URL,
    app: comoRol("opsrun_app", CLAVE_LOCAL_OPSRUN_APP),
    migrador: comoRol("opsrun_migrador", CLAVE_LOCAL_OPSRUN_MIGRADOR),
    // La API (Kong) no corre con `supabase db start`; solo la necesita la app.
    api: estado.API_URL ? estado.API_URL.replace(/\/+$/, "") : null,
    faltaCampo,
  };
}

/** Variables de entorno de opsRUN para el Supabase local. Falla si no está arriba. */
export function entornoSupabaseLocal() {
  const { app, api, faltaCampo } = urlsSupabaseLocal();
  if (!api) throw faltaCampo("API_URL");
  return {
    OPSRUN_DATABASE_URL: app,
    // En local GoTrue está detrás de Kong; en la caja sirve en su raíz.
    OPSRUN_GOTRUE_URL: `${api}/auth/v1`,
  };
}
