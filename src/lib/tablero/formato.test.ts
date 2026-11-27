import { describe, expect, it } from "vitest";

import { fechaYVentana, hora, horaConFecha, iniciales, horaOFecha } from "./formato";

const UTC = "UTC";

describe("formato del tablero", () => {
  it("hora en 12 h, en la zona de la operación", () => {
    expect(hora("2026-11-24T14:05:00Z", UTC)).toBe("2:05 PM");
    expect(hora("2026-11-24T14:05:00Z", "America/Bogota")).toBe("9:05 AM");
  });

  it("la hora sola si es de hoy; si no, con la fecha", () => {
    const ahora = new Date("2026-11-24T18:00:00Z");
    expect(horaOFecha("2026-11-24T09:30:00Z", ahora, UTC)).toBe("9:30 AM");
    expect(horaOFecha("2026-11-21T09:30:00Z", ahora, UTC)).toBe("Nov 21, 9:30 AM");
  });

  it("horaConFecha: siempre con fecha, y con el año si no es el en curso (OPR-35)", () => {
    const ahora = new Date("2026-11-27T18:00:00Z");
    expect(horaConFecha("2026-11-27T09:30:00Z", ahora, UTC)).toBe("Nov 27, 9:30 AM");
    expect(horaConFecha("2026-11-25T14:30:00Z", ahora, "America/New_York")).toBe("Nov 25, 9:30 AM");
    expect(horaConFecha("2025-11-25T14:30:00Z", ahora, UTC)).toBe("Nov 25, 2025, 2:30 PM");
  });

  it("fecha de servicio con su ventana", () => {
    expect(fechaYVentana("2026-11-25", "09:00", "12:00")).toBe("Wed, Nov 25 · 9:00 AM–12:00 PM");
    expect(fechaYVentana("2026-11-25", "13:30", "16:00")).toBe("Wed, Nov 25 · 1:30 PM–4:00 PM");
  });

  it("sin fecha o sin ventana, — —", () => {
    expect(fechaYVentana(null, "09:00", "12:00")).toBe("— —");
    expect(fechaYVentana("2026-11-25", null, null)).toBe("Wed, Nov 25 · — —");
  });

  it("iniciales del operador", () => {
    expect(iniciales("Ops Uno")).toBe("OU");
    expect(iniciales("finance")).toBe("F");
    expect(iniciales("  Ana  María  Pérez ")).toBe("AP");
  });
});
