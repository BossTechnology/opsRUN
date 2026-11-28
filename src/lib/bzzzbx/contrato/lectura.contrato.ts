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
  BUSCAR_MENSAJES_MAX,
  CLAVE,
  ENTIDADES,
  ESTADOS_DE_ENTREGA,
  type Cursor,
  type Entidad,
  type FiltroDeJobs,
  type FiltroDeMensajes,
  type Filtros,
} from "../tipos";

export type EntornoDeLectura = {
  lectura: LecturaBzzzbx;
  /** Un crosswalk ID que existe, por entidad. */
  conocidos: { [E in Entidad]: string };
  /** Un hijo conocido por entidad hija, con su filtro. */
  relaciones: { [E in keyof Filtros]: Filtros[E] };
  /** El ID de un correo entrante conocido, para `buscarMensajes` (OPR-15). */
  correoEntrante: string;
  /** Un job conocido, para `buscarJobs` (su cliente, propiedad y fecha se leen con `obtener`). */
  jobConPropiedad: { bzzzbx_job_id: string; bzzzbx_property_id: string };
  /**
   * OPR-19 (provisional hasta OPR-6): un correo saliente que rebotó, con el motivo del proveedor; ausente si el
   * entorno no tiene uno. Contra el real, sale de los datos de prueba del laboratorio.
   */
  correoRebotado?: { bzzzbx_message_id: string; bzzzbx_thread_id: string; delivery_detail: string };
  /** OPR-19: cambia el `delivery` de un mensaje conocido a `bounced`; ausente si no se puede. */
  cambioDeEntrega?: { bzzzbx_message_id: string; provocar: () => Promise<void> };
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

    describe("estado de entrega de un mensaje (OPR-19, provisional hasta OPR-6)", () => {
      it("todo mensaje trae un delivery de los cinco y un delivery_detail que es texto, null o no viene", async () => {
        const { lectura, relaciones } = await crear();
        const mensajes = await lectura.listarPor("message", relaciones.message);
        expect(mensajes.length).toBeGreaterThan(0);
        for (const m of mensajes) {
          expect(ESTADOS_DE_ENTREGA).toContain(m.delivery);
          expect(["string", "undefined"]).toContain(m.delivery_detail === null ? "undefined" : typeof m.delivery_detail);
        }
      });

      it("un correo rebotado se lee igual por obtener, obtenerVarios y listarPor, con su detalle", async () => {
        const entorno = await crear();
        if (!entorno.correoRebotado) return;
        const { bzzzbx_message_id: id, bzzzbx_thread_id: hilo, delivery_detail } = entorno.correoRebotado;
        const uno = await entorno.lectura.obtener("message", id);
        const varios = await entorno.lectura.obtenerVarios("message", [id]);
        const delHilo = (await entorno.lectura.listarPor("message", { bzzzbx_thread_id: hilo })).find((m) => m.bzzzbx_message_id === id);
        for (const m of [uno, varios[0], delHilo]) {
          expect(m).toBeDefined();
          expect(m).not.toBeNull();
          expect(m!.delivery).toBe("bounced");
          expect(m!.delivery_detail).toBe(delivery_detail);
          expect(m!.direction).toBe("outbound");
        }
      });

      it("un cambio de delivery aparece en cambiosDesde y el mensaje queda bounced", async () => {
        const entorno = await crear();
        if (!entorno.cambioDeEntrega) return;
        const { lectura } = entorno;
        const { cursor } = await lectura.cambiosDesde(null);
        await entorno.cambioDeEntrega.provocar();
        await entorno.esperar?.();
        const lote = await lectura.cambiosDesde(cursor);
        expect(lote.cambios.map((c) => `${c.entidad}:${c.id}`)).toContain(`message:${entorno.cambioDeEntrega.bzzzbx_message_id}`);
        expect((await lectura.obtener("message", entorno.cambioDeEntrega.bzzzbx_message_id))!.delivery).toBe("bounced");
      });
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

    describe("leerFoto", () => {
      it("da la imagen de una foto conocida, con su tipo, y nunca vacía (OPR-30, P-8)", async () => {
        const { lectura, conocidos } = await crear();
        const foto = await lectura.obtener("photo", conocidos.photo);
        expect(foto).not.toBeNull();
        const imagen = await lectura.leerFoto(foto!.ref);
        expect(imagen).not.toBeNull();
        expect(imagen!.contentType).toMatch(/^image\//);
        expect(imagen!.bytes).toBeInstanceOf(Uint8Array);
        expect(imagen!.bytes.length).toBeGreaterThan(0);
      });

      it("da null para una referencia que BzzzBX no conoce", async () => {
        const { lectura } = await crear();
        expect(await lectura.leerFoto("stand-in:photo/bx-no-existe-0000")).toBeNull();
      });
    });

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

    describe("buscarMensajes (OPR-15, provisional hasta OPR-6)", () => {
      const DESDE_SIEMPRE = "2000-01-01T00:00:00Z";
      const todos = async (entorno: EntornoDeLectura) =>
        entorno.lectura.buscarMensajes({ channel: "email", direction: "inbound", desde: DESDE_SIEMPRE });

      it("trae el correo entrante conocido, y solo correos entrantes desde la hora pedida", async () => {
        const entorno = await crear();
        const conocido = await entorno.lectura.obtener("message", entorno.correoEntrante);
        expect(conocido).not.toBeNull();
        const { mensajes } = await todos(entorno);
        expect(mensajes.map((m) => m.bzzzbx_message_id)).toContain(entorno.correoEntrante);
        for (const m of mensajes) {
          expect(m.channel).toBe("email");
          expect(m.direction).toBe("inbound");
          expect(typeof m.version).toBe("string");
        }
        const despues = await entorno.lectura.buscarMensajes({
          channel: "email",
          direction: "inbound",
          desde: new Date(Date.parse(conocido!.sent_at) + 1).toISOString(),
        });
        expect(despues.mensajes.map((m) => m.bzzzbx_message_id)).not.toContain(entorno.correoEntrante);
        for (const m of despues.mensajes) expect(Date.parse(m.sent_at)).toBeGreaterThan(Date.parse(conocido!.sent_at));
      });

      it("ordena por sent_at y luego por crosswalk ID, y trae a lo sumo el máximo", async () => {
        const { mensajes, hay_mas } = await todos(await crear());
        expect(mensajes.length).toBeLessThanOrEqual(BUSCAR_MENSAJES_MAX);
        expect(typeof hay_mas).toBe("boolean");
        const claves = mensajes.map((m) => `${new Date(m.sent_at).toISOString()} ${m.bzzzbx_message_id}`);
        expect(claves).toEqual([...claves].sort());
      });

      it("despuesDe pagina: devuelve solo los posteriores a ese mensaje, sin repetirlo", async () => {
        const entorno = await crear();
        const { mensajes } = await todos(entorno);
        if (mensajes.length < 2) return;
        const primero = mensajes[0]!;
        const siguiente = await entorno.lectura.buscarMensajes({
          channel: "email",
          direction: "inbound",
          desde: DESDE_SIEMPRE,
          despuesDe: primero.bzzzbx_message_id,
        });
        expect(siguiente.mensajes.map((m) => m.bzzzbx_message_id)).not.toContain(primero.bzzzbx_message_id);
        expect(siguiente.mensajes.map((m) => m.bzzzbx_message_id)).toEqual(
          mensajes.slice(1, 1 + BUSCAR_MENSAJES_MAX).map((m) => m.bzzzbx_message_id),
        );
      });

      it.each([
        ["con un canal que no es email", { channel: "text", direction: "inbound", desde: DESDE_SIEMPRE }],
        ["con una dirección que no es inbound", { channel: "email", direction: "outbound", desde: DESDE_SIEMPRE }],
        ["con una hora mal formada", { channel: "email", direction: "inbound", desde: "ayer" }],
        [
          "con un despuesDe desconocido",
          { channel: "email", direction: "inbound", desde: DESDE_SIEMPRE, despuesDe: "bx-no-existe-0000" },
        ],
      ])("rechaza un filtro %s con FiltroInvalido", async (_caso, filtro) => {
        const { lectura } = await crear();
        await expect(lectura.buscarMensajes(filtro as unknown as FiltroDeMensajes)).rejects.toBeInstanceOf(FiltroInvalido);
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
