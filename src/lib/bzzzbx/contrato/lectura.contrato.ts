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

import { CursorCaducado, FiltroInvalido } from "../errores";
import type { LecturaBzzzbx } from "../puertos";
import {
  BUSCAR_JOBS_MAX,
  BUSCAR_JOBS_MAX_DIAS,
  CLAVE,
  ENTIDADES,
  type Cursor,
  type Entidad,
  type FiltroDeJobs,
  type Filtros,
} from "../tipos";

export type EntornoDeLectura = {
  lectura: LecturaBzzzbx;
  /** Un crosswalk ID que existe, por entidad. */
  conocidos: { [E in Entidad]: string };
  /** Un hijo conocido por entidad hija, con su filtro. */
  relaciones: { [E in keyof Filtros]: Filtros[E] };
  /** Un job conocido, para `buscarJobs` (su cliente, propiedad y fecha se leen con `obtener`). */
  jobConPropiedad: { bzzzbx_job_id: string; bzzzbx_property_id: string };
  /** Provoca un cambio en el origen sobre una entidad conocida; ausente si no se puede. */
  cambio?: { entidad: Entidad; id: string; provocar: () => Promise<void> };
  /** Espera lo necesario para que un cambio llegue (el real tarda; el falso no). */
  esperar?: () => Promise<void>;
};

const DESCONOCIDO = "bx-no-existe-0000";
/** Suma días a una fecha YYYY-MM-DD, en UTC. */
function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

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

    it("un job puede traer price ({ amount_cents entero, currency de 3 letras }) o null; nunca otra forma (OPR-26, P-6)", async () => {
      const { lectura, conocidos } = await crear();
      const job = await lectura.obtener("job", conocidos.job);
      const price = job!.price;
      if (price === undefined || price === null) return;
      expect(Number.isInteger(price.amount_cents)).toBe(true);
      expect(price.amount_cents).toBeGreaterThanOrEqual(0);
      expect(price.currency).toMatch(/^[A-Z]{3}$/);
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

    describe("buscarJobs", () => {
      /** El job conocido, leído, y un rango de fechas que lo contiene. */
      async function conocido(entorno: EntornoDeLectura) {
        const job = await entorno.lectura.obtener("job", entorno.jobConPropiedad.bzzzbx_job_id);
        expect(job).not.toBeNull();
        return { job: job!, desde: sumarDias(job!.service_date, -3), hasta: sumarDias(job!.service_date, 3) };
      }

      it("por propiedad y rango trae el job, y solo jobs de esa propiedad dentro del rango", async () => {
        const entorno = await crear();
        const { job, desde, hasta } = await conocido(entorno);
        const jobs = await entorno.lectura.buscarJobs({ bzzzbx_property_id: job.bzzzbx_property_id, desde, hasta });
        expect(jobs.map((j) => j.bzzzbx_job_id)).toContain(job.bzzzbx_job_id);
        for (const j of jobs) {
          expect(j.bzzzbx_property_id).toBe(job.bzzzbx_property_id);
          expect(j.service_date >= desde && j.service_date <= hasta).toBe(true);
          expect(typeof j.version).toBe("string");
        }
      });

      it("por cliente trae el job, y solo jobs de ese cliente", async () => {
        const entorno = await crear();
        const { job, desde, hasta } = await conocido(entorno);
        const jobs = await entorno.lectura.buscarJobs({ bzzzbx_customer_id: job.bzzzbx_customer_id, desde, hasta });
        expect(jobs.map((j) => j.bzzzbx_job_id)).toContain(job.bzzzbx_job_id);
        for (const j of jobs) expect(j.bzzzbx_customer_id).toBe(job.bzzzbx_customer_id);
      });

      it("cliente y propiedad se combinan con Y", async () => {
        const entorno = await crear();
        const { job, desde, hasta } = await conocido(entorno);
        const jobs = await entorno.lectura.buscarJobs({
          bzzzbx_customer_id: job.bzzzbx_customer_id,
          bzzzbx_property_id: "bx-no-existe-0000",
          desde,
          hasta,
        });
        expect(jobs).toEqual([]);
      });

      it("un rango que no contiene la fecha del job no lo trae", async () => {
        const entorno = await crear();
        const { job } = await conocido(entorno);
        const desde = sumarDias(job.service_date, 1);
        const jobs = await entorno.lectura.buscarJobs({ bzzzbx_property_id: job.bzzzbx_property_id, desde, hasta: desde });
        expect(jobs.map((j) => j.bzzzbx_job_id)).not.toContain(job.bzzzbx_job_id);
      });

      it("ordena por service_date y luego por crosswalk ID, y trae a lo sumo el máximo", async () => {
        const entorno = await crear();
        const { job } = await conocido(entorno);
        const desde = sumarDias(job.service_date, -BUSCAR_JOBS_MAX_DIAS + 1);
        const jobs = await entorno.lectura.buscarJobs({ bzzzbx_customer_id: job.bzzzbx_customer_id, desde, hasta: job.service_date });
        expect(jobs.length).toBeLessThanOrEqual(BUSCAR_JOBS_MAX);
        const claves = jobs.map((j) => `${j.service_date} ${j.bzzzbx_job_id}`);
        expect(claves).toEqual([...claves].sort());
      });

      it.each([
        ["sin cliente ni propiedad", { desde: "2030-01-01", hasta: "2030-01-02" }],
        ["con desde después de hasta", { bzzzbx_property_id: "bx-prop-x", desde: "2030-01-05", hasta: "2030-01-01" }],
        ["con un rango de más del máximo", { bzzzbx_property_id: "bx-prop-x", desde: "2030-01-01", hasta: sumarDias("2030-01-01", BUSCAR_JOBS_MAX_DIAS) }],
        ["con una fecha mal formada", { bzzzbx_property_id: "bx-prop-x", desde: "2030-1-1", hasta: "2030-01-02" }],
      ])("rechaza un filtro %s con FiltroInvalido", async (_caso, filtro) => {
        const { lectura } = await crear();
        await expect(lectura.buscarJobs(filtro as FiltroDeJobs)).rejects.toBeInstanceOf(FiltroInvalido);
      });
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
