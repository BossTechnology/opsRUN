/**
 * Falso en memoria del puerto de lectura (spec OPR-22 §5). Hace de las
 * proyecciones de BzzzBX con datos inventados; nunca escribe en la base.
 *
 * Además del contrato tiene controles de prueba, que el real no tendrá:
 * `cambiar` y `poner` (un cambio en el origen), `noDisponible` (BzzzBX caído)
 * y `reconstruir` (las proyecciones se vacían y se rellenan, Runbook §3.2).
 */
import { isDeepStrictEqual } from "node:util";

import { BzzzbxNoDisponible, CursorCaducado, FiltroInvalido } from "../errores";
import { validarFiltroDeJobs } from "../filtro-de-jobs";
import type { LecturaBzzzbx } from "../puertos";
import {
  BUSCAR_JOBS_MAX,
  BUSCAR_MENSAJES_MAX,
  CLAVE,
  ENTIDADES,
  type Cambio,
  type Cursor,
  type Entidad,
  type EntidadHija,
  type Entidades,
  type FiltroDeJobs,
  type FiltroDeMensajes,
  type Filtros,
  type Job,
  type Leido,
  type LoteDeCambios,
  type Message,
} from "../tipos";

import type { DatosIniciales } from "./datos";
import type { Reloj } from "./reloj";

type Fila = Record<string, unknown> & { version: string };
type ConVersion<E extends Entidad> = Entidades[E] & { version: string };

const ES_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** El orden de `buscarMensajes`: la hora y, a igual hora, el crosswalk ID. */
const clave = (m: Message) => `${new Date(m.sent_at).toISOString()} ${m.bzzzbx_message_id}`;

/** Prefijo de los ids de los correos que deja caer `correoNuevo`; no chocan con los de la seed. */
const PREFIJO_CORREO_NUEVO = "9";
/** Por proceso y no por falso: un `reiniciar` no repite ids que la base ya vio. */
const arranque = Date.now().toString(36);
let correosNuevos = 0;

const FORMA_CURSOR = /^lf1\.(\d+)\.(\d+)$/;

export class LecturaFalsa implements LecturaBzzzbx {
  private tablas = new Map<Entidad, Map<string, Fila>>();
  private registro: Cambio[] = [];
  private generacion = 1;
  private ultimaVersion = 0;
  private caido = false;

  constructor(
    private readonly reloj: Reloj,
    datos: DatosIniciales,
    private readonly tamanoDeLote = 100,
  ) {
    for (const entidad of ENTIDADES) {
      const tabla = new Map<string, Fila>();
      for (const fila of datos[entidad] as Record<string, unknown>[]) {
        tabla.set(String(fila[CLAVE[entidad]]), { ...structuredClone(fila), version: this.versionNueva() });
      }
      this.tablas.set(entidad, tabla);
    }
  }

  // -------------------------------------------------------------------------
  // Contrato
  // -------------------------------------------------------------------------

  async obtener<E extends Entidad>(entidad: E, id: string): Promise<Leido<Entidades[E]> | null> {
    this.exigirDisponible();
    const fila = this.tabla(entidad).get(id);
    return fila ? this.leido<E>(fila) : null;
  }

  async obtenerVarios<E extends Entidad>(entidad: E, ids: string[]): Promise<Leido<Entidades[E]>[]> {
    this.exigirDisponible();
    const tabla = this.tabla(entidad);
    return ids.flatMap((id) => {
      const fila = tabla.get(id);
      return fila ? [this.leido<E>(fila)] : [];
    });
  }

  async listarPor<E extends EntidadHija>(entidad: E, filtro: Filtros[E]): Promise<Leido<Entidades[E]>[]> {
    this.exigirDisponible();
    const condiciones = Object.entries(filtro);
    return [...this.tabla(entidad).values()]
      .filter((fila) => condiciones.every(([campo, valor]) => isDeepStrictEqual(fila[campo], valor)))
      .map((fila) => this.leido<E>(fila));
  }

  async buscarJobs(filtro: FiltroDeJobs): Promise<Leido<Job>[]> {
    validarFiltroDeJobs(filtro);
    this.exigirDisponible();
    const { bzzzbx_customer_id: cliente, bzzzbx_property_id: propiedad, desde, hasta } = filtro;
    return [...this.tabla("job").values()]
      .map((fila) => this.leido<"job">(fila))
      .filter(
        (job) =>
          (cliente === undefined || job.bzzzbx_customer_id === cliente) &&
          (propiedad === undefined || job.bzzzbx_property_id === propiedad) &&
          job.service_date >= desde &&
          job.service_date <= hasta,
      )
      .sort((a, b) => (a.service_date + a.bzzzbx_job_id < b.service_date + b.bzzzbx_job_id ? -1 : 1))
      .slice(0, BUSCAR_JOBS_MAX);
  }

  async buscarMensajes(filtro: FiltroDeMensajes): Promise<{ mensajes: Leido<Message>[]; hay_mas: boolean }> {
    if (filtro.channel !== "email" || filtro.direction !== "inbound") {
      throw new FiltroInvalido("buscarMensajes solo trae correos entrantes");
    }
    if (!ES_ISO.test(filtro.desde) || Number.isNaN(Date.parse(filtro.desde))) {
      throw new FiltroInvalido("desde debe ser un instante ISO 8601 UTC");
    }
    this.exigirDisponible();
    const ordenados = [...this.tabla("message").values()]
      .map((fila) => this.leido<"message">(fila))
      .filter((m) => m.channel === "email" && m.direction === "inbound")
      .sort((a, b) => clave(a).localeCompare(clave(b)));
    const desde = Date.parse(filtro.desde);
    let candidatos = ordenados.filter((m) => Date.parse(m.sent_at) >= desde);
    if (filtro.despuesDe !== undefined) {
      const ancla = ordenados.find((m) => m.bzzzbx_message_id === filtro.despuesDe);
      if (!ancla) throw new FiltroInvalido("despuesDe no es un mensaje conocido");
      candidatos = candidatos.filter((m) => clave(m) > clave(ancla));
    }
    return { mensajes: candidatos.slice(0, BUSCAR_MENSAJES_MAX), hay_mas: candidatos.length > BUSCAR_MENSAJES_MAX };
  }

  async cambiosDesde(cursor: Cursor | null): Promise<LoteDeCambios> {
    this.exigirDisponible();
    const desde = cursor === null ? this.registro.length : this.posicion(cursor);
    const cambios = this.registro.slice(desde, desde + this.tamanoDeLote);
    const hasta = desde + cambios.length;
    return {
      cambios: cambios.map((c) => ({ ...c })),
      cursor: `lf1.${this.generacion}.${hasta}` as Cursor,
      hay_mas: hasta < this.registro.length,
    };
  }

  // -------------------------------------------------------------------------
  // Controles de prueba (solo el falso)
  // -------------------------------------------------------------------------

  /** Cambia campos de una entidad que existe, como si cambiara en el origen. */
  cambiar<E extends Entidad>(entidad: E, id: string, parche: Partial<Entidades[E]>): void {
    const actual = this.tabla(entidad).get(id);
    if (!actual) throw new Error(`el falso no tiene ${entidad} ${id}`);
    if (CLAVE[entidad] in parche && (parche as Record<string, unknown>)[CLAVE[entidad]] !== id) {
      throw new Error(`no se cambia el crosswalk ID de ${entidad}`);
    }
    this.guardar(entidad, id, { ...actual, ...structuredClone(parche) });
  }

  /** Agrega o reemplaza una entidad completa, como si apareciera en el origen. */
  poner<E extends Entidad>(entidad: E, valor: Entidades[E]): void {
    const id = String((valor as Record<string, unknown>)[CLAVE[entidad]]);
    this.guardar(entidad, id, structuredClone(valor) as Record<string, unknown>);
  }

  /**
   * Deja caer un correo entrante de un remitente inventado, con su cambio. Sin
   * `respuestaA` abre un hilo nuevo; con él, es una respuesta en ese hilo. Los
   * ids empiezan con 9 y llevan la hora de arranque del proceso, para que ni
   * un `reiniciar` del falso ni otra corrida sobre la misma base los repitan
   * (spec OPR-15 §10.3).
   */
  correoNuevo(respuestaA?: string): { bzzzbx_message_id: string; bzzzbx_thread_id: string } {
    correosNuevos += 1;
    const sufijo = `${PREFIJO_CORREO_NUEVO}-${arranque}-${correosNuevos}`;
    const mensaje: Message = {
      bzzzbx_message_id: `bx-msg-${sufijo}`,
      bzzzbx_thread_id: respuestaA ?? `bx-thread-${sufijo}`,
      channel: "email",
      direction: "inbound",
      from: "new.requester@example.test",
      to: ["requests@example.test"],
      subject: respuestaA ? "Re: Cleaning request" : "Cleaning request",
      body: "Hello, can you clean the unit this week?",
      sent_at: this.reloj.ahora().toISOString(),
      delivery: "delivered",
    };
    this.poner("message", mensaje);
    return { bzzzbx_message_id: mensaje.bzzzbx_message_id, bzzzbx_thread_id: mensaje.bzzzbx_thread_id! };
  }

  /** BzzzBX caído: toda llamada lanza `BzzzbxNoDisponible` hasta volver a false. */
  noDisponible(caido: boolean): void {
    this.caido = caido;
  }

  get disponible(): boolean {
    return !this.caido;
  }

  /**
   * Vacía las proyecciones y las vuelve a llenar con lo mismo (la verdad no
   * cambia). Los cursores dados antes caducan.
   */
  reconstruir(): void {
    const copia = new Map([...this.tablas].map(([entidad, tabla]) => [entidad, structuredClone(tabla)]));
    this.tablas.clear();
    for (const [entidad, tabla] of copia) this.tablas.set(entidad, tabla);
    this.registro = [];
    this.generacion += 1;
  }

  /** Todas las filas de una entidad, con su versión: para pruebas y para el falso de instrucciones. */
  todos<E extends Entidad>(entidad: E): ConVersion<E>[] {
    return [...this.tabla(entidad).values()].map((fila) => structuredClone(fila) as unknown as ConVersion<E>);
  }

  existe(entidad: Entidad, id: string): boolean {
    return this.tabla(entidad).has(id);
  }

  // -------------------------------------------------------------------------

  private guardar(entidad: Entidad, id: string, valor: Record<string, unknown>): void {
    const version = this.versionNueva();
    this.tabla(entidad).set(id, { ...valor, version });
    this.registro.push({ entidad, id, version });
  }

  private tabla(entidad: Entidad): Map<string, Fila> {
    const tabla = this.tablas.get(entidad);
    if (!tabla) throw new Error(`entidad desconocida: ${entidad}`);
    return tabla;
  }

  private leido<E extends Entidad>(fila: Fila): Leido<Entidades[E]> {
    return { ...structuredClone(fila), leido_en: this.reloj.ahora().toISOString() } as unknown as Leido<Entidades[E]>;
  }

  private versionNueva(): string {
    this.ultimaVersion += 1;
    return `v${this.ultimaVersion}`;
  }

  private posicion(cursor: Cursor): number {
    const partes = FORMA_CURSOR.exec(cursor);
    if (!partes) throw new CursorCaducado();
    const [, generacion, posicion] = partes;
    if (Number(generacion) !== this.generacion || Number(posicion) > this.registro.length) {
      throw new CursorCaducado();
    }
    return Number(posicion);
  }

  private exigirDisponible(): void {
    if (this.caido) throw new BzzzbxNoDisponible();
  }
}

