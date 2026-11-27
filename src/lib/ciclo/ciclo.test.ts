// @vitest-environment node
/**
 * El ciclo de fondo único (ADR 0006, spec OPR-15 §8.1 y §9.2): una instancia
 * por proceso, una vuelta a la vez por tarea, varias tareas con su cadencia, y
 * sin correr bajo pruebas salvo que un test lo arranque. Reloj y temporizador
 * inyectados: ninguna prueba espera.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { iniciarCicloDeFondo, motivoParaNoCorrer, olvidarCicloDeFondo } from "./arranque";
import { crearCiclo, type Temporizador } from "./ciclo";

function reloj(inicio = 1_000_000) {
  let t = inicio;
  return { ahora: () => t, adelantar: (ms: number) => (t += ms) };
}

const registro = () => ({ info: vi.fn(), error: vi.fn() });

/** Una tarea cuya vuelta termina cuando la prueba lo decide. */
function tareaManual(nombre: string, cadenciaMs: number) {
  const vueltas: (() => void)[] = [];
  let iniciadas = 0;
  return {
    tarea: {
      nombre,
      cadenciaMs,
      vuelta: () => {
        iniciadas += 1;
        return new Promise<void>((resolver) => vueltas.push(resolver));
      },
    },
    get iniciadas() {
      return iniciadas;
    },
    terminar: () => vueltas.shift()?.(),
  };
}

afterEach(() => olvidarCicloDeFondo());

describe("crearCiclo", () => {
  it("corre cada tarea en su cadencia, no antes", async () => {
    const r = reloj();
    const ciclo = crearCiclo({ ahora: r.ahora, log: registro() });
    const rapida = vi.fn(async () => {});
    const lenta = vi.fn(async () => {});
    ciclo.registrar({ nombre: "rapida", cadenciaMs: 5_000, vuelta: rapida });
    ciclo.registrar({ nombre: "lenta", cadenciaMs: 15_000, vuelta: lenta });

    await ciclo.tic();
    expect([rapida.mock.calls.length, lenta.mock.calls.length]).toEqual([1, 1]);

    r.adelantar(4_999);
    await ciclo.tic();
    expect([rapida.mock.calls.length, lenta.mock.calls.length]).toEqual([1, 1]);

    r.adelantar(1);
    await ciclo.tic();
    expect([rapida.mock.calls.length, lenta.mock.calls.length]).toEqual([2, 1]);

    r.adelantar(10_000);
    await ciclo.tic();
    expect([rapida.mock.calls.length, lenta.mock.calls.length]).toEqual([3, 2]);
  });

  it("una vuelta a la vez por tarea: si la anterior sigue, se salta", async () => {
    const r = reloj();
    const ciclo = crearCiclo({ ahora: r.ahora, log: registro() });
    const t = tareaManual("larga", 1_000);
    ciclo.registrar(t.tarea);

    const primero = ciclo.tic();
    expect(t.iniciadas).toBe(1);
    r.adelantar(60_000);
    await ciclo.tic();
    expect(t.iniciadas).toBe(1);

    t.terminar();
    await primero;
    r.adelantar(1_000);
    const segundo = ciclo.tic();
    expect(t.iniciadas).toBe(2);
    t.terminar();
    await segundo;
  });

  it("una tarea lenta no frena a las demás", async () => {
    const r = reloj();
    const ciclo = crearCiclo({ ahora: r.ahora, log: registro() });
    const lenta = tareaManual("lenta", 1_000);
    const otra = vi.fn(async () => {});
    ciclo.registrar(lenta.tarea);
    ciclo.registrar({ nombre: "otra", cadenciaMs: 1_000, vuelta: otra });

    const enCurso = ciclo.tic();
    await Promise.resolve();
    r.adelantar(1_000);
    await ciclo.tic();
    expect(otra).toHaveBeenCalledTimes(2);
    expect(lenta.iniciadas).toBe(1);
    lenta.terminar();
    await enCurso;
  });

  it("una tarea que falla no tumba el ciclo; el error se registra una vez y el regreso, una vez", async () => {
    const r = reloj();
    const log = registro();
    const ciclo = crearCiclo({ ahora: r.ahora, log });
    let falla = true;
    const otra = vi.fn(async () => {});
    ciclo.registrar({
      nombre: "frágil",
      cadenciaMs: 1_000,
      vuelta: async () => {
        if (falla) throw new Error("la base no responde");
      },
    });
    ciclo.registrar({ nombre: "otra", cadenciaMs: 1_000, vuelta: otra });

    for (let i = 0; i < 3; i++) {
      await ciclo.tic();
      r.adelantar(1_000);
    }
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0]!.join(" ")).toContain("frágil");
    expect(otra).toHaveBeenCalledTimes(3);

    falla = false;
    await ciclo.tic();
    r.adelantar(1_000);
    await ciclo.tic();
    expect(log.info).toHaveBeenCalledTimes(1);
  });

  it("un error distinto se registra de nuevo", async () => {
    const r = reloj();
    const log = registro();
    const ciclo = crearCiclo({ ahora: r.ahora, log });
    let n = 0;
    ciclo.registrar({
      nombre: "t",
      cadenciaMs: 1_000,
      vuelta: async () => {
        throw new Error(n++ < 2 ? "uno" : "otro");
      },
    });
    for (let i = 0; i < 4; i++) {
      await ciclo.tic();
      r.adelantar(1_000);
    }
    expect(log.error).toHaveBeenCalledTimes(2);
  });

  it("rechaza dos tareas con el mismo nombre y una cadencia que no es positiva", () => {
    const ciclo = crearCiclo({ log: registro() });
    ciclo.registrar({ nombre: "a", cadenciaMs: 1_000, vuelta: async () => {} });
    expect(() => ciclo.registrar({ nombre: "a", cadenciaMs: 1_000, vuelta: async () => {} })).toThrow(/ya tiene/);
    expect(() => ciclo.registrar({ nombre: "b", cadenciaMs: 0, vuelta: async () => {} })).toThrow(/cadencia/);
  });

  it("acepta tareas nuevas: el ciclo es uno solo y lo sumado corre en él", async () => {
    const r = reloj();
    const ciclo = crearCiclo({ ahora: r.ahora, log: registro() });
    ciclo.registrar({ nombre: "entrada_correo", cadenciaMs: 15_000, vuelta: async () => {} });
    ciclo.registrar({ nombre: "alertas", cadenciaMs: 60_000, vuelta: async () => {} });
    expect(ciclo.tareas).toEqual(["entrada_correo", "alertas"]);
  });

  it("un solo temporizador para todas las tareas; iniciar dos veces no abre otro; parar lo cancela", () => {
    const cancelar = vi.fn();
    const cada = vi.fn(() => cancelar);
    const temporizador: Temporizador = { cada };
    const ciclo = crearCiclo({ temporizador, log: registro() });
    ciclo.registrar({ nombre: "a", cadenciaMs: 1_000, vuelta: async () => {} });
    ciclo.registrar({ nombre: "b", cadenciaMs: 2_000, vuelta: async () => {} });
    expect(cada).not.toHaveBeenCalled();
    ciclo.iniciar();
    ciclo.iniciar();
    expect(cada).toHaveBeenCalledTimes(1);
    expect(ciclo.iniciado).toBe(true);
    ciclo.parar();
    expect(cancelar).toHaveBeenCalledTimes(1);
    expect(ciclo.iniciado).toBe(false);
  });

  it("el tic del temporizador corre lo que toca", async () => {
    let tic = () => {};
    const temporizador: Temporizador = {
      cada: (_ms, fn) => {
        tic = fn;
        return () => {};
      },
    };
    const vuelta = vi.fn(async () => {});
    const ciclo = crearCiclo({ temporizador, log: registro() });
    ciclo.registrar({ nombre: "a", cadenciaMs: 1_000, vuelta });
    ciclo.iniciar();
    tic();
    await Promise.resolve();
    expect(vuelta).toHaveBeenCalledTimes(1);
  });
});

describe("iniciarCicloDeFondo", () => {
  it("no corre bajo pruebas: ni crea el ciclo ni llama a las tareas", () => {
    const tareas = vi.fn(() => []);
    expect(motivoParaNoCorrer({ VITEST: "true" })).toBe("bajo pruebas");
    expect(iniciarCicloDeFondo({ VITEST: "true" }, tareas)).toBeNull();
    // Playwright pone NODE_ENV=test y sus E2E necesitan el ciclo: eso no cuenta como "bajo pruebas".
    expect(motivoParaNoCorrer({ NODE_ENV: "test" })).toBeNull();
    // El entorno real de esta corrida es de pruebas.
    expect(iniciarCicloDeFondo(process.env, tareas)).toBeNull();
    expect(tareas).not.toHaveBeenCalled();
  });

  it("no corre durante next build ni con OPSRUN_CICLO_DE_FONDO=0", () => {
    const tareas = vi.fn(() => []);
    expect(iniciarCicloDeFondo({ NEXT_PHASE: "phase-production-build" }, tareas)).toBeNull();
    expect(iniciarCicloDeFondo({ OPSRUN_CICLO_DE_FONDO: "0" }, tareas)).toBeNull();
    expect(tareas).not.toHaveBeenCalled();
  });

  it("fuera de pruebas arranca una sola vez por proceso, aunque se pida dos veces", () => {
    const tareas = vi.fn(() => [{ nombre: "t", cadenciaMs: 60_000_000, vuelta: async () => {} }]);
    const a = iniciarCicloDeFondo({}, tareas);
    const b = iniciarCicloDeFondo({}, tareas);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(tareas).toHaveBeenCalledTimes(1);
    expect(a!.iniciado).toBe(true);
  });
});
