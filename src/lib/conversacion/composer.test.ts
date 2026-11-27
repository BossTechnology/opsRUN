// @vitest-environment node
/**
 * Disponibilidad del Composer por modo (spec OPR-27 §5.1 y §10) y validación
 * del cuerpo (límites de S-9).
 */
import { describe, expect, it } from "vitest";

import {
  disponibilidadDelComposer,
  RAZON_BZZZBX_CAIDO,
  RAZON_JOB_CANCELADO,
  RAZON_SIN_CLEANER,
  RAZON_SIN_HILO,
  validarCuerpo,
} from "./composer";

const base = { etapa: "requests", bzzzbxDisponible: true, hilos: ["bx-thread-0002"], equipoId: "bx-team-0001" };

describe("disponibilidadDelComposer", () => {
  it("con hilo, cleaner y BzzzBX, los tres modos corren", () => {
    expect(disponibilidadDelComposer(base)).toEqual({
      customer: { disponible: true },
      cleaner: { disponible: true },
      note: { disponible: true },
    });
  });

  it("BzzzBX caído: Customer y Cleaner en gris, Note sigue", () => {
    expect(disponibilidadDelComposer({ ...base, bzzzbxDisponible: false })).toEqual({
      customer: { disponible: false, razon: RAZON_BZZZBX_CAIDO },
      cleaner: { disponible: false, razon: RAZON_BZZZBX_CAIDO },
      note: { disponible: true },
    });
  });

  it("job cancelado: los tres en gris, también con BzzzBX caído", () => {
    for (const bzzzbxDisponible of [true, false]) {
      expect(disponibilidadDelComposer({ ...base, etapa: "cancelled", bzzzbxDisponible })).toEqual({
        customer: { disponible: false, razon: RAZON_JOB_CANCELADO },
        cleaner: { disponible: false, razon: RAZON_JOB_CANCELADO },
        note: { disponible: false, razon: RAZON_JOB_CANCELADO },
      });
    }
  });

  it("sin hilo de correo: solo Customer en gris", () => {
    const d = disponibilidadDelComposer({ ...base, hilos: [] });
    expect(d.customer).toEqual({ disponible: false, razon: RAZON_SIN_HILO });
    expect(RAZON_SIN_HILO).toBe("No email thread for this request");
    expect(d.cleaner.disponible).toBe(true);
  });

  it("sin cleaner: solo Cleaner en gris", () => {
    const d = disponibilidadDelComposer({ ...base, equipoId: null });
    expect(d.cleaner).toEqual({ disponible: false, razon: RAZON_SIN_CLEANER });
    expect(RAZON_SIN_CLEANER).toBe("Choose a cleaner first");
    expect(d.customer.disponible).toBe(true);
  });
});

describe("validarCuerpo", () => {
  it("recorta y acepta hasta el límite de cada modo (nota 4 000, correo 10 000, texto 1 600)", () => {
    expect(validarCuerpo("note", "  Hola \n")).toEqual({ ok: true, cuerpo: "Hola" });
    expect(validarCuerpo("note", "x".repeat(4000)).ok).toBe(true);
    expect(validarCuerpo("note", "x".repeat(4001)).ok).toBe(false);
    expect(validarCuerpo("customer", "x".repeat(10_000)).ok).toBe(true);
    expect(validarCuerpo("customer", "x".repeat(10_001)).ok).toBe(false);
    expect(validarCuerpo("cleaner", "x".repeat(1600)).ok).toBe(true);
    expect(validarCuerpo("cleaner", "x".repeat(1601)).ok).toBe(false);
  });

  it("vacío, solo espacios o algo que no es texto no sirve", () => {
    for (const valor of ["", "   ", "\n\t ", null, undefined, 3, {}]) {
      expect(validarCuerpo("customer", valor).ok).toBe(false);
    }
  });
});
