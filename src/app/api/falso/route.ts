import { connection } from "next/server";

import { obtenerFalso, reiniciarFalso } from "@/lib/bzzzbx";
import { aplicarControl } from "@/lib/bzzzbx/falso/control";
import { olvidarVentanas } from "@/lib/ventana/servidor";

/**
 * POST /api/falso: controles del stand-in de BzzzBX para los E2E (spec OPR-25,
 * P-7). Solo existe con BZZZBX_MODO=falso fuera del servidor; en cualquier
 * otro caso responde 404, como si la ruta no estuviera.
 */
export async function POST(pedido: Request) {
  await connection();
  const falso = obtenerFalso();
  if (!falso) return new Response(null, { status: 404 });

  const cuerpo: unknown = await pedido.json().catch(() => null);
  if (typeof cuerpo === "object" && cuerpo !== null && (cuerpo as { accion?: unknown }).accion === "reiniciar") {
    reiniciarFalso();
    // Lo último leído de BzzzBX por la Job window es del falso anterior.
    olvidarVentanas();
    return Response.json({ ok: true });
  }
  const resultado = aplicarControl(falso, cuerpo);
  return Response.json(resultado, { status: resultado.ok ? 200 : 400 });
}
