/**
 * Falso en memoria del puerto de IA (spec OPR-36 §13). PROVISIONAL hasta OPR-6.
 *
 * Con el reloj inyectable del falso: sin temporizadores, el tiempo pasa cuando el
 * reloj avanza. Cada mensaje tiene un guion que decide cómo responde la IA; sin
 * guion, el mensaje responde que no lo conoce (definitivo), así los correos de la
 * seed no se analizan por accidente. Todo inventado, con los IDs que comparten la
 * seed y el falso. Nada parece un correo real: el falso nunca lee ni inventa texto
 * de un correo.
 *
 * Guiones:
 *  - `normal`: listo a los 2 s, con propuestas que encajan con los datos del falso;
 *  - `lenta`: en curso hasta que `terminar(mensaje)` la libera con el guion `normal`;
 *  - `falla`: a los 2 s, `fallido` con `model_error`;
 *  - `varios`: `normal` más `multiple_jobs` con dos;
 *  - `invalida`: `normal`, con una propuesta de forma mala;
 *  - `limitada`: el primer pedido lanza `IaLimitada`; los siguientes, como `normal`.
 */
import { BzzzbxNoDisponible, IaLimitada, IaRechazada } from "../errores";
import type { IaBzzzbx } from "../puertos";
import type { CampoDeIa, PedidoDeAnalisis, Propuesta, ResultadoDeAnalisis } from "../tipos-ia";

import type { Reloj } from "./reloj";

export type Guion = "normal" | "lenta" | "falla" | "varios" | "invalida" | "limitada";
export const GUIONES: readonly Guion[] = ["normal", "lenta", "falla", "varios", "invalida", "limitada"];

/** Cuánto tarda la IA del falso en responder con un guion que responde. */
export const IA_FALSA_TARDA_MS = 2000;

const MODELO = "example-model";

type Registro = {
  pedido: PedidoDeAnalisis;
  recibido_at: number;
  guion: Guion;
  /** `lenta` liberada con `terminar`: desde ese instante cuenta como `normal`. */
  liberada_en: number | null;
  /** Un resultado terminado no cambia: se calcula una vez. */
  resultado: ResultadoDeAnalisis | null;
};

const dia = (ms: number, masDias: number) => new Date(ms + masDias * 86_400_000).toISOString().slice(0, 10);

/** Las propuestas inventadas de un correo analizado, con los IDs de la seed y del falso. */
function propuestasNormales(campos: readonly CampoDeIa[], ahoraMs: number): Propuesta[] {
  const todas: Propuesta[] = [
    { campo: "property", rank: 1, valor: "bx-prop-0001", motivo: "The address matches the property." },
    { campo: "property", rank: 2, valor: "bx-prop-0002", motivo: "Same street, another building." },
    { campo: "property", rank: 3, valor: "bx-prop-0003", motivo: "Same name, another city." },
    { campo: "unit", rank: 1, valor: "4B", motivo: "The unit is in the subject." },
    { campo: "beds", rank: 1, valor: 3, motivo: "It says three bedrooms." },
    { campo: "service", rank: 1, valor: "bx-svc-0001", motivo: "It asks for a regular clean." },
    { campo: "service_date", rank: 1, valor: dia(ahoraMs, 1), motivo: "It asks for tomorrow." },
    { campo: "time_window", rank: 1, valor: { start: "09:00", end: "12:00" }, motivo: "It asks for the morning." },
    {
      campo: "sender",
      rank: 1,
      valor: { bzzzbx_customer_id: "bx-cust-0001", bzzzbx_contact_id: "bx-cont-0001" },
      motivo: "The signature names the contact.",
    },
  ];
  return todas.filter((p) => campos.includes(p.campo));
}

export class IaFalsa implements IaBzzzbx {
  private registros = new Map<string, Registro>();
  private guiones = new Map<string, Guion>();
  private limitadasYa = new Set<string>();
  private caida = false;

  constructor(
    private readonly reloj: Reloj,
    private readonly tardaMs: number = IA_FALSA_TARDA_MS,
  ) {}

  // -------------------------------------------------------------------------
  // Controles de prueba (no son del contrato)
  // -------------------------------------------------------------------------

  /** Cómo responde la IA a ese mensaje. Sin guion, lo rechaza como desconocido. */
  ponerGuion(bzzzbx_message_id: string, guion: Guion): void {
    this.guiones.set(bzzzbx_message_id, guion);
  }

  /** La IA sin servicio (BzzzBX caído solo para esta capa), sin tocar la lectura. */
  noDisponible(caida: boolean): void {
    this.caida = caida;
  }

  get disponible(): boolean {
    return !this.caida;
  }

  /** Libera un análisis `lenta` de ese mensaje: responde como `normal`. */
  terminar(bzzzbx_message_id: string): number {
    let liberados = 0;
    for (const r of this.registros.values()) {
      if (r.pedido.bzzzbx_message_id === bzzzbx_message_id && r.guion === "lenta" && r.liberada_en === null) {
        r.liberada_en = this.reloj.ahora().getTime();
        liberados += 1;
      }
    }
    return liberados;
  }

  // -------------------------------------------------------------------------
  // Contrato
  // -------------------------------------------------------------------------

  async pedirAnalisis(pedido: PedidoDeAnalisis): Promise<{ recibido_at: string }> {
    this.exigirDisponible();
    const ya = this.registros.get(pedido.clave);
    if (ya) return { recibido_at: new Date(ya.recibido_at).toISOString() };

    const guion = this.guiones.get(pedido.bzzzbx_message_id);
    if (!guion) throw new IaRechazada("message_unknown", true);
    if (guion === "limitada" && !this.limitadasYa.has(pedido.bzzzbx_message_id)) {
      this.limitadasYa.add(pedido.bzzzbx_message_id);
      throw new IaLimitada(5000);
    }

    const ahora = this.reloj.ahora().getTime();
    this.registros.set(pedido.clave, {
      pedido: { ...pedido, campos: [...pedido.campos] },
      recibido_at: ahora,
      guion,
      liberada_en: null,
      resultado: null,
    });
    return { recibido_at: new Date(ahora).toISOString() };
  }

  async resultadoDeAnalisis(clave: string): Promise<ResultadoDeAnalisis | null> {
    this.exigirDisponible();
    const r = this.registros.get(clave);
    if (!r) return null;
    if (r.resultado) return r.resultado;

    const ahora = this.reloj.ahora().getTime();
    const desde = r.guion === "lenta" ? r.liberada_en : r.recibido_at;
    if (desde === null || ahora - desde < this.tardaMs) return { estado: "en_curso" };
    const terminado_at = new Date(desde + this.tardaMs).toISOString();

    if (r.guion === "falla") {
      r.resultado = { estado: "fallido", error_code: "model_error", terminado_at };
      return r.resultado;
    }
    const propuestas = propuestasNormales(r.pedido.campos, desde);
    if (r.guion === "varios" && r.pedido.campos.includes("multiple_jobs")) {
      propuestas.push({ campo: "multiple_jobs", rank: 1, valor: { count: 2 }, motivo: "It lists two units." });
    }
    if (r.guion === "invalida") {
      // Una propuesta con forma mala: camas en texto.
      const i = propuestas.findIndex((p) => p.campo === "beds");
      if (i >= 0) propuestas[i] = { ...propuestas[i]!, valor: "three" };
      else propuestas.push({ campo: "unit", rank: 1, valor: 4, motivo: null });
    }
    r.resultado = { estado: "listo", modelo: MODELO, propuestas, terminado_at };
    return r.resultado;
  }

  private exigirDisponible(): void {
    if (this.caida) throw new BzzzbxNoDisponible();
  }
}
