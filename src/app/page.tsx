import { connection } from "next/server";
import { Suspense } from "react";

import { obtenerTablero, revisarCambiosDelTablero, SONDEO_MS, zonaDeLaOperacion } from "@/lib/tablero/servidor";

import { VistaTablero } from "./_tablero/vista-tablero";

/** Se lee en cada visita y en cada refresco, nunca en el build. */
async function TableroEnVivo() {
  await connection();
  // El cursor va antes que la lectura: lo que cambie en medio se ve en el siguiente sondeo.
  const { cursor } = await revisarCambiosDelTablero(null);
  const tablero = await obtenerTablero();
  return <VistaTablero tablero={tablero} zona={zonaDeLaOperacion()} sondeoMs={SONDEO_MS} cursor={cursor} />;
}

/** El tablero (OPR-25). */
export default function Inicio() {
  return (
    <Suspense fallback={<p aria-busy="true">Loading board…</p>}>
      <TableroEnVivo />
    </Suspense>
  );
}
