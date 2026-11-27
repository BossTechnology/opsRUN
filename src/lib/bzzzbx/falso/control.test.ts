// @vitest-environment node
import { describe, expect, it } from "vitest";

import { aplicarControl } from "./control";
import { crearFalso, RelojManual, type Falso } from "./index";

async function esperarCierre(falso: Falso, clave: string) {
  for (let i = 0; i < 20; i++) {
    const r = await falso.instrucciones.estado(clave);
    if (r && r.estado !== "en_curso") return r;
    (falso.reloj as RelojManual).adelantar(falso.instrucciones.pasoMs);
  }
  throw new Error("no cerró");
}

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

  it("forzar_error: el próximo envío del tipo falla como se pidió (OPR-27)", async () => {
    const falso = crearFalso({ reloj: new RelojManual() });
    expect(
      aplicarControl(falso, { accion: "forzar_error", tipo: "send_email", cuando: "al_ejecutar", error_message: "Nope." }),
    ).toEqual({ ok: true });
    await falso.instrucciones.entregar({
      idempotency_key: "kc1",
      tipo: "send_email",
      payload: { bzzzbx_thread_id: "bx-thread-0002", body: "x" },
      actor: { tipo: "operator", operator_id: "0a000000-0000-4000-8000-0000000000a1" },
    });
    const cierre = await esperarCierre(falso, "kc1");
    expect(cierre).toMatchObject({ estado: "fallida", error_code: "forced_error", error_message: "Nope." });
  });

  it("forzar_error rechaza un tipo o un momento que no existen", () => {
    const falso = crearFalso();
    expect(aplicarControl(falso, { accion: "forzar_error", tipo: "borrar", cuando: "al_ejecutar" })).toMatchObject({ ok: false });
    expect(aplicarControl(falso, { accion: "forzar_error", tipo: "send_email", cuando: "nunca" })).toMatchObject({ ok: false });
    expect(aplicarControl(falso, { accion: "forzar_error", tipo: "send_email", cuando: "al_ejecutar", error_message: 3 })).toMatchObject({ ok: false });
  });

  it("rechaza lo que no entiende", () => {
    const falso = crearFalso();
    expect(aplicarControl(falso, { accion: "borrar_todo" })).toMatchObject({ ok: false });
    expect(aplicarControl(falso, { accion: "cambiar", entidad: "no_existe", id: "x", parche: {} })).toMatchObject({ ok: false });
    expect(aplicarControl(falso, { accion: "cambiar", entidad: "job", id: "bx-job-9999", parche: {} })).toMatchObject({ ok: false });
    expect(aplicarControl(falso, null)).toMatchObject({ ok: false });
  });
});
