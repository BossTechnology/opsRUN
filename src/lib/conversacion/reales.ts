import "server-only";

/**
 * Los ejecutores de la conversación con sus dependencias reales: la base como
 * `opsrun_app`, el puerto de lectura de BzzzBX (para validar el equipo) y el
 * despacho de instrucciones. El registro de acciones los carga al usarlos
 * (`src/lib/acciones/registro.ts`).
 */
import { after } from "next/server";

import { comoOpsrunApp } from "../db/servidor";
import { entregarEnvio } from "../instrucciones/servidor";
import { lecturaOAusente } from "../tablero/servidor";

import { crearEjecutoresDeConversacion } from "./ejecutores";

export const ejecutoresReales = crearEjecutoresDeConversacion({
  escribir: (actor, fn) => comoOpsrunApp(fn, { escritura: true, actor }),
  equipo: async (id) => lecturaOAusente().obtener("cleaner_team", id),
  // Después de responder al navegador: la respuesta no espera a BzzzBX (§5.3, paso 4).
  entregar: (clave) => after(() => entregarEnvio(clave)),
});
