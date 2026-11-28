// @vitest-environment node
/** La tarea `analisis_ia` y su lugar en el ciclo (spec OPR-36 §9.1, §9.3 y §12.3). */
import { describe, expect, it, vi } from "vitest";

import { esNoDisponible } from "../bzzzbx/errores";
import { iaOAusente } from "../bzzzbx/ausente";
import { crearFalso, RelojManual } from "../bzzzbx/falso";
import { obtenerBzzzbx } from "../bzzzbx";
import { crearCiclo, type Tarea } from "../ciclo/ciclo";
import { tareasDeOpsrun } from "../ciclo/arranque";

import type { DatosDeAnalisis } from "./analisis";
import { ACTOR_ANALISIS } from "./datos-sql";
import { ANALISIS_CADENCIA_MS, NOMBRE_DE_LA_TAREA, tareaAnalisisIa } from "./tarea";

const datosVacios = (): DatosDeAnalisis & { iniciadas: string[] } => {
  const iniciadas: string[] = [];
  return {
    iniciadas,
    iniciar: async (id) => {
      iniciadas.push(id);
      return null;
    },
    candidatasDelBarrido: async () => [],
    pendientes: async () => [],
    registrar: async () => "recorded",
  };
};

describe("tareaAnalisisIa", () => {
  it("se llama analisis_ia y corre cada 5 s", () => {
    const tarea = tareaAnalisisIa(() => ({ ia: crearFalso().ia, datos: datosVacios() }));
    expect(tarea.nombre).toBe("analisis_ia");
    expect(NOMBRE_DE_LA_TAREA).toBe("analisis_ia");
    expect(tarea.cadenciaMs).toBe(5000);
    expect(ANALISIS_CADENCIA_MS).toBe(5000);
  });

  it("su actor es de sistema (analisis_ia), nunca un operador", () => {
    expect(ACTOR_ANALISIS).toEqual({ tipo: "sistema", proceso: "analisis_ia" });
  });

  it("despertar anota la request y la vuelta siguiente abre su análisis; tras reiniciar el falso usa el puerto nuevo", async () => {
    const datos = datosVacios();
    let falso = crearFalso();
    const tarea = tareaAnalisisIa(() => ({ ia: falso.ia, datos }));
    tarea.despertar("rq-1");
    expect(datos.iniciadas).toEqual([]);
    await tarea.vuelta();
    expect(datos.iniciadas).toEqual(["rq-1"]);
    falso = crearFalso();
    await expect(tarea.vuelta()).resolves.toMatchObject({ estado: "ok" });
  });

  it("corre dentro del ciclo con su cadencia", async () => {
    const reloj = new RelojManual();
    const ciclo = crearCiclo({ ahora: () => reloj.ahora().getTime(), log: { info() {}, error() {} } });
    const datos = datosVacios();
    const tarea = tareaAnalisisIa(() => ({ ia: crearFalso().ia, datos }));
    const vuelta = vi.fn(tarea.vuelta);
    ciclo.registrar({ nombre: tarea.nombre, cadenciaMs: tarea.cadenciaMs, vuelta } as Tarea);
    tarea.despertar("rq-2");
    await ciclo.tic();
    expect(vuelta).toHaveBeenCalledTimes(1);
    reloj.adelantar(4000);
    await ciclo.tic();
    expect(vuelta).toHaveBeenCalledTimes(1);
    reloj.adelantar(1000);
    await ciclo.tic();
    expect(vuelta).toHaveBeenCalledTimes(2);
  });
});

describe("tareasDeOpsrun", () => {
  it("registra la tarea de análisis junto a las otras", () => {
    expect(tareasDeOpsrun().map((t) => t.nombre)).toEqual([
      "entrada_correo",
      "reconciliacion_envios",
      "observador_etapas",
      "registrador_alertas",
      "analisis_ia",
    ]);
  });
});

describe("iaOAusente (spec §12.3)", () => {
  it("si BzzzBX no se puede crear, responde siempre no disponible y el servidor arranca", async () => {
    const ia = iaOAusente(() => {
      throw new Error("el real no existe todavía");
    });
    expect(esNoDisponible(await ia.pedirAnalisis({ clave: "k", bzzzbx_message_id: "m", bzzzbx_thread_id: null, campos: [] }).catch((e) => e))).toBe(true);
    expect(esNoDisponible(await ia.resultadoDeAnalisis("k").catch((e) => e))).toBe(true);
  });

  it("con BzzzBX disponible da su puerto de IA", () => {
    const falso = crearFalso();
    expect(iaOAusente(() => falso.ia)).toBe(falso.ia);
  });

  it("obtenerBzzzbx trae `ia` y sigue al falso vigente", () => {
    const env = { BZZZBX_MODO: "falso" };
    expect(typeof obtenerBzzzbx(env).ia.pedirAnalisis).toBe("function");
  });
});
