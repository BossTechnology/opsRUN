import { describe, expect, it } from "vitest";

import { armarAudit, idsParaNombres, textoDeLaVista } from "./armar";
import { SIN_NOMBRES, type FilaDeAudit, type Nombres } from "./tipos";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

let n = 0;
/** Una fila de Audit con lo mínimo; cada prueba pone lo suyo. */
function fila(parcial: Partial<FilaDeAudit> & Pick<FilaDeAudit, "event_type">): FilaDeAudit {
  n += 1;
  return {
    id: String(n),
    label: parcial.event_type,
    source: "opsrun",
    actor_kind: "system",
    actor_nombre: null,
    reason: null,
    occurred_at: "2026-11-25T14:30:00.000000Z",
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

describe("armarAudit: las etapas (OPR-30 a OPR-32)", () => {
  const complemento = (f: FilaDeAudit) => armarAudit({ filas: [f], identificadores: { r_number: 3, job_number: "EX-00003" }, nombres: SIN_NOMBRES, zona: "UTC", ahora: new Date("2026-11-27T15:00:00Z") }).filas[0]!.complemento;

  it("Marked as OSS / Not OSS dice cuál se marcó; la marca automática de la seed no trae complemento", () => {
    expect(complemento(fila({ event_type: "oss_marked", actor_kind: "operator", actor_nombre: "Ops Uno", marca_oss: "oss" }))).toBe("· OSS");
    expect(complemento(fila({ event_type: "oss_marked", actor_kind: "operator", actor_nombre: "Ops Uno", marca_oss: "not_oss" }))).toBe("· Not OSS");
    expect(complemento(fila({ event_type: "oss_marked" }))).toBeNull();
  });

  it("PO entered dice el PO que escribió el operador", () => {
    expect(complemento(fila({ event_type: "po_entered", actor_kind: "operator", actor_nombre: "Ops Uno", po_numero: "PO-EX-0108" }))).toBe("· PO PO-EX-0108");
    expect(complemento(fila({ event_type: "po_entered" }))).toBeNull();
  });

  it("Alert cleared lleva la regla con su nombre, el nivel y 'Cleared by operator', y el motivo", () => {
    const f = fila({
      event_type: "alert_cleared", actor_kind: "operator", actor_nombre: "Ops Uno", reason: "Large unit.",
      alerta_regla: "MEC-003", alerta_nivel: "amber", alerta_resolucion: "cleared_by_operator",
    });
    const vista = armarAudit({ filas: [f], identificadores: { r_number: 3, job_number: "EX-00003" }, nombres: SIN_NOMBRES, zona: "UTC", ahora: new Date("2026-11-27T15:00:00Z") }).filas[0]!;
    expect(vista.complemento).toBe("· MEC-003 Running long · Amber · Cleared by operator");
    expect(vista.motivo).toBe("Large unit.");
    expect(vista.persona).toBe("Ops Uno");
  });

  it("los hechos observados (Checked in, Started, Completed, Paid) salen marcados como observados, de BzzzBX y sin complemento", () => {
    for (const tipo of ["job_checked_in", "job_started", "job_completed", "job_paid"]) {
      const v = armarAudit({
        filas: [fila({ event_type: tipo, source: "bzzzbx_observed", actor_kind: "bzzzbx" })],
        identificadores: { r_number: 3, job_number: "EX-00003" }, nombres: SIN_NOMBRES, zona: "UTC", ahora: new Date("2026-11-27T15:00:00Z"),
      }).filas[0]!;
      expect(v.observado, tipo).toBe(true);
      expect(v.persona, tipo).toBe("BzzzBX");
      expect(v.complemento, tipo).toBeNull();
    }
  });
});
const IDS = { r_number: 3, job_number: "EX-00003" };
const armar = (filas: FilaDeAudit[], extra: { nombres?: Nombres; zona?: string; ahora?: Date } = {}) =>
  armarAudit({ filas, identificadores: IDS, nombres: extra.nombres ?? SIN_NOMBRES, zona: extra.zona ?? "UTC", ahora: extra.ahora ?? AHORA });

const NOMBRES: Nombres = {
  disponible: true,
  job: { "bx-job-0102": "EX-00102" },
  cleaner_team: { "bx-team-0001": "Team Alpha", "bx-team-0003": "Team Gamma" },
  property: { "bx-prop-0001": "Example Tower" },
  service: { "bx-svc-0001": "Standard clean" },
};

describe("armarAudit: identificadores", () => {
  it("R number, Job number y Work App number (P-7: el mismo valor)", () => {
    const v = armar([]);
    expect(v).toMatchObject({ request: "R3", jobNumber: "EX-00003", workAppNumber: "EX-00003" });
  });

  it("lo que falta se ve — —", () => {
    const v = armarAudit({ filas: [], identificadores: { r_number: 7, job_number: null }, nombres: SIN_NOMBRES, zona: "UTC", ahora: AHORA });
    expect(v).toMatchObject({ request: "R7", jobNumber: "— —", workAppNumber: "— —" });
  });

  it("Times in <abreviatura de la zona>", () => {
    expect(armar([], { zona: "UTC" }).zona).toBe("Times in UTC");
    expect(armar([], { zona: "America/New_York" }).zona).toBe("Times in EST");
    // En horario de verano la abreviatura cambia.
    expect(armar([], { zona: "America/New_York", ahora: new Date("2026-07-01T15:00:00Z") }).zona).toBe("Times in EDT");
  });
});

describe("armarAudit: orden (P-4)", () => {
  it("del más viejo al más nuevo, y a igual hora por id, aunque lleguen desordenadas", () => {
    const filas = [
      fila({ id: "12", event_type: "c", occurred_at: "2026-11-25T10:00:00.000000Z" }),
      fila({ id: "9", event_type: "b", occurred_at: "2026-11-25T10:00:00.000000Z" }),
      fila({ id: "30", event_type: "a", occurred_at: "2026-11-24T10:00:00.000000Z" }),
      fila({ id: "2", event_type: "d", occurred_at: "2026-11-26T10:00:00.000000Z" }),
    ];
    expect(armar(filas).filas.map((f) => f.tipo)).toEqual(["a", "b", "c", "d"]);
  });

  it("el id se compara como número, no como texto", () => {
    const filas = [fila({ id: "100", event_type: "x" }), fila({ id: "99", event_type: "y" })];
    expect(armar(filas).filas.map((f) => f.tipo)).toEqual(["y", "x"]);
  });

  it("los microsegundos desempatan", () => {
    const filas = [
      fila({ id: "1", event_type: "tarde", occurred_at: "2026-11-25T10:00:00.000900Z" }),
      fila({ id: "2", event_type: "temprano", occurred_at: "2026-11-25T10:00:00.000100Z" }),
    ];
    expect(armar(filas).filas.map((f) => f.tipo)).toEqual(["temprano", "tarde"]);
  });
});

describe("armarAudit: persona (P-3)", () => {
  const persona = (p: Partial<FilaDeAudit>) => armar([fila({ event_type: "t", ...p })]).filas[0]!.persona;

  it("operador: su nombre; un operador desactivado también", () => {
    expect(persona({ actor_kind: "operator", actor_nombre: "Ops Uno" })).toBe("Ops Uno");
    expect(persona({ actor_kind: "operator", actor_nombre: "Ex Operador" })).toBe("Ex Operador");
  });
  it("system es opsRUN, ai es AI y bzzzbx es BzzzBX", () => {
    expect(persona({ actor_kind: "system" })).toBe("opsRUN");
    expect(persona({ actor_kind: "ai" })).toBe("AI");
    expect(persona({ actor_kind: "bzzzbx" })).toBe("BzzzBX");
  });
});

describe("armarAudit: complementos", () => {
  const una = (p: Partial<FilaDeAudit> & { event_type: string }, nombres: Nombres = SIN_NOMBRES) =>
    armar([fila(p)], { nombres }).filas[0]!;

  it("el primer request_assigned es el Original y los demás no; muestra el destino", () => {
    const v = armar([
      fila({ id: "1", event_type: "request_assigned", label: "Assigned", a_operador: "Ops Dos", occurred_at: "2026-11-25T10:00:00.000000Z" }),
      fila({ id: "2", event_type: "request_reassigned", label: "Reassigned", de_operador: "Ops Dos", a_operador: "Ops Uno", occurred_at: "2026-11-25T11:00:00.000000Z" }),
      fila({ id: "3", event_type: "request_assigned", label: "Assigned", a_operador: "Ops Uno", occurred_at: "2026-11-25T12:00:00.000000Z" }),
    ]).filas;
    expect(v.map((f) => f.original)).toEqual([true, false, false]);
    expect(v[0]!.complemento).toBe("to Ops Dos");
    expect(v[1]!.complemento).toBe("from Ops Dos to Ops Uno");
    expect(v[2]!.complemento).toBe("to Ops Uno");
  });

  it("el Original es el primero en el tiempo, no en el arreglo", () => {
    const v = armar([
      fila({ id: "5", event_type: "request_assigned", a_operador: "B", occurred_at: "2026-11-25T12:00:00.000000Z" }),
      fila({ id: "4", event_type: "request_assigned", a_operador: "A", occurred_at: "2026-11-25T10:00:00.000000Z" }),
    ]).filas;
    expect(v.map((f) => [f.complemento, f.original])).toEqual([["to A", true], ["to B", false]]);
  });

  it("confirmaciones: por teléfono, por texto o sin método", () => {
    expect(una({ event_type: "cleaner_confirmed", metodo: "phone" }).complemento).toBe("· by phone");
    expect(una({ event_type: "cleaner_confirmed", metodo: "cleaner_text" }).complemento).toBe("· by text");
    expect(una({ event_type: "details_confirmed", metodo: "operator" }).complemento).toBeNull();
    expect(una({ event_type: "sender_confirmed" }).complemento).toBeNull();
  });

  it("request_scheduled, con y sin enlace", () => {
    expect(una({ event_type: "request_scheduled", job_number: "EX-00003" }).complemento).toBe("· job EX-00003");
    expect(una({ event_type: "request_scheduled", job_number: "EX-00107", modo: "linked" }).complemento).toBe(
      "· linked to observed job EX-00107",
    );
    expect(una({ event_type: "request_scheduled" }).complemento).toBeNull();
  });

  it("job_link_rejected con el nombre del puerto", () => {
    expect(una({ event_type: "job_link_rejected", bzzzbx_job_id: "bx-job-0102" }, NOMBRES).complemento).toBe("· job EX-00102");
  });

  it("job_link_rejected: BzzzBX respondió pero no conoce el job → a proposed job", () => {
    expect(una({ event_type: "job_link_rejected", bzzzbx_job_id: "bx-job-9999" }, NOMBRES).complemento).toBe("· a proposed job");
  });

  it("job_link_rejected con BzzzBX sin nombres → job — —", () => {
    expect(una({ event_type: "job_link_rejected", bzzzbx_job_id: "bx-job-0102" }).complemento).toBe("· job — —");
  });

  it("cleaner_asked, replied y declined llevan el nombre del cleaner; sin nombres, — —", () => {
    for (const t of ["cleaner_asked", "cleaner_replied", "cleaner_declined"]) {
      expect(una({ event_type: t, equipo_id: "bx-team-0001" }, NOMBRES).complemento).toBe("· Team Alpha");
      expect(una({ event_type: t, equipo_id: "bx-team-0001" }).complemento).toBe("· — —");
    }
  });

  it("alertas: regla, nombre y nivel; al abrir el motivo; al resolver cómo se resolvió", () => {
    const base = { alerta_regla: "OPS-001", alerta_nivel: "amber" as const, alerta_texto: "Unassigned for 15 min." };
    expect(una({ event_type: "alert_opened", ...base }).complemento).toBe(
      "· OPS-001 Unassigned request · Amber · Unassigned for 15 min.",
    );
    expect(una({ event_type: "alert_level_changed", ...base, alerta_nivel: "red" }).complemento).toBe("· OPS-001 Unassigned request · Red");
    expect(una({ event_type: "alert_resolved", ...base, alerta_resolucion: "auto_cleared" }).complemento).toBe(
      "· OPS-001 Unassigned request · Amber · Cleared automatically",
    );
    expect(una({ event_type: "alert_resolved", ...base, alerta_resolucion: "fixed_by_action" }).complemento).toContain("Fixed by action");
    expect(una({ event_type: "alert_cleared", ...base, alerta_resolucion: "cleared_by_operator" }).complemento).toContain("Cleared by operator");
  });

  it("una regla sin nombre en el código se ve con su código", () => {
    expect(una({ event_type: "alert_opened", alerta_regla: "XXX-999", alerta_nivel: "red" }).complemento).toBe("· XXX-999 · Red");
  });

  it("análisis de IA: n sugerencias, o trabajado a mano", () => {
    expect(una({ event_type: "ai_analysis_completed", sugerencias: 5 }).complemento).toBe("· 5 suggestions");
    expect(una({ event_type: "ai_analysis_completed", sugerencias: 1 }).complemento).toBe("· 1 suggestion");
    expect(una({ event_type: "ai_analysis_completed" }).complemento).toBeNull();
    expect(una({ event_type: "ai_analysis_failed" }).complemento).toBe("· worked by hand");
  });

  it("IA aceptada y rechazada: campo y valor; un crosswalk ID sale como el nombre del puerto", () => {
    expect(una({ event_type: "ai_suggestion_accepted", ia_campo: "property", ia_campo_label: "Property", ia_valor: "bx-prop-0001" }, NOMBRES).complemento).toBe(
      "· Property: Example Tower",
    );
    expect(una({ event_type: "ai_suggestion_rejected", ia_campo: "cleaner_team", ia_campo_label: "Cleaner", ia_valor: "bx-team-0003" }, NOMBRES).complemento).toBe(
      "· Cleaner: Team Gamma",
    );
    expect(una({ event_type: "ai_suggestion_accepted", ia_campo: "service", ia_campo_label: "Service", ia_valor: "bx-svc-0001" }, NOMBRES).complemento).toBe(
      "· Service: Standard clean",
    );
  });

  it("IA corregida: valor propuesto → valor final, escalares tal cual", () => {
    expect(una({ event_type: "ai_suggestion_corrected", ia_campo: "beds", ia_campo_label: "Beds", ia_valor: 3, ia_valor_final: 2 }).complemento).toBe(
      "· Beds: 3 → 2",
    );
    expect(una({ event_type: "ai_suggestion_corrected", ia_campo: "unit", ia_campo_label: "Unit", ia_valor: "4B", ia_valor_final: "4C" }).complemento).toBe(
      "· Unit: 4B → 4C",
    );
  });

  it("IA con crosswalk ID y BzzzBX sin nombres: — —, nunca el ID", () => {
    const c = una({ event_type: "ai_suggestion_corrected", ia_campo: "cleaner_team", ia_campo_label: "Cleaner", ia_valor: "bx-team-0001", ia_valor_final: "bx-team-0003" }).complemento;
    expect(c).toBe("· Cleaner: — — → — —");
  });

  it("un crosswalk ID de un campo que no resuelve el puerto tampoco se ve", () => {
    const c = una({ event_type: "ai_suggestion_accepted", ia_campo: "space", ia_campo_label: "Space", ia_valor: "bx-space-0002" }, NOMBRES).complemento;
    expect(c).toBe("· Space: — —");
  });

  it("un valor que no es escalar (objeto) no se muestra en crudo", () => {
    const c = una({ event_type: "ai_suggestion_accepted", ia_campo: "sender", ia_campo_label: "Who is it from?", ia_valor: { a: 1 } }).complemento;
    expect(c).toBe("· Who is it from?: — —");
  });

  it("acción fallida: el tipo de instrucción y el error", () => {
    expect(una({ event_type: "instruction_failed", instruccion_label: "Schedule", instruccion_error: "Property not found" }).complemento).toBe(
      "· Schedule · Property not found",
    );
  });

  it("note_added y los tipos no previstos: solo el label, la persona y el motivo (S-9)", () => {
    const f = una({ event_type: "tipo_nuevo_del_catalogo", label: "Something new", actor_kind: "operator", actor_nombre: "Ops Uno", reason: "Because." });
    expect(f).toMatchObject({ evento: "Something new", complemento: null, persona: "Ops Uno", motivo: "Because." });
    expect(una({ event_type: "note_added", label: "Note added" }).complemento).toBeNull();
  });
});

describe("armarAudit: motivo y observados", () => {
  it("el motivo sale cuando existe y no cuando falta o está vacío", () => {
    const v = armar([
      fila({ id: "1", event_type: "job_ended_manually", reason: "Cleaner finished but the app did not sync." }),
      fila({ id: "2", event_type: "oss_marked", reason: null }),
      fila({ id: "3", event_type: "x", reason: "   " }),
    ]).filas;
    expect(v.map((f) => f.motivo)).toEqual(["Cleaner finished but the app did not sync.", null, null]);
  });

  it("Observed solo en los hechos observados de PINCH", () => {
    const v = armar([
      fila({ id: "1", event_type: "job_checked_in", source: "bzzzbx_observed", actor_kind: "bzzzbx" }),
      fila({ id: "2", event_type: "po_entered", source: "opsrun", actor_kind: "operator", actor_nombre: "Finance Uno" }),
    ]).filas;
    expect(v.map((f) => f.observado)).toEqual([true, false]);
  });
});

describe("armarAudit: la hora (§6)", () => {
  const horaDe = (instante: string, zona: string, ahora = AHORA) =>
    armar([fila({ event_type: "t", occurred_at: instante })], { zona, ahora }).filas[0]!;

  it("con fecha siempre, en la zona de la operación", () => {
    expect(horaDe("2026-11-25T14:30:00.000000Z", "UTC").hora).toBe("Nov 25, 2:30 PM");
    expect(horaDe("2026-11-25T14:30:00.000000Z", "America/New_York").hora).toBe("Nov 25, 9:30 AM");
  });

  it("a ambos lados de un cambio de horario: la misma hora de reloj UTC no da la misma local", () => {
    // El horario de verano de EE. UU. terminó el 1 de noviembre de 2026 a las 2:00 AM locales.
    const antes = horaDe("2026-10-31T14:30:00.000000Z", "America/New_York");
    const despues = horaDe("2026-11-02T14:30:00.000000Z", "America/New_York");
    expect(antes.hora).toBe("Oct 31, 10:30 AM"); // EDT, UTC−4
    expect(despues.hora).toBe("Nov 2, 9:30 AM"); // EST, UTC−5
    expect(horaDe("2026-10-31T14:30:00.000000Z", "UTC").hora).toBe("Oct 31, 2:30 PM");
  });

  it("el año va delante si no es el año en curso en esa zona", () => {
    expect(horaDe("2025-11-25T14:30:00.000000Z", "UTC").hora).toBe("Nov 25, 2025, 2:30 PM");
    // 1 de enero 2027 en UTC es todavía 2026 en Nueva York.
    const finDeAnio = new Date("2027-01-01T03:00:00Z");
    expect(horaDe("2026-12-31T20:00:00.000000Z", "America/New_York", finDeAnio).hora).toBe("Dec 31, 3:00 PM");
    expect(horaDe("2026-12-31T20:00:00.000000Z", "UTC", finDeAnio).hora).toBe("Dec 31, 2026, 8:00 PM");
  });

  it("el instante en ISO UTC para <time datetime>", () => {
    expect(horaDe("2026-11-25T14:30:00.000000Z", "America/New_York").instante).toBe("2026-11-25T14:30:00.000Z");
  });
});

describe("armarAudit: BzzzBX sin nombres", () => {
  it("— — en lo de PINCH y el resto completo", () => {
    const v = armar([
      fila({ id: "1", event_type: "request_assigned", a_operador: "Ops Dos", actor_kind: "operator", actor_nombre: "Ops Uno" }),
      fila({ id: "2", event_type: "cleaner_asked", equipo_id: "bx-team-0001", actor_kind: "operator", actor_nombre: "Ops Uno", reason: "ask" }),
    ]).filas;
    expect(v[0]).toMatchObject({ complemento: "to Ops Dos", persona: "Ops Uno" });
    expect(v[1]).toMatchObject({ complemento: "· — —", persona: "Ops Uno", motivo: "ask" });
  });
});

describe("armarAudit: nada interno ni de Zendesk", () => {
  // Todos los tipos del catálogo, con datos que traen ids en cada lugar posible.
  const TIPOS = [
    "request_received", "request_assigned", "request_reassigned", "details_confirmed", "sender_confirmed", "cleaner_confirmed",
    "confirmation_superseded", "request_scheduled", "job_link_rejected", "cleaner_asked", "cleaner_replied", "cleaner_declined",
    "job_rescheduled", "job_cancelled", "job_ended_manually", "oss_marked", "job_approved", "po_entered", "job_validated",
    "job_checked_in", "job_started", "job_completed", "job_paid", "email_sent", "text_sent", "requester_notified", "note_added",
    "alert_opened", "alert_level_changed", "alert_resolved", "alert_cleared", "ai_analysis_completed", "ai_analysis_failed",
    "ai_suggestion_accepted", "ai_suggestion_corrected", "ai_suggestion_rejected", "instruction_failed", "tipo_desconocido",
  ];

  function todas(nombres: Nombres) {
    return armar(
      TIPOS.map((t) =>
        fila({
          event_type: t,
          label: t.replaceAll("_", " "),
          actor_kind: "operator",
          actor_nombre: "Ops Uno",
          a_operador: "Ops Dos",
          de_operador: "Ops Uno",
          metodo: "phone",
          modo: "linked",
          job_number: "EX-00003",
          bzzzbx_job_id: "bx-job-0102",
          sugerencias: 2,
          alerta_regla: "TRN-005",
          alerta_nivel: "amber",
          alerta_texto: "Customer requires a PO.",
          alerta_resolucion: "fixed_by_action",
          ia_campo: "property",
          ia_campo_label: "Property",
          ia_valor: "bx-prop-0001",
          ia_valor_final: "bx-prop-0001",
          instruccion_label: "Schedule",
          instruccion_error: "Property not found",
          equipo_id: "bx-team-0001",
        }),
      ),
      { nombres },
    );
  }

  it.each([
    ["con nombres", NOMBRES],
    ["sin nombres", SIN_NOMBRES],
  ])("ningún texto armado %s contiene bx-, un uuid ni zendesk", (_t, nombres) => {
    const texto = textoDeLaVista(todas(nombres));
    expect(texto).not.toMatch(/bx-/i);
    expect(texto).not.toMatch(UUID);
    expect(texto.toLowerCase()).not.toContain("zendesk");
    expect(texto.length).toBeGreaterThan(200);
  });
});

describe("idsParaNombres", () => {
  it("junta lo que hay que pedir al puerto, sin repetir", () => {
    const ids = idsParaNombres([
      fila({ event_type: "job_link_rejected", bzzzbx_job_id: "bx-job-0102" }),
      fila({ event_type: "job_link_rejected", bzzzbx_job_id: "bx-job-0102" }),
      fila({ event_type: "cleaner_asked", equipo_id: "bx-team-0001" }),
      fila({ event_type: "ai_suggestion_accepted", ia_campo: "property", ia_valor: "bx-prop-0001" }),
      fila({ event_type: "ai_suggestion_corrected", ia_campo: "cleaner_team", ia_valor: "bx-team-0001", ia_valor_final: "bx-team-0003" }),
      fila({ event_type: "ai_suggestion_accepted", ia_campo: "service", ia_valor: "bx-svc-0001" }),
      fila({ event_type: "ai_suggestion_accepted", ia_campo: "beds", ia_valor: 3 }),
    ]);
    expect(ids).toEqual({
      job: ["bx-job-0102"],
      cleaner_team: ["bx-team-0001", "bx-team-0003"],
      property: ["bx-prop-0001"],
      service: ["bx-svc-0001"],
    });
  });

  it("sin nada de PINCH, nada que pedir", () => {
    expect(idsParaNombres([fila({ event_type: "request_received" })])).toEqual({ job: [], cleaner_team: [], property: [], service: [] });
  });
});
