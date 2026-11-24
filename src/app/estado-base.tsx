import { connection } from "next/server";

import { leerSalud } from "@/lib/salud";
import { crearClienteServidor } from "@/lib/supabase/servidor";

import { TarjetaSalud } from "./tarjeta-salud";

/** Lee la salud de la base en cada visita, nunca en el build. */
export async function EstadoBase() {
  await connection();

  let salud;
  try {
    salud = await leerSalud(crearClienteServidor());
  } catch (e) {
    salud = {
      conectada: false as const,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  if (!salud.conectada) {
    console.error("[opsRUN] La base no responde:", salud.error);
  }
  return <TarjetaSalud salud={salud} />;
}
