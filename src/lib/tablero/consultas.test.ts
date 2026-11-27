// @vitest-environment node
/**
 * Las consultas del tablero contra la base con la seed, como opsrun_app.
 * Corren solo con OPSRUN_REQUIERE_BASE=1 (job de E2E del CI, base nueva), como
 * `seed-y-falso.test.ts`: una base local ya usada puede tener una seed vieja.
 */
import { afterAll, describe, expect, it } from "vitest";

import { urlsSupabaseLocal } from "../../../scripts/supabase-local.mjs";
import { comoOpsrunApp, crearPool } from "../db/pool";

import { leerFilas, leerMarca } from "./consultas";

function urlApp(): string | null {
  // OPSRUN_DATABASE_URL apunta a otra base (por ejemplo una temporal) sin tocar la compartida.
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

conBase("consultas del tablero (seed)", () => {
  const origen = crearPool({ tipo: "url", url: url ?? "postgresql://sin-base" });
  afterAll(() => origen.end());

  it("lee las ocho requests de la seed con sus tipos de texto", async () => {
    const filas = await comoOpsrunApp(leerFilas, { origen });
    const seed = filas.filter((f) => f.id.startsWith("b0000000-0000-4000-8000-0000000000a"));
    expect(seed).toHaveLength(8);
    const r2 = seed.find((f) => f.id.endsWith("a2"))!;
    expect(r2).toMatchObject({
      status: "open",
      owner_display_name: "Ops Uno",
      bzzzbx_property_id: "bx-prop-0002",
      window_start: "09:00",
      window_end: "12:00",
      bzzzbx_thread_id: "bx-thread-0002",
    });
    expect(typeof r2.r_number).toBe("number");
    expect(r2.service_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r2.received_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const r6 = seed.find((f) => f.id.endsWith("a6"))!;
    expect(r6).toMatchObject({ status: "scheduled", bzzzbx_job_id: "bx-job-0006", job_number: "EX-00006" });
    expect(r6.approved_at).not.toBeNull();
  });

  it("la marca de opsRUN es el último Audit", async () => {
    expect(await comoOpsrunApp(leerMarca, { origen })).toMatch(/^\d+$/);
  });
});
