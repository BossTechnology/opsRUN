/**
 * Falso en memoria del puerto de instrucciones (spec OPR-22 §4 y §5).
 *
 * Una instrucción aceptada recorre los pasos del Runbook §7.1, uno por cada
 * `pasoMs` del reloj (sin temporizadores: se pone al día en cada llamada).
 * En el paso `observed` aplica su efecto a la lectura falsa, porque en el
 * contrato real la confirmación llega cuando el cambio se ve como proyección.
 *
 * Controles de prueba: `forzarError`, `exigirAprobacion` y `aprobar`.
 *
 * Los envíos (`send_email`, `send_text`) llevan crosswalk IDs y el cuerpo que
 * escribió el operador (OPR-27, P-2): el hilo o el equipo, nunca una dirección
 * ni un teléfono. El falso resuelve los destinatarios, como lo hará BzzzBX.
 * PROVISIONAL hasta OPR-6.
 */
import { BzzzbxNoDisponible, CursorCaducado, InstruccionRechazada } from "../errores";
import type { InstruccionesBzzzbx } from "../puertos";
import {
  TIPOS_INSTRUCCION,
  type Acuse,
  type Cursor,
  type Instruccion,
  type LoteDeResultados,
  type Paso,
  type Resultado,
  type TipoInstruccion,
} from "../tipos";

import type { LecturaFalsa } from "./lectura-falsa";
import type { Reloj } from "./reloj";

export type CuandoFalla = "al_entregar" | "al_ejecutar" | "sin_confirmar" | "no_disponible";

export type ErrorForzado = {
  tipo?: TipoInstruccion;
  idempotency_key?: string;
  cuando: CuandoFalla;
  error_code?: string;
  error_message?: string;
  /** Cuántas instrucciones lo sufren. Por defecto, 1. */
  veces?: number;
};

const CUANDO: readonly CuandoFalla[] = ["al_entregar", "al_ejecutar", "sin_confirmar", "no_disponible"];
const FORMA_CURSOR = /^if1\.(\d+)$/;
/**
 * Secuencia de los IDs de los mensajes que crea el falso. Vive fuera de la
 * instancia: `reiniciarFalso` crea un falso nuevo y los IDs no se repiten, como
 * en BzzzBX, para que un vínculo de opsRUN no apunte a otro mensaje.
 */
let ultimoMensaje = 9000;
/** Marca del payload para provocar un error desde un E2E (supuesto S-9). Solo la lee el falso. */
export const MARCA_ERROR = "__forzar_error";
/** Los valores de `cuando` que acepta `forzarError`; los E2E los piden por HTTP (`/api/falso`). */
export const VALORES_DE_CUANDO: readonly CuandoFalla[] = CUANDO;

type Falla = { cuando: CuandoFalla; error_code: string; error_message: string };

type Registro = {
  instruccion: Instruccion;
  acuse: Acuse;
  pasos: Paso[];
  indice: number;
  proximoEn: number;
  aprobada: boolean;
  falla: Falla | null;
  datos?: Record<string, unknown>;
  ultimo: Resultado;
};

export class InstruccionesFalsas implements InstruccionesBzzzbx {
  readonly pasoMs: number;
  private registros = new Map<string, Registro>();
  private rechazadas = new Map<string, InstruccionRechazada>();
  private registro: Resultado[] = [];
  private errores: (ErrorForzado & { restantes: number })[] = [];
  private conAprobacion = new Set<TipoInstruccion>();
  private ultimaReferencia = 9000;
  private ultimoId = 9000;

  constructor(
    private readonly reloj: Reloj,
    private readonly lectura: LecturaFalsa,
    opciones: { pasoMs?: number } = {},
  ) {
    this.pasoMs = opciones.pasoMs ?? 1000;
  }

  // -------------------------------------------------------------------------
  // Contrato
  // -------------------------------------------------------------------------

  async entregar(instruccion: Instruccion): Promise<Acuse> {
    this.exigirDisponible();
    this.ponerAlDia();
    const clave = instruccion.idempotency_key;
    const rechazo = this.rechazadas.get(clave);
    if (rechazo) throw rechazo;
    const existente = this.registros.get(clave);
    if (existente) return { ...existente.acuse };

    const falla = this.fallaPara(instruccion);
    if (falla?.cuando === "no_disponible") throw new BzzzbxNoDisponible();
    const motivo = falla?.cuando === "al_entregar" ? falla : this.validar(instruccion);
    if (motivo) {
      const error = new InstruccionRechazada(motivo.error_code, motivo.error_message);
      this.rechazadas.set(clave, error);
      throw error;
    }

    const ahora = this.reloj.ahora();
    const acuse: Acuse = {
      idempotency_key: clave,
      bzzzbx_reference: `bx-ref-${++this.ultimaReferencia}`,
      aceptada_en: ahora.toISOString(),
    };
    const pasos: Paso[] = ["requested", "authorized"];
    if (this.conAprobacion.has(instruccion.tipo)) pasos.push("awaiting_approval");
    pasos.push("dispatched", "executed", "observed");
    const registro: Registro = {
      instruccion: structuredClone(instruccion),
      acuse,
      pasos,
      indice: 0,
      proximoEn: ahora.getTime() + this.pasoMs,
      aprobada: false,
      falla,
      ultimo: { idempotency_key: clave, estado: "en_curso", paso: "requested" },
    };
    this.registros.set(clave, registro);
    this.registro.push(registro.ultimo);
    return { ...acuse };
  }

  async resultadosDesde(cursor: Cursor | null): Promise<LoteDeResultados> {
    this.exigirDisponible();
    this.ponerAlDia();
    const desde = cursor === null ? this.registro.length : this.posicion(cursor);
    return {
      resultados: this.registro.slice(desde).map((r) => structuredClone(r)),
      cursor: `if1.${this.registro.length}` as Cursor,
      hay_mas: false,
    };
  }

  async estado(idempotency_key: string): Promise<Resultado | null> {
    this.exigirDisponible();
    this.ponerAlDia();
    const registro = this.registros.get(idempotency_key);
    return registro ? structuredClone(registro.ultimo) : null;
  }

  // -------------------------------------------------------------------------
  // Controles de prueba (solo el falso)
  // -------------------------------------------------------------------------

  /** Provoca un error en las próximas instrucciones que encajen. */
  forzarError(error: ErrorForzado): void {
    this.errores.push({ ...error, restantes: error.veces ?? 1 });
  }

  /** Las instrucciones de este tipo esperan en `awaiting_approval` hasta `aprobar`. */
  exigirAprobacion(tipo: TipoInstruccion): void {
    this.conAprobacion.add(tipo);
  }

  aprobar(idempotency_key: string): void {
    const registro = this.registros.get(idempotency_key);
    if (!registro) throw new Error(`el falso no tiene la instrucción ${idempotency_key}`);
    registro.aprobada = true;
    registro.proximoEn = Math.max(registro.proximoEn, this.reloj.ahora().getTime());
  }

  // -------------------------------------------------------------------------

  private ponerAlDia(): void {
    const ahora = this.reloj.ahora().getTime();
    for (const registro of this.registros.values()) {
      while (registro.ultimo.estado === "en_curso" && ahora >= registro.proximoEn) {
        if (registro.pasos[registro.indice] === "awaiting_approval" && !registro.aprobada) break;
        this.avanzar(registro);
        registro.proximoEn += this.pasoMs;
      }
    }
  }

  private avanzar(registro: Registro): void {
    const clave = registro.instruccion.idempotency_key;
    const siguiente = registro.pasos[registro.indice + 1];
    const falla = registro.falla;
    let resultado: Resultado;

    if (siguiente === "executed" && falla?.cuando === "al_ejecutar") {
      resultado = { idempotency_key: clave, estado: "fallida", error_code: falla.error_code, error_message: falla.error_message };
    } else if (siguiente === "observed" && falla?.cuando === "sin_confirmar") {
      resultado = { idempotency_key: clave, estado: "sin_confirmar", motivo: "The result was not observed in the source." };
    } else if (siguiente) {
      if (siguiente === "observed") registro.datos = this.aplicarEfecto(registro.instruccion);
      registro.indice += 1;
      resultado = { idempotency_key: clave, estado: "en_curso", paso: siguiente };
    } else {
      resultado = {
        idempotency_key: clave,
        estado: "confirmada",
        bzzzbx_reference: registro.acuse.bzzzbx_reference,
        ...(registro.datos ? { datos: registro.datos } : {}),
      };
    }
    registro.ultimo = resultado;
    this.registro.push(resultado);
  }

  /** Lo que la instrucción cambia en el origen; devuelve lo que opsRUN debe guardar. */
  private aplicarEfecto({ tipo, payload, sujeto }: Instruccion): Record<string, unknown> | undefined {
    const job = sujeto?.bzzzbx_job_id;
    const texto = (campo: string) => (typeof payload[campo] === "string" ? (payload[campo] as string) : null);
    switch (tipo) {
      case "create_job": {
        const n = ++this.ultimoId;
        const bzzzbx_job_id = `bx-job-${n}`;
        const job_number = `EX-${n}`;
        const bzzzbx_team_id = texto("bzzzbx_team_id");
        this.lectura.poner("job", {
          bzzzbx_job_id,
          job_number,
          bzzzbx_customer_id: texto("bzzzbx_customer_id")!,
          bzzzbx_property_id: texto("bzzzbx_property_id")!,
          bzzzbx_space_id: texto("bzzzbx_space_id"),
          bzzzbx_service_id: texto("bzzzbx_service_id")!,
          service_date: texto("service_date")!,
          window_start: texto("window_start"),
          window_end: texto("window_end"),
          status: "scheduled",
          bzzzbx_team_id,
          po_number: texto("po_number"),
        });
        if (bzzzbx_team_id) {
          this.lectura.poner("assignment", { bzzzbx_assignment_id: `bx-asg-${n}`, bzzzbx_job_id, bzzzbx_team_id, status: "assigned" });
        }
        this.lectura.poner("payment", { bzzzbx_job_id, paid: false, paid_at: null, bzzzbx_event_id: null });
        return { bzzzbx_job_id, job_number };
      }
      case "reschedule_job":
        this.lectura.cambiar("job", job!, {
          service_date: texto("service_date")!,
          window_start: texto("window_start"),
          window_end: texto("window_end"),
        });
        return undefined;
      case "cancel_job":
        this.lectura.cambiar("job", job!, { status: "cancelled" });
        return undefined;
      case "write_po":
        this.lectura.cambiar("job", job!, { po_number: texto("po_number") });
        return undefined;
      case "send_email":
      case "send_text": {
        const bzzzbx_message_id = `bx-msg-${++ultimoMensaje}`;
        const esCorreo = tipo === "send_email";
        // BzzzBX resuelve el destinatario con el crosswalk ID (OPR-27, P-2).
        const hilo = esCorreo ? this.primeroDelHilo(texto("bzzzbx_thread_id")!) : undefined;
        const equipo = esCorreo ? undefined : this.lectura.todos("cleaner_team").find((t) => t.bzzzbx_team_id === texto("bzzzbx_team_id"));
        this.lectura.poner("message", {
          bzzzbx_message_id,
          bzzzbx_thread_id: esCorreo ? texto("bzzzbx_thread_id") : null,
          channel: esCorreo ? "email" : "text",
          direction: "outbound",
          from: esCorreo ? "requests@example.test" : "opsrun",
          to: esCorreo ? (hilo ? [hilo.from] : []) : equipo?.phone ? [equipo.phone] : [],
          subject: esCorreo ? (hilo?.subject ? `Re: ${hilo.subject.replace(/^Re:\s*/i, "")}` : null) : null,
          body: texto("body")!,
          sent_at: this.reloj.ahora().toISOString(),
          delivery: "sent",
        });
        return { bzzzbx_message_id };
      }
      default:
        // IA, End manually y Validate solo confirman (supuesto S-10).
        return undefined;
    }
  }

  private validar({ tipo, payload, sujeto }: Instruccion): Falla | null {
    const invalido = (error_message: string): Falla => ({ cuando: "al_entregar", error_code: "invalid_payload", error_message });
    if (!(TIPOS_INSTRUCCION as readonly string[]).includes(tipo)) {
      return { cuando: "al_entregar", error_code: "unknown_type", error_message: `Unknown instruction type: ${tipo}` };
    }
    const tiene = (campo: string) => typeof payload[campo] === "string" && (payload[campo] as string).length > 0;
    const jobConocido = () => !!sujeto?.bzzzbx_job_id && this.lectura.existe("job", sujeto.bzzzbx_job_id);

    switch (tipo) {
      case "send_email":
        if (!tiene("body")) return invalido("An email needs a body.");
        if (!tiene("bzzzbx_thread_id") || !this.primeroDelHilo(payload.bzzzbx_thread_id as string)) {
          return invalido("Unknown thread.");
        }
        return null;
      case "send_text":
        if (!tiene("body")) return invalido("A text needs a body.");
        if (!tiene("bzzzbx_team_id") || !this.lectura.existe("cleaner_team", payload.bzzzbx_team_id as string)) {
          return invalido("Unknown cleaner team.");
        }
        return null;
      case "create_job":
        for (const campo of ["bzzzbx_customer_id", "bzzzbx_property_id", "bzzzbx_service_id", "service_date"]) {
          if (!tiene(campo)) return invalido(`create_job needs ${campo}.`);
        }
        return null;
      case "reschedule_job":
        if (!jobConocido()) return { cuando: "al_entregar", error_code: "unknown_job", error_message: "Job not found." };
        if (!tiene("service_date")) return invalido("reschedule_job needs service_date.");
        return null;
      case "write_po":
        if (!jobConocido()) return { cuando: "al_entregar", error_code: "unknown_job", error_message: "Job not found." };
        if (!tiene("po_number")) return invalido("write_po needs po_number.");
        return null;
      case "cancel_job":
      case "end_job_manually":
      case "record_validation":
        if (!jobConocido()) return { cuando: "al_entregar", error_code: "unknown_job", error_message: "Job not found." };
        return null;
      default:
        return null;
    }
  }

  /** El error forzado que le toca a esta instrucción, si hay; lo consume. */
  private fallaPara(instruccion: Instruccion): Falla | null {
    const marca = instruccion.payload[MARCA_ERROR];
    if (typeof marca === "string" && (CUANDO as readonly string[]).includes(marca)) {
      return { cuando: marca as CuandoFalla, error_code: "forced_error", error_message: "Forced error (stand-in)." };
    }
    const error = this.errores.find(
      (e) =>
        e.restantes > 0 &&
        (e.tipo === undefined || e.tipo === instruccion.tipo) &&
        (e.idempotency_key === undefined || e.idempotency_key === instruccion.idempotency_key),
    );
    if (!error) return null;
    error.restantes -= 1;
    return {
      cuando: error.cuando,
      error_code: error.error_code ?? "forced_error",
      error_message: error.error_message ?? "Forced error (stand-in).",
    };
  }

  /** El primer mensaje del hilo (el de la request original); undefined si el falso no conoce el hilo. */
  private primeroDelHilo(bzzzbx_thread_id: string) {
    return this.lectura
      .todos("message")
      .filter((m) => m.bzzzbx_thread_id === bzzzbx_thread_id)
      .sort((a, b) => a.sent_at.localeCompare(b.sent_at))
      .find((m) => m.direction === "inbound");
  }

  private posicion(cursor: Cursor): number {
    const partes = FORMA_CURSOR.exec(cursor);
    if (!partes || Number(partes[1]) > this.registro.length) throw new CursorCaducado();
    return Number(partes[1]);
  }

  private exigirDisponible(): void {
    if (!this.lectura.disponible) throw new BzzzbxNoDisponible();
  }
}
