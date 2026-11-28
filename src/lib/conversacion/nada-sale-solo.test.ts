// @vitest-environment node
/**
 * Guard 'nada sale solo' (spec OPR-27 §5.5 y §11.1 (c), principio 3: las IAs
 * proponen, las personas firman). Un correo o un texto solo sale por la acción
 * de un operador. Esta prueba descubre en el disco (`src/**`) quién puede
 * crear un `send_email` o un `send_text`, en vez de enumerar los archivos
 * buenos, y falla si hay otro camino:
 *
 *  1. solo `src/lib/conversacion/ejecutores.ts` llama a `opsrun.send_email` o
 *     `opsrun.send_text` (las funciones SQL que exigen un operador);
 *  2. solo el Composer (`src/app/_conversacion/composer.tsx`) llama a
 *     `ejecutarAccion` con un código `send_*`;
 *  3. nadie más arma una `Instruccion` de tipo `send_*` (`tipo: "send_…"` en un
 *     objeto; el despacho entrega las que ya existen en la base: no las crea);
 *  4. nadie más del código de la app inserta en `opsrun.instruction`;
 *  5. (OPR-18) las plantillas no envían: `src/lib/plantillas/`, el panel de avisos y el picker de plantillas no
 *     importan `ejecutarAccion`, los ejecutores, `reales`, el despacho ni las acciones del servidor, y no nombran
 *     `send_email` ni `send_text` como código de acción;
 *  6. (OPR-18) ningún archivo que lea `message_template` llama a `opsrun.send_*` ni inserta en `opsrun.instruction`:
 *     no hay un camino que combine una plantilla con una instrucción fuera de las dos funciones SQL de envío (que
 *     comprueba pgTAP en `plantillas.test.sql`).
 *
 * Los comentarios no cuentan: documentar una llamada no es hacerla.
 *
 * Se ve fallar en cada corrida: el mismo detector, sobre archivos de prueba que
 * rompen cada regla, tiene que marcarlos.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

const EJECUTORES = "lib/conversacion/ejecutores.ts";
const COMPOSER = "app/_conversacion/composer.tsx";
/** Lo de las plantillas que nunca envía: el módulo puro y los dos componentes que solo muestran y copian (OPR-18). */
const SOLO_MUESTRA = (ruta: string) =>
  ruta.startsWith("lib/plantillas/") || ruta === "app/_conversacion/avisos.tsx" || ruta === "app/_conversacion/plantillas.tsx";

type Archivo = { ruta: string; texto: string };

/** Sin los comentarios de bloque ni los de línea completa: documentar `opsrun.send_email` no es llamarla. */
const sinComentarios = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Todos los .ts y .tsx de `src/` que no son pruebas, con su ruta relativa a `src/`. */
function codigoDeLaApp(dir = SRC): Archivo[] {
  const salida: Archivo[] = [];
  for (const nombre of readdirSync(dir)) {
    const completa = join(dir, nombre);
    if (statSync(completa).isDirectory()) {
      salida.push(...codigoDeLaApp(completa));
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.(ts|tsx)$/.test(nombre)) {
      salida.push({ ruta: relative(SRC, completa), texto: sinComentarios(readFileSync(completa, "utf8")) });
    }
  }
  return salida;
}

const SEND = String.raw`["'\x60]send_(?:email|text)["'\x60]`;

const REGLAS = {
  /** 1 */ llamaALaFuncionSql: (a: Archivo) => /opsrun\.send_(?:email|text)\b/.test(a.texto),
  /** 2 */ llamaAEjecutarAccionConSend: (a: Archivo) => /\bejecutarAccion\w*\b/.test(a.texto) && new RegExp(SEND).test(a.texto),
  /** 3 */ armaUnaInstruccionSend: (a: Archivo) => new RegExp(String.raw`\btipo:\s*${SEND}\s*[,}]`).test(a.texto),
  /** 4 */ insertaInstrucciones: (a: Archivo) => /insert\s+into\s+opsrun\.instruction\b/i.test(a.texto),
  /** 5 */ plantillaQueEnvia: (a: Archivo) =>
    /\bejecutarAccion\w*\b/.test(a.texto) ||
    /(?:from|import)\s*\(?\s*["'][^"']*(?:ejecutores|\/reales|acciones\/servidor|acciones\/ejecutar|instrucciones\/|_ventana\/acciones)[^"']*["']/.test(a.texto) ||
    /opsrun\.send_(?:email|text)\b/.test(a.texto) ||
    new RegExp(SEND).test(a.texto),
  /** 6 */ combinaPlantillaYEnvio: (a: Archivo) =>
    /\bmessage_template\b/.test(a.texto) && (/opsrun\.send_(?:email|text)\b/.test(a.texto) || /insert\s+into\s+opsrun\.instruction\b/i.test(a.texto)),
};

/** Las rutas que rompen alguna regla, con la regla y sin contar a quien sí puede. */
export function violaciones(archivos: Archivo[]): string[] {
  const malas: string[] = [];
  for (const a of archivos) {
    if (REGLAS.llamaALaFuncionSql(a) && a.ruta !== EJECUTORES) malas.push(`${a.ruta}: llama a opsrun.send_*`);
    if (REGLAS.llamaAEjecutarAccionConSend(a) && a.ruta !== COMPOSER) malas.push(`${a.ruta}: ejecutarAccion con send_*`);
    if (REGLAS.armaUnaInstruccionSend(a)) malas.push(`${a.ruta}: arma una Instruccion send_*`);
    if (REGLAS.insertaInstrucciones(a)) malas.push(`${a.ruta}: inserta en opsrun.instruction`);
    if (SOLO_MUESTRA(a.ruta) && REGLAS.plantillaQueEnvia(a)) malas.push(`${a.ruta}: una plantilla que envía`);
    if (REGLAS.combinaPlantillaYEnvio(a)) malas.push(`${a.ruta}: combina message_template con un envío`);
  }
  return malas;
}

describe("guard 'nada sale solo' (c): descubre en el disco quién puede enviar", () => {
  const codigo = codigoDeLaApp();

  it("tiene qué mirar: descubre el código de la app y a los dos únicos que pueden enviar", () => {
    expect(codigo.length).toBeGreaterThan(50);
    // OPR-18: descubre también lo de las plantillas que no puede enviar (si no existiera, la regla 5 no miraría nada).
    expect(codigo.filter((a) => SOLO_MUESTRA(a.ruta)).length).toBeGreaterThanOrEqual(7);
    expect(codigo.some((a) => a.ruta === "app/_conversacion/avisos.tsx")).toBe(true);
    expect(codigo.some((a) => a.ruta === "app/_conversacion/plantillas.tsx")).toBe(true);
    expect(codigo.filter(REGLAS.llamaALaFuncionSql).map((a) => a.ruta)).toEqual([EJECUTORES]);
    expect(codigo.filter(REGLAS.llamaAEjecutarAccionConSend).map((a) => a.ruta)).toEqual([COMPOSER]);
  });

  it("nadie fuera del Composer y de su ejecutor puede crear un envío", () => {
    expect(violaciones(codigo)).toEqual([]);
  });

  it("el despacho de instrucciones no crea ninguna: ni arma una Instruccion send_* ni inserta en la base", () => {
    const despacho = codigo.filter((a) => a.ruta.startsWith("lib/instrucciones/"));
    expect(despacho.length).toBeGreaterThanOrEqual(3);
    for (const a of despacho) {
      expect(REGLAS.armaUnaInstruccionSend(a), a.ruta).toBe(false);
      expect(REGLAS.insertaInstrucciones(a), a.ruta).toBe(false);
      expect(REGLAS.llamaALaFuncionSql(a), a.ruta).toBe(false);
    }
  });

  it("OPR-18: lo que lee message_template existe y no envía (descubre quién la lee)", () => {
    const lectores = codigo.filter((a) => /\bmessage_template\b/.test(a.texto)).map((a) => a.ruta);
    expect(lectores).toContain("lib/conversacion/consultas.ts");
    for (const a of codigo.filter((x) => lectores.includes(x.ruta))) expect(REGLAS.combinaPlantillaYEnvio(a), a.ruta).toBe(false);
  });

  it("se ve fallar: el detector marca un archivo que rompe cada regla", () => {
    const falsos: Archivo[] = [
      { ruta: "app/api/enviar/route.ts", texto: "await db.query('select opsrun.send_email($1, $2, $3, $4)', args);" },
      { ruta: "lib/ia/borrador.ts", texto: "import { ejecutarAccion } from '@/app/_ventana/acciones';\nawait ejecutarAccion({ codigo: \"send_email\", datos });" },
      { ruta: "lib/ia/otro.ts", texto: "const r = ejecutarAccionReal({ codigo: `send_text` }, refrescar);" },
      { ruta: "lib/instrucciones/trabajo.ts", texto: 'const i = { idempotency_key: k, tipo: "send_text", payload, actor };' },
      { ruta: "lib/instrucciones/sql.ts", texto: "insert into opsrun.instruction (type) values ('send_email')" },
      // OPR-18: una plantilla que se envía sola, por cada manera de hacerlo.
      { ruta: "lib/plantillas/enviar.ts", texto: "import { ejecutarAccion } from '@/app/_ventana/acciones';\nawait ejecutarAccion(x);" },
      { ruta: "lib/plantillas/directo.ts", texto: "import { crearEjecutoresDeConversacion } from '../conversacion/ejecutores';" },
      { ruta: "app/_conversacion/avisos.tsx", texto: "await db.query('select opsrun.send_email($1)', [t]);" },
      { ruta: "app/_conversacion/plantillas.tsx", texto: "const accion = 'send_text';" },
      { ruta: "lib/plantillas/despacho.ts", texto: "import { entregarPorClave } from '../instrucciones/despacho';" },
      {
        ruta: "lib/acciones/avisos.ts",
        texto:
          "const { rows } = await db.query('select body from opsrun.message_template where active');\nawait db.query('select opsrun.send_text($1::uuid, $2::text, $3::text, $4::text)', [id, e, rows[0].body, k]);",
      },
    ];
    expect(violaciones(falsos)).toEqual([
      "app/api/enviar/route.ts: llama a opsrun.send_*",
      "lib/ia/borrador.ts: ejecutarAccion con send_*",
      "lib/ia/otro.ts: ejecutarAccion con send_*",
      "lib/instrucciones/trabajo.ts: arma una Instruccion send_*",
      "lib/instrucciones/sql.ts: inserta en opsrun.instruction",
      "lib/plantillas/enviar.ts: una plantilla que envía",
      "lib/plantillas/directo.ts: una plantilla que envía",
      "app/_conversacion/avisos.tsx: llama a opsrun.send_*",
      "app/_conversacion/avisos.tsx: una plantilla que envía",
      "app/_conversacion/plantillas.tsx: una plantilla que envía",
      "lib/plantillas/despacho.ts: una plantilla que envía",
      "lib/acciones/avisos.ts: llama a opsrun.send_*",
      "lib/acciones/avisos.ts: combina message_template con un envío",
    ]);
    // Y el detector no marca a los dos que sí pueden.
    expect(violaciones([...falsos, ...codigo.filter((a) => a.ruta === EJECUTORES || a.ruta === COMPOSER)])).toHaveLength(13);
  });
});
