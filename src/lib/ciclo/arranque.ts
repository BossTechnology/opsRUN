/**
 * Arranque del ciclo de fondo único (ADR 0006). Lo llama `instrumentation`
 * (solo runtime `nodejs`). Aquí se registran las tareas: una tarjeta que
 * necesite trabajo de fondo suma su tarea a `tareasDeOpsrun`, no abre un
 * temporizador.
 *
 * No corre bajo pruebas ni durante `next build`: un test que lo necesite lo
 * arranca explícitamente con `crearCiclo()` y sus propias tareas. Se apaga con
 * `OPSRUN_CICLO_DE_FONDO=0`.
 */
import { tareaRegistradorAlertas } from "../alertas/tarea";
import { tareaEntradaCorreo } from "../entrada/servidor";
import { tareaReconciliacionEnvios } from "../instrucciones/reconciliacion";
import { tareaObservadorEtapas } from "../observados/tarea";

import { crearCiclo, type Ciclo, type Tarea } from "./ciclo";

type Entorno = Record<string, string | undefined>;

/** Las tareas de opsRUN. Una tarjeta que necesite trabajo de fondo suma la suya aquí. */
export function tareasDeOpsrun(): Tarea[] {
  return [tareaEntradaCorreo(), tareaReconciliacionEnvios(), tareaObservadorEtapas(), tareaRegistradorAlertas()];
}

/** Por qué no debe correr, o null si puede. */
export function motivoParaNoCorrer(env: Entorno = process.env): string | null {
  if (env.OPSRUN_CICLO_DE_FONDO === "0") return "OPSRUN_CICLO_DE_FONDO=0";
  // Vitest fija VITEST. NODE_ENV no sirve: Playwright lo pone en "test" y sus E2E necesitan la entrada corriendo.
  if (env.VITEST) return "bajo pruebas";
  if (env.NEXT_PHASE === "phase-production-build") return "durante next build";
  return null;
}

const global = globalThis as typeof globalThis & { __opsrunCiclo?: Ciclo };

/**
 * Crea e inicia el ciclo, una vez por proceso (en `globalThis`: sobrevive a la
 * recarga en caliente de `next dev` sin duplicarse). Null si no debe correr.
 */
export function iniciarCicloDeFondo(env: Entorno = process.env, tareas: () => Tarea[] = tareasDeOpsrun): Ciclo | null {
  const motivo = motivoParaNoCorrer(env);
  if (motivo) return null;
  if (global.__opsrunCiclo) return global.__opsrunCiclo;
  const ciclo = crearCiclo();
  for (const tarea of tareas()) ciclo.registrar(tarea);
  ciclo.iniciar();
  global.__opsrunCiclo = ciclo;
  return ciclo;
}

/** Solo para pruebas: para y olvida el ciclo del proceso. */
export function olvidarCicloDeFondo(): void {
  global.__opsrunCiclo?.parar();
  global.__opsrunCiclo = undefined;
}
