import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResultadoAccion } from "@/lib/acciones/tipos";
import type { Candidato } from "@/lib/fase-a/enlace";
import { BUSCAR_JOBS_MAX } from "@/lib/bzzzbx/tipos";
import type { PropsRanuraEnlace } from "@/lib/ventana/ranuras";

import { RanuraEnlace, TEXTO_TRUNCADO } from "./ranura-enlace";

afterEach(cleanup);

const job = (n: number, parche: Partial<Candidato["job"]> = {}): Candidato["job"] => ({
  bzzzbx_job_id: `bx-job-01${String(n).padStart(2, "0")}`,
  job_number: `EX-001${String(n).padStart(2, "0")}`,
  bzzzbx_customer_id: "bx-cust-0002",
  bzzzbx_property_id: "bx-prop-0004",
  bzzzbx_space_id: null,
  bzzzbx_service_id: "bx-svc-0001",
  service_date: "2026-11-27",
  window_start: "13:00",
  window_end: "16:00",
  status: "scheduled",
  bzzzbx_team_id: "bx-team-0001",
  po_number: null,
  version: "1",
  leido_en: "2026-11-24T18:00:00Z",
  ...parche,
});

const SUGERIDO: Candidato = {
  job: job(7),
  coincide: ["misma_propiedad", "mismo_cliente", "misma_fecha", "misma_ventana", "mismo_equipo"],
  sugerido: true,
};
const OTRO: Candidato = { job: job(8), coincide: ["misma_propiedad", "mismo_cliente"], sugerido: false };

const GATE_COMPLETO = { dueno: true, details: true, sender: true, cleaner: true };
const guardada: ResultadoAccion = { tipo: "guardada" };

function pintar(parche: Partial<PropsRanuraEnlace> = {}) {
  const confirmar = vi.fn<PropsRanuraEnlace["confirmar"]>(async () => guardada);
  const rechazar = vi.fn<PropsRanuraEnlace["rechazar"]>(async () => guardada);
  const props: PropsRanuraEnlace = {
    requestId: "b0000000-0000-4000-8000-0000000000a7",
    etapa: "requests",
    bzzzbx: { disponible: true, actualizadoEn: "2026-11-24T18:00:00Z" },
    zona: "UTC",
    propuesta: { candidatos: [SUGERIDO, OTRO], truncado: false },
    gate: GATE_COMPLETO,
    confirmar,
    rechazar,
    equipos: { "bx-team-0001": "Sparkle Cleaners" },
    ...parche,
  };
  render(<RanuraEnlace {...props} />);
  return { confirmar, rechazar };
}

describe("RanuraEnlace: candidatos", () => {
  it("cada candidato con su job number, fecha y ventana, cleaner y por qué encaja; Suggested solo en el que lo es", () => {
    pintar();
    const filas = screen.getAllByTestId("candidato-enlace");
    expect(filas).toHaveLength(2);
    expect(filas[0]!.getAttribute("data-job")).toBe("bx-job-0107");
    expect(within(filas[0]!).getByText("EX-00107")).toBeTruthy();
    expect(within(filas[0]!).getByText("Fri, Nov 27 · 1:00 PM–4:00 PM")).toBeTruthy();
    expect(within(filas[0]!).getByText("Sparkle Cleaners")).toBeTruthy();
    expect(within(filas[0]!).getAllByRole("listitem").map((l) => l.textContent)).toEqual([
      "Same property",
      "Same customer",
      "Same date",
      "Same window",
      "Same cleaner",
    ]);
    expect(within(filas[0]!).getByTestId("sugerido").textContent).toBe("Suggested");
    expect(within(filas[1]!).queryByTestId("sugerido")).toBeNull();
  });

  it("un cleaner sin nombre leído se ve como — —", () => {
    pintar({ equipos: {} });
    expect(within(screen.getAllByTestId("candidato-enlace")[0]!).getByText("— —")).toBeTruthy();
  });
});

describe("RanuraEnlace: truncado, motivo vacío y BzzzBX caído", () => {
  it("truncado: un aviso con role=status encima de la lista, y la lista se muestra igual", () => {
    pintar({ propuesta: { candidatos: [SUGERIDO], truncado: true } });
    const aviso = screen.getByRole("status", { name: "" });
    expect(aviso).toBe(screen.getByTestId("aviso-truncado"));
    expect(aviso.textContent).toBe(`Showing the first ${BUSCAR_JOBS_MAX} jobs. There may be more: narrow the property or the date.`);
    expect(aviso.textContent).toBe(TEXTO_TRUNCADO);
    expect(screen.getAllByTestId("candidato-enlace")).toHaveLength(1);
    const lista = screen.getByTestId("lista-candidatos");
    expect(aviso.compareDocumentPosition(lista) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sin truncado no hay aviso", () => {
    pintar();
    expect(screen.queryByTestId("aviso-truncado")).toBeNull();
  });

  it.each([
    ["sin_cliente_ni_propiedad", "Confirm who it is from first"],
    ["sin_candidatos", "No matching job found in PINCH tools yet"],
  ] as const)("lista vacía por %s", (motivo_vacio, texto) => {
    pintar({ propuesta: { candidatos: [], truncado: false, motivo_vacio } });
    expect(screen.getByTestId("enlace-vacio").textContent).toBe(texto);
    expect(screen.queryByTestId("lista-candidatos")).toBeNull();
  });

  it("truncado y sin candidatos: dice las dos cosas", () => {
    pintar({ propuesta: { candidatos: [], truncado: true, motivo_vacio: "sin_candidatos" } });
    expect(screen.getByTestId("aviso-truncado")).toBeTruthy();
    expect(screen.getByTestId("enlace-vacio")).toBeTruthy();
  });

  it("BzzzBX caído: lo dice y no propone nada", () => {
    pintar({ propuesta: { error: "bzzzbx_no_disponible" } });
    expect(screen.getByTestId("enlace-caido").textContent).toBe("BzzzBX unavailable");
    expect(screen.queryByTestId("candidato-enlace")).toBeNull();
  });
});

describe("RanuraEnlace: gate de Schedule", () => {
  it("completo: sin aviso y Confirm habilitado", () => {
    pintar();
    expect(screen.queryByTestId("gate-enlace")).toBeNull();
    expect((screen.getByRole("button", { name: "Confirm EX-00107" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("incompleto: dice qué falta, en orden, y Confirm queda deshabilitado en todos los candidatos", () => {
    pintar({ gate: { dueno: false, details: true, sender: false, cleaner: false } });
    expect(screen.getByTestId("gate-enlace").textContent).toBe("Before linking, confirm: Owner, Sender, Cleaner");
    for (const boton of screen.getAllByTestId("confirmar-enlace")) expect((boton as HTMLButtonElement).disabled).toBe(true);
    // Rechazar un candidato no depende del gate.
    for (const boton of screen.getAllByTestId("rechazar-enlace")) expect((boton as HTMLButtonElement).disabled).toBe(false);
  });

  it("incompleto en Details: lo nombra", () => {
    pintar({ gate: { ...GATE_COMPLETO, details: false } });
    expect(screen.getByTestId("gate-enlace").textContent).toBe("Before linking, confirm: Details");
  });
});

describe("RanuraEnlace: confirmar y rechazar", () => {
  it("Confirm pide el enlace de ese job por la Server Action", async () => {
    const { confirmar } = pintar();
    fireEvent.click(screen.getByRole("button", { name: "Confirm EX-00108" }));
    await waitFor(() => expect(confirmar).toHaveBeenCalledWith("bx-job-0108"));
    await waitFor(() => expect(screen.getByTestId("resultado-enlace").textContent).toBe("Saved"));
  });

  it("un EnlaceInvalido de confirmar se dice en el panel, sin cerrar la lista", async () => {
    const { confirmar } = pintar();
    confirmar.mockResolvedValueOnce({ tipo: "rechazada", codigo: "job_ya_enlazado", mensaje: "That job is already linked to another request." });
    fireEvent.click(screen.getByRole("button", { name: "Confirm EX-00107" }));
    await waitFor(() =>
      expect(screen.getByTestId("resultado-enlace").textContent).toBe("That job is already linked to another request."),
    );
    expect(screen.getByTestId("resultado-enlace").getAttribute("data-tipo")).toBe("rechazada");
    expect(screen.getAllByTestId("candidato-enlace")).toHaveLength(2);
  });

  it("una Server Action que falla de forma inesperada no deja la ranura rota", async () => {
    const { confirmar } = pintar();
    confirmar.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm EX-00107" }));
    await waitFor(() => expect(screen.getByTestId("resultado-enlace").textContent).toBe("Something went wrong. Try again."));
  });

  it("rechazar abre el motivo opcional y manda el motivo recortado; sin motivo manda null", async () => {
    const { rechazar } = pintar();
    fireEvent.click(screen.getByRole("button", { name: "Reject EX-00108" }));
    const rechazo = screen.getByTestId("rechazo-enlace");
    expect(within(rechazo).getByText("Reason (optional)")).toBeTruthy();
    // El "Reject job" no exige motivo.
    expect((within(rechazo).getByTestId("enviar-rechazo") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(within(rechazo).getByTestId("motivo-rechazo"), { target: { value: "  Other building  " } });
    fireEvent.click(within(rechazo).getByTestId("enviar-rechazo"));
    await waitFor(() => expect(rechazar).toHaveBeenCalledWith("bx-job-0108", "Other building"));
    await waitFor(() => expect(screen.queryByTestId("rechazo-enlace")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Reject EX-00107" }));
    fireEvent.click(screen.getByTestId("enviar-rechazo"));
    await waitFor(() => expect(rechazar).toHaveBeenLastCalledWith("bx-job-0107", null));
  });

  it("Cancel cierra el motivo sin rechazar", () => {
    const { rechazar } = pintar();
    fireEvent.click(screen.getByRole("button", { name: "Reject EX-00108" }));
    fireEvent.click(screen.getByTestId("cancelar-rechazo"));
    expect(screen.queryByTestId("rechazo-enlace")).toBeNull();
    expect(rechazar).not.toHaveBeenCalled();
  });
});
