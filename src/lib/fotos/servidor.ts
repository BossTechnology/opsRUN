import "server-only";

import { lecturaOAusente } from "../tablero/servidor";

import { crearJobDeLaRequest } from "./datos-sql";
import type { DependenciasDeFoto } from "./servir";

/** El puerto de lectura de BzzzBX y la lectura del job de la request, para la ruta `/api/fotos/[id]`. */
export function dependenciasDeFoto(): DependenciasDeFoto {
  return { jobDeLaRequest: crearJobDeLaRequest(), lectura: lecturaOAusente() };
}
