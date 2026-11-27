import { connection, type NextRequest } from "next/server";

import { reconciliarSiToca } from "@/lib/instrucciones/servidor";
import { revisarCambiosDelTablero } from "@/lib/tablero/servidor";

/**
 * GET /api/tablero/cambios?cursor=…: ¿cambió algo del tablero desde el cursor?
 * Solo responde sí o no, si BzzzBX responde y el cursor siguiente; ningún dato
 * de PINCH sale por aquí (spec OPR-25 §4).
 *
 * Antes de mirar, pone al día los envíos de correo y texto abiertos (spec
 * OPR-27 §7), a lo sumo una vez cada 5 s por proceso: así lo que cierre se ve
 * en este mismo sondeo. No escribe nada más ni crea instrucciones.
 */
export async function GET(pedido: NextRequest) {
  await connection();
  await reconciliarSiToca();
  try {
    const revision = await revisarCambiosDelTablero(pedido.nextUrl.searchParams.get("cursor"));
    return Response.json(revision, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[opsRUN] tablero: no se pudo revisar cambios:", e instanceof Error ? e.message : e);
    return Response.json({ status: "error" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
