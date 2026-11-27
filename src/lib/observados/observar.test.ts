// @vitest-environment node
/**
 * El observador de hechos de PINCH (OPR-30 a OPR-32 §7.5, P-9): un evento nuevo
 * llama a `record_observed_event` una vez; repetido no duplica; BzzzBX caído no
 * escribe nada. La cadencia y la vuelta única son del ciclo (`tarea.test.ts`).
 */
import { describe, expect, it, vi } from "vitest";

import { crearFalso, RelojManual } from "../bzzzbx/falso";
import type { Actor, Tx } from "../db/pool";

import { ACTOR_OBSERVADOR, CONSULTA_JOBS_ENLAZADOS, crearDatosDelObservador, type Ejecutar } from "./datos-sql";
import { crearObservador, type DatosDelObservador, type HechoObservado } from "./observar";

function preparar(jobs: string[] = ["bx-job-0004", "bx-job-0006"]) {
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
  return { reloj, falso, datos, registrar, observador };
}

describe("observador: hechos observados", () => {
  it("escribe el check-in y el inicio de R4, y el check-in, el fin y el pago de R6, una vez cada uno", async () => {
    const { observador, registrar } = preparar();
    const r = await observador.vuelta();
    expect(r).toEqual({ tipo: "corrida", jobs: 2, escritos: 5, repetidos: 0, errores: 0 });
    const tipos = registrar.mock.calls.map(([h]) => `${h.bzzzbxJobId}:${h.tipo}:${h.bzzzbxEventId}`).sort();
    expect(tipos).toEqual([
      "bx-job-0004:job_checked_in:bx-evt-0001",
      "bx-job-0004:job_started:bx-evt-0002",
      "bx-job-0006:job_checked_in:bx-evt-0003",
      "bx-job-0006:job_completed:bx-evt-0004",
      "bx-job-0006:job_paid:bx-evt-0005",
    ]);
  });

  it("solo manda el tipo, la hora de BzzzBX y los crosswalk IDs: nada más", async () => {
    const { observador, registrar } = preparar(["bx-job-0004"]);
    await observador.vuelta();
    for (const [h] of registrar.mock.calls) {
      expect(Object.keys(h).sort()).toEqual(["bzzzbxEventId", "bzzzbxJobId", "ocurridoEn", "tipo"]);
      expect(h.ocurridoEn).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("un evento repetido en la vuelta siguiente no vuelve a llamar a la base", async () => {
    const { observador, registrar } = preparar();
    await observador.vuelta();
    const primeras = registrar.mock.calls.length;
        expect(await observador.vuelta()).toEqual({ tipo: "corrida", jobs: 2, escritos: 0, repetidos: 5, errores: 0 });
    expect(registrar).toHaveBeenCalledTimes(primeras);
  });

  it("un evento que aparece después se escribe en su vuelta, una sola vez", async () => {
    const { observador, registrar, falso } = preparar(["bx-job-0004"]);
    await observador.vuelta();
    falso.lectura.poner("jobtracker_event", {
      bzzzbx_event_id: "bx-evt-9001",
      bzzzbx_job_id: "bx-job-0004",
      kind: "completed",
      occurred_at: "2026-11-27T15:30:00.000Z",
    });
        expect(await observador.vuelta()).toMatchObject({ escritos: 1, repetidos: 2 });
        expect(await observador.vuelta()).toMatchObject({ escritos: 0, repetidos: 3 });
    expect(registrar.mock.calls.filter(([h]) => h.bzzzbxEventId === "bx-evt-9001")).toHaveLength(1);
  });

  it("la base que ya tenía el evento (null) cuenta como repetido y no se vuelve a pedir", async () => {
    const { observador, registrar, datos } = preparar(["bx-job-0004"]);
    vi.mocked(datos.registrar).mockResolvedValue(null);
    expect(await observador.vuelta()).toMatchObject({ escritos: 0, repetidos: 2 });
        await observador.vuelta();
    expect(registrar).toHaveBeenCalledTimes(2);
  });

  it("un pago sin evento o sin fecha no se observa", async () => {
    const { observador, registrar, falso } = preparar(["bx-job-0004"]);
    falso.lectura.cambiar("payment", "bx-job-0004", { paid: true, paid_at: "2026-11-27T14:00:00.000Z", bzzzbx_event_id: null });
    await observador.vuelta();
    expect(registrar.mock.calls.some(([h]) => h.tipo === "job_paid")).toBe(false);
  });
});

describe("observador: BzzzBX caído y errores", () => {
  it("con BzzzBX caído no escribe nada y lo dice", async () => {
    const { observador, registrar, falso } = preparar();
    falso.lectura.noDisponible(true);
    expect(await observador.vuelta()).toEqual({ tipo: "bzzzbx_no_disponible" });
    expect(registrar).not.toHaveBeenCalled();
  });

  it("un job que falla no frena a los demás: cuenta el error y sigue", async () => {
    const { observador, registrar, falso } = preparar();
    const original = falso.lectura.listarPor.bind(falso.lectura);
    vi.spyOn(falso.lectura, "listarPor").mockImplementation(async (entidad, filtro) => {
      if ((filtro as { bzzzbx_job_id?: string }).bzzzbx_job_id === "bx-job-0004") throw new Error("falla rara");
      return original(entidad, filtro);
    });
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await observador.vuelta()).toMatchObject({ tipo: "corrida", errores: 1, escritos: 3 });
    consola.mockRestore();
    expect(registrar.mock.calls.every(([h]) => h.bzzzbxJobId === "bx-job-0006")).toBe(true);
  });
});

describe("datos-sql del observador", () => {
  function baseDeMentira(filas: unknown[]) {
    const consultas: { sql: string; parametros: unknown[] }[] = [];
    const opciones: ({ escritura?: boolean; actor?: Actor } | undefined)[] = [];
    const ejecutar: Ejecutar = async (fn, o) => {
      opciones.push(o);
      return fn({
        query: async (sql: string, parametros: unknown[] = []) => {
          consultas.push({ sql, parametros });
          return { rows: filas };
        },
      } as unknown as Tx);
    };
    return { ejecutar, consultas, opciones };
  }

  it("jobsEnlazados lee en solo lectura y sin actor", async () => {
    const { ejecutar, consultas, opciones } = baseDeMentira([{ bzzzbx_job_id: "bx-job-0003" }, { bzzzbx_job_id: "bx-job-0004" }]);
    expect(await crearDatosDelObservador(ejecutar).jobsEnlazados()).toEqual(["bx-job-0003", "bx-job-0004"]);
    expect(consultas[0]!.sql).toBe(CONSULTA_JOBS_ENLAZADOS);
    expect(opciones).toEqual([undefined]);
  });

  it("registrar llama a record_observed_event como el actor de sistema `observador`", async () => {
    const { ejecutar, consultas, opciones } = baseDeMentira([{ id: "77" }]);
    const id = await crearDatosDelObservador(ejecutar).registrar({
      bzzzbxJobId: "bx-job-0004",
      tipo: "job_started",
      bzzzbxEventId: "bx-evt-0002",
      ocurridoEn: "2026-11-27T14:00:00.000Z",
    });
    expect(id).toBe("77");
    expect(consultas[0]!.sql.replace(/\s+/g, " ")).toBe("select opsrun.record_observed_event($1, $2, $3, $4::timestamptz)::text as id");
    expect(consultas[0]!.parametros).toEqual(["bx-job-0004", "job_started", "bx-evt-0002", "2026-11-27T14:00:00.000Z"]);
    expect(opciones).toEqual([{ escritura: true, actor: ACTOR_OBSERVADOR }]);
    expect(ACTOR_OBSERVADOR).toEqual({ tipo: "sistema", proceso: "observador" });
  });

  it("registrar devuelve null si la base ya tenía el evento", async () => {
    const { ejecutar } = baseDeMentira([{ id: null }]);
    expect(
      await crearDatosDelObservador(ejecutar).registrar({ bzzzbxJobId: "j", tipo: "job_paid", bzzzbxEventId: "e", ocurridoEn: "2026-11-27T14:00:00.000Z" }),
    ).toBeNull();
  });
});
