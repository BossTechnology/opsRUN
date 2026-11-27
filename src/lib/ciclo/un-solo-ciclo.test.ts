// @vitest-environment node
/**
 * Guard G16 (ADR 0006): hay un solo ciclo de fondo, y una lectura nunca escribe.
 *
 *  1. Ningún módulo del servidor abre un temporizador propio (`setInterval`):
 *     el trabajo de fondo es una tarea del ciclo (`src/lib/ciclo/`). Los
 *     componentes de cliente ("use client") sondean desde el navegador y no
 *     cuentan.
 *  2. Ninguna ruta de lectura (`src/app/api/**` ni los módulos del tablero)
 *     importa la entrada de correo ni el arranque del ciclo: la entrada corre
 *     en el ciclo, no al contestar un GET.
 *  3. Ninguna lectura (un GET de `src/app/api/**`, un server component de
 *     `src/app/**` o los módulos de lectura del tablero y la ventana) importa
 *     ni llama a la reconciliación de envíos (`lib/instrucciones/reconciliacion`
 *     y sus funciones): una lectura nunca escribe. Las lecturas se descubren
 *     por su forma (un `route.ts` que exporta GET, un `page`/`layout`), no por
 *     una lista.
 *
 * Descubre en vez de enumerar: recorre `src/` y mira cada archivo. Se ve fallar
 * en cada corrida: arma un `src/` de prueba con un temporizador propio y una
 * ruta que importa la entrada, y comprueba que el guard los detecta.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const ruta = join(dir, d.name);
    if (d.isDirectory()) return archivos(ruta);
    return /\.(ts|tsx|mts)$/.test(d.name) && !/\.test\.(ts|tsx)$/.test(d.name) ? [ruta] : [];
  });
}

const esDeCliente = (texto: string) => /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/.*\n\s*)*["']use client["']/.test(texto);

/** Temporizadores propios: `setInterval` fuera de `lib/ciclo` y de los componentes de cliente. */
export function temporizadoresPropios(raiz: string): string[] {
  return archivos(raiz).flatMap((ruta) => {
    const rel = relative(raiz, ruta).split(sep).join("/");
    if (rel.startsWith("lib/ciclo/")) return [];
    const texto = readFileSync(ruta, "utf8");
    if (esDeCliente(texto)) return [];
    const sinComentarios = texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    return /\bsetInterval\s*\(/.test(sinComentarios) ? [rel] : [];
  });
}

/** Lecturas que importan la entrada de correo o el arranque del ciclo. */
export function lecturasQueEscriben(raiz: string): string[] {
  return archivos(raiz).flatMap((ruta) => {
    const rel = relative(raiz, ruta).split(sep).join("/");
    const esLectura = rel.startsWith("app/api/") || rel.startsWith("lib/tablero/");
    if (!esLectura) return [];
    const texto = readFileSync(ruta, "utf8");
    return /from\s+["'][^"']*(\/entrada(\/|["'])|\/ciclo\/)/.test(texto) ? [rel] : [];
  });
}

const SIN_COMENTARIOS = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** ¿Es una lectura? Un `route.ts` que exporta GET, un componente de servidor de `app/`, o los módulos de lectura de `lib/`. */
function esLectura(rel: string, texto: string): boolean {
  if (/^app\/(?:.*\/)?route\.(ts|tsx)$/.test(rel)) return /export\s+(?:async\s+)?(?:function\s+GET\b|const\s+GET\b)|export\s*\{[^}]*\bGET\b/.test(SIN_COMENTARIOS(texto));
  if (/^app\/(?:.*\/)?(?:page|layout|default|template|loading|not-found)\.tsx$/.test(rel)) return true;
  return rel.startsWith("lib/tablero/") || rel.startsWith("lib/ventana/") || /^lib\/conversacion\/leer[^/]*\.ts$/.test(rel);
}

/** Lecturas que importan o llaman a la reconciliación de envíos. */
export function lecturasQueReconcilian(raiz: string): string[] {
  return archivos(raiz).flatMap((ruta) => {
    const rel = relative(raiz, ruta).split(sep).join("/");
    const texto = readFileSync(ruta, "utf8");
    if (!esLectura(rel, texto)) return [];
    const codigo = SIN_COMENTARIOS(texto);
    const importa = /from\s+["'][^"']*\/instrucciones\/(?:reconciliacion|servidor)["']/.test(codigo);
    const llama = /\b(?:reconciliarSiToca|reconciliarInstrucciones|crearReconciliador|tareaReconciliacionEnvios)\b/.test(codigo);
    return importa || llama ? [rel] : [];
  });
}

describe("G16: un solo ciclo de fondo", () => {
  it("el guard tiene qué mirar", () => {
    expect(archivos(RAIZ).length).toBeGreaterThan(100);
    expect(archivos(RAIZ).some((r) => r.endsWith(join("app", "api", "tablero", "cambios", "route.ts")))).toBe(true);
  });

  it("ningún módulo del servidor abre un temporizador propio", () => {
    expect(temporizadoresPropios(RAIZ)).toEqual([]);
  });

  it("ninguna lectura importa la entrada de correo ni el ciclo", () => {
    expect(lecturasQueEscriben(RAIZ)).toEqual([]);
  });

  it("ninguna lectura importa ni llama a la reconciliación de envíos", () => {
    expect(lecturasQueReconcilian(RAIZ)).toEqual([]);
  });

  it("descubre lecturas de verdad: la ruta del sondeo y el tablero cuentan", () => {
    const lecturas = archivos(RAIZ)
      .map((r) => ({ rel: relative(RAIZ, r).split(sep).join("/"), texto: readFileSync(r, "utf8") }))
      .filter((a) => esLectura(a.rel, a.texto))
      .map((a) => a.rel);
    expect(lecturas).toContain("app/api/tablero/cambios/route.ts");
    expect(lecturas).toContain("app/page.tsx");
  });

  describe("se ve fallar", () => {
    const falsa = mkdtempSync(join(tmpdir(), "opsrun-g16-"));
    const poner = (rel: string, texto: string) => {
      mkdirSync(dirname(join(falsa, rel)), { recursive: true });
      writeFileSync(join(falsa, rel), texto);
    };
    poner("lib/ciclo/ciclo.ts", "export const ok = setInterval(() => {}, 1000);\n");
    poner("lib/entrada/propio.ts", "export const mio = setInterval(() => {}, 15000);\n");
    poner("lib/alertas/otro.ts", "// setInterval( en un comentario no cuenta\nexport const x = 1;\n");
    poner("app/_tablero/en-vivo.tsx", '"use client";\nexport const id = setInterval(() => {}, 15000);\n');
    poner("app/api/tablero/cambios/route.ts", 'import { crearEntrada } from "@/lib/entrada/entrada";\nexport const GET = crearEntrada;\n');
    poner("app/api/salud/route.ts", 'import { salud } from "@/lib/salud";\nexport const GET = salud;\n');
    poner(
      "app/api/otro/route.ts",
      'import { reconciliarSiToca } from "@/lib/instrucciones/servidor";\nexport async function GET() { await reconciliarSiToca(); return Response.json({}); }\n',
    );
    poner("app/api/accion/route.ts", 'import { tareaReconciliacionEnvios } from "@/lib/instrucciones/reconciliacion";\nexport const POST = tareaReconciliacionEnvios;\n');
    poner("app/tablero/page.tsx", 'import { reconciliarInstrucciones } from "@/lib/instrucciones/despacho";\nexport default async function P() { await reconciliarInstrucciones(null as never); return null; }\n');
    poner("lib/ventana/leer.ts", 'import { tareaReconciliacionEnvios } from "../instrucciones/reconciliacion";\nexport const x = tareaReconciliacionEnvios;\n');
    poner("lib/ventana/limpia.ts", '// reconciliarSiToca solo en un comentario\nexport const y = 1;\n');
    poner("lib/instrucciones/reconciliacion.ts", "export const tareaReconciliacionEnvios = () => ({});\n");

    afterAll(() => rmSync(falsa, { recursive: true, force: true }));

    it("detecta un temporizador propio, y no el ciclo, ni un comentario, ni un componente de cliente", () => {
      expect(temporizadoresPropios(falsa)).toEqual(["lib/entrada/propio.ts"]);
    });

    it("detecta una ruta de lectura que importa la entrada, y no una que no", () => {
      expect(lecturasQueEscriben(falsa)).toEqual(["app/api/tablero/cambios/route.ts"]);
    });

    it("detecta una lectura que reconcilia (GET, página o módulo de lectura), y no un POST, ni un comentario, ni el módulo de la tarea", () => {
      expect(lecturasQueReconcilian(falsa)).toEqual([
        "app/api/otro/route.ts",
        "app/tablero/page.tsx",
        "lib/ventana/leer.ts",
      ]);
    });
  });
});
