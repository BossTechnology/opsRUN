// @vitest-environment node
/**
 * El observador de hechos como tarea del ciclo de fondo (ADR 0006, spec §7.5):
 * está registrado, corre cada 15 s y, al tocarle su turno, escribe lo observado;
 * no corre antes de su turno ni dos a la vez, y recuerda lo escrito entre vueltas.
 * Reloj inyectado.
 */
import { describe, expect, it, vi } from "vitest";

import { crearFalso, RelojManual } from "../bzzzbx/falso";
import { tareasDeOpsrun } from "../ciclo/arranque";
import { crearCiclo } from "../ciclo/ciclo";

import type { DatosDelObservador, HechoObservado } from "./observar";
import { NOMBRE_DE_LA_TAREA, OBSERVADOR_CADENCIA_MS, tareaObservadorEtapas } from "./tarea";

function preparar(jobs: string[] = ["bx-job-0004", "bx-job-0006"]) {
  const falso = crearFalso({ reloj: new RelojManual(new Date("2026-11-27T15:00:00Z")) });
  const escritos = new Set<string>();
  const registrar = vi.fn(async (h: HechoObservado) => {
    if (escritos.has(h.bzzzbxEventId)) return null;
    escritos.add(h.bzzzbxEventId);
    return String(escritos.size);
  });
  const jobsEnlazados = vi.fn(async () => jobs);
  const datos: DatosDelObservador = { jobsEnlazados, registrar };
  const deps = vi.fn(() => ({ lectura: falso.lectura, datos }));
  return { falso, registrar, jobsEnlazados, deps };
}

const callado = () => ({ info: vi.fn(), error: vi.fn() });

describe("tarea observador_etapas", () => {
  it("está en la lista de tareas de opsRUN, cada 15 s", () => {
    expect(tareaObservadorEtapas()).toMatchObject({ nombre: "observador_etapas", cadenciaMs: 15_000 });
    expect(NOMBRE_DE_LA_TAREA).toBe("observador_etapas");
    expect(OBSERVADOR_CADENCIA_MS).toBe(15_000);
    expect(tareasDeOpsrun().map((t) => t.nombre)).toContain(NOMBRE_DE_LA_TAREA);
  });

  it("el ciclo la corre al tocarle su turno y no antes", async () => {
    let t = 1_000_000;
    const { jobsEnlazados, registrar, deps } = preparar();
    const ciclo = crearCiclo({ ahora: () => t, log: callado() });
    ciclo.registrar(tareaObservadorEtapas(deps));

    await ciclo.tic();
    expect(jobsEnlazados).toHaveBeenCalledTimes(1);
    expect(registrar).toHaveBeenCalledTimes(5);
    t += 14_999;
    await ciclo.tic();
    expect(jobsEnlazados).toHaveBeenCalledTimes(1);
    t += 1;
    await ciclo.tic();
    expect(jobsEnlazados).toHaveBeenCalledTimes(2);
  });

  it("recuerda lo escrito entre vueltas del ciclo y escribe lo nuevo una sola vez", async () => {
    let t = 1_000_000;
    const { falso, registrar, deps } = preparar(["bx-job-0004"]);
    const ciclo = crearCiclo({ ahora: () => t, log: callado() });
    ciclo.registrar(tareaObservadorEtapas(deps));

    await ciclo.tic();
    expect(registrar).toHaveBeenCalledTimes(2);
    falso.lectura.poner("jobtracker_event", {
      bzzzbx_event_id: "bx-evt-9001",
      bzzzbx_job_id: "bx-job-0004",
      kind: "completed",
      occurred_at: "2026-11-27T15:30:00.000Z",
    });
    for (let i = 0; i < 3; i++) {
      t += OBSERVADOR_CADENCIA_MS;
      await ciclo.tic();
    }
    expect(registrar).toHaveBeenCalledTimes(3);
    expect(registrar.mock.calls.filter(([h]) => h.bzzzbxEventId === "bx-evt-9001")).toHaveLength(1);
  });

  it("una vuelta lenta no deja empezar otra (lo garantiza el ciclo)", async () => {
    let t = 1_000_000;
    const { jobsEnlazados, deps } = preparar();
    let soltar!: () => void;
    jobsEnlazados.mockImplementationOnce(() => new Promise<string[]>((resolver) => (soltar = () => resolver([]))));
    const ciclo = crearCiclo({ ahora: () => t, log: callado() });
    ciclo.registrar(tareaObservadorEtapas(deps));

    const primera = ciclo.tic();
    t += 3 * OBSERVADOR_CADENCIA_MS;
    await ciclo.tic();
    expect(jobsEnlazados).toHaveBeenCalledTimes(1);
    soltar();
    await primera;
  });

  it("pide las dependencias en cada vuelta (el stand-in se reemplaza al reiniciarlo)", async () => {
    const { deps } = preparar();
    const tarea = tareaObservadorEtapas(deps);
    await tarea.vuelta();
    await tarea.vuelta();
    expect(deps).toHaveBeenCalledTimes(2);
  });

  it("con el stand-in reiniciado, la siguiente vuelta lee el nuevo", async () => {
    const primero = preparar(["bx-job-0004"]);
    const segundo = preparar(["bx-job-0006"]);
    let actual = primero;
    const tarea = tareaObservadorEtapas(() => ({
      lectura: actual.falso.lectura,
      datos: { jobsEnlazados: actual.jobsEnlazados, registrar: actual.registrar },
    }));
    await tarea.vuelta();
    actual = segundo;
    await tarea.vuelta();
    expect(primero.jobsEnlazados).toHaveBeenCalledTimes(1);
    expect(segundo.registrar.mock.calls.map(([h]) => h.bzzzbxJobId)).toContain("bx-job-0006");
  });

  it("BzzzBX caído: la vuelta termina sin escribir y el ciclo sigue con la siguiente", async () => {
    let t = 1_000_000;
    const { falso, registrar, deps } = preparar();
    const log = callado();
    const ciclo = crearCiclo({ ahora: () => t, log });
    ciclo.registrar(tareaObservadorEtapas(deps));
    falso.lectura.noDisponible(true);
    await ciclo.tic();
    expect(registrar).not.toHaveBeenCalled();
    falso.lectura.noDisponible(false);
    t += OBSERVADOR_CADENCIA_MS;
    await ciclo.tic();
    expect(registrar).toHaveBeenCalledTimes(5);
    expect(log.error).not.toHaveBeenCalled();
  });
});
