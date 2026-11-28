// @vitest-environment node
/**
 * La cancelación observada (OPR-29, spec §7.2 y P-3): la tarea `observador_etapas` que ya recorre los jobs enlazados
 * lee también el `Job`, y si PINCH lo canceló anota `job_cancel_observed` una sola vez, con el id sintético
 * `<job>:cancelled` y la hora de la lectura. No hay tarea ni temporizador nuevos.
 */
import { describe, expect, it, vi } from "vitest";

import { BzzzbxNoDisponible } from "../bzzzbx/errores";
import { crearFalso, RelojManual } from "../bzzzbx/falso";

import { crearObservador, idDeCancelacion, TIPO_JOB_CANCELADO, type DatosDelObservador, type HechoObservado } from "./observar";
import { tareaObservadorEtapas } from "./tarea";

function preparar(jobs: string[] = ["bx-job-0111"]) {
  const reloj = new RelojManual(new Date("2026-11-27T15:00:00Z"));
  const falso = crearFalso({ reloj });
  const escritos = new Set<string>();
  const registrar = vi.fn(async (h: HechoObservado) => {
    // Como la base: el segundo con el mismo id no escribe y devuelve null.
    if (escritos.has(h.bzzzbxEventId)) return null;
    escritos.add(h.bzzzbxEventId);
    return String(escritos.size);
  });
  const datos: DatosDelObservador = { jobsEnlazados: vi.fn(async () => jobs), registrar };
  const observador = crearObservador(() => ({ lectura: falso.lectura, datos }));
  const cancelar = (id: string) => falso.lectura.cambiar("job", id, { status: "cancelled" });
  const cancelaciones = () => registrar.mock.calls.map(([h]) => h).filter((h) => h.tipo === TIPO_JOB_CANCELADO);
  return { reloj, falso, datos, registrar, observador, cancelar, cancelaciones };
}

describe("observador: job cancelado en PINCH", () => {
  it("el tipo y el id sintético son los del spec", () => {
    expect(TIPO_JOB_CANCELADO).toBe("job_cancel_observed");
    expect(idDeCancelacion("bx-job-0111")).toBe("bx-job-0111:cancelled");
  });

  it("un job cancelado hace una llamada a record_observed_event con job_cancel_observed y el id <job>:cancelled", async () => {
    const { observador, cancelar, cancelaciones } = preparar();
    cancelar("bx-job-0111");
    const r = await observador.vuelta();
    expect(r).toEqual({ tipo: "corrida", jobs: 1, escritos: 1, repetidos: 0, errores: 0 });
    expect(cancelaciones()).toHaveLength(1);
    expect(cancelaciones()[0]).toMatchObject({ bzzzbxJobId: "bx-job-0111", tipo: "job_cancel_observed", bzzzbxEventId: "bx-job-0111:cancelled" });
  });

  it("la hora es la de la lectura en que el observador lo vio (el Job no trae la de la cancelación, S-9)", async () => {
    const { observador, cancelar, cancelaciones, reloj } = preparar();
    cancelar("bx-job-0111");
    reloj.adelantar(7 * 60_000);
    await observador.vuelta();
    expect(cancelaciones()[0]!.ocurridoEn).toBe("2026-11-27T15:07:00.000Z");
  });

  it("solo manda el tipo, la hora y los crosswalk IDs: nada más", async () => {
    const { observador, cancelar, cancelaciones } = preparar();
    cancelar("bx-job-0111");
    await observador.vuelta();
    expect(Object.keys(cancelaciones()[0]!).sort()).toEqual(["bzzzbxEventId", "bzzzbxJobId", "ocurridoEn", "tipo"]);
  });

  it("la vuelta siguiente no la repite ni vuelve a llamar a la base", async () => {
    const { observador, cancelar, cancelaciones } = preparar();
    cancelar("bx-job-0111");
    await observador.vuelta();
    expect(await observador.vuelta()).toEqual({ tipo: "corrida", jobs: 1, escritos: 0, repetidos: 1, errores: 0 });
    expect(cancelaciones()).toHaveLength(1);
  });

  it("un job programado no la llama", async () => {
    const { observador, cancelaciones } = preparar(["bx-job-0111", "bx-job-0110"]);
    await observador.vuelta();
    expect(cancelaciones()).toHaveLength(0);
  });

  it("se anota cuando ocurre: un job que se cancela después se escribe en su vuelta, una sola vez", async () => {
    const { observador, cancelar, cancelaciones } = preparar();
    await observador.vuelta();
    expect(cancelaciones()).toHaveLength(0);
    cancelar("bx-job-0111");
    expect(await observador.vuelta()).toMatchObject({ escritos: 1 });
    await observador.vuelta();
    expect(cancelaciones()).toHaveLength(1);
  });

  it("BzzzBX caído no escribe nada", async () => {
    const { observador, cancelar, falso, registrar } = preparar();
    cancelar("bx-job-0111");
    falso.lectura.noDisponible(true);
    expect(await observador.vuelta()).toEqual({ tipo: "bzzzbx_no_disponible" });
    expect(registrar).not.toHaveBeenCalled();
  });

  it("si solo falla la lectura del Job a mitad de la vuelta tampoco escribe la cancelación", async () => {
    const { observador, cancelar, falso, cancelaciones } = preparar();
    cancelar("bx-job-0111");
    vi.spyOn(falso.lectura, "obtener").mockImplementation(async (entidad) => {
      if (entidad === "job") throw new BzzzbxNoDisponible("caído");
      return null;
    });
    expect(await observador.vuelta()).toEqual({ tipo: "bzzzbx_no_disponible" });
    expect(cancelaciones()).toHaveLength(0);
  });

  it("es la misma tarea del ciclo de siempre: sin tarea ni cadencia nuevas", () => {
    const tarea = tareaObservadorEtapas();
    expect(tarea).toMatchObject({ nombre: "observador_etapas", cadenciaMs: 15_000 });
  });
});
