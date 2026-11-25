import { connection } from "next/server";

import { comoOpsrunApp } from "@/lib/db/servidor";
import { CONSULTA_SALUD, leerSalud } from "@/lib/salud";

import { TarjetaSalud } from "./tarjeta-salud";

/** Lee la salud de la base en cada visita, nunca en el build. */
export async function EstadoBase() {
  await connection();

  const salud = await leerSalud(() =>
    comoOpsrunApp(async (db) => (await db.query(CONSULTA_SALUD)).rows),
  );
  if (!salud.conectada) {
    console.error("[opsRUN] La base no responde:", salud.error);
  }
  return <TarjetaSalud salud={salud} />;
}
