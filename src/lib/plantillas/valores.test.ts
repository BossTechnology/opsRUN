// @vitest-environment node
/** `valoresDelJob` (spec OPR-18 §4.3 y §10.2): de dónde sale cada placeholder y con qué formato. */
import { describe, expect, it } from "vitest";

import type { Job, Property } from "../bzzzbx/tipos";

import { valoresDelJob, type BorradorDePlantilla } from "./valores";

const BORRADOR: BorradorDePlantilla = {
  bzzzbx_property_id: "bx-prop-0002",
  bzzzbx_space_id: "bx-space-0002",
  unit: "12",
  service_date: "2026-11-25",
  window_start: "09:00:00",
  window_end: "12:00:00",
};

const PROPIEDAD: Property = {
  bzzzbx_property_id: "bx-prop-0002",
  name: "Sample Court",
  city: "Example City",
  units: [{ bzzzbx_space_id: "bx-space-0002", label: "Unit 12" }],
  default_team_id: null,
};

const JOB: Job = {
  bzzzbx_job_id: "bx-job-0003",
  job_number: "EX-00003",
  bzzzbx_customer_id: "bx-cust-0001",
  bzzzbx_property_id: "bx-prop-0002",
  bzzzbx_space_id: "bx-space-0002",
  bzzzbx_service_id: "bx-svc-0001",
  service_date: "2026-12-02",
  window_start: "10:00",
  window_end: "14:00",
  status: "scheduled",
  bzzzbx_team_id: "bx-team-0001",
  po_number: null,
};

describe("valoresDelJob", () => {
  it("en Requests manda el borrador, con el espacio de BzzzBX y el formato del tablero", () => {
    expect(valoresDelJob({ fuente: "borrador", borrador: BORRADOR, job: null, propiedad: PROPIEDAD })).toEqual({
      property: "Sample Court",
      space: "Unit 12",
      date: "Wed, Nov 25",
      window: "9:00 AM–12:00 PM",
    });
  });

  it("en una plantilla de texto la ventana lleva guion ASCII (un SMS, S-11); la de correo, la media raya del tablero", () => {
    const entrada = { fuente: "borrador" as const, borrador: BORRADOR, job: null, propiedad: PROPIEDAD };
    expect(valoresDelJob(entrada, "text").window).toBe("9:00 AM-12:00 PM");
    expect(valoresDelJob(entrada, "email").window).toBe("9:00 AM–12:00 PM");
    expect(valoresDelJob(entrada).window).toBe("9:00 AM–12:00 PM");
  });

  it("desde Scheduled manda el job, no el borrador", () => {
    expect(valoresDelJob({ fuente: "job", borrador: BORRADOR, job: JOB, propiedad: PROPIEDAD })).toEqual({
      property: "Sample Court",
      space: "Unit 12",
      date: "Wed, Dec 2",
      window: "10:00 AM–2:00 PM",
    });
  });

  it("el espacio de BzzzBX gana a la unidad del borrador", () => {
    expect(valoresDelJob({ fuente: "borrador", borrador: { ...BORRADOR, unit: "99" }, job: null, propiedad: PROPIEDAD }).space).toBe("Unit 12");
  });

  it("sin etiqueta de espacio cae a la unidad del borrador", () => {
    const sinEspacio = { ...JOB, bzzzbx_space_id: null };
    expect(valoresDelJob({ fuente: "job", borrador: { ...BORRADOR, unit: "7C" }, job: sinEspacio, propiedad: { ...PROPIEDAD, units: [] } }).space).toBe("7C");
  });

  it("sin espacio ni unidad, el espacio es vacío (no literal): se colapsa al llenar", () => {
    const v = valoresDelJob({ fuente: "borrador", borrador: { ...BORRADOR, bzzzbx_space_id: null, unit: null }, job: null, propiedad: PROPIEDAD });
    expect(v.space).toBe("");
    expect(valoresDelJob({ fuente: "borrador", borrador: { ...BORRADOR, bzzzbx_space_id: null, unit: "  " }, job: null, propiedad: PROPIEDAD }).space).toBe("");
  });

  it("sin propiedad en BzzzBX no hay {{property}}: queda literal", () => {
    const v = valoresDelJob({ fuente: "borrador", borrador: BORRADOR, job: null, propiedad: null });
    expect(v.property).toBeUndefined();
    expect(v.space).toBe("12"); // sin la etiqueta de BzzzBX, la unidad del borrador
    expect(v.date).toBe("Wed, Nov 25");
  });

  it("sin fecha o sin ventana en el borrador, esos placeholders no tienen valor", () => {
    const v = valoresDelJob({
      fuente: "borrador",
      borrador: { ...BORRADOR, service_date: null, window_start: null, window_end: null },
      job: null,
      propiedad: PROPIEDAD,
    });
    expect(v.date).toBeUndefined();
    expect(v.window).toBeUndefined();
    expect(valoresDelJob({ fuente: "borrador", borrador: { ...BORRADOR, window_end: null }, job: null, propiedad: PROPIEDAD }).window).toBeUndefined();
  });

  it("con el job que BzzzBX no conoce, no se usa el borrador para fecha y ventana (son del job)", () => {
    const v = valoresDelJob({ fuente: "job", borrador: BORRADOR, job: null, propiedad: PROPIEDAD });
    expect(v.date).toBeUndefined();
    expect(v.window).toBeUndefined();
    expect(v.property).toBe("Sample Court");
  });

  it("la fecha de calendario no se corre por la zona horaria", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Honolulu";
      expect(valoresDelJob({ fuente: "borrador", borrador: { ...BORRADOR, service_date: "2026-11-25" }, job: null, propiedad: PROPIEDAD }).date).toBe("Wed, Nov 25");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
