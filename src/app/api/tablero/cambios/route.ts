import { connection, type NextRequest } from "next/server";

import { revisarCambiosDelTablero } from "@/lib/tablero/servidor";

/**
 * GET /api/tablero/cambios?cursor=…: ¿cambió algo del tablero desde el cursor?
 * Solo responde sí o no, si BzzzBX responde y el cursor siguiente; ningún dato
 * de PINCH sale por aquí (spec OPR-25 §4).
 */
export async function GET(pedido: NextRequest) {
  await connection();
  try {
    const revision = await revisarCambiosDelTablero(pedido.nextUrl.searchParams.get("cursor"));
    return Response.json(revision, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[opsRUN] tablero: no se pudo revisar cambios:", e instanceof Error ? e.message : e);
    return Response.json({ status: "error" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
