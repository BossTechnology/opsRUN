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

    afterAll(() => rmSync(falsa, { recursive: true, force: true }));

    it("detecta un temporizador propio, y no el ciclo, ni un comentario, ni un componente de cliente", () => {
      expect(temporizadoresPropios(falsa)).toEqual(["lib/entrada/propio.ts"]);
    });

    it("detecta una ruta de lectura que importa la entrada, y no una que no", () => {
      expect(lecturasQueEscriben(falsa)).toEqual(["app/api/tablero/cambios/route.ts"]);
    });
  });
});
