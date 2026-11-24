/**
 * Salud de la base de opsRUN: llama a public.opsrun_health().
 *
 * Recibe el cliente en vez de crearlo, para probarla sin servidor.
 */
export type Salud =
  | { conectada: true; versionEsquema: string | null }
  | { conectada: false; error: string };

type RespuestaRpc = {
  data: unknown;
  error: { message: string } | null;
};

export type ClienteSalud = {
  rpc: (fn: "opsrun_health") => PromiseLike<RespuestaRpc>;
};

type FilaSalud = { status: string; schema_version: string | null };

function esFilaSalud(valor: unknown): valor is FilaSalud {
  return (
    typeof valor === "object" &&
    valor !== null &&
    "status" in valor &&
    typeof (valor as FilaSalud).status === "string"
  );
}

export async function leerSalud(cliente: ClienteSalud): Promise<Salud> {
  try {
    const { data, error } = await cliente.rpc("opsrun_health");
    if (error) return { conectada: false, error: error.message };

    const fila = Array.isArray(data) ? data[0] : data;
    if (!esFilaSalud(fila) || fila.status !== "ok") {
      return { conectada: false, error: "Respuesta inesperada de opsrun_health" };
    }
    return { conectada: true, versionEsquema: fila.schema_version ?? null };
  } catch (e) {
    return { conectada: false, error: e instanceof Error ? e.message : String(e) };
  }
}
