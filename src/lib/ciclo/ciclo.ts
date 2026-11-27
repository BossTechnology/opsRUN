/**
 * El ciclo de fondo único de opsRUN (ADR 0006, spec OPR-15 §8.1 y P-1): una sola
 * pieza dentro del servidor de Next que corre varias tareas, cada una con su
 * cadencia y una vuelta a la vez. La entrada de correo es la primera; el
 * registrador de alertas y el observador se suman registrando su tarea aquí.
 * Ninguna tarjeta abre un temporizador propio (guard en `un-solo-ciclo.test.ts`).
 *
 * Un solo temporizador (el "tic") revisa qué tareas tocan. El reloj y el
 * temporizador se inyectan: las pruebas llaman a `tic()` sin esperar.
 *
 * Una tarea que falla no tumba el ciclo ni a las demás: el error se registra
 * una vez (y de nuevo solo si cambia) y se reintenta en su siguiente turno; al
 * volver a salir bien se avisa una vez.
 */

export type Tarea = {
  /** Único por ciclo; sale en los logs. */
  nombre: string;
  /** Cada cuánto corre, en ms. */
  cadenciaMs: number;
  /** Una vuelta. Nunca corre dos a la vez de la misma tarea. */
  vuelta: () => Promise<unknown>;
};

export type Temporizador = {
  cada(ms: number, fn: () => void): () => void;
};

export type OpcionesDelCiclo = {
  ahora?: () => number;
  temporizador?: Temporizador;
  log?: Pick<Console, "info" | "error">;
  /** Cada cuánto revisa qué tareas tocan. */
  ticMs?: number;
};

export const TIC_MS = 1000;

const temporizadorDelSistema: Temporizador = {
  cada(ms, fn) {
    const id = setInterval(fn, ms);
    // El ciclo no mantiene vivo al proceso.
    id.unref?.();
    return () => clearInterval(id);
  },
};

type Registro = {
  tarea: Tarea;
  proximaVez: number;
  enCurso: boolean;
  ultimoError: string | null;
};

export function crearCiclo({
  ahora = Date.now,
  temporizador = temporizadorDelSistema,
  log = console,
  ticMs = TIC_MS,
}: OpcionesDelCiclo = {}) {
  const registros = new Map<string, Registro>();
  let detener: (() => void) | null = null;

  async function correr(registro: Registro): Promise<void> {
    registro.enCurso = true;
    const { tarea } = registro;
    try {
      await tarea.vuelta();
      if (registro.ultimoError !== null) {
        registro.ultimoError = null;
        log.info(`[opsRUN] ciclo: ${tarea.nombre} volvió a funcionar`);
      }
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      if (mensaje !== registro.ultimoError) {
        registro.ultimoError = mensaje;
        log.error(`[opsRUN] ciclo: ${tarea.nombre} falló:`, mensaje);
      }
    } finally {
      registro.enCurso = false;
      registro.proximaVez = ahora() + tarea.cadenciaMs;
    }
  }

  return {
    /** Suma una tarea. Su primera vuelta es en el siguiente tic. */
    registrar(tarea: Tarea): void {
      if (registros.has(tarea.nombre)) throw new Error(`el ciclo ya tiene una tarea ${tarea.nombre}`);
      if (!(tarea.cadenciaMs > 0)) throw new Error(`la tarea ${tarea.nombre} necesita una cadencia mayor que cero`);
      registros.set(tarea.nombre, { tarea, proximaVez: ahora(), enCurso: false, ultimoError: null });
    },

    /**
     * Corre las tareas que tocan y no están en curso. Devuelve cuando terminan
     * las vueltas que arrancó (el temporizador no lo espera).
     */
    async tic(): Promise<void> {
      const t = ahora();
      const toca = [...registros.values()].filter((r) => !r.enCurso && t >= r.proximaVez);
      await Promise.all(toca.map(correr));
    },

    /** Arranca el temporizador. Repetirlo no hace nada. */
    iniciar(): void {
      if (detener) return;
      detener = temporizador.cada(ticMs, () => {
        void this.tic();
      });
    },

    /** Para el temporizador; lo que esté en curso termina solo. */
    parar(): void {
      detener?.();
      detener = null;
    },

    get iniciado(): boolean {
      return detener !== null;
    },

    get tareas(): string[] {
      return [...registros.keys()];
    },
  };
}

export type Ciclo = ReturnType<typeof crearCiclo>;
