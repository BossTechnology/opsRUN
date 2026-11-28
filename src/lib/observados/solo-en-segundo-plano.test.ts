// @vitest-environment node
/**
 * Guard: el observador de hechos de PINCH corre solo en segundo plano, dentro del
 * único ciclo de fondo de opsRUN (OPR-30 a OPR-32 §7.5, P-9 aprobada por Henry el
 * 2026-11-27), nunca desde una consulta de lectura como `/api/tablero/cambios`.
 *
 * Descubre en vez de enumerar: recorre todo `src/` y falla si algún archivo que no
 * es del propio módulo, ni una prueba, ni el arranque del ciclo
 * (`lib/ciclo/arranque.ts`, que registra su tarea, o `instrumentation*`) importa
 * `observados`. Una ruta, una página, un server component o una lectura que lo
 * llame hace fallar este guard. Y lo contrario también se comprueba: el
 * arranque sí lo registra (si alguien lo quita del ciclo, nadie observa).
 *
 * Complementa a G16 (`lib/ciclo/un-solo-ciclo.test.ts`), que vigila los
 * temporizadores propios y las lecturas que reconcilian o abren la entrada.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const IMPORTA_OBSERVADOS = /\b(?:from|import)\s*\(?\s*["'][^"']*observados[^"']*["']/;
const ES_ARRANQUE = /^lib\/ciclo\/arranque\.ts$|(^|\/)(instrumentation|instrumentacion)[^/]*\.tsx?$/;

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

/**
 * Lo mismo para el registrador de alertas de OPR-34 (P-2): `lib/alertas/registrador`,
 * `tarea` y `datos-sql` son el registrador y su escritura; `armar`, `consultas`,
 * `reglas` y `tipos` son de lectura y los importa cualquiera. Solo el arranque del
 * ciclo importa la tarea.
 */
const IMPORTA_EL_REGISTRADOR = /\b(?:from|import)\s*\(?\s*["'][^"']*alertas\/(?:registrador|tarea|datos-sql)[^"']*["']/;

/** Los archivos que importan el registrador de alertas y no deberían. */
export function importadoresIndebidosDelRegistrador(fuentes: { ruta: string; texto: string }[]): string[] {
  return fuentes
    .filter(({ ruta }) => !ruta.startsWith("lib/alertas/") && !/\.test\.tsx?$/.test(ruta) && !ES_ARRANQUE.test(ruta))
    .filter(({ texto }) => IMPORTA_EL_REGISTRADOR.test(texto))
    .map(({ ruta }) => ruta);
}

describe("el registrador de alertas solo corre en segundo plano (OPR-34, P-2)", () => {
  const fuentes = archivos(RAIZ).map((ruta) => ({ ruta: relative(RAIZ, ruta).split("\\").join("/"), texto: readFileSync(ruta, "utf8") }));

  it("el guard tiene qué mirar: el registrador existe y se recorre todo src/", () => {
    expect(fuentes.some((f) => f.ruta === "lib/alertas/registrador.ts")).toBe(true);
    expect(fuentes.some((f) => f.ruta === "lib/alertas/tarea.ts")).toBe(true);
    expect(fuentes.length).toBeGreaterThan(100);
  });

  it("ningún archivo de lectura, ruta, página o ranura lo importa", () => {
    expect(importadoresIndebidosDelRegistrador(fuentes)).toEqual([]);
  });

  it("el arranque del ciclo sí registra su tarea", () => {
    const arranque = fuentes.find((f) => f.ruta === "lib/ciclo/arranque.ts");
    expect(arranque?.texto).toMatch(IMPORTA_EL_REGISTRADOR);
    expect(arranque?.texto).toContain("tareaRegistradorAlertas()");
  });

  it("se ve fallar: una ruta de lectura o una ranura que lo importe se detecta; el arranque, su módulo y las lecturas de Alerts no", () => {
    const malo = { ruta: "app/api/tablero/cambios/route.ts", texto: `import { tareaRegistradorAlertas } from "@/lib/alertas/tarea";` };
    expect(importadoresIndebidosDelRegistrador([malo])).toEqual(["app/api/tablero/cambios/route.ts"]);
    expect(importadoresIndebidosDelRegistrador([{ ruta: "app/_ventana/ranura-alertas.tsx", texto: `const m = await import("../../lib/alertas/registrador");` }])).toEqual([
      "app/_ventana/ranura-alertas.tsx",
    ]);
    expect(importadoresIndebidosDelRegistrador([{ ruta: "lib/tablero/leer.ts", texto: `import { crearDatosDelRegistrador } from "../alertas/datos-sql";` }])).toEqual([
      "lib/tablero/leer.ts",
    ]);
    const bien = [
      { ruta: "lib/ciclo/arranque.ts", texto: `import { tareaRegistradorAlertas } from "../alertas/tarea";` },
      { ruta: "instrumentation.ts", texto: `import { tareaRegistradorAlertas } from "@/lib/alertas/tarea";` },
      { ruta: "lib/alertas/tarea.ts", texto: `import { crearRegistrador } from "./registrador";` },
      { ruta: "lib/alertas/registrador.test.ts", texto: `import { crearRegistrador } from "./registrador";` },
      { ruta: "lib/tablero/armar.ts", texto: `import { alertasDeLaRequest } from "../alertas/armar";` },
      { ruta: "app/_ventana/ranura-alertas.tsx", texto: `import { leerAlertas } from "@/lib/alertas/consultas";` },
    ];
    expect(importadoresIndebidosDelRegistrador(bien)).toEqual([]);
    // Otro módulo del ciclo (no el arranque) tampoco puede.
    expect(importadoresIndebidosDelRegistrador([{ ruta: "lib/ciclo/ciclo.ts", texto: `import { x } from "../alertas/tarea";` }])).toEqual(["lib/ciclo/ciclo.ts"]);
  });
});

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

  it("el arranque del ciclo sí registra su tarea", () => {
    const arranque = fuentes.find((f) => f.ruta === "lib/ciclo/arranque.ts");
    expect(arranque?.texto).toMatch(IMPORTA_OBSERVADOS);
    expect(arranque?.texto).toContain("tareaObservadorEtapas()");
  });

  it("se ve fallar: una ruta de lectura que lo importe se detecta; el arranque y su propio módulo no", () => {
    const malo = { ruta: "app/api/tablero/cambios/route.ts", texto: `import { tareaObservadorEtapas } from "@/lib/observados/tarea";` };
    expect(importadoresIndebidos([malo])).toEqual(["app/api/tablero/cambios/route.ts"]);
    expect(importadoresIndebidos([{ ruta: "lib/tablero/servidor.ts", texto: `const m = await import("../observados/servidor");` }])).toEqual([
      "lib/tablero/servidor.ts",
    ]);
    const bien = [
      { ruta: "lib/ciclo/arranque.ts", texto: `import { tareaObservadorEtapas } from "../observados/tarea";` },
      { ruta: "instrumentation.ts", texto: `import { tareaObservadorEtapas } from "@/lib/observados/tarea";` },
      { ruta: "lib/observados/tarea.ts", texto: `import { crearObservador } from "./observar";` },
      { ruta: "lib/observados/observar.test.ts", texto: `import { x } from "./observar";` },
    ];
    expect(importadoresIndebidos(bien)).toEqual([]);
    // Otro módulo del ciclo (no el arranque) tampoco puede.
    expect(importadoresIndebidos([{ ruta: "lib/ciclo/ciclo.ts", texto: `import { x } from "../observados/tarea";` }])).toEqual(["lib/ciclo/ciclo.ts"]);
  });
});
