/**
 * Stand-in de BzzzBX en memoria (ADR 0005). Solo local, CI y pruebas: con
 * OPSRUN_SERVIDOR=1 la fábrica no lo deja elegir (`../index.ts`).
 */
import { datosIniciales } from "./datos";
import { EntregaFalsa } from "./entrega-falsa";
import { InstruccionesFalsas } from "./instrucciones-falsas";
import { LecturaFalsa } from "./lectura-falsa";
import { relojDelSistema, type Reloj } from "./reloj";

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

export type Falso = { lectura: LecturaFalsa; instrucciones: InstruccionesFalsas; entrega: EntregaFalsa; reloj: Reloj };

export function crearFalso(opciones: OpcionesFalso = {}): Falso {
  const reloj = opciones.reloj ?? relojDelSistema;
  const lectura = new LecturaFalsa(reloj, datosIniciales(reloj.ahora()), opciones.tamanoDeLote);
  const instrucciones = new InstruccionesFalsas(reloj, lectura, { pasoMs: opciones.pasoMs });
  const entrega = new EntregaFalsa(reloj, lectura, opciones.pasoMs);
  lectura.engancharEntrega(entrega);
  return { lectura, instrucciones, entrega, reloj };
}
