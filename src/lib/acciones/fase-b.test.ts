// @vitest-environment node
/**
 * Guard de la Fase B (OPR-29, spec §6 y §11.2): las acciones que se hacen en las herramientas de PINCH hasta que se
 * enciendan las acciones (Reschedule, Cancel job y End manually, hoy) no tienen ejecutor, no salen `disponible` en
 * ninguna etapa y `ejecutarAccion` las rechaza antes de tocar la base o el puerto de instrucciones.
 *
 * Descubre en `REGISTRO_DE_ACCIONES` las entradas con `faseB`, sin lista: una acción de la Fase B nueva entra sola,
 * y una a la que alguien le ponga un ejecutor hace fallar esta prueba. Se ve fallar en cada corrida con una entrada de
 * prueba `faseB` con ejecutor.
 */
import { describe, expect, it, vi } from "vitest";

import { armarVentana } from "../ventana/armar";
import {
  CONFIRMACIONES_COMPLETAS,
  filaVentana,
  leidosVentanaDelFalso,
  OPERADORES_DE_PRUEBA,
} from "../ventana/prueba-datos";
import type { VentanaJob } from "../ventana/tipos";

import { disponibilidadDe, FASE_B } from "./disponibilidad";
import { ejecutar } from "./ejecutar";
import { REGISTRO_DE_ACCIONES } from "./registro";
import type { DefinicionAccion } from "./tipos";

const AHORA = new Date("2026-11-24T18:00:00Z");
const ACTOR = { tipo: "operador", authUserId: "de000000-0000-4000-8000-0000000000a1" } as const;

function ventana(n: number, parche: { disponible?: boolean } = {}): VentanaJob {
  return armarVentana({
    fila: filaVentana(AHORA, n),
    leidos: leidosVentanaDelFalso(AHORA),
    hilos: [`bx-thread-000${n}`],
    operadores: OPERADORES_DE_PRUEBA,
    confirmaciones: CONFIRMACIONES_COMPLETAS,
    instruccionAbierta: false,
    ahora: AHORA,
    zona: "UTC",
    bzzzbx: { disponible: parche.disponible ?? true, actualizadoEn: AHORA.toISOString() },
    tab: null,
  });
}

/** Una ventana por etapa (R2 a R6) y una con el job cancelado, con BzzzBX arriba y caído. */
const VENTANAS: { nombre: string; v: VentanaJob }[] = [2, 3, 4, 5, 6].flatMap((n) =>
  [true, false].map((disponible) => ({ nombre: `R${n}${disponible ? "" : " sin BzzzBX"}`, v: ventana(n, { disponible }) })),
);
VENTANAS.push({ nombre: "job cancelado", v: { ...ventana(3), etapa: "cancelled" } });

/** Lo que incumple cada entrada `faseB` del registro; vacío si todas cumplen. */
function violacionesDeFaseB(registro: DefinicionAccion[]): string[] {
  return registro
    .filter((d) => d.faseB)
    .flatMap((def) => [
      ...(def.ejecutor ? [`${def.codigo}: tiene ejecutor`] : []),
      ...VENTANAS.filter(({ v }) => disponibilidadDe(def, v).tipo === "disponible").map(({ nombre }) => `${def.codigo}: disponible en ${nombre}`),
    ]);
}

describe("Fase B: lo que se hace en las herramientas de PINCH no corre desde opsRUN", () => {
  const faseB = REGISTRO_DE_ACCIONES.filter((d) => d.faseB);

  it("el descubrimiento ve las acciones de la Fase B (Reschedule, Cancel job y End manually)", () => {
    expect(faseB.map((d) => d.codigo).sort()).toEqual(["cancel_job", "end_job_manually", "reschedule_job"]);
  });

  it("ninguna tiene ejecutor ni sale disponible en ninguna etapa", () => {
    expect(violacionesDeFaseB(REGISTRO_DE_ACCIONES)).toEqual([]);
  });

  it("en su etapa salen fuera_de_release con 'Available when actions are switched on'", () => {
    for (const def of faseB) {
      const propias = VENTANAS.filter(({ v }) => v.etapa !== "cancelled" && def.etapas.includes(v.etapa));
      expect(propias.length, def.codigo).toBeGreaterThan(0);
      for (const { nombre, v } of propias) {
        expect(disponibilidadDe(def, v), `${def.codigo} en ${nombre}`).toEqual({ tipo: "fuera_de_release", fase: "b" });
      }
    }
    expect(FASE_B).toBe("Available when actions are switched on");
  });

  it.each(["reschedule_job", "cancel_job", "end_job_manually"])(
    "%s, forzada con motivo y versión buenos, se rechaza antes de leer el actor, tocar la base o refrescar",
    async (codigo) => {
      const def = REGISTRO_DE_ACCIONES.find((d) => d.codigo === codigo)!;
      const v = ventana(def.etapas.includes("scheduled") ? 3 : 4);
      const deps = {
        registro: REGISTRO_DE_ACCIONES,
        leerVentana: vi.fn(async () => v),
        actor: vi.fn(async () => ACTOR),
        refrescar: vi.fn(async () => {}),
      };
      const r = await ejecutar(deps, { requestId: v.requestId, codigo, motivo: "Because.", datos: {}, version: v.version });
      expect(r).toEqual({ tipo: "rechazada", codigo: "no_disponible", mensaje: FASE_B });
      expect(deps.actor).not.toHaveBeenCalled();
      expect(deps.refrescar).not.toHaveBeenCalled();
    },
  );

  it("aunque una acción de la Fase B tuviera ejecutor, ejecutarAccion no lo llama", async () => {
    const ejecutor = vi.fn(async () => ({ tipo: "guardada" as const }));
    const conEjecutor: DefinicionAccion = { ...REGISTRO_DE_ACCIONES.find((d) => d.codigo === "reschedule_job")!, ejecutor };
    const v = ventana(3);
    const deps = {
      registro: [conEjecutor],
      leerVentana: vi.fn(async () => v),
      actor: vi.fn(async () => ACTOR),
      refrescar: vi.fn(async () => {}),
    };
    const r = await ejecutar(deps, { requestId: v.requestId, codigo: "reschedule_job", motivo: "Because.", datos: {}, version: v.version });
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "no_disponible" });
    expect(ejecutor).not.toHaveBeenCalled();
  });

  it("se ve fallar: una entrada faseB con ejecutor hace saltar el guard", () => {
    const conEjecutor: DefinicionAccion = {
      codigo: "prueba_fase_b",
      etiqueta: "Prueba",
      descripcion: "Una acción de la Fase B con ejecutor, que no debería existir.",
      etapas: ["scheduled"],
      enRelease: true,
      faseB: true,
      motivo: "no",
      necesitaBzzzbx: false,
      ejecutor: async () => ({ tipo: "guardada" }),
    };
    expect(violacionesDeFaseB([...REGISTRO_DE_ACCIONES, conEjecutor])).toEqual(["prueba_fase_b: tiene ejecutor"]);
  });
});
