// @vitest-environment node
import { describe, expect, it } from "vitest";

import { aplicarControl } from "./control";
import { crearFalso } from "./index";

describe("aplicarControl (ruta de control del falso, solo E2E)", () => {
  it("cambiar una entidad", async () => {
    const falso = crearFalso();
    const r = aplicarControl(falso, { accion: "cambiar", entidad: "job_health", id: "bx-job-0003", parche: { status: "breached" } });
    expect(r).toEqual({ ok: true });
    expect((await falso.lectura.obtener("job_health", "bx-job-0003"))?.status).toBe("breached");
  });

  it("poner una entidad nueva", async () => {
    const falso = crearFalso();
    aplicarControl(falso, {
      accion: "poner",
      entidad: "jobtracker_event",
      valor: { bzzzbx_event_id: "bx-evt-0100", bzzzbx_job_id: "bx-job-0003", kind: "checked_in", occurred_at: "2026-11-24T10:00:00Z" },
    });
    expect(await falso.lectura.obtener("jobtracker_event", "bx-evt-0100")).not.toBeNull();
  });

  it("BzzzBX caído y de vuelta", () => {
    const falso = crearFalso();
    aplicarControl(falso, { accion: "no_disponible", valor: true });
    expect(falso.lectura.disponible).toBe(false);
    aplicarControl(falso, { accion: "no_disponible", valor: false });
    expect(falso.lectura.disponible).toBe(true);
  });

  it("rechaza lo que no entiende", () => {
    const falso = crearFalso();
    expect(aplicarControl(falso, { accion: "borrar_todo" })).toMatchObject({ ok: false });
    expect(aplicarControl(falso, { accion: "cambiar", entidad: "no_existe", id: "x", parche: {} })).toMatchObject({ ok: false });
    expect(aplicarControl(falso, { accion: "cambiar", entidad: "job", id: "bx-job-9999", parche: {} })).toMatchObject({ ok: false });
    expect(aplicarControl(falso, null)).toMatchObject({ ok: false });
  });
});
