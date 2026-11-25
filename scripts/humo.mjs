// Prueba de humo de opsRUN: GET /api/salud, que llama a opsrun.opsrun_health()
// como opsrun_app, y compara la versión del esquema con las migraciones que
// trae esta imagen.
//
// Corre dentro del contenedor: es el HEALTHCHECK de la imagen y la prueba de
// humo del deploy (scripts/servidor/opsrun.sh, con `docker exec`). Pasa si la
// base responde "ok" y su última migración es igual o posterior a la última de
// la imagen: tras un deploy son iguales; tras una vuelta atrás la base puede ir
// por delante (las migraciones son solo hacia adelante) y eso no es un fallo.
//
// Imprime una línea sin datos de conexión y sale con 0 si pasa, 1 si no.
import { pathToFileURL } from "node:url";

import { migracionesEnDisco } from "./migrar.mjs";

/**
 * @param {unknown} cuerpo lo que respondió /api/salud
 * @param {string | undefined} esperada la última migración de la imagen
 * @returns {{ ok: boolean, motivo: string }}
 */
export function evaluarSalud(cuerpo, esperada) {
  if (typeof cuerpo !== "object" || cuerpo === null || cuerpo.status !== "ok") {
    return { ok: false, motivo: "la base no responde a opsrun_health()" };
  }
  const version = cuerpo.schema_version;
  if (typeof version !== "string" || !/^\d{14}$/.test(version)) {
    return { ok: false, motivo: "opsrun_health() no trae la versión del esquema" };
  }
  if (esperada && version < esperada) {
    return { ok: false, motivo: `la base va en ${version} y esta imagen espera ${esperada}: faltan migraciones` };
  }
  return { ok: true, motivo: `opsrun_health() ok, esquema ${version}` };
}

export async function probarHumo({
  url = `http://127.0.0.1:${process.env.PORT || 3000}/api/salud`,
  esperar = 5000,
} = {}) {
  const esperada = (await migracionesEnDisco()).at(-1)?.version;
  let cuerpo;
  try {
    const respuesta = await fetch(url, { signal: AbortSignal.timeout(esperar) });
    cuerpo = await respuesta.json();
  } catch (error) {
    return { ok: false, motivo: `opsRUN no responde en /api/salud (${error.name})` };
  }
  return evaluarSalud(cuerpo, esperada);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { ok, motivo } = await probarHumo();
  console.log(`humo: ${ok ? "pasa" : "falla"}: ${motivo}`);
  process.exit(ok ? 0 : 1);
}
