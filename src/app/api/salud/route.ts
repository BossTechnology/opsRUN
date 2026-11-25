import { connection } from "next/server";

import { comoOpsrunApp } from "@/lib/db/servidor";
import { CONSULTA_SALUD, leerSalud, respuestaDeSalud } from "@/lib/salud";

/**
 * GET /api/salud: llama a opsrun.opsrun_health() como opsrun_app.
 *
 * La usan el HEALTHCHECK de la imagen y la prueba de humo del deploy
 * (scripts/humo.mjs). Responde 200 con la última migración aplicada, o 503
 * sin el detalle del error, que queda solo en el log del servidor.
 */
export async function GET() {
  await connection();

  const salud = await leerSalud(() =>
    comoOpsrunApp(async (db) => (await db.query(CONSULTA_SALUD)).rows),
  );
  if (!salud.conectada) {
    console.error("[opsRUN] salud: la base no responde:", salud.error);
  }
  const { estado, cuerpo } = respuestaDeSalud(salud);
  return Response.json(cuerpo, { status: estado, headers: { "cache-control": "no-store" } });
}
