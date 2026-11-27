import { connection, type NextRequest } from "next/server";

import { dependenciasDeFoto } from "@/lib/fotos/servidor";
import { servirFoto } from "@/lib/fotos/servir";

/** Nunca se guarda ni se cachea: la imagen es de BzzzBX y solo se muestra (spec OPR-30, S-4 y P-8). */
const SIN_CACHE = { "cache-control": "private, no-store" };

/**
 * GET /api/fotos/[id]?request=<uuid>: la imagen de una foto del Job tracker. Pide
 * la imagen al puerto de BzzzBX (el navegador nunca habla con BzzzBX) y la
 * devuelve con `Cache-Control: private, no-store`. 404 si la foto no es de un job
 * enlazado a esa request; 503 si BzzzBX no responde. Solo lee de la base.
 */
export async function GET(pedido: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  let respuesta;
  try {
    respuesta = await servirFoto({ fotoId: id, requestId: pedido.nextUrl.searchParams.get("request") }, dependenciasDeFoto());
  } catch (e) {
    console.error("[opsRUN] fotos: no se pudo servir la foto:", e instanceof Error ? e.message : e);
    return new Response(null, { status: 503, headers: SIN_CACHE });
  }
  if (respuesta.estado !== 200) return new Response(null, { status: respuesta.estado, headers: SIN_CACHE });
  return new Response(new Uint8Array(respuesta.bytes), {
    headers: {
      ...SIN_CACHE,
      "content-type": respuesta.contentType,
      // Un SVG abierto directo no ejecuta nada ni carga nada.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}
