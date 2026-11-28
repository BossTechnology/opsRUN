// @vitest-environment node
/**
 * El registrador de alertas como tarea del ciclo de fondo (ADR 0006, spec OPR-34
 * §4 y §10.2): está registrado, corre cada 15 s y, al tocarle su turno, anota lo
 * que cambió; no corre antes de su turno ni dos a la vez; una vuelta que falla
 * no impide la de la entrada de correo ni al revés. Reloj inyectado.
 */
import { describe, expect, it, vi } from "vitest";

import { crearFalso, RelojManual } from "../bzzzbx/falso";
import { tareasDeOpsrun } from "../ciclo/arranque";
import { crearCiclo } from "../ciclo/ciclo";

import type { AlertaARegistrar, DatosDelRegistrador } from "./registrador";
import { NOMBRE_DE_LA_TAREA, REGISTRADOR_CADENCIA_MS, tareaRegistradorAlertas } from "./tarea";

const R = (n: number) => `b0000000-0000-4000-8000-0000000000a${n}`;

function preparar() {
  const falso = crearFalso({ reloj: new RelojManual(new Date("2026-11-27T15:00:00Z")) });
  const registrar = vi.fn(async (a: AlertaARegistrar) => `o-${a.bzzzbx_alert_id}`);
  const requestsActivas = vi.fn(async () => [{ id: R(1), bzzzbx_job_id: null as string | null }]);
  const datos: DatosDelRegistrador = {
    requestsActivas,
    hilosActivos: vi.fn(async () => []),
    alertasAbiertas: vi.fn(async () => []),
    requestsExistentes: vi.fn(async (ids: string[]) => new Set(ids)),
    requestsDeJobs: vi.fn(async () => new Map()),
    requestsDeMensajes: vi.fn(async () => new Map()),
    requestsDeHilos: vi.fn(async () => new Map()),
    registrar,
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps = vi.fn(() => ({ lectura: falso.lectura, datos, log }));
  return { falso, registrar, requestsActivas, deps, log };
}

const callado = () => ({ info: vi.fn(), error: vi.fn() });

describe("tarea registrador_alertas", () => {
  it("está en la lista de tareas de opsRUN, cada 15 s", () => {
    expect(tareaRegistradorAlertas()).toMatchObject({ nombre: "registrador_alertas", cadenciaMs: 15_000 });
    expect(NOMBRE_DE_LA_TAREA).toBe("registrador_alertas");
    expect(REGISTRADOR_CADENCIA_MS).toBe(15_000);
    const nombres = tareasDeOpsrun().map((t) => t.nombre);
    expect(nombres).toContain(NOMBRE_DE_LA_TAREA);
    // Junto a las demás, sin otro temporizador: todas las del ciclo único.
    expect(nombres).toEqual(expect.arrayContaining(["entrada_correo", "reconciliacion_envios", "observador_etapas"]));
    expect(new Set(nombres).size).toBe(nombres.length);
  });

  it("el ciclo la corre al tocarle su turno y no antes; después anota lo que cambió", async () => {
    let t = 1_000_000;
    const { falso, registrar, requestsActivas, deps } = preparar();
    const ciclo = crearCiclo({ ahora: () => t, log: callado() });
    ciclo.registrar(tareaRegistradorAlertas(deps));

    await ciclo.tic();
    expect(requestsActivas).toHaveBeenCalledTimes(1);
    expect(registrar).toHaveBeenCalledTimes(1); // la OPS-001 de R1, de la pasada del arranque
    t += 14_999;
    await ciclo.tic();
    expect(deps).toHaveBeenCalledTimes(1);
    falso.lectura.poner("alert_result", {
      bzzzbx_alert_id: "bx-alert-t34",
      sujeto: { tipo: "request", request_id: R(1) },
      rule_id: "OPS-002",
      rule_version: "1",
      level: "red",
      reason_text: "Open for 2 days.",
      opened_at: "2026-11-27T14:00:00.000Z",
      cleared_at: null,
    });
    t += 1;
    await ciclo.tic();
    expect(deps).toHaveBeenCalledTimes(2);
    expect(registrar).toHaveBeenCalledTimes(2);
    // Recuerda el cursor entre vueltas: otra vuelta sin cambios no vuelve a anotar nada.
    t += REGISTRADOR_CADENCIA_MS;
    await ciclo.tic();
    expect(registrar).toHaveBeenCalledTimes(2);
  });

  it("una vuelta lenta no deja empezar otra (lo garantiza el ciclo)", async () => {
    let t = 1_000_000;
    const { requestsActivas, deps } = preparar();
    let soltar!: () => void;
    requestsActivas.mockImplementationOnce(() => new Promise((resolver) => (soltar = () => resolver([]))));
    const ciclo = crearCiclo({ ahora: () => t, log: callado() });
    ciclo.registrar(tareaRegistradorAlertas(deps));

    const primera = ciclo.tic();
    t += 3 * REGISTRADOR_CADENCIA_MS;
    await ciclo.tic();
    expect(requestsActivas).toHaveBeenCalledTimes(1);
    soltar();
    await primera;
  });

  it("una vuelta que falla no impide la de la entrada de correo, ni al revés; la tarea se reintenta en su turno", async () => {
    let t = 1_000_000;
    const { registrar, deps } = preparar();
    registrar.mockRejectedValueOnce(new Error("se cayó la base"));
    const log = callado();
    const ciclo = crearCiclo({ ahora: () => t, log });
    const entrada = vi.fn(async () => {});
    ciclo.registrar({ nombre: "entrada_correo", cadenciaMs: 15_000, vuelta: entrada });
    ciclo.registrar(tareaRegistradorAlertas(deps));

    await ciclo.tic();
    expect(entrada).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0]).toEqual(["[opsRUN] ciclo: registrador_alertas falló:", "se cayó la base"]);
    t += REGISTRADOR_CADENCIA_MS;
    await ciclo.tic();
    expect(entrada).toHaveBeenCalledTimes(2);
    expect(registrar).toHaveBeenCalledTimes(2); // la reintentó con el mismo cursor
    expect(log.info).toHaveBeenCalledWith("[opsRUN] ciclo: registrador_alertas volvió a funcionar");

    // Al revés: si la entrada falla, el registrador sigue.
    const fragil = crearCiclo({ ahora: () => t, log: callado() });
    fragil.registrar({ nombre: "entrada_correo", cadenciaMs: 15_000, vuelta: async () => Promise.reject(new Error("falló")) });
    const otra = preparar();
    fragil.registrar(tareaRegistradorAlertas(otra.deps));
    await fragil.tic();
    expect(otra.registrar).toHaveBeenCalledTimes(1);
  });

  it("pide las dependencias en cada vuelta (el stand-in se reemplaza al reiniciarlo)", async () => {
    const { deps } = preparar();
    const tarea = tareaRegistradorAlertas(deps);
    await tarea.vuelta();
    await tarea.vuelta();
    expect(deps).toHaveBeenCalledTimes(2);
  });

  it("con BzzzBX caído la vuelta termina sin escribir, sin error, y el ciclo sigue con la siguiente", async () => {
    let t = 1_000_000;
    const { falso, registrar, deps } = preparar();
    const log = callado();
    const ciclo = crearCiclo({ ahora: () => t, log });
    ciclo.registrar(tareaRegistradorAlertas(deps));
    falso.lectura.noDisponible(true);
    await ciclo.tic();
    expect(registrar).not.toHaveBeenCalled();
    falso.lectura.noDisponible(false);
    t += REGISTRADOR_CADENCIA_MS;
    await ciclo.tic();
    expect(registrar).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
  });
});
