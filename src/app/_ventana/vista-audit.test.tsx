import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { armarAudit } from "@/lib/audit/armar";
import { SIN_NOMBRES, type FilaDeAudit } from "@/lib/audit/tipos";

import { VistaAuditPestana } from "./vista-audit";

afterEach(cleanup);

function fila(p: Partial<FilaDeAudit> & Pick<FilaDeAudit, "id" | "event_type" | "label" | "occurred_at">): FilaDeAudit {
  return {
    source: "opsrun",
    actor_kind: "system",
    actor_nombre: null,
    reason: null,
    a_operador: null,
    de_operador: null,
    metodo: null,
    modo: null,
    marca_oss: null,
    po_numero: null,
    job_number: null,
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
    ...p,
  };
}

const FILAS: FilaDeAudit[] = [
  fila({ id: "1", event_type: "request_received", label: "Request received", occurred_at: "2026-11-25T10:00:00.000000Z" }),
  fila({
    id: "2",
    event_type: "request_assigned",
    label: "Assigned",
    actor_kind: "operator",
    actor_nombre: "Ops Dos",
    a_operador: "Ops Dos",
    occurred_at: "2026-11-25T10:05:00.000000Z",
  }),
  fila({
    id: "3",
    event_type: "job_ended_manually",
    label: "Ended manually",
    actor_kind: "operator",
    actor_nombre: "Ops Dos",
    reason: "Cleaner finished but the app did not sync.",
    occurred_at: "2026-11-25T14:30:00.000000Z",
  }),
  fila({
    id: "4",
    event_type: "job_checked_in",
    label: "Checked in",
    source: "bzzzbx_observed",
    actor_kind: "bzzzbx",
    occurred_at: "2026-11-25T15:00:00.000000Z",
  }),
];

const pintar = (filas = FILAS) =>
  render(
    <VistaAuditPestana
      etapa="scheduled"
      vista={armarAudit({
        filas,
        identificadores: { r_number: 3, job_number: "EX-00003" },
        nombres: SIN_NOMBRES,
        zona: "America/New_York",
        ahora: new Date("2026-11-27T15:00:00Z"),
      })}
    />,
  );

describe("VistaAuditPestana", () => {
  it("una lista ordenada con su nombre, y un <time datetime> por fila", () => {
    const { container } = pintar();
    const lista = screen.getByRole("list", { name: "Audit" });
    expect(lista.tagName).toBe("OL");
    expect(within(lista).getAllByRole("listitem")).toHaveLength(4);
    const tiempos = [...container.querySelectorAll("time")];
    expect(tiempos.map((t) => t.getAttribute("datetime"))).toEqual([
      "2026-11-25T10:00:00.000Z",
      "2026-11-25T10:05:00.000Z",
      "2026-11-25T14:30:00.000Z",
      "2026-11-25T15:00:00.000Z",
    ]);
    expect(tiempos[2]!.textContent).toBe("Nov 25, 9:30 AM");
  });

  it("conserva el marcador data-ranura=audit (OPR-26 A14)", () => {
    const { container } = pintar();
    expect(container.querySelector('[data-ranura="audit"]')).not.toBeNull();
  });

  it("los identificadores y la zona arriba de la lista", () => {
    pintar();
    expect(screen.getByTestId("audit-request").textContent).toBe("R3");
    expect(screen.getByTestId("audit-job-number").textContent).toBe("EX-00003");
    expect(screen.getByTestId("audit-work-app-number").textContent).toBe("EX-00003");
    expect(screen.getByTestId("audit-zona").textContent).toBe("Times in EST");
  });

  it("Reason: solo cuando hay motivo", () => {
    pintar();
    const motivos = screen.getAllByTestId("audit-motivo");
    expect(motivos).toHaveLength(1);
    expect(motivos[0]!.textContent).toBe("Reason: Cleaner finished but the app did not sync.");
  });

  it("Original en la primera asignación y Observed solo en lo observado", () => {
    pintar();
    const filas = screen.getAllByTestId("audit-fila");
    expect(filas[1]!.textContent).toContain("Original");
    expect(filas[1]!.textContent).not.toContain("Observed");
    expect(filas[3]!.textContent).toContain("Observed");
    expect(filas[0]!.textContent).not.toMatch(/Original|Observed/);
    expect(screen.getAllByText(/Observed/)).toHaveLength(1);
  });

  it("la persona de cada fila", () => {
    pintar();
    expect(screen.getAllByTestId("audit-persona").map((e) => e.textContent)).toEqual(["opsRUN", "Ops Dos", "Ops Dos", "BzzzBX"]);
  });

  it("sin eventos, lo dice sin lista", () => {
    pintar([]);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("No events yet.")).toBeTruthy();
  });

  it("sin request, lo dice sin identificadores", () => {
    const { container } = render(<VistaAuditPestana etapa="scheduled" vista={null} />);
    expect(container.querySelector('[data-ranura="audit"]')).not.toBeNull();
    expect(screen.queryByTestId("audit-ids")).toBeNull();
  });
});
