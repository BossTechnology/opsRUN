import { describe, expect, it } from "vitest";

import { armarAudit, textoDeLaVista } from "./armar";
import { SIN_NOMBRES, type FilaDeAudit } from "./tipos";

/**
 * Lo que Audit dice en Scheduled (OPR-29, spec §5.3 y §8.1): las dos líneas de Delayed, el cambio de job y la
 * cancelación observada. No son tipos nuevos de alerta: Delayed es el `alert_opened` y el `alert_resolved` de OPS-010
 * que escribe el registrador, con otro texto solo aquí.
 */
let n = 0;
function fila(parcial: Partial<FilaDeAudit> & Pick<FilaDeAudit, "event_type">): FilaDeAudit {
  n += 1;
  return {
    id: String(n),
    label: parcial.event_type,
    source: "opsrun",
    actor_kind: "system",
    actor_nombre: null,
    reason: null,
    occurred_at: "2026-11-27T14:30:00.000000Z",
    a_operador: null,
    de_operador: null,
    metodo: null,
    modo: null,
    marca_oss: null,
    po_numero: null,
    job_number: null,
    job_anterior_number: null,
    job_nuevo_number: null,
    bzzzbx_job_id: null,
    sugerencias: null,
    alerta_regla: null,
    alerta_nivel: null,
    alerta_texto: null,
    alerta_resolucion: null,
    ia_campo: null,
    ia_campo_label: null,
    ia_valor: null,
    ia_valor_final: null,
    instruccion_label: null,
    instruccion_error: null,
    equipo_id: null,
    ...parcial,
  };
}

const AHORA = new Date("2026-11-27T15:00:00Z");
const vista = (filas: FilaDeAudit[]) =>
  armarAudit({ filas, identificadores: { r_number: 10, job_number: "EX-00110" }, nombres: SIN_NOMBRES, zona: "America/New_York", ahora: AHORA });
const unaFila = (f: FilaDeAudit) => vista([f]).filas[0]!;
const texto = (f: FilaDeAudit) => {
  const { evento, complemento } = unaFila(f);
  return [evento, complemento].filter(Boolean).join(" ");
};

describe("Delayed en Audit (OPS-010)", () => {
  const abre = (extra: Partial<FilaDeAudit> = {}) =>
    fila({
      event_type: "alert_opened",
      label: "Alert opened",
      actor_kind: "bzzzbx",
      alerta_regla: "OPS-010",
      alerta_nivel: "red",
      alerta_texto: "Not started by 1:00 PM.",
      ...extra,
    });
  const resuelve = (extra: Partial<FilaDeAudit> = {}) =>
    fila({
      event_type: "alert_resolved",
      label: "Alert resolved",
      actor_kind: "bzzzbx",
      alerta_regla: "OPS-010",
      alerta_nivel: "red",
      alerta_resolucion: "auto_cleared",
      ...extra,
    });

  it("alert_opened se lee 'Delayed · <el texto de Signal Maker>', tal como llegó", () => {
    expect(texto(abre())).toBe("Delayed · Not started by 1:00 PM.");
    // La hora sale del texto de la alerta, no de opsRUN (P-7).
    expect(texto(abre({ alerta_texto: "Not started by 2:30 PM." }))).toBe("Delayed · Not started by 2:30 PM.");
  });

  it("sin texto de Signal Maker dice solo Delayed", () => {
    expect(texto(abre({ alerta_texto: null }))).toBe("Delayed");
    expect(texto(abre({ alerta_texto: "   " }))).toBe("Delayed");
  });

  it("alert_resolved automático se lee 'Started · Delayed cleared'", () => {
    expect(texto(resuelve())).toBe("Started · Delayed cleared");
  });

  it("las dos líneas llevan la marca Observed y la persona BzzzBX, aunque el registrador las escriba con el origen de opsRUN", () => {
    const v = vista([abre(), resuelve()]);
    expect(v.filas.map((f) => [f.observado, f.persona])).toEqual([
      [true, "BzzzBX"],
      [true, "BzzzBX"],
    ]);
    expect(textoDeLaVista(v)).toContain("Observed");
  });

  it("las demás alertas y las demás resoluciones de Delayed no llevan la marca (como hasta ahora)", () => {
    expect(unaFila(fila({ event_type: "alert_opened", label: "Alert opened", actor_kind: "bzzzbx", alerta_regla: "OPS-001", alerta_nivel: "amber" })).observado).toBe(false);
    expect(unaFila(resuelve({ alerta_resolucion: "cleared_by_operator" })).observado).toBe(false);
  });

  it("una resolución distinta de la automática se ve como las demás alertas", () => {
    expect(texto(resuelve({ alerta_resolucion: "cleared_by_operator" }))).toBe("Alert resolved · OPS-010 Delayed · Red · Cleared by operator");
    expect(texto(resuelve({ alerta_resolucion: "fixed_by_action" }))).toBe("Alert resolved · OPS-010 Delayed · Red · Fixed by action");
  });

  it("las demás reglas se ven como hoy", () => {
    expect(texto(fila({ event_type: "alert_opened", label: "Alert opened", alerta_regla: "OPS-001", alerta_nivel: "amber", alerta_texto: "Unassigned for 15 min." }))).toBe(
      "Alert opened · OPS-001 Unassigned request · Amber · Unassigned for 15 min.",
    );
    expect(texto(fila({ event_type: "alert_resolved", label: "Alert resolved", alerta_regla: "MEC-003", alerta_nivel: "amber", alerta_resolucion: "auto_cleared" }))).toBe(
      "Alert resolved · MEC-003 Running long · Amber · Cleared automatically",
    );
  });

  it("el orden en una request que se limpia con el check-in: Delayed, Checked in y Started · Delayed cleared", () => {
    const v = vista([
      abre({ occurred_at: "2026-11-27T18:00:00.000000Z" }),
      fila({ event_type: "job_checked_in", label: "Checked in", source: "bzzzbx_observed", actor_kind: "bzzzbx", occurred_at: "2026-11-27T18:30:00.000000Z" }),
      resuelve({ occurred_at: "2026-11-27T18:31:00.000000Z" }),
    ]);
    expect(v.filas.map((f) => [f.evento, f.complemento].filter(Boolean).join(" "))).toEqual([
      "Delayed · Not started by 1:00 PM.",
      "Checked in",
      "Started · Delayed cleared",
    ]);
  });
});

describe("Change linked job y la cancelación observada en Audit", () => {
  it("job_relinked dice 'from … to …' y lleva el motivo y la persona", () => {
    const f = unaFila(
      fila({
        event_type: "job_relinked",
        label: "Linked job changed",
        actor_kind: "operator",
        actor_nombre: "Ops Uno",
        reason: "PINCH replaced the job.",
        job_anterior_number: "EX-00111",
        job_nuevo_number: "EX-00112",
      }),
    );
    expect([f.evento, f.complemento, f.persona, f.motivo, f.observado]).toEqual([
      "Linked job changed",
      "from EX-00111 to EX-00112",
      "Ops Uno",
      "PINCH replaced the job.",
      false,
    ]);
  });

  it("sin los números, job_relinked solo dice su label", () => {
    expect(unaFila(fila({ event_type: "job_relinked", label: "Linked job changed", actor_kind: "operator", actor_nombre: "Ops Uno", reason: "x" })).complemento).toBeNull();
  });

  it("job_cancel_observed lleva la marca Observed, sin persona de opsRUN ni motivo", () => {
    const f = unaFila(fila({ event_type: "job_cancel_observed", label: "Job cancelled", source: "bzzzbx_observed", actor_kind: "bzzzbx" }));
    expect([f.evento, f.complemento, f.persona, f.motivo, f.observado]).toEqual(["Job cancelled", null, "BzzzBX", null, true]);
  });
});
