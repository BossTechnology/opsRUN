// @vitest-environment node
/**
 * Controles del falso de lectura que el real no tiene: cambios en el origen,
 * BzzzBX caído y reconstrucción de proyecciones (spec OPR-22 §3.4 y §5).
 */
import { describe, expect, it } from "vitest";

import { BzzzbxNoDisponible, CursorCaducado } from "../errores";
import { ENTIDADES, type Cursor } from "../tipos";

import { crearFalso, RelojManual } from ".";

describe("lectura falsa: datos", () => {
  it("tiene al menos una fila de cada entidad", async () => {
    const { lectura } = crearFalso();
    for (const entidad of ENTIDADES) expect(lectura.todos(entidad).length, entidad).toBeGreaterThan(0);
  });

  it("encaja con la seed: R4 con check-in, R6 con Paid y su cliente exige PO", async () => {
    const { lectura } = crearFalso();
    const eventos = await lectura.listarPor("jobtracker_event", { bzzzbx_job_id: "bx-job-0004" });
    expect(eventos.map((e) => e.kind)).toEqual(["checked_in", "started"]);
    expect((await lectura.obtener("payment", "bx-job-0006"))?.paid).toBe(true);
    const job = await lectura.obtener("job", "bx-job-0006");
    expect((await lectura.obtener("customer", job!.bzzzbx_customer_id))?.po_required).toBe(true);
  });

  it("la alerta OPS-001 abierta es de la request R1 de opsRUN", async () => {
    const { lectura } = crearFalso();
    const alertas = await lectura.listarPor("alert_result", {
      sujeto: { tipo: "request", request_id: "b0000000-0000-4000-8000-0000000000a1" },
    });
    expect(alertas).toMatchObject([{ bzzzbx_alert_id: "bx-alert-0001", rule_id: "OPS-001", cleared_at: null }]);
  });

  it("solo usa datos inventados: correos @example.test", () => {
    const { lectura } = crearFalso();
    const correos = [
      ...lectura.todos("contact").map((c) => c.email),
      ...lectura.todos("message").flatMap((m) => (m.channel === "email" ? [m.from, ...m.to] : [])),
    ].filter((c): c is string => !!c);
    expect(correos.length).toBeGreaterThan(0);
    for (const correo of correos) expect(correo).toMatch(/@example\.test$/);
  });

  it("las fechas de servicio se arman desde el reloj, como la seed desde current_date", async () => {
    const { lectura } = crearFalso({ reloj: new RelojManual(new Date("2030-03-10T15:00:00Z")) });
    expect((await lectura.obtener("job", "bx-job-0004"))?.service_date).toBe("2030-03-10");
    expect((await lectura.obtener("job", "bx-job-0003"))?.service_date).toBe("2030-03-11");
  });
});

describe("lectura falsa: cambios en el origen", () => {
  it("cambiar actualiza el dato, sube la versión y deja el cambio en el cursor", async () => {
    const { lectura } = crearFalso();
    const antes = await lectura.obtener("job", "bx-job-0003");
    const { cursor } = await lectura.cambiosDesde(null);
    lectura.cambiar("job", "bx-job-0003", { window_start: "11:00" });
    const despues = await lectura.obtener("job", "bx-job-0003");
    expect(despues?.window_start).toBe("11:00");
    expect(despues?.version).not.toBe(antes?.version);
    const lote = await lectura.cambiosDesde(cursor);
    expect(lote.cambios).toEqual([{ entidad: "job", id: "bx-job-0003", version: despues!.version }]);
  });

  it("cambiar no deja tocar el crosswalk ID", () => {
    const { lectura } = crearFalso();
    expect(() => lectura.cambiar("job", "bx-job-0003", { bzzzbx_job_id: "bx-job-9999" })).toThrow();
  });

  it("cambiar una entidad que no existe falla", () => {
    const { lectura } = crearFalso();
    expect(() => lectura.cambiar("job", "bx-job-9999", { po_number: "X" })).toThrow();
  });

  it("poner agrega una entidad nueva y la avisa (por ejemplo, un check-in)", async () => {
    const { lectura } = crearFalso();
    const { cursor } = await lectura.cambiosDesde(null);
    lectura.poner("jobtracker_event", {
      bzzzbx_event_id: "bx-evt-9001",
      bzzzbx_job_id: "bx-job-0003",
      kind: "checked_in",
      occurred_at: "2030-01-01T10:00:00.000Z",
    });
    const lote = await lectura.cambiosDesde(cursor);
    expect(lote.cambios.map((c) => c.id)).toEqual(["bx-evt-9001"]);
    expect(await lectura.listarPor("jobtracker_event", { bzzzbx_job_id: "bx-job-0003" })).toHaveLength(1);
  });

  it("lo leído es una copia: modificarlo no cambia el falso", async () => {
    const { lectura } = crearFalso();
    const job = await lectura.obtener("job", "bx-job-0003");
    job!.po_number = "modificado";
    expect((await lectura.obtener("job", "bx-job-0003"))?.po_number).not.toBe("modificado");
    const propiedad = await lectura.obtener("property", "bx-prop-0002");
    propiedad!.units.push({ bzzzbx_space_id: "bx-space-9999", label: "otra" });
    expect((await lectura.obtener("property", "bx-prop-0002"))?.units).toHaveLength(1);
  });

  it("parte los cambios en lotes con hay_mas", async () => {
    const { lectura } = crearFalso({ tamanoDeLote: 2 });
    let { cursor } = await lectura.cambiosDesde(null);
    for (const ventana of ["10:00", "10:30", "11:00"]) lectura.cambiar("job", "bx-job-0003", { window_start: ventana });

    const primero = await lectura.cambiosDesde(cursor);
    expect(primero.cambios).toHaveLength(2);
    expect(primero.hay_mas).toBe(true);
    cursor = primero.cursor;
    const segundo = await lectura.cambiosDesde(cursor);
    expect(segundo.cambios).toHaveLength(1);
    expect(segundo.hay_mas).toBe(false);
  });
});

describe("lectura falsa: BzzzBX no disponible", () => {
  it("todas las lecturas lanzan BzzzbxNoDisponible y vuelven al reactivarse", async () => {
    const { lectura } = crearFalso();
    const { cursor } = await lectura.cambiosDesde(null);
    lectura.noDisponible(true);
    await expect(lectura.obtener("job", "bx-job-0003")).rejects.toBeInstanceOf(BzzzbxNoDisponible);
    await expect(lectura.obtenerVarios("job", ["bx-job-0003"])).rejects.toBeInstanceOf(BzzzbxNoDisponible);
    await expect(lectura.listarPor("photo", { bzzzbx_job_id: "bx-job-0006" })).rejects.toBeInstanceOf(BzzzbxNoDisponible);
    await expect(lectura.buscarJobs({})).rejects.toBeInstanceOf(BzzzbxNoDisponible);
    await expect(lectura.cambiosDesde(cursor)).rejects.toBeInstanceOf(BzzzbxNoDisponible);
    lectura.noDisponible(false);
    expect(await lectura.obtener("job", "bx-job-0003")).not.toBeNull();
    expect((await lectura.cambiosDesde(cursor)).cambios).toEqual([]);
  });
});

describe("lectura falsa: reconstrucción (lado de opsRUN del rebuild test)", () => {
  it("el cursor viejo caduca y uno nuevo funciona", async () => {
    const { lectura } = crearFalso();
    const { cursor } = await lectura.cambiosDesde(null);
    lectura.reconstruir();
    await expect(lectura.cambiosDesde(cursor)).rejects.toBeInstanceOf(CursorCaducado);
    const nuevo = await lectura.cambiosDesde(null);
    expect((await lectura.cambiosDesde(nuevo.cursor)).cambios).toEqual([]);
  });

  it("los crosswalk IDs y los datos son los mismos después, también los cambiados", async () => {
    const { lectura } = crearFalso();
    lectura.cambiar("job", "bx-job-0003", { po_number: "PO-EX-9999" });
    const foto = () => ENTIDADES.map((e) => lectura.todos(e));
    const antes = foto();
    lectura.reconstruir();
    expect(foto()).toEqual(antes);
  });

  it("rechaza un cursor manipulado", async () => {
    const { lectura } = crearFalso();
    const { cursor } = await lectura.cambiosDesde(null);
    await expect(lectura.cambiosDesde(`${cursor}9` as Cursor)).rejects.toBeInstanceOf(CursorCaducado);
  });
});
