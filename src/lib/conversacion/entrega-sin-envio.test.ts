// @vitest-environment node
/**
 * Guard "el arreglo de la alerta no envía" (spec OPR-19 §10.2, principio 3: las
 * personas firman). El botón Edit and resend de la alerta Message not delivered y
 * el Edit and resend del hilo solo mueven el foco o copian el cuerpo al Composer:
 * nunca envían. Sale algo únicamente si el operador pulsa Send, que es del
 * Composer (la regla (c) de `nada-sale-solo.test.ts` sigue encontrando solo al
 * Composer y a su ejecutor).
 *
 * Descubre en el disco (`src/**`) a quien pinta uno de esos botones, por su marca
 * (`data-testid="reenviar"` o `data-accion="edit_and_resend"`), en vez de
 * enumerar archivos, y falla si ese archivo puede enviar: importa o llama a
 * `ejecutarAccion` o a las acciones, nombra `send_email` o `send_text`, llama a la
 * función SQL `opsrun.send_*` o hace un `fetch`. Los comentarios no cuentan.
 *
 * Se ve fallar en cada corrida: el mismo detector, sobre archivos de prueba que
 * pintan el botón y envían, tiene que marcarlos.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

type Archivo = { ruta: string; texto: string };

const sinComentarios = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function codigoDeLaApp(dir = SRC): Archivo[] {
  const salida: Archivo[] = [];
  for (const nombre of readdirSync(dir)) {
    const completa = join(dir, nombre);
    if (statSync(completa).isDirectory()) {
      salida.push(...codigoDeLaApp(completa));
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.(ts|tsx)$/.test(nombre)) {
      salida.push({ ruta: relative(SRC, completa).split(sep).join("/"), texto: sinComentarios(readFileSync(completa, "utf8")) });
    }
  }
  return salida;
}

/** Quien pinta Edit and resend (el del hilo o el de la alerta). */
const PINTA_EL_BOTON = (a: Archivo) => /data-testid="reenviar"|data-accion="edit_and_resend"/.test(a.texto);

const SEND = String.raw`["'\x60]send_(?:email|text)["'\x60]`;
const PUEDE_ENVIAR: Record<string, (a: Archivo) => boolean> = {
  "importa o llama a ejecutarAccion": (a) => /\bejecutarAccion\w*\b/.test(a.texto),
  "importa las acciones": (a) => /from\s+["'][^"']*\/(?:acciones|_ventana\/acciones)["']/.test(a.texto),
  "nombra send_email o send_text": (a) => new RegExp(SEND).test(a.texto),
  "llama a opsrun.send_*": (a) => /opsrun\.send_(?:email|text)\b/.test(a.texto),
  "hace un fetch": (a) => /\bfetch\s*\(/.test(a.texto),
};

/** Los archivos que pintan Edit and resend y pueden enviar, con la razón. */
export function botonesQueEnvian(archivos: Archivo[]): string[] {
  return archivos.filter(PINTA_EL_BOTON).flatMap((a) =>
    Object.entries(PUEDE_ENVIAR)
      .filter(([, detecta]) => detecta(a))
      .map(([razon]) => `${a.ruta}: ${razon}`),
  );
}

describe("guard: Edit and resend, en el hilo y en la alerta, nunca envía (OPR-19)", () => {
  const codigo = codigoDeLaApp();

  it("tiene qué mirar: descubre a quien pinta el botón del hilo y el de la alerta", () => {
    expect(codigo.length).toBeGreaterThan(50);
    expect(codigo.filter(PINTA_EL_BOTON).map((a) => a.ruta).sort()).toEqual(["app/_conversacion/hilo.tsx", "app/_ventana/boton-de-alerta.tsx"]);
  });

  it("ninguno de los dos puede enviar", () => {
    expect(botonesQueEnvian(codigo)).toEqual([]);
  });

  it("el Composer sigue siendo el único que envía: Edit and resend solo le copia el cuerpo", () => {
    const composer = codigo.find((a) => a.ruta === "app/_conversacion/composer.tsx")!;
    expect(PINTA_EL_BOTON(composer)).toBe(false);
    expect(PUEDE_ENVIAR["importa o llama a ejecutarAccion"]!(composer)).toBe(true);
  });

  describe("se ve fallar", () => {
    const falsos = (texto: string): Archivo[] => [{ ruta: "app/_ventana/malo.tsx", texto: sinComentarios(texto) }];

    it.each([
      ["importa ejecutarAccion", 'import { ejecutarAccion } from "./acciones";\nexport const B = () => <button data-testid="reenviar" onClick={() => ejecutarAccion({})} />;', "importa o llama a ejecutarAccion"],
      ["importa las acciones", 'import { x } from "@/lib/acciones";\nexport const B = () => <button data-accion="edit_and_resend" />;', "importa las acciones"],
      ["nombra send_text", 'export const B = () => <button data-testid="reenviar" data-codigo={"send_text"} />;', "nombra send_email o send_text"],
      ["llama a la función SQL", 'export const q = "select opsrun.send_email($1)";\nexport const B = () => <button data-testid="reenviar" />;', "llama a opsrun.send_*"],
      ["hace un fetch", 'export const B = () => <button data-testid="reenviar" onClick={() => fetch("/x")} />;', "hace un fetch"],
    ])("detecta un botón que %s", (_caso, texto, razon) => {
      expect(botonesQueEnvian(falsos(texto))).toContain(`app/_ventana/malo.tsx: ${razon}`);
    });

    it("no marca un botón que solo mueve el foco, ni un comentario que nombra ejecutarAccion, ni a quien no pinta el botón", () => {
      expect(botonesQueEnvian(falsos('// no llama a ejecutarAccion ni a send_text\nexport const B = () => <button data-testid="reenviar" onClick={() => document.body.focus()} />;'))).toEqual([]);
      expect(botonesQueEnvian(falsos('import { ejecutarAccion } from "./acciones";\nexport const C = ejecutarAccion;'))).toEqual([]);
    });
  });
});
