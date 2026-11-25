/**
 * Contrato del puerto de lectura (spec OPR-22 §7): lo que debe cumplir
 * CUALQUIER implementación, el falso en memoria y el real de OPR-6.
 *
 * No usa controles del falso. Lo que necesita del entorno lo pide en `crear`:
 * un ID conocido por entidad y, si la implementación lo permite, una forma de
 * provocar un cambio en el origen. Contra el real, esos IDs salen de los datos
 * de prueba del laboratorio.
 */
import { describe, expect, it } from "vitest";

import { CursorCaducado } from "../errores";
import type { LecturaBzzzbx } from "../puertos";
import { CLAVE, ENTIDADES, type Cursor, type Entidad, type Filtros } from "../tipos";

export type EntornoDeLectura = {
  lectura: LecturaBzzzbx;
  /** Un crosswalk ID que existe, por entidad. */
  conocidos: { [E in Entidad]: string };
  /** Un hijo conocido por entidad hija, con su filtro. */
  relaciones: { [E in keyof Filtros]: Filtros[E] };
  /** Un job conocido y su propiedad, para `buscarJobs`. */
  jobConPropiedad: { bzzzbx_job_id: string; bzzzbx_property_id: string };
  /** Provoca un cambio en el origen sobre una entidad conocida; ausente si no se puede. */
  cambio?: { entidad: Entidad; id: string; provocar: () => Promise<void> };
  /** Espera lo necesario para que un cambio llegue (el real tarda; el falso no). */
  esperar?: () => Promise<void>;
};

const DESCONOCIDO = "bx-no-existe-0000";
const ES_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function probarContratoDeLectura(nombre: string, crear: () => Promise<EntornoDeLectura>) {
  describe(`contrato de lectura: ${nombre}`, () => {
    it.each(ENTIDADES)("obtiene un %s conocido con su crosswalk ID, versión y hora", async (entidad) => {
      const { lectura, conocidos } = await crear();
      const id = conocidos[entidad];
      const leido = await lectura.obtener(entidad, id);
      expect(leido).not.toBeNull();
      expect((leido as Record<string, unknown>)[CLAVE[entidad]]).toBe(id);
      expect(typeof leido!.version).toBe("string");
      expect(leido!.version.length).toBeGreaterThan(0);
      expect(leido!.leido_en).toMatch(ES_ISO);
    });

    it("da null para un ID desconocido", async () => {
      const { lectura } = await crear();
      expect(await lectura.obtener("job", DESCONOCIDO)).toBeNull();
    });

    it("obtenerVarios devuelve los conocidos y omite los desconocidos", async () => {
      const { lectura, conocidos } = await crear();
      const varios = await lectura.obtenerVarios("property", [conocidos.property, DESCONOCIDO]);
      expect(varios.map((p) => p.bzzzbx_property_id)).toEqual([conocidos.property]);
    });

    it("obtenerVarios sin IDs no devuelve nada", async () => {
      const { lectura } = await crear();
      expect(await lectura.obtenerVarios("job", [])).toEqual([]);
    });

    it.each(Object.keys({ assignment: 1, contact: 1, jobtracker_event: 1, photo: 1, message: 1, alert_result: 1 }) as (keyof Filtros)[])(
      "listarPor %s devuelve al menos uno y solo los que cumplen el filtro",
      async (entidad) => {
        const { lectura, relaciones } = await crear();
        const filtro = relaciones[entidad];
        const hijos = await lectura.listarPor(entidad, filtro);
        expect(hijos.length).toBeGreaterThan(0);
        for (const hijo of hijos) {
          for (const [campo, valor] of Object.entries(filtro)) {
            expect((hijo as Record<string, unknown>)[campo]).toEqual(valor);
          }
        }
      },
    );

    it("buscarJobs por propiedad trae el job y solo jobs de esa propiedad", async () => {
      const { lectura, jobConPropiedad } = await crear();
      const jobs = await lectura.buscarJobs({ bzzzbx_property_id: jobConPropiedad.bzzzbx_property_id });
      expect(jobs.map((j) => j.bzzzbx_job_id)).toContain(jobConPropiedad.bzzzbx_job_id);
      for (const job of jobs) expect(job.bzzzbx_property_id).toBe(jobConPropiedad.bzzzbx_property_id);
    });

    it("cambiosDesde(null) no trae cambios y da un cursor", async () => {
      const { lectura } = await crear();
      const lote = await lectura.cambiosDesde(null);
      expect(lote.cambios).toEqual([]);
      expect(lote.hay_mas).toBe(false);
      expect(typeof lote.cursor).toBe("string");
    });

    it("un cursor recién dado se puede volver a usar", async () => {
      const { lectura } = await crear();
      const { cursor } = await lectura.cambiosDesde(null);
      const lote = await lectura.cambiosDesde(cursor);
      expect(typeof lote.cursor).toBe("string");
    });

    it("un cursor que no dio el puerto se rechaza como caducado", async () => {
      const { lectura } = await crear();
      await expect(lectura.cambiosDesde("no-es-un-cursor" as Cursor)).rejects.toBeInstanceOf(CursorCaducado);
    });

    it("un cambio en el origen llega por el cursor, con versión nueva, una sola vez", async (contexto) => {
      const entorno = await crear();
      if (!entorno.cambio) return contexto.skip();
      const { lectura } = entorno;
      const { entidad, id, provocar } = entorno.cambio;
      const antes = await lectura.obtener(entidad, id);
      const { cursor } = await lectura.cambiosDesde(null);

      await provocar();
      await entorno.esperar?.();

      const lote = await lectura.cambiosDesde(cursor);
      const cambio = lote.cambios.find((c) => c.entidad === entidad && c.id === id);
      expect(cambio).toBeDefined();
      const despues = await lectura.obtener(entidad, id);
      expect(despues!.version).toBe(cambio!.version);
      expect(despues!.version).not.toBe(antes!.version);

      const siguiente = await lectura.cambiosDesde(lote.cursor);
      expect(siguiente.cambios.filter((c) => c.entidad === entidad && c.id === id && c.version === cambio!.version)).toEqual([]);
    });
  });
}
