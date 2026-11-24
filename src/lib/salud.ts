/**
 * Salud de la base de opsRUN: lee opsrun.opsrun_health() como opsrun_app.
 *
 * Recibe la consulta en vez de hacerla, para probarla sin base.
 */
export type Salud =
  | { conectada: true; versionEsquema: string | null }
  | { conectada: false; error: string };

export const CONSULTA_SALUD = "select status, schema_version from opsrun.opsrun_health()";

type FilaSalud = { status: string; schema_version: string | null };

function esFilaSalud(valor: unknown): valor is FilaSalud {
  return (
    typeof valor === "object" &&
    valor !== null &&
    "status" in valor &&
    typeof (valor as FilaSalud).status === "string"
  );
}

export async function leerSalud(consultar: () => Promise<unknown[]>): Promise<Salud> {
  try {
    const [fila] = await consultar();
    if (!esFilaSalud(fila) || fila.status !== "ok") {
      return { conectada: false, error: "Respuesta inesperada de opsrun_health" };
    }
    return { conectada: true, versionEsquema: fila.schema_version ?? null };
  } catch (e) {
    return { conectada: false, error: e instanceof Error ? e.message : String(e) };
  }
}
