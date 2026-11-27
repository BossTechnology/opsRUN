// @vitest-environment node
/**
 * Guard: el observador de hechos de PINCH corre solo en segundo plano, dentro del
 * único ciclo de fondo de opsRUN (OPR-30 a OPR-32 §7.5, P-9 aprobada por Henry el
 * 2026-11-27), nunca desde una consulta de lectura como `/api/tablero/cambios`.
 *
 * Descubre en vez de enumerar: recorre todo `src/` y falla si algún archivo que no
 * es del propio módulo, ni una prueba, ni el arranque (`instrumentation*`,
 * `instrumentacion*`) importa `observados`. Una ruta, una página, un server
 * component o una lectura que lo llame hace fallar este guard.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const IMPORTA_OBSERVADOS = /\b(?:from|import)\s*\(?\s*["'][^"']*observados[^"']*["']/;
const ES_ARRANQUE = /(^|\/)(instrumentation|instrumentacion)[^/]*\.tsx?$/;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

/** Los archivos que importan el observador y no deberían. Recibe las rutas y sus textos para poder probar el guard. */
export function importadoresIndebidos(fuentes: { ruta: string; texto: string }[]): string[] {
  return fuentes
    .filter(({ ruta }) => !ruta.startsWith("lib/observados/") && !/\.test\.tsx?$/.test(ruta) && !ES_ARRANQUE.test(ruta))
    .filter(({ texto }) => IMPORTA_OBSERVADOS.test(texto))
    .map(({ ruta }) => ruta);
}

describe("el observador solo corre en segundo plano", () => {
  const fuentes = archivos(RAIZ).map((ruta) => ({ ruta: relative(RAIZ, ruta).split("\\").join("/"), texto: readFileSync(ruta, "utf8") }));

  it("el guard tiene qué mirar: el módulo del observador existe y se recorre todo src/", () => {
    expect(fuentes.some((f) => f.ruta === "lib/observados/observar.ts")).toBe(true);
    expect(fuentes.length).toBeGreaterThan(100);
    expect(fuentes.some((f) => f.ruta === "app/api/tablero/cambios/route.ts")).toBe(true);
  });

  it("ningún archivo de lectura, ruta, página o ranura lo importa", () => {
    expect(importadoresIndebidos(fuentes)).toEqual([]);
  });

  it("se ve fallar: una ruta de lectura que lo importe se detecta; el arranque y su propio módulo no", () => {
    const malo = { ruta: "app/api/tablero/cambios/route.ts", texto: `import { correrObservador } from "@/lib/observados/servidor";` };
    expect(importadoresIndebidos([malo])).toEqual(["app/api/tablero/cambios/route.ts"]);
    expect(importadoresIndebidos([{ ruta: "lib/tablero/servidor.ts", texto: `const m = await import("../observados/servidor");` }])).toEqual([
      "lib/tablero/servidor.ts",
    ]);
    const bien = [
      { ruta: "instrumentation.ts", texto: `import { correrObservador } from "@/lib/observados/servidor";` },
      { ruta: "lib/observados/servidor.ts", texto: `import { crearObservador } from "./observar";` },
      { ruta: "lib/observados/observar.test.ts", texto: `import { x } from "./observar";` },
    ];
    expect(importadoresIndebidos(bien)).toEqual([]);
  });
});
