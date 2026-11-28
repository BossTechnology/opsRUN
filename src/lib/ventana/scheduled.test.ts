// @vitest-environment node
/**
 * La Job window en Scheduled (OPR-29, spec §4, §5.2 y §8): el chip Delayed del encabezado, la fila Linked job, la
 * fecha que cambia en PINCH, y los candidatos de Change linked job que arma el servidor.
 */
import { describe, expect, it } from "vitest";

import type { AlertResult } from "../bzzzbx/tipos";
import { proponerEnlaces, type DependenciasDeEnlace } from "../fase-a/enlace";
import { crearFalso, RelojManual } from "../bzzzbx/falso";

import { armarVentana, type EntradaVentana } from "./armar";
import { candidatosParaElCambio } from "./propuesta";
import { CONFIRMACIONES_COMPLETAS, filaVentana, leidosVentanaDelFalso, OPERADORES_DE_PRUEBA, SIN_CONFIRMACIONES } from "./prueba-datos";

const AHORA = new Date("2026-11-24T18:00:00Z");

function entrada(n: number, parche: Partial<EntradaVentana> = {}): EntradaVentana {
  return {
    fila: filaVentana(AHORA, n),
    leidos: leidosVentanaDelFalso(AHORA),
    hilos: [`bx-thread-000${n}`],
    operadores: OPERADORES_DE_PRUEBA,
    confirmaciones: n === 1 ? SIN_CONFIRMACIONES : CONFIRMACIONES_COMPLETAS,
    instruccionAbierta: false,
    ahora: AHORA,
    zona: "UTC",
    bzzzbx: { disponible: true, actualizadoEn: AHORA.toISOString() },
    tab: null,
    ...parche,
  };
}

const OPS010: AlertResult = {
  bzzzbx_alert_id: "bx-alert-9010",
  sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0003" },
  rule_id: "OPS-010",
  rule_version: "1",
  level: "red",
  reason_text: "Not started by 1:00 PM.",
  opened_at: "2026-11-24T18:00:00.000Z",
  cleared_at: null,
};

function conOps010(n = 3, extra: Partial<EntradaVentana> = {}): EntradaVentana {
  const e = entrada(n, extra);
  return { ...e, leidos: { ...e.leidos, alertas: [...e.leidos.alertas, OPS010] } };
}

describe("encabezado.delayed: el chip gris Delayed (S-7)", () => {
  it("solo en Scheduled con OPS-010 abierta", () => {
    expect(armarVentana(conOps010()).encabezado.delayed).toBe(true);
    expect(armarVentana(entrada(3)).encabezado.delayed).toBe(false);
  });

  it("con OPS-010 cerrada en BzzzBX no hay chip", () => {
    const e = entrada(3);
    e.leidos = { ...e.leidos, alertas: [...e.leidos.alertas, { ...OPS010, cleared_at: "2026-11-24T18:30:00.000Z" }] };
    expect(armarVentana(e).encabezado.delayed).toBe(false);
  });

  it("con el check-in sale aunque la alerta siga abierta (S-10): la etapa ya es In Progress", () => {
    const e = conOps010();
    e.leidos = {
      ...e.leidos,
      eventos: [...e.leidos.eventos, { bzzzbx_event_id: "bx-evt-9010", bzzzbx_job_id: "bx-job-0003", kind: "checked_in", occurred_at: AHORA.toISOString() }],
    };
    const v = armarVentana(e);
    expect(v.etapa).toBe("in_progress");
    expect(v.encabezado.delayed).toBe(false);
  });

  it("no sale en otras etapas ni con el job cancelado", () => {
    expect(armarVentana(conOps010(4)).encabezado.delayed).toBe(false);
    const e = conOps010();
    e.leidos = { ...e.leidos, jobs: e.leidos.jobs.map((j) => (j.bzzzbx_job_id === "bx-job-0003" ? { ...j, status: "cancelled" as const } : j)) };
    const v = armarVentana(e);
    expect(v.etapa).toBe("cancelled");
    expect(v.encabezado.delayed).toBe(false);
  });

  it("la ventana abre en Alerts porque OPS-010 pide acción, y el chip no es una alerta más", () => {
    const v = armarVentana(conOps010());
    expect(v.inicial).toEqual({ id: "alerts", porRegla: true });
    expect(v.alertas.map((a) => a.regla)).toEqual(["OPS-010"]);
  });
});

describe("la fila Linked job de la pestaña de la propiedad", () => {
  it("dice el job number y quién lo enlazó y cuándo, en la zona de la operación", () => {
    const campo = armarVentana(entrada(3)).propiedad.campos.find((c) => c.clave === "linked");
    expect(campo).toEqual({ clave: "linked", etiqueta: "Linked job", valor: "EX-00003 · Linked Nov 23 by Ops Uno", noEncontrado: false });
  });

  it("después de un Change linked job dice el job nuevo y quién lo cambió", () => {
    const e = entrada(3);
    e.fila = { ...e.fila, job_number: "EX-00112", bzzzbx_job_id: "bx-job-0112", linked_at: "2026-11-24T17:00:00.000Z", linked_by_nombre: "Ops Dos" };
    expect(armarVentana(e).propiedad.campos.find((c) => c.clave === "linked")!.valor).toBe("EX-00112 · Linked Nov 24 by Ops Dos");
  });

  it("una request en Requests no tiene fila Linked job", () => {
    expect(armarVentana(entrada(2)).propiedad.campos.some((c) => c.clave === "linked")).toBe(false);
  });

  it("sin dato de Audit dice solo el job number", () => {
    const e = entrada(3);
    e.fila = { ...e.fila, linked_at: null, linked_by_nombre: null };
    expect(armarVentana(e).propiedad.campos.find((c) => c.clave === "linked")!.valor).toBe("EX-00003");
  });
});

describe("una fecha cambiada en PINCH se ve sola", () => {
  it("el encabezado y la fila Date and window muestran la nueva", () => {
    const e = entrada(3);
    e.leidos = {
      ...e.leidos,
      jobs: e.leidos.jobs.map((j) =>
        j.bzzzbx_job_id === "bx-job-0003" ? { ...j, service_date: "2026-11-30", window_start: "13:00", window_end: "16:00" } : j,
      ),
    };
    const v = armarVentana(e);
    expect(v.encabezado.linea.fecha).toBe("Mon, Nov 30 · 1:00 PM–4:00 PM");
    expect(v.propiedad.campos.find((c) => c.clave === "date")!.valor).toBe("Mon, Nov 30 · 1:00 PM–4:00 PM");
  });
});

describe("los candidatos de Change linked job (§8.1)", () => {
  function propuestaDe() {
    const falso = crearFalso({ reloj: new RelojManual(AHORA) });
    const fila = {
      id: "b0000000-0000-4000-8000-0000000000a3",
      status: "scheduled" as const,
      // R11 de la seed: enlazada a bx-job-0111, con bx-job-0112 de la misma propiedad y cliente en otro día.
      bzzzbx_job_id: "bx-job-0111",
      change_seq: "111",
      received_at: new Date(AHORA.getTime() - 86_400_000).toISOString(),
      bzzzbx_customer_id: "bx-cust-0002",
      bzzzbx_property_id: "bx-prop-0006",
      service_date: new Date(AHORA.getTime() + 86_400_000).toISOString().slice(0, 10),
      window_start: "09:00",
      window_end: "12:00",
      bzzzbx_team_id: "bx-team-0002",
    };
    const deps: DependenciasDeEnlace = {
      lectura: falso.lectura,
      datos: {
        leerRequest: async () => fila,
        jobsEnlazadosAOtra: async () => new Set(),
        jobsRechazados: async () => new Set(),
        jobsReenlazados: async () => new Set(),
        enlazar: async () => {},
        rechazar: async () => {},
        cambiar: async () => {},
      },
    };
    return { deps, id: fila.id };
  }

  it("se arman como texto para el panel, con el cleaner y por qué coinciden", async () => {
    const { deps, id } = propuestaDe();
    const propuesta = await proponerEnlaces(deps, id, { paraCambio: true });
    if ("error" in propuesta) throw new Error("no debía fallar");
    const { candidatosDeCambio, candidatosTruncado } = candidatosParaElCambio(propuesta, { "bx-team-0002": "Team Beta" });
    expect(candidatosTruncado).toBe(false);
    // El actual (bx-job-0111) no se ofrece; el otro job de la propiedad (bx-job-0112), sí.
    expect(candidatosDeCambio.map((c) => c.bzzzbxJobId)).not.toContain("bx-job-0111");
    const otro = candidatosDeCambio.find((c) => c.bzzzbxJobId === "bx-job-0112");
    expect(otro).toMatchObject({ jobNumber: "EX-00112", cleaner: "Team Beta", coincide: expect.arrayContaining(["misma_propiedad", "mismo_cliente"]) });
    expect(otro!.fecha).toMatch(/1:00 PM–4:00 PM$/);
  });

  it("con BzzzBX caído no hay candidatos", () => {
    expect(candidatosParaElCambio({ error: "bzzzbx_no_disponible" })).toEqual({ candidatosDeCambio: [], candidatosTruncado: false });
  });

  it("llegan a la ventana y a sus bloqueos", () => {
    const e = entrada(3, {
      candidatosDeCambio: [{ bzzzbxJobId: "bx-job-x", jobNumber: "EX-X", fecha: "Nov 28", cleaner: "— —", coincide: ["misma_propiedad"], sugerido: true }],
      candidatosTruncado: true,
    });
    const v = armarVentana(e);
    expect(v.datos.candidatosDeCambio).toHaveLength(1);
    expect(v.datos.candidatosTruncado).toBe(true);
    expect(armarVentana(entrada(3)).datos.candidatosDeCambio).toEqual([]);
  });
});
