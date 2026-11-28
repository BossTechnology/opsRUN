/**
 * La entrega de los mensajes salientes en el falso (spec OPR-19 §9). Provisional
 * hasta OPR-6. Hace dos cosas, ninguna del contrato:
 *
 *  1. **Entrega forzada** (`forzar`): el próximo `send_email` o `send_text` que el
 *     falso observe se ve primero como hoy, con `delivery: "sent"`, y un paso del
 *     reloj después pasa a `failed` o `bounced`, con su motivo. La instrucción se
 *     confirma igual: el envío salió y fue el proveedor quien no lo entregó.
 *  2. **Imita a Signal Maker solo para abrir** Message not delivered (P-4): cuando
 *     un mensaje saliente pasa a `failed` o `bounced` (por esto o por un `cambiar`
 *     o `poner` de un E2E), pone una `AlertResult` abierta de esa regla sobre ese
 *     mensaje, una sola vez. No la cierra: cerrarla es de OPR-33, y los E2E la
 *     cierran con `cleared_at`.
 *
 * Sin temporizadores: se pone al día cuando alguien lee el falso (`alLeer`), como
 * las instrucciones. Todo inventado (repo público).
 */
import { REGLA_MENSAJE_NO_ENTREGADO } from "../../alertas/reglas";
import type { Message, TipoInstruccion } from "../tipos";

import type { LecturaFalsa } from "./lectura-falsa";
import type { Reloj } from "./reloj";

export type EntregaForzada = {
  tipo: Extract<TipoInstruccion, "send_email" | "send_text">;
  delivery: "failed" | "bounced";
  delivery_detail?: string | null;
};

type Pendiente = { id: string; aplicarEn: number; delivery: EntregaForzada["delivery"]; delivery_detail: string | null };

/** Los mensajes que crea una instrucción (`bx-msg-9nnn`): no los de la seed ni los que un E2E pone a mano. */
const DE_UNA_INSTRUCCION = /^bx-msg-9\d+$/;

export class EntregaFalsa {
  private forzadas: EntregaForzada[] = [];
  private pendientes: Pendiente[] = [];

  constructor(
    private readonly reloj: Reloj,
    private readonly lectura: LecturaFalsa,
    private readonly pasoMs = 1000,
  ) {}

  /** El próximo envío de ese tipo se entrega como se pide, un paso después de observarse. */
  forzar(entrega: EntregaForzada): void {
    this.forzadas.push({ ...entrega });
  }

  /** Lo que `LecturaFalsa` llama después de guardar una entidad. */
  alGuardar(entidad: string, valor: Record<string, unknown>): void {
    if (entidad !== "message") return;
    const m = valor as unknown as Message;
    if (m.direction !== "outbound") return;
    if (m.delivery === "failed" || m.delivery === "bounced") {
      this.abrirAlerta(m);
      return;
    }
    if (m.delivery === "sent" && DE_UNA_INSTRUCCION.test(m.bzzzbx_message_id)) {
      const tipo = m.channel === "email" ? "send_email" : "send_text";
      const i = this.forzadas.findIndex((f) => f.tipo === tipo);
      if (i < 0) return;
      const [f] = this.forzadas.splice(i, 1);
      this.pendientes.push({
        id: m.bzzzbx_message_id,
        aplicarEn: this.reloj.ahora().getTime() + this.pasoMs,
        delivery: f!.delivery,
        delivery_detail: f!.delivery_detail ?? null,
      });
    }
  }

  /** Lo que `LecturaFalsa` llama antes de cada lectura: pasa a su entrega los mensajes que ya les toca. */
  alLeer(): void {
    const ahora = this.reloj.ahora().getTime();
    const vencidos = this.pendientes.filter((p) => ahora >= p.aplicarEn);
    if (vencidos.length === 0) return;
    this.pendientes = this.pendientes.filter((p) => !vencidos.includes(p));
    for (const p of vencidos) {
      this.lectura.cambiar("message", p.id, { delivery: p.delivery, delivery_detail: p.delivery_detail });
    }
  }

  private abrirAlerta(m: Message): void {
    const id = `bx-alert-${m.bzzzbx_message_id.replace(/^bx-msg-/, "msg-")}`;
    if (this.lectura.existe("alert_result", id)) return;
    const a = m.to[0] ?? "the recipient";
    const equipo = m.channel === "text" ? this.lectura.todos("cleaner_team").find((t) => t.phone === a) : undefined;
    const quien = equipo?.name ?? a;
    const motivo = m.delivery_detail?.trim();
    this.lectura.poner("alert_result", {
      bzzzbx_alert_id: id,
      sujeto: { tipo: "message", bzzzbx_message_id: m.bzzzbx_message_id },
      rule_id: REGLA_MENSAJE_NO_ENTREGADO,
      rule_version: "1",
      level: "red",
      reason_text: `${m.channel === "email" ? "Email" : "Text"} to ${quien} ${m.delivery === "bounced" ? "bounced" : "failed"}${motivo ? `: ${motivo}` : "."}`,
      opened_at: this.reloj.ahora().toISOString(),
      cleared_at: null,
    });
  }
}
