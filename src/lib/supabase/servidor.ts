import "server-only";

import { createClient } from "@supabase/supabase-js";

import { leerEntornoSupabase } from "@/lib/entorno";

/**
 * Cliente de Supabase para el servidor de Next, con la llave secreta.
 * Nunca se importa desde un componente de cliente (lo impide `server-only`).
 */
export function crearClienteServidor() {
  const { url, secretKey } = leerEntornoSupabase();
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
