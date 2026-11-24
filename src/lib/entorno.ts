/**
 * Variables de entorno del servidor de Next.
 *
 * Se leen en tiempo de ejecución, no al compilar: el mismo build corre en
 * staging y en producción con valores distintos. Por eso el servidor usa
 * SUPABASE_URL y no NEXT_PUBLIC_SUPABASE_URL, que Next congela en el build.
 */
export type EntornoSupabase = {
  url: string;
  secretKey: string;
};

const REQUERIDAS = ["SUPABASE_URL", "SUPABASE_SECRET_KEY"] as const;

export function leerEntornoSupabase(
  env: Record<string, string | undefined> = process.env,
): EntornoSupabase {
  const faltan = REQUERIDAS.filter((nombre) => !env[nombre]?.trim());
  if (faltan.length > 0) {
    throw new Error(
      `Faltan variables de entorno: ${faltan.join(", ")}. ` +
        "En local, levanta todo con `pnpm local`; en el servidor, revisa su entorno.",
    );
  }
  return {
    url: env.SUPABASE_URL!.trim(),
    secretKey: env.SUPABASE_SECRET_KEY!.trim(),
  };
}
