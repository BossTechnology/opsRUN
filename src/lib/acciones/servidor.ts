import "server-only";

/**
 * `ejecutarAccion` con sus dependencias reales: la ventana de este momento, el
 * actor de la sesión y el registro de acciones. La Server Action que lo
 * expone al navegador está en `src/app/_ventana/acciones.ts`.
 */
import { actorDeLaSesion } from "../actor/servidor";
import { obtenerVentana } from "../ventana/servidor";

import { ejecutar } from "./ejecutar";
import { REGISTRO_DE_ACCIONES } from "./registro";
import type { EntradaAccion, ResultadoAccion } from "./tipos";

export function ejecutarAccionReal(entrada: EntradaAccion, refrescar: () => Promise<void>): Promise<ResultadoAccion> {
  return ejecutar(
    { registro: REGISTRO_DE_ACCIONES, leerVentana: (id) => obtenerVentana(id), actor: actorDeLaSesion, refrescar },
    entrada,
  );
}
