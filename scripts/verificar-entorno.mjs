// Revisa el entorno del servidor antes de tocar nada: las mismas reglas con
// las que el servidor de Next se niega a arrancar (src/lib/db/entorno.ts, con
// OPSRUN_SERVIDOR=1), sin conectarse a la base.
//
// El deploy lo corre dentro de la imagen nueva, con el entorno y el archivo de
// secretos que tendrá el contenedor, antes de aplicar migraciones. Así una
// variable prohibida (PROHIBIDAS_EN_SERVIDOR) o un secreto que falta paran el
// deploy antes de cambiar la base.
//
// Importa entorno.ts tal cual: Node 22 quita los tipos al cargarlo. Una sola
// lista de reglas para el servidor y para el deploy.
//
// Los problemas salen por nombre, nunca por valor.
import { pathToFileURL } from "node:url";

import { enServidor, problemasDeEntorno } from "../src/lib/db/entorno.ts";

/** @param {Record<string, string | undefined>} env */
export function verificarEntorno(env = process.env) {
  if (!enServidor(env)) return ["OPSRUN_SERVIDOR no es 1: el contenedor del servidor siempre lo lleva"];
  return problemasDeEntorno(env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problemas = verificarEntorno();
  if (problemas.length > 0) {
    for (const problema of problemas) console.error(`entorno: ${problema}`);
    process.exit(1);
  }
  console.log("entorno: listo para el servidor");
}
