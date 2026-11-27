// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { JobTrackerEvent, Photo } from "../bzzzbx/tipos";

import { armarTracker, duracionTexto, type EntradaTracker } from "./armar";

const R = "b0000000-0000-4000-8000-0000000000a4";
const JOB = { service_date: "2026-11-27", window_start: "10:00", window_end: "14:00" };
const AHORA = new Date("2026-11-27T16:00:00Z");

const ev = (kind: JobTrackerEvent["kind"], occurred_at: string, id = `${kind}-${occurred_at}`): JobTrackerEvent => ({
  bzzzbx_event_id: id,
  bzzzbx_job_id: "bx-job-0004",
  kind,
  occurred_at,
});
const foto = (id: string, phase: Photo["phase"], taken_at: string): Photo => ({
  bzzzbx_photo_id: id,
  bzzzbx_job_id: "bx-job-0004",
  phase,
  taken_at,
  ref: `stand-in:photo/${id}`,
});

function armar(parche: Partial<EntradaTracker> = {}) {
  return armarTracker({
    requestId: R,
    etapa: "In Progress",
    job: JOB,
    eventos: [],
    fotos: [],
    alertas: [],
    ahora: AHORA,
    zona: "America/New_York",
    bzzzbxDisponible: true,
    ...parche,
  });
}

describe("armarTracker: llegada, inicio, fin y duración (OPR-30 §4.1)", () => {
  it("muestra las horas en la zona de la operación, con fecha, y la ventana en una fila con el estado", () => {
    const v = armar({
      eventos: [ev("checked_in", "2026-11-27T15:00:00Z"), ev("started", "2026-11-27T15:05:00Z")],
    });
    expect(v.etapa).toBe("In Progress");
    expect(v.ventana).toBe("Fri, Nov 27 · 10:00 AM–2:00 PM");
    expect(v.llegada).toBe("Nov 27, 10:00 AM");
    expect(v.inicio).toBe("Nov 27, 10:05 AM");
    expect(v.fin).toBe("— —");
  });

  it("sin eventos todo es `— —`, la duración también, y la esperada sigue saliendo de la ventana", () => {
    const v = armar();
    expect([v.llegada, v.inicio, v.fin, v.duracion.valor]).toEqual(["— —", "— —", "— —", "— —"]);
    expect(v.duracion).toEqual({ valor: "— —", corriendo: false, esperada: "4h 00m" });
  });

  it("job en curso: la duración es ahora − inicio y dice que corre", () => {
    const v = armar({ eventos: [ev("started", "2026-11-27T15:05:00Z")] });
    // 15:05 a 16:00: 55 minutos.
    expect(v.duracion).toEqual({ valor: "55m", corriendo: true, esperada: "4h 00m" });
  });

  it("job terminado: la duración es fin − inicio y ya no corre, aunque `ahora` siga andando", () => {
    const eventos = [ev("started", "2026-11-27T15:05:00Z"), ev("completed", "2026-11-27T17:35:00Z")];
    const v = armar({ eventos, ahora: new Date("2026-11-28T09:00:00Z") });
    expect(v.fin).toBe("Nov 27, 12:35 PM");
    expect(v.duracion).toEqual({ valor: "2h 30m", corriendo: false, esperada: "4h 00m" });
  });

  it("con eventos repetidos del mismo tipo vale el primero (S-3)", () => {
    const v = armar({
      eventos: [ev("started", "2026-11-27T15:30:00Z", "b"), ev("started", "2026-11-27T15:05:00Z", "a"), ev("started", "2026-11-27T15:50:00Z", "c")],
    });
    expect(v.inicio).toBe("Nov 27, 10:05 AM");
  });

  it("el fin a mano de opsRUN vale solo si el Job Tracker no trae `completed`", () => {
    const sinCompleted = armar({ eventos: [ev("started", "2026-11-27T15:05:00Z")], finAMano: "2026-11-27T17:00:00Z" });
    expect(sinCompleted.fin).toBe("Nov 27, 12:00 PM");
    expect(sinCompleted.duracion.corriendo).toBe(false);
    const conCompleted = armar({
      eventos: [ev("started", "2026-11-27T15:05:00Z"), ev("completed", "2026-11-27T17:35:00Z")],
      finAMano: "2026-11-27T17:00:00Z",
    });
    expect(conCompleted.fin).toBe("Nov 27, 12:35 PM");
  });

  it("una duración negativa (reloj torcido) se pinta como 0m, nunca negativa", () => {
    const v = armar({ eventos: [ev("started", "2026-11-27T16:30:00Z")], ahora: new Date("2026-11-27T16:00:00Z") });
    expect(v.duracion.valor).toBe("0m");
  });

  it("sin job leído (BzzzBX caído y sin nada antes): ventana y esperada `— —`", () => {
    const v = armar({ job: undefined });
    expect(v.ventana).toBe("— —");
    expect(v.duracion.esperada).toBe("— —");
  });

  it("zona horaria a los dos lados de un cambio de horario: el mismo instante UTC sale distinto antes y después", () => {
    // El domingo 1 de noviembre de 2026 termina el horario de verano en Nueva York (UTC−4 → UTC−5).
    const antes = armar({ eventos: [ev("started", "2026-11-01T05:30:00Z")], ahora: new Date("2026-11-01T12:00:00Z") });
    const despues = armar({ eventos: [ev("started", "2026-11-01T06:30:00Z")], ahora: new Date("2026-11-01T12:00:00Z") });
    expect(antes.inicio).toBe("Nov 1, 1:30 AM"); // UTC−4
    expect(despues.inicio).toBe("Nov 1, 1:30 AM"); // UTC−5: la misma hora de reloj, una hora UTC después
    // La duración no depende de la zona: es la diferencia de instantes.
    expect(antes.duracion.valor).toBe("6h 30m");
    expect(despues.duracion.valor).toBe("5h 30m");
  });

  it("la zona de la operación mueve la hora y el día, no la duración", () => {
    const eventos = [ev("started", "2026-11-27T03:30:00Z"), ev("completed", "2026-11-27T05:00:00Z")];
    expect(armar({ eventos, zona: "UTC" }).inicio).toBe("Nov 27, 3:30 AM");
    expect(armar({ eventos, zona: "America/New_York" }).inicio).toBe("Nov 26, 10:30 PM");
    expect(armar({ eventos, zona: "UTC" }).duracion.valor).toBe(armar({ eventos, zona: "America/New_York" }).duracion.valor);
  });
});

describe("armarTracker: Running long", () => {
  it("el chip sale con una MEC-003 abierta y no con otra regla", () => {
    expect(armar({ alertas: [{ rule_id: "MEC-003" }] }).runningLong).toBe(true);
    expect(armar({ alertas: [{ rule_id: "OPS-010" }] }).runningLong).toBe(false);
    expect(armar().runningLong).toBe(false);
  });
});

describe("armarTracker: fotos (OPR-30 §4.2)", () => {
  it("agrupa Before y After y las ordena por taken_at", () => {
    const v = armar({
      fotos: [
        foto("p3", "after", "2026-11-27T19:00:00Z"),
        foto("p2", "before", "2026-11-27T15:10:00Z"),
        foto("p1", "before", "2026-11-27T15:00:00Z"),
        foto("p4", "after", "2026-11-27T18:50:00Z"),
      ],
    });
    expect(v.fotos.before.map((f) => f.id)).toEqual(["p1", "p2"]);
    expect(v.fotos.after.map((f) => f.id)).toEqual(["p4", "p3"]);
  });

  it("cada miniatura trae su alt con la fase y la hora, y su ruta del servidor con la request", () => {
    const v = armar({ fotos: [foto("bx-photo-0001", "before", "2026-11-27T15:05:00Z")] });
    expect(v.fotos.before[0]).toEqual({
      id: "bx-photo-0001",
      fase: "before",
      alt: "Before photo, Nov 27, 10:05 AM",
      hora: "Nov 27, 10:05 AM",
      src: `/api/fotos/bx-photo-0001?request=${R}`,
    });
  });

  it("sin fotos: los dos grupos vacíos", () => {
    expect(armar().fotos).toEqual({ before: [], after: [] });
  });

  it("con BzzzBX caído las miniaturas no están disponibles", () => {
    expect(armar({ bzzzbxDisponible: false }).fotosDisponibles).toBe(false);
    expect(armar().fotosDisponibles).toBe(true);
  });

  it("nunca guarda ni expone la ref de BzzzBX: la vista no la trae", () => {
    const v = armar({ fotos: [foto("p1", "before", "2026-11-27T15:00:00Z")] });
    expect(JSON.stringify(v)).not.toContain("stand-in:photo");
  });
});

describe("duracionTexto", () => {
  it.each([
    [0, "0m"],
    [59_000, "0m"],
    [45 * 60_000, "45m"],
    [60 * 60_000, "1h 00m"],
    [65 * 60_000, "1h 05m"],
    [4 * 60 * 60_000, "4h 00m"],
    [-5 * 60_000, "0m"],
  ])("%d ms es %s", (ms, texto) => {
    expect(duracionTexto(ms)).toBe(texto);
  });
});
