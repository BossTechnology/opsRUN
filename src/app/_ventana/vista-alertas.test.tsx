import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { armarAlertas } from "@/lib/alertas/armar";
import type { EsperaDeOpsrun, MensajeDeAlerta, OcurrenciaDeOpsrun, VistaAlertas } from "@/lib/alertas/tipos";
import { accionesVisibles } from "@/lib/acciones/disponibilidad";
import type { EntradaAccion, ResultadoAccion } from "@/lib/acciones/tipos";
import type { AlertResult } from "@/lib/bzzzbx/tipos";
import { armarVentana, type EntradaVentana } from "@/lib/ventana/armar";
import { CONFIRMACIONES_COMPLETAS, filaVentana, leidosVentanaDelFalso, OPERADORES_DE_PRUEBA, SIN_CONFIRMACIONES } from "@/lib/ventana/prueba-datos";
import type { VentanaJob } from "@/lib/ventana/tipos";

// La Server Action y sus dependencias de servidor no corren en jsdom.
vi.mock("./acciones", () => ({ ejecutarAccion: vi.fn(), elegirActor: vi.fn() }));

import { ProveedorDeAcciones } from "./accion-de-la-ventana";
import { BarraAcciones } from "./barra-acciones";
import { VistaAlertasPestana } from "./vista-alertas";

afterEach(cleanup);

const AHORA = new Date("2026-11-24T18:00:00Z");
const OPS_UNO = "0a000000-0000-4000-8000-0000000000a1";

function ventana(n: number, parche: Partial<EntradaVentana> = {}): VentanaJob {
  return armarVentana({
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
  });
}

const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();

const ocurrenciaCerrada = (id: string, parche: Partial<OcurrenciaDeOpsrun> = {}): OcurrenciaDeOpsrun => ({
  bzzzbx_alert_id: id,
  request_id: "b0000000-0000-4000-8000-0000000000a4",
  rule_id: "OPS-010",
  level: "red",
  reason_text: "Not started by 1:00 PM.",
  bzzzbx_message_id: null,
  opened_at: hace(180),
  resolved_at: hace(120),
  resolution: "auto_cleared",
  resolved_by_nombre: null,
  resolution_reason: null,
  fixing_label: null,
  ...parche,
});

const espera: EsperaDeOpsrun = {
  id: "d0000000-0000-4000-8000-0000000000a2",
  request_id: "b0000000-0000-4000-8000-0000000000a2",
  purpose: "initial",
  bzzzbx_team_id: "bx-team-0001",
  status: "asked",
  asked_at: hace(110),
  new_service_date: null,
  new_window_start: null,
  new_window_end: null,
};

function vistaDe(
  v: VentanaJob,
  extra: { ocurrencias?: OcurrenciaDeOpsrun[]; esperas?: EsperaDeOpsrun[]; mensajes?: Record<string, MensajeDeAlerta> } = {},
): VistaAlertas {
  return armarAlertas({ abiertas: v.alertasLeidas, ocurrencias: extra.ocurrencias ?? [], esperas: extra.esperas ?? [], equipos: { "bx-team-0001": "Team Alpha" }, mensajes: extra.mensajes, ahora: AHORA, zona: "UTC" });
}

function pintar(v: VentanaJob, extra: Parameters<typeof vistaDe>[1] = {}, { actorId = OPS_UNO, conBarra = false }: { actorId?: string | null; conBarra?: boolean } = {}) {
  const ejecutar = vi.fn<(entrada: EntradaAccion) => Promise<ResultadoAccion>>(async () => ({ tipo: "guardada" }));
  const acciones = accionesVisibles(v);
  render(
    <ProveedorDeAcciones acciones={acciones}>
      {conBarra ? <BarraAcciones requestId={v.requestId} version={v.version} acciones={acciones} ventana={v} actorId={actorId} ejecutar={ejecutar} /> : null}
      <VistaAlertasPestana vista={vistaDe(v, extra)} etapa={v.etapa} bzzzbx={v.bzzzbx} />
    </ProveedorDeAcciones>,
  );
  return ejecutar;
}

const seccion = (nombre: "needs-action" | "waiting" | "resolved") => screen.getByTestId(`alertas-${nombre}`);

describe("pestaña Alerts: las tres secciones (§5.1)", () => {
  it("cada sección es una <section> con su encabezado, una <ul> y su data-testid; la raíz conserva data-ranura=alertas", () => {
    pintar(ventana(1), { ocurrencias: [ocurrenciaCerrada("bx-alert-0002")], esperas: [espera] });
    expect(screen.getByTestId("alertas").getAttribute("data-ranura")).toBe("alertas");
    for (const [id, titulo] of [
      ["needs-action", "Needs action (1)"],
      ["waiting", "Waiting (1)"],
      ["resolved", "Resolved (1)"],
    ] as const) {
      const s = seccion(id);
      expect(s.tagName).toBe("SECTION");
      expect(s.getAttribute("aria-labelledby")).toBeTruthy();
      expect(document.getElementById(s.getAttribute("aria-labelledby")!)?.textContent).toBe(titulo);
      expect(s.querySelector("ul")).not.toBeNull();
    }
  });

  it("Needs action: regla, motivo vivo, tiempo abierta, hora en un <time> y el botón; la fila lleva su regla, nivel y sección", () => {
    pintar(ventana(1));
    const fila = within(seccion("needs-action")).getByTestId("alerta");
    expect(fila.getAttribute("data-regla")).toBe("OPS-001");
    expect(fila.getAttribute("data-nivel")).toBe("amber");
    expect(fila.getAttribute("data-seccion")).toBe("needs-action");
    expect(within(fila).getByTestId("alerta-regla").textContent).toBe("OPS-001 Unassigned request");
    expect(within(fila).getByTestId("alerta-motivo").textContent).toBe("Unassigned for 15 min.");
    expect(within(fila).getByTestId("alerta-duracion").textContent).toBe("Open 5 min");
    expect(within(fila).getByTestId("alerta-abierta").tagName).toBe("TIME");
    expect(within(fila).getByTestId("alerta-abierta").getAttribute("datetime")).toBe(hace(5));
    expect(within(fila).getByTestId("alerta-boton").textContent).toBe("Assign / Reassign");
  });

  it("Waiting: qué se espera, a quién, el estado y desde cuándo", () => {
    pintar(ventana(2), { esperas: [espera] });
    const fila = within(seccion("waiting")).getByTestId("alerta");
    expect(fila.getAttribute("data-seccion")).toBe("waiting");
    expect(within(fila).getByTestId("espera-que").textContent).toBe("Cleaner confirmation");
    expect(within(fila).getByTestId("espera-cleaner").textContent).toBe("Team Alpha");
    expect(within(fila).getByTestId("espera-estado").textContent).toBe("Asked");
    expect(within(fila).getByTestId("espera-desde").textContent).toBe("Waiting 1 h 50 min");
  });

  it("Resolved: nivel y regla, motivo de la ocurrencia, abierta y resuelta, tiempo, quién y cómo, con Reason de Clear alert y las repeticiones", () => {
    pintar(ventana(4), {
      ocurrencias: [
        ocurrenciaCerrada("bx-alert-0002"),
        ocurrenciaCerrada("bx-alert-0009", { resolved_at: hace(1000), opened_at: hace(1100) }),
        ocurrenciaCerrada("bx-alert-0010", { rule_id: "MEC-003", level: "amber", resolution: "cleared_by_operator", resolved_by_nombre: "Ops Dos", resolution_reason: "Large unit, cleaner called ahead.", opened_at: hace(300), resolved_at: hace(240) }),
      ],
    });
    const filas = within(seccion("resolved")).getAllByTestId("alerta");
    expect(filas.map((f) => f.getAttribute("data-alerta"))).toEqual(["bx-alert-0002", "bx-alert-0010", "bx-alert-0009"]);
    const [auto, limpiada] = filas;
    expect(within(auto!).getByTestId("alerta-quien").textContent).toBe("Cleared automatically");
    expect(within(auto!).getByTestId("alerta-repeticiones").textContent).toBe("Repeats on this job: 2");
    expect(within(auto!).getByTestId("alerta-duracion").textContent).toBe("Open 1 h");
    expect(within(auto!).queryByTestId("alerta-razon")).toBeNull();
    expect(within(limpiada!).getByTestId("alerta-quien").textContent).toBe("Cleared by Ops Dos");
    expect(within(limpiada!).getByTestId("alerta-razon").textContent).toBe("Reason: Large unit, cleaner called ahead.");
    // La MEC-003 abierta de R4 (bx-alert-0006) cuenta como otra apertura de la misma regla.
    expect(within(limpiada!).getByTestId("alerta-repeticiones").textContent).toBe("Repeats on this job: 2");
    expect(within(auto!).getByTestId("alerta-abierta-y-resuelta").textContent).toBe("Opened Nov 24, 3:00 PM · Resolved 4:00 PM");
  });

  it("una sección vacía se ve con su encabezado y None; Needs action dice No alerts need action", () => {
    pintar(ventana(3));
    expect(within(seccion("needs-action")).getByTestId("sin-alertas").textContent).toBe("No alerts need action");
    expect(within(seccion("waiting")).getByText("None")).toBeTruthy();
    expect(within(seccion("resolved")).getByText("None")).toBeTruthy();
    expect(screen.queryAllByTestId("alerta")).toHaveLength(0);
  });

  it("con BzzzBX caído, Needs action trae lo último leído con la franja y la hora", () => {
    pintar(ventana(1, { bzzzbx: { disponible: false, actualizadoEn: hace(7) } }));
    expect(screen.getByTestId("alertas-franja").textContent).toBe("BzzzBX unavailable · last update 5:53 PM");
    expect(within(seccion("needs-action")).getAllByTestId("alerta")).toHaveLength(1);
  });
});

describe("pestaña Alerts: el botón de cada alerta (§5.3)", () => {
  it("abre la acción en la action bar, elegida y con 'Assign to me' ya elegido, y no ejecuta nada", () => {
    const ejecutar = pintar(ventana(1), {}, { conBarra: true });
    expect(screen.queryByTestId("panel-accion")).toBeNull();
    fireEvent.click(screen.getByTestId("alerta-boton"));
    const panel = screen.getByTestId("panel-accion");
    expect(panel.getAttribute("data-accion")).toBe("assign");
    expect((screen.getByTestId("accion") as HTMLSelectElement).value).toBe("assign");
    // "Assign to me" quedó elegido: Ops Uno es el actor.
    expect((screen.getByTestId("go") as HTMLButtonElement).disabled).toBe(false);
    expect(ejecutar).not.toHaveBeenCalled();
    // Corre solo con Go, con el operador del actor y la versión de la ventana.
    fireEvent.click(screen.getByTestId("go"));
    expect(ejecutar).toHaveBeenCalledWith(expect.objectContaining({ codigo: "assign", datos: { operator_id: OPS_UNO }, version: "101" }));
  });

  it("sin actor, el panel abre sin nadie elegido y Go sigue deshabilitado", () => {
    pintar(ventana(1), {}, { conBarra: true, actorId: null });
    fireEvent.click(screen.getByTestId("alerta-boton"));
    expect(screen.getByTestId("panel-accion").getAttribute("data-accion")).toBe("assign");
    expect((screen.getByTestId("go") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Clear alert abre con la alerta de esa fila elegida; con el motivo obligatorio", () => {
    pintar(ventana(4), {}, { conBarra: true });
    fireEvent.click(within(seccion("needs-action")).getByTestId("alerta-boton"));
    expect(screen.getByTestId("panel-accion").getAttribute("data-accion")).toBe("clear_alert");
    expect(screen.getByTestId("alerta-limpiable").getAttribute("data-alerta")).toBe("bx-alert-0006");
    expect((screen.getByTestId("go") as HTMLButtonElement).disabled).toBe(true); // falta el motivo
    fireEvent.change(screen.getByTestId("motivo"), { target: { value: "Large unit." } });
    expect((screen.getByTestId("go") as HTMLButtonElement).disabled).toBe(false);
  });

  it("pedir la misma acción otra vez la vuelve a abrir, prellenada", () => {
    pintar(ventana(1), {}, { conBarra: true });
    fireEvent.click(screen.getByTestId("alerta-boton"));
    fireEvent.click(screen.getByTestId("assign-to-me")); // sigue elegido
    fireEvent.click(screen.getByTestId("cancelar-accion"));
    expect(screen.queryByTestId("panel-accion")).toBeNull();
    fireEvent.click(screen.getByTestId("alerta-boton"));
    expect((screen.getByTestId("go") as HTMLButtonElement).disabled).toBe(false);
  });

  it("si la acción no está disponible, el botón se ve en gris con el mismo motivo que en la barra", () => {
    // R4 con BzzzBX caído: Clear alert lee de BzzzBX.
    pintar(ventana(4, { bzzzbx: { disponible: false, actualizadoEn: hace(1) } }));
    const boton = screen.getByTestId("alerta-boton") as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    expect(boton.textContent).toBe("Clear alert");
    expect(screen.getByTestId("alerta-boton-nota").textContent).toBe("BzzzBX unavailable");
    expect(boton.getAttribute("aria-describedby")).toBe(screen.getByTestId("alerta-boton-nota").id);
  });

  it("una acción bloqueada por un dato dice su motivo (Schedule sin el remitente confirmado)", () => {
    const v = ventana(1);
    const e = { ...v, alertasLeidas: [{ ...v.alertasLeidas[0]!, rule_id: "OPS-002" }] };
    pintar(e);
    expect((screen.getByTestId("alerta-boton") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("alerta-boton").textContent).toBe("Schedule");
    expect(screen.getByTestId("alerta-boton-nota").textContent).toBe("Confirm who it is from first");
  });

  it("una acción que no aplica en la etapa de la alerta, o que no está en el registro, sale en gris con su motivo", () => {
    const v = ventana(3); // Scheduled: Assign es de Requests
    const alerta: AlertResult = { bzzzbx_alert_id: "bx-alert-7300", sujeto: { tipo: "request", request_id: v.requestId }, rule_id: "OPS-001", rule_version: "1", level: "amber", reason_text: "x", opened_at: hace(5), cleared_at: null };
    pintar({ ...v, alertasLeidas: [alerta] });
    expect((screen.getByTestId("alerta-boton") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("alerta-boton-nota").textContent).toBe("Not available at this stage");
  });

  it("OPS-010 no tiene botón: dice 'Clears at check-in'", () => {
    const v = ventana(1);
    pintar({ ...v, alertasLeidas: [{ ...v.alertasLeidas[0]!, rule_id: "OPS-010", level: "red" }] });
    expect(screen.queryByTestId("alerta-boton")).toBeNull();
    expect(screen.getByTestId("alerta-sin-boton").textContent).toBe("Clears at check-in");
  });

  it("Message not delivered lleva el foco al mensaje en la conversación (Edit and resend)", () => {
    const v = ventana(2);
    const alerta: AlertResult = { bzzzbx_alert_id: "bx-alert-7301", sujeto: { tipo: "message", bzzzbx_message_id: "bx-msg-0299" }, rule_id: "MSG-001", rule_version: "1", level: "red", reason_text: "Text not delivered.", opened_at: hace(5), cleared_at: null };
    render(
      <>
        <ol>
          <li data-entrada="msg:bx-msg-0299" tabIndex={-1} data-testid="entrada-falsa">
            <button type="button" data-testid="reenviar">
              Edit and resend
            </button>
          </li>
          <li data-entrada="msg:otro" tabIndex={-1} />
        </ol>
        <ProveedorDeAcciones acciones={accionesVisibles(v)}>
          <VistaAlertasPestana
            vista={vistaDe({ ...v, alertasLeidas: [alerta] }, { mensajes: { "bx-msg-0299": { encontrado: true, destinatario: "Team Alpha · +1 555 0111", modo: { disponible: true } } } })}
            etapa={v.etapa}
          />
        </ProveedorDeAcciones>
      </>,
    );
    const boton = screen.getByTestId("alerta-boton");
    expect(boton.textContent).toBe("Edit and resend");
    fireEvent.click(boton);
    expect(document.activeElement).toBe(screen.getByTestId("reenviar"));
  });

  describe("Message not delivered en la pestaña (OPR-19 §6.2 y §6.3)", () => {
    const mensajeAlerta: AlertResult = { bzzzbx_alert_id: "bx-alert-7302", sujeto: { tipo: "message", bzzzbx_message_id: "bx-msg-0299" }, rule_id: "MSG-001", rule_version: "1", level: "red", reason_text: "Text to Team Alpha failed: Invalid number.", opened_at: hace(5), cleared_at: null };
    const con = (mensaje: MensajeDeAlerta | undefined) => {
      const v = ventana(2);
      pintar({ ...v, alertasLeidas: [mensajeAlerta] }, mensaje ? { mensajes: { "bx-msg-0299": mensaje } } : {});
    };

    it("la fila trae el destinatario de solo lectura y el arreglo; otra regla no", () => {
      con({ encontrado: true, destinatario: "Team Alpha · +1 555 0111", modo: { disponible: true } });
      expect(screen.getByTestId("alerta-destinatario").textContent).toBe("To: Team Alpha · +1 555 0111");
      expect(screen.getByTestId("alerta-arreglo").textContent).toBe("Check the address or number and resend.");
      expect(screen.getByTestId("alerta-destinatario").querySelector("input, button, a")).toBeNull();
      cleanup();
      const v = ventana(1);
      pintar(v);
      expect(screen.queryByTestId("alerta-destinatario")).toBeNull();
      expect(screen.queryByTestId("alerta-arreglo")).toBeNull();
    });

    it("sin haber leído el mensaje, el destinatario se ve — — y el botón en gris con BzzzBX unavailable", () => {
      con(undefined);
      expect(screen.getByTestId("alerta-destinatario").textContent).toBe("To: — —");
      expect((screen.getByTestId("alerta-boton") as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByTestId("alerta-boton-nota").textContent).toBe("BzzzBX unavailable");
    });

    it.each([
      ["el modo Customer apagado: sin hilo", "No email thread for this request"],
      ["el modo Cleaner apagado: sin cleaner", "Choose a cleaner first"],
      ["el job cancelado", "Job cancelled"],
    ])("con %s el botón queda en gris con el mismo motivo y no mueve el foco", (_caso, razon) => {
      con({ encontrado: true, destinatario: "x", modo: { disponible: false, razon } });
      const boton = screen.getByTestId("alerta-boton") as HTMLButtonElement;
      expect(boton.disabled).toBe(true);
      expect(screen.getByTestId("alerta-boton-nota").textContent).toBe(razon);
    });

    it("un mensaje que BzzzBX no conoce: en gris con 'Message not found in BzzzBX'", () => {
      con({ encontrado: false, destinatario: null, modo: { disponible: false, razon: "Message not found in BzzzBX" } });
      expect((screen.getByTestId("alerta-boton") as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByTestId("alerta-boton-nota").textContent).toBe("Message not found in BzzzBX");
    });

    it("sin la entrada en el hilo no hace nada, y si el Edit and resend del mensaje está en gris, el foco va a la entrada", () => {
      con({ encontrado: true, destinatario: "x", modo: { disponible: true } });
      render(
        <ol>
          <li data-entrada="msg:bx-msg-0299" tabIndex={-1} data-testid="entrada-falsa">
            <button type="button" data-testid="reenviar" disabled>
              Edit and resend
            </button>
          </li>
        </ol>,
      );
      fireEvent.click(screen.getByTestId("alerta-boton"));
      expect(document.activeElement).toBe(screen.getByTestId("entrada-falsa"));
    });
  });
});
