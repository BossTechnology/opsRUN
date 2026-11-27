// @vitest-environment node
/**
 * Las consultas de la Job window contra la base con la seed, como opsrun_app.
 * Corren solo con OPSRUN_REQUIERE_BASE=1 (job de E2E del CI, base nueva), como
 * las del tablero. Con OPSRUN_DATABASE_URL se apuntan a otra base (una temporal).
 */
import { afterAll, describe, expect, it } from "vitest";

import { urlsSupabaseLocal } from "../../../scripts/supabase-local.mjs";
import { comoOpsrunApp, crearPool } from "../db/pool";

import { esIdDeRequest, leerDeOpsrun } from "./consultas";

function urlApp(): string | null {
  if (process.env.OPSRUN_DATABASE_URL) return process.env.OPSRUN_DATABASE_URL;
  try {
    return urlsSupabaseLocal().app;
  } catch {
    return null;
  }
}

const requiereBase = process.env.OPSRUN_REQUIERE_BASE === "1";
const url = requiereBase ? urlApp() : null;
const conBase = requiereBase ? describe : describe.skip;

const id = (n: number) => `b0000000-0000-4000-8000-0000000000a${n}`;

describe("esIdDeRequest", () => {
  it("solo un uuid puede ser una request", () => {
    expect(esIdDeRequest(id(3))).toBe(true);
    expect(esIdDeRequest("no-es-uuid")).toBe(false);
    expect(esIdDeRequest("")).toBe(false);
    expect(esIdDeRequest(`${id(3)}; drop table opsrun.request`)).toBe(false);
  });
});

conBase("consultas de la Job window (seed)", () => {
  const origen = crearPool({ tipo: "url", url: url ?? "postgresql://sin-base" });
  afterAll(() => origen.end());
  const leer = (n: number | string) =>
    comoOpsrunApp((db) => leerDeOpsrun(db, typeof n === "number" ? id(n) : n), { origen });

  it("R3: la fila del tablero más contacto, equipo, notas y change_seq como texto", async () => {
    const r = (await leer(3))!;
    expect(r.fila).toMatchObject({
      id: id(3),
      status: "scheduled",
      owner_display_name: "Ops Uno",
      bzzzbx_job_id: "bx-job-0003",
      job_number: "EX-00003",
      bzzzbx_contact_id: "bx-cont-0001",
      bzzzbx_team_id: "bx-team-0002",
      access_notes: null,
      po_number: "PO-EX-0003",
      window_start: "10:00",
    });
    expect(r.fila.change_seq).toMatch(/^\d+$/);
    expect(r.hilos).toEqual(["bx-thread-0003"]);
    expect(r.confirmaciones).toEqual({ details: true, sender: true, cleaner: true });
    expect(r.instruccionAbierta).toBe(false);
  });

  it("R2 espera al cleaner: details y sender vigentes, el cleaner no", async () => {
    const r = (await leer(2))!;
    expect(r.confirmaciones).toEqual({ details: true, sender: true, cleaner: false });
    expect(r.fila.access_notes).toBe("Key at the front desk.");
  });

  it("R1 no tiene confirmaciones ni dueño", async () => {
    const r = (await leer(1))!;
    expect(r.confirmaciones).toEqual({ details: false, sender: false, cleaner: false });
    expect(r.fila.owner_operator_id).toBeNull();
  });

  it("R7 (P-3): en Requests, con dueño, las tres confirmaciones y su hilo", async () => {
    const r = (await leer(7))!;
    expect(r.fila).toMatchObject({
      status: "open",
      owner_display_name: "Ops Dos",
      bzzzbx_customer_id: "bx-cust-0002",
      bzzzbx_property_id: "bx-prop-0004",
      window_start: "13:00",
      window_end: "16:00",
      bzzzbx_team_id: "bx-team-0001",
      bzzzbx_job_id: null,
    });
    expect(r.confirmaciones).toEqual({ details: true, sender: true, cleaner: true });
    expect(r.hilos).toEqual(["bx-thread-0007"]);
  });

  it("los operadores activos con su carga: requests suyas que aún no llegan a Validation", async () => {
    const { operadores } = (await leer(3))!;
    const porNombre = Object.fromEntries(operadores.map((o) => [o.nombre, o.abiertas]));
    // Ops Uno: R2 y R3. Ops Dos: R4, R5 y R7. Finance Uno: R6, ya aprobada.
    expect(porNombre).toMatchObject({ "Ops Uno": 2, "Ops Dos": 3, "Finance Uno": 0, "Finance Dos": 0 });
  });

  it("una request que no existe es null", async () => {
    expect(await leer("b0000000-0000-4000-8000-0000000000ff")).toBeNull();
  });

  it("la seed deja a los operadores un auth_user_id inventado y fijo (P-2)", async () => {
    const { rows } = await comoOpsrunApp((db) => db.query<{ id: string; auth: string | null }>(
      "select id::text, auth_user_id::text as auth from opsrun.operator order by id",
    ), { origen });
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const fila of rows.filter((r) => r.id.startsWith("0a000000"))) {
      expect(fila.auth, fila.id).toMatch(/^de000000-0000-4000-8000-0000000000(a1|a2|b1|b2)$/);
    }
  });
});
