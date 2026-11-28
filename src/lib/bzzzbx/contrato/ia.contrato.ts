/**
 * Contrato del puerto de IA (spec OPR-36 §15.2): lo que debe cumplir CUALQUIER
 * implementación. No usa controles del falso. Contra el real (BZZZBX_CONTRATO_REAL=1),
 * el pedido válido es un correo de prueba del laboratorio y `esperar` duerme un rato.
 */
import { describe, expect, it } from "vitest";

import { validarPropuestas } from "../../analisis-ia/forma";
import type { IaBzzzbx } from "../puertos";
import type { CampoDeIa, PedidoDeAnalisis, ResultadoDeAnalisis } from "../tipos-ia";

export type EntornoDeIa = {
  ia: IaBzzzbx;
  /** Un pedido que BzzzBX acepta y que termina `listo`, con esos campos. */
  pedidoValido: (clave: string, campos: CampoDeIa[]) => PedidoDeAnalisis;
  /** Deja pasar el tiempo de un análisis (el falso adelanta su reloj; el real duerme). */
  esperar: () => Promise<void>;
  /** Cuántas esperas como máximo hasta el resultado. */
  esperasMaximas?: number;
};

let contador = 0;
const claveNueva = () => `contrato-ia-${Date.now().toString(36)}-${(contador++).toString(36)}`;

async function hastaTerminar(entorno: EntornoDeIa, clave: string): Promise<Exclude<ResultadoDeAnalisis, { estado: "en_curso" }>> {
  const maximo = entorno.esperasMaximas ?? 30;
  for (let i = 0; i <= maximo; i++) {
    const r = await entorno.ia.resultadoDeAnalisis(clave);
    if (r && r.estado !== "en_curso") return r;
    await entorno.esperar();
  }
  throw new Error(`el análisis ${clave} no terminó tras ${maximo} esperas`);
}

export function probarContratoDeIa(nombre: string, crear: () => Promise<EntornoDeIa>) {
  describe(`contrato de IA: ${nombre}`, () => {
    it("pedirAnalisis acusa con la hora de recibido", async () => {
      const entorno = await crear();
      const acuse = await entorno.ia.pedirAnalisis(entorno.pedidoValido(claveNueva(), ["property"]));
      expect(Number.isNaN(Date.parse(acuse.recibido_at))).toBe(false);
    });

    it("pedirAnalisis con la misma clave es idempotente: mismo acuse y mismo resultado, sin repetir el trabajo", async () => {
      const entorno = await crear();
      const clave = claveNueva();
      const pedido = entorno.pedidoValido(clave, ["property", "unit"]);
      const primero = await entorno.ia.pedirAnalisis(pedido);
      const segundo = await entorno.ia.pedirAnalisis(pedido);
      expect(segundo).toEqual(primero);
      const resultado = await hastaTerminar(entorno, clave);
      await entorno.ia.pedirAnalisis(pedido);
      expect(await entorno.ia.resultadoDeAnalisis(clave)).toEqual(resultado);
    });

    it("resultadoDeAnalisis de una clave desconocida es null", async () => {
      const { ia } = await crear();
      expect(await ia.resultadoDeAnalisis(claveNueva())).toBeNull();
    });

    it("tras pedir, el resultado está en curso o ya terminado", async () => {
      const entorno = await crear();
      const clave = claveNueva();
      await entorno.ia.pedirAnalisis(entorno.pedidoValido(clave, ["property"]));
      const r = await entorno.ia.resultadoDeAnalisis(clave);
      expect(r).not.toBeNull();
      expect(["en_curso", "listo", "fallido"]).toContain(r!.estado);
    });

    it("un resultado terminado no cambia", async () => {
      const entorno = await crear();
      const clave = claveNueva();
      await entorno.ia.pedirAnalisis(entorno.pedidoValido(clave, ["property", "beds", "service_date"]));
      const terminado = await hastaTerminar(entorno, clave);
      await entorno.esperar();
      expect(await entorno.ia.resultadoDeAnalisis(clave)).toEqual(terminado);
    });

    it("las propuestas son solo de los campos pedidos y con la forma de §4.1, con la principal de cada campo", async () => {
      const entorno = await crear();
      const clave = claveNueva();
      const campos: CampoDeIa[] = ["property", "unit", "beds", "service", "service_date", "time_window", "sender"];
      await entorno.ia.pedirAnalisis(entorno.pedidoValido(clave, campos));
      const r = await hastaTerminar(entorno, clave);
      expect(r.estado).toBe("listo");
      if (r.estado !== "listo") return;
      expect(r.propuestas.length).toBeGreaterThan(0);
      for (const p of r.propuestas) expect(campos).toContain(p.campo);
      const forma = validarPropuestas(r.propuestas, campos);
      expect(forma, JSON.stringify(forma)).toMatchObject({ ok: true });
      expect(Number.isNaN(Date.parse(r.terminado_at))).toBe(false);
    });

    it("no devuelve un campo que no se pidió", async () => {
      const entorno = await crear();
      const clave = claveNueva();
      await entorno.ia.pedirAnalisis(entorno.pedidoValido(clave, ["unit"]));
      const r = await hastaTerminar(entorno, clave);
      if (r.estado === "listo") expect(r.propuestas.every((p) => p.campo === "unit")).toBe(true);
    });
  });
}
