// @vitest-environment node
/**
 * La reconciliación de envíos como tarea del ciclo de fondo (ADR 0006, spec
 * OPR-27 §7): está registrada, corre cada 5 s y, al tocarle su turno, cierra
 * lo abierto; no corre antes de su turno ni dos a la vez. Reloj inyectado.
 */
import { describe, expect, it, vi } from "vitest";

import { tareasDeOpsrun } from "../ciclo/arranque";
import { crearCiclo } from "../ciclo/ciclo";
import type { InstruccionesBzzzbx } from "../bzzzbx/puertos";

import type { DatosDeDespacho, DependenciasDeDespacho } from "./despacho";
import { NOMBRE_DE_LA_TAREA, RECONCILIACION_CADENCIA_MS, tareaReconciliacionEnvios } from "./reconciliacion";

function dependencias() {
  const abiertas = vi.fn(async () => []);
  const datos = { abiertas, abierta: vi.fn(), registrarEntrega: vi.fn(), resolver: vi.fn() } as unknown as DatosDeDespacho;
  const instrucciones = { entregar: vi.fn(), estado: vi.fn(), resultadosDesde: vi.fn() } as unknown as InstruccionesBzzzbx;
  const deps: DependenciasDeDespacho = { instrucciones, datos };
  return { deps, abiertas };
}

describe("tarea reconciliacion_envios", () => {
  it("está en la lista de tareas de opsRUN, cada 5 s", () => {
    const tarea = tareaReconciliacionEnvios();
    expect(tarea).toMatchObject({ nombre: NOMBRE_DE_LA_TAREA, cadenciaMs: 5_000 });
    expect(RECONCILIACION_CADENCIA_MS).toBe(5_000);
    expect(tareasDeOpsrun().map((t) => t.nombre)).toContain(NOMBRE_DE_LA_TAREA);
  });

  it("el ciclo la corre al tocarle su turno y no antes", async () => {
    let t = 1_000_000;
    const { deps, abiertas } = dependencias();
    const ciclo = crearCiclo({ ahora: () => t, log: { info: vi.fn(), error: vi.fn() } });
    ciclo.registrar(tareaReconciliacionEnvios(() => deps));

    await ciclo.tic();
    expect(abiertas).toHaveBeenCalledTimes(1);
    t += 4_999;
    await ciclo.tic();
    expect(abiertas).toHaveBeenCalledTimes(1);
    t += 1;
    await ciclo.tic();
    expect(abiertas).toHaveBeenCalledTimes(2);
  });

  it("pide las dependencias en cada vuelta (el stand-in se reemplaza al reiniciarlo)", async () => {
    const deps = vi.fn(() => dependencias().deps);
    const tarea = tareaReconciliacionEnvios(deps);
    await tarea.vuelta();
    await tarea.vuelta();
    expect(deps).toHaveBeenCalledTimes(2);
  });
});
