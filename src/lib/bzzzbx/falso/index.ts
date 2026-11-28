/**
 * Stand-in de BzzzBX en memoria (ADR 0005). Solo local, CI y pruebas: con
 * OPSRUN_SERVIDOR=1 la fábrica no lo deja elegir (`../index.ts`).
 */
import { datosIniciales } from "./datos";
import { IaFalsa } from "./ia-falsa";
import { InstruccionesFalsas } from "./instrucciones-falsas";
import { LecturaFalsa } from "./lectura-falsa";
import { relojDelSistema, type Reloj } from "./reloj";

export { IaFalsa, GUIONES, type Guion } from "./ia-falsa";
export { InstruccionesFalsas, MARCA_ERROR, type CuandoFalla, type ErrorForzado } from "./instrucciones-falsas";
export { LecturaFalsa } from "./lectura-falsa";
export { RelojManual, relojDelSistema, type Reloj } from "./reloj";

export type OpcionesFalso = {
  reloj?: Reloj;
  /** Cambios por lote en `cambiosDesde`. */
  tamanoDeLote?: number;
  /** Tiempo de cada paso de una instrucción. */
  pasoMs?: number;
};

export type Falso = { lectura: LecturaFalsa; instrucciones: InstruccionesFalsas; ia: IaFalsa; reloj: Reloj };

export function crearFalso(opciones: OpcionesFalso = {}): Falso {
  const reloj = opciones.reloj ?? relojDelSistema;
  const lectura = new LecturaFalsa(reloj, datosIniciales(reloj.ahora()), opciones.tamanoDeLote);
  const instrucciones = new InstruccionesFalsas(reloj, lectura, { pasoMs: opciones.pasoMs });
  const ia = new IaFalsa(reloj);
  return { lectura, instrucciones, ia, reloj };
}
