// @vitest-environment node
/**
 * Guard (spec OPR-36 §14.2): el análisis de IA corre solo en segundo plano, dentro del
 * único ciclo de fondo de opsRUN, nunca desde una lectura. Una lectura nunca pide un
 * análisis (ADR 0006). Complementa a G16 (`lib/ciclo/un-solo-ciclo.test.ts`), que vigila
 * los temporizadores y las lecturas que reconcilian o registran; va en su propio archivo
 * para no tocar el de G16 (otros PR lo editan).
 *
 * Descubre en vez de enumerar: recorre todo `src/` y mira cada archivo.
 *  1. Los módulos con efectos (`analisis`, `datos-sql`, `tarea`) solo los importa el
 *     propio módulo, una prueba, el arranque del ciclo (`lib/ciclo/arranque.ts`) o
 *     `instrumentation*`. Los puros (`forma`, `armar`, `tipos`) los puede importar
 *     cualquiera, porque no escriben ni llaman a nadie.
 *  2. Nada fuera de `lib/bzzzbx/` y de `lib/analisis-ia/` toca el puerto de IA
 *     (`.ia`, `iaOAusente`, `pedirAnalisis`, `resultadoDeAnalisis`) ni las funciones que
 *     abren o cierran un análisis (`start_ai_analysis`, `record_ai_analysis`): una
 *     lectura, una ruta o una página no pueden. Decidir una sugerencia
 *     (`decide_ai_suggestion`) sí es del operador y vive en `lib/acciones/`.
 *  3. El arranque sí registra la tarea y le pasa su `despertar` a la entrada (si alguien
 *     lo quita, nadie analiza).
 * Se ve fallar: las funciones reciben las fuentes y se prueban con rutas y textos malos.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const ES_ARRANQUE = /^lib\/ciclo\/arranque\.ts$|(^|\/)(instrumentation|instrumentacion)[^/]*\.tsx?$/;
const IMPORTA_UN_MODULO_CON_EFECTOS = /\b(?:from|import)\s*\(?\s*["'][^"']*analisis-ia\/(?:analisis|datos-sql|tarea)["']/;
const USA_EL_PUERTO_DE_IA =
  /\b(?:iaOAusente|IaBzzzbx|pedirAnalisis|resultadoDeAnalisis|start_ai_analysis|record_ai_analysis|tareaAnalisisIa|crearAnalisis|crearDatosDeAnalisis)\b|\bobtenerBzzzbx\(\s*\)\s*\.ia\b/;

type Fuente = { ruta: string; texto: string };

const SIN_COMENTARIOS = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const esPrueba = (ruta: string) => /\.test\.tsx?$/.test(ruta);

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

/** Los archivos que importan un módulo con efectos del análisis y no deberían. */
export function importadoresIndebidos(fuentes: Fuente[]): string[] {
  return fuentes
    .filter(({ ruta }) => !ruta.startsWith("lib/analisis-ia/") && !esPrueba(ruta) && !ES_ARRANQUE.test(ruta))
    .filter(({ texto }) => IMPORTA_UN_MODULO_CON_EFECTOS.test(SIN_COMENTARIOS(texto)))
    .map(({ ruta }) => ruta);
}

/** Los archivos que tocan el puerto de IA o las funciones de la base del análisis y no deberían. */
export function usuariosIndebidosDelPuerto(fuentes: Fuente[]): string[] {
  return fuentes
    .filter(({ ruta }) => !ruta.startsWith("lib/analisis-ia/") && !ruta.startsWith("lib/bzzzbx/") && !esPrueba(ruta) && !ES_ARRANQUE.test(ruta))
    .filter(({ texto }) => USA_EL_PUERTO_DE_IA.test(SIN_COMENTARIOS(texto)))
    .map(({ ruta }) => ruta);
}

describe("el análisis de IA solo corre en segundo plano (OPR-36, ADR 0006)", () => {
  const fuentes: Fuente[] = archivos(RAIZ).map((ruta) => ({ ruta: relative(RAIZ, ruta).split("\\").join("/"), texto: readFileSync(ruta, "utf8") }));

  it("el guard tiene qué mirar: el módulo existe y se recorre todo src/, también las rutas de lectura", () => {
    expect(fuentes.some((f) => f.ruta === "lib/analisis-ia/tarea.ts")).toBe(true);
    expect(fuentes.some((f) => f.ruta === "lib/bzzzbx/falso/ia-falsa.ts")).toBe(true);
    expect(fuentes.some((f) => f.ruta === "app/api/tablero/cambios/route.ts")).toBe(true);
    expect(fuentes.length).toBeGreaterThan(100);
  });

  it("ninguna lectura, ruta, página ni ranura importa la tarea, sus datos ni su vuelta", () => {
    expect(importadoresIndebidos(fuentes)).toEqual([]);
  });

  it("nada fuera del puerto y del módulo toca el puerto de IA ni abre o cierra un análisis", () => {
    expect(usuariosIndebidosDelPuerto(fuentes)).toEqual([]);
  });

  it("el arranque del ciclo sí registra la tarea y le pasa su despertar a la entrada", () => {
    const arranque = fuentes.find((f) => f.ruta === "lib/ciclo/arranque.ts");
    expect(arranque?.texto).toMatch(IMPORTA_UN_MODULO_CON_EFECTOS);
    expect(arranque?.texto).toContain("tareaAnalisisIa()");
    expect(arranque?.texto).toMatch(/tareaEntradaCorreo\(\{\s*alCrearRequest:\s*analisis\.despertar\s*\}\)/);
    expect(arranque?.texto).toMatch(/\banalisis,?\s*\]/);
  });

  it("se ve fallar: una ruta de lectura, una página o una ranura que importe la tarea se detecta; el arranque, el módulo y las puras no", () => {
    const malo = { ruta: "app/api/tablero/cambios/route.ts", texto: `import { tareaAnalisisIa } from "@/lib/analisis-ia/tarea";` };
    expect(importadoresIndebidos([malo])).toEqual(["app/api/tablero/cambios/route.ts"]);
    expect(importadoresIndebidos([{ ruta: "app/page.tsx", texto: `import { crearAnalisis } from "../lib/analisis-ia/analisis";` }])).toEqual(["app/page.tsx"]);
    expect(importadoresIndebidos([{ ruta: "app/_ventana/ranura-x.tsx", texto: `const m = await import("../../lib/analisis-ia/datos-sql");` }])).toEqual([
      "app/_ventana/ranura-x.tsx",
    ]);
    // Otro módulo del ciclo (no el arranque) tampoco puede.
    expect(importadoresIndebidos([{ ruta: "lib/ciclo/ciclo.ts", texto: `import { x } from "../analisis-ia/tarea";` }])).toEqual(["lib/ciclo/ciclo.ts"]);
    const bien = [
      { ruta: "lib/ciclo/arranque.ts", texto: `import { tareaAnalisisIa } from "../analisis-ia/tarea";` },
      { ruta: "instrumentation.ts", texto: `import { tareaAnalisisIa } from "@/lib/analisis-ia/tarea";` },
      { ruta: "lib/analisis-ia/tarea.ts", texto: `import { crearAnalisis } from "./analisis";` },
      { ruta: "lib/analisis-ia/analisis.test.ts", texto: `import { crearAnalisis } from "./analisis";` },
      { ruta: "lib/ventana/armar.ts", texto: `import { armarIa } from "../analisis-ia/armar";` },
      { ruta: "app/_ventana/campo-ia.tsx", texto: `import { valorDeEntrada } from "@/lib/analisis-ia/forma";` },
      { ruta: "lib/ventana/comentario.ts", texto: `// import { x } from "../analisis-ia/tarea"\nexport const z = 1;` },
    ];
    expect(importadoresIndebidos(bien)).toEqual([]);
  });

  it("se ve fallar: una lectura que usa el puerto de IA o llama a las funciones del análisis se detecta; el puerto y el módulo no", () => {
    expect(usuariosIndebidosDelPuerto([{ ruta: "lib/ventana/leer.ts", texto: `const ia = obtenerBzzzbx().ia; await ia.pedirAnalisis(p);` }])).toEqual(["lib/ventana/leer.ts"]);
    expect(usuariosIndebidosDelPuerto([{ ruta: "app/api/tablero/cambios/route.ts", texto: `import { iaOAusente } from "@/lib/bzzzbx/ausente";` }])).toEqual([
      "app/api/tablero/cambios/route.ts",
    ]);
    expect(usuariosIndebidosDelPuerto([{ ruta: "lib/tablero/leer.ts", texto: `await db.query("select opsrun.start_ai_analysis($1)");` }])).toEqual(["lib/tablero/leer.ts"]);
    expect(usuariosIndebidosDelPuerto([{ ruta: "lib/ventana/consultas.ts", texto: `await db.query("select opsrun.record_ai_analysis($1)");` }])).toEqual([
      "lib/ventana/consultas.ts",
    ]);
    const bien = [
      { ruta: "lib/bzzzbx/falso/ia-falsa.ts", texto: `async pedirAnalisis() {} async resultadoDeAnalisis() {}` },
      { ruta: "lib/analisis-ia/analisis.ts", texto: `await ia.pedirAnalisis(p);` },
      { ruta: "lib/ciclo/arranque.ts", texto: `const analisis = tareaAnalisisIa();` },
      { ruta: "lib/acciones/ia.ts", texto: `await db.query("select opsrun.decide_ai_suggestion($1)");` },
      { ruta: "lib/ventana/leer.ts", texto: `// pedirAnalisis solo en un comentario\nexport const y = 1;` },
    ];
    expect(usuariosIndebidosDelPuerto(bien)).toEqual([]);
  });
});
