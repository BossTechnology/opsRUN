/**
 * Contrato del puerto de instrucciones (spec OPR-22 §7): lo que debe cumplir
 * CUALQUIER implementación. No usa controles del falso. Contra el real, la
 * instrucción válida es una de prueba que el laboratorio acepta sin efectos
 * para nadie, y `esperar` duerme un rato.
 */
import { describe, expect, it } from "vitest";

import { CursorCaducado } from "../errores";
import type { InstruccionesBzzzbx } from "../puertos";
import { esCierre, PASOS, type Cursor, type Instruccion, type Resultado } from "../tipos";

export type EntornoDeInstrucciones = {
  instrucciones: InstruccionesBzzzbx;
  /** Una instrucción que BzzzBX acepta y que termina confirmada. */
  instruccionValida: (idempotency_key: string) => Instruccion;
  /** Deja pasar el tiempo de un paso (el falso adelanta su reloj; el real duerme). */
  esperar: () => Promise<void>;
  /** Cuántas esperas como máximo hasta el cierre. */
  esperasMaximas?: number;
};

let contador = 0;
const claveNueva = () => `contrato-${Date.now().toString(36)}-${(contador++).toString(36)}`;

async function hastaCerrar(entorno: EntornoDeInstrucciones, clave: string): Promise<Resultado> {
  const maximo = entorno.esperasMaximas ?? 20;
  for (let i = 0; i <= maximo; i++) {
    const r = await entorno.instrucciones.estado(clave);
    if (r && esCierre(r)) return r;
    await entorno.esperar();
  }
  throw new Error(`la instrucción ${clave} no cerró tras ${maximo} esperas`);
}

export function probarContratoDeInstrucciones(nombre: string, crear: () => Promise<EntornoDeInstrucciones>) {
  describe(`contrato de instrucciones: ${nombre}`, () => {
    it("entregar acusa con la misma clave, una referencia de BzzzBX y la hora", async () => {
      const { instrucciones, instruccionValida } = await crear();
      const clave = claveNueva();
      const acuse = await instrucciones.entregar(instruccionValida(clave));
      expect(acuse.idempotency_key).toBe(clave);
      expect(acuse.bzzzbx_reference.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(acuse.aceptada_en))).toBe(false);
    });

    it("entregar dos veces con la misma clave da el mismo acuse", async () => {
      const { instrucciones, instruccionValida } = await crear();
      const clave = claveNueva();
      const primero = await instrucciones.entregar(instruccionValida(clave));
      const segundo = await instrucciones.entregar(instruccionValida(clave));
      expect(segundo).toEqual(primero);
    });

    it("estado de una clave desconocida es null", async () => {
      const { instrucciones } = await crear();
      expect(await instrucciones.estado(claveNueva())).toBeNull();
    });

    it("tras entregar, el estado es en curso en un paso del Runbook o ya cerrado", async () => {
      const { instrucciones, instruccionValida } = await crear();
      const clave = claveNueva();
      await instrucciones.entregar(instruccionValida(clave));
      const r = await instrucciones.estado(clave);
      expect(r).not.toBeNull();
      if (r!.estado === "en_curso") expect(PASOS).toContain(r!.paso);
    });

    it("una instrucción válida cierra confirmada, con la referencia del acuse", async () => {
      const entorno = await crear();
      const clave = claveNueva();
      const acuse = await entorno.instrucciones.entregar(entorno.instruccionValida(clave));
      const cierre = await hastaCerrar(entorno, clave);
      expect(cierre).toMatchObject({ idempotency_key: clave, estado: "confirmada", bzzzbx_reference: acuse.bzzzbx_reference });
    });

    it("el cierre no cambia después", async () => {
      const entorno = await crear();
      const clave = claveNueva();
      await entorno.instrucciones.entregar(entorno.instruccionValida(clave));
      const cierre = await hastaCerrar(entorno, clave);
      await entorno.esperar();
      expect(await entorno.instrucciones.estado(clave)).toEqual(cierre);
    });

    it("resultadosDesde(null) no trae resultados y da un cursor", async () => {
      const { instrucciones } = await crear();
      const lote = await instrucciones.resultadosDesde(null);
      expect(lote.resultados).toEqual([]);
      expect(lote.hay_mas).toBe(false);
    });

    it("los resultados llegan por el cursor, terminan en el cierre y no se repiten", async () => {
      const entorno = await crear();
      const { cursor } = await entorno.instrucciones.resultadosDesde(null);
      const clave = claveNueva();
      await entorno.instrucciones.entregar(entorno.instruccionValida(clave));
      const cierre = await hastaCerrar(entorno, clave);

      const vistos: Resultado[] = [];
      let actual: Cursor = cursor;
      for (let vuelta = 0; vuelta < 50; vuelta++) {
        const lote = await entorno.instrucciones.resultadosDesde(actual);
        vistos.push(...lote.resultados.filter((r) => r.idempotency_key === clave));
        actual = lote.cursor;
        if (!lote.hay_mas) break;
      }
      expect(vistos.at(-1)).toEqual(cierre);
      expect(vistos.filter(esCierre)).toHaveLength(1);

      const despues = await entorno.instrucciones.resultadosDesde(actual);
      expect(despues.resultados.filter((r) => r.idempotency_key === clave)).toEqual([]);
    });

    it("un cursor que no dio el puerto se rechaza como caducado", async () => {
      const { instrucciones } = await crear();
      await expect(instrucciones.resultadosDesde("no-es-un-cursor" as Cursor)).rejects.toBeInstanceOf(CursorCaducado);
    });
  });
}
