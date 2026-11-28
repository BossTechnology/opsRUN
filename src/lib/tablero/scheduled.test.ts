// @vitest-environment node
/**
 * La etapa Scheduled en el tablero (OPR-29, spec §4 y §5): fecha y ventana del job bajo el número, "Delayed" con
 * OPS-010 abierta (la calcula Signal Maker; opsRUN solo la lee), el check-in que la quita aunque la alerta siga
 * abierta (S-10), el job cancelado fuera del tablero y la fecha de PINCH que se ve sola al cambiar.
 */
import { describe, expect, it } from "vitest";

import { armarTablero } from "./armar";
import { filasDeLaSeed, leidosDelFalso } from "./prueba-datos";
import type { Leidos, Tablero } from "./tipos";

const AHORA = new Date("2026-11-24T18:00:00Z");

const armar = (leidos: Leidos): Tablero =>
  armarTablero({ filas: filasDeLaSeed(AHORA), leidos, ahora: AHORA, zona: "UTC", bzzzbx: { disponible: true, actualizadoEn: AHORA.toISOString() } });

const tarjetas = (t: Tablero) => t.columnas.flatMap((c) => [...c.tarjetas, ...c.pagadas]);
const tarjeta = (t: Tablero, numero: string) => tarjetas(t).find((x) => x.numero === numero);

const OPS010 = {
  bzzzbx_alert_id: "bx-alert-9010",
  sujeto: { tipo: "job" as const, bzzzbx_job_id: "bx-job-0003" },
  rule_id: "OPS-010",
  rule_version: "1",
  level: "red" as const,
  reason_text: "Not started by 1:00 PM.",
  opened_at: "2026-11-24T18:00:00.000Z",
  cleared_at: null,
};

describe("Scheduled en el tablero (OPR-29)", () => {
  it("muestra la fecha y la ventana del job bajo el número", () => {
    const t = armar(leidosDelFalso(AHORA));
    expect(tarjeta(t, "EX-00003")).toMatchObject({ etapa: "scheduled", estado: { tipo: "programada", texto: "Wed, Nov 25 · 10:00 AM–2:00 PM" } });
  });

  it("con OPS-010 abierta dice Delayed en lugar de la fecha, y se sombrea de rojo", () => {
    const leidos = leidosDelFalso(AHORA);
    leidos.alertas.push(OPS010);
    const t = tarjeta(armar(leidos), "EX-00003")!;
    expect(t.estado).toEqual({ tipo: "delayed", texto: "Delayed" });
    expect(t.color).toBe("sombreada");
    expect(t.alertas).toMatchObject({ total: 1, nivel: "red" });
  });

  it("con OPS-010 cerrada en BzzzBX vuelve a mostrar la fecha", () => {
    const leidos = leidosDelFalso(AHORA);
    leidos.alertas.push({ ...OPS010, cleared_at: "2026-11-24T18:30:00.000Z" });
    expect(tarjeta(armar(leidos), "EX-00003")!.estado).toMatchObject({ tipo: "programada" });
  });

  it("con el check-in y OPS-010 todavía abierta pasa a In Progress sin Delayed (S-10)", () => {
    const leidos = leidosDelFalso(AHORA);
    leidos.alertas.push(OPS010);
    leidos.eventos.push({ bzzzbx_event_id: "bx-evt-9010", bzzzbx_job_id: "bx-job-0003", kind: "checked_in", occurred_at: AHORA.toISOString() });
    const t = tarjeta(armar(leidos), "EX-00003")!;
    expect(t.etapa).toBe("in_progress");
    expect(t.estado.tipo).toBe("en_curso");
  });

  it("un job cancelado en PINCH no tiene tarjeta", () => {
    const leidos = leidosDelFalso(AHORA);
    leidos.jobs = leidos.jobs.map((j) => (j.bzzzbx_job_id === "bx-job-0003" ? { ...j, status: "cancelled" as const } : j));
    expect(tarjeta(armar(leidos), "EX-00003")).toBeUndefined();
  });

  it("una fecha cambiada en el job (reprogramado en PINCH) cambia el texto de la tarjeta, sin que opsRUN guarde nada", () => {
    const leidos = leidosDelFalso(AHORA);
    leidos.jobs = leidos.jobs.map((j) =>
      j.bzzzbx_job_id === "bx-job-0003" ? { ...j, service_date: "2026-11-30", window_start: "13:00", window_end: "16:00" } : j,
    );
    expect(tarjeta(armar(leidos), "EX-00003")!.estado).toEqual({ tipo: "programada", texto: "Mon, Nov 30 · 1:00 PM–4:00 PM" });
  });
});
