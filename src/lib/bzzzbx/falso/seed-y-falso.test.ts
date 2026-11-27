// @vitest-environment node
/**
 * El falso y `supabase/seed.sql` hablan de las mismas cosas: todo crosswalk ID
 * de la seed existe en el falso (spec OPR-22 §5).
 *
 * - Los IDs escritos en la seed se leen del archivo.
 * - Los que la seed arma (`bx-job-…`, `bx-msg-…`, `bx-thread-…`, job numbers)
 *   se leen de la base recién cargada. Corre solo con OPSRUN_REQUIERE_BASE=1
 *   (job de E2E del CI, base nueva): una base local ya usada puede tener una
 *   seed cargada antes de que esos IDs dejaran de salir del R number.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { urlsSupabaseLocal } from "../../../../scripts/supabase-local.mjs";
import { CLAVE, ENTIDADES } from "../tipos";

import { crearFalso } from ".";

/** Crosswalk IDs que no son entidades de lectura: referencias de instrucciones. */
const NO_SON_ENTIDADES = /^bx-ref-/;

function idsDelFalso(): Set<string> {
  const { lectura } = crearFalso();
  const ids = new Set<string>();
  for (const entidad of ENTIDADES) {
    for (const fila of lectura.todos(entidad) as Record<string, unknown>[]) {
      ids.add(String(fila[CLAVE[entidad]]));
      if (entidad === "property") for (const u of fila.units as { bzzzbx_space_id: string }[]) ids.add(u.bzzzbx_space_id);
      if (entidad === "message" && fila.bzzzbx_thread_id) ids.add(String(fila.bzzzbx_thread_id));
      if (entidad === "job") ids.add(String(fila.job_number));
      if (entidad === "payment" && fila.bzzzbx_event_id) ids.add(String(fila.bzzzbx_event_id));
    }
  }
  return ids;
}

describe("seed y falso: IDs escritos en la seed", () => {
  const seed = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
  const literales = [...new Set(seed.match(/'bx-[a-z]+-\d{4}'/g)?.map((m) => m.slice(1, -1)) ?? [])].filter(
    (id) => !NO_SON_ENTIDADES.test(id),
  );

  it("la seed trae crosswalk IDs (si no, esta prueba no prueba nada)", () => {
    expect(literales.length).toBeGreaterThan(20);
  });

  it("todos existen en el falso", () => {
    const ids = idsDelFalso();
    expect(literales.filter((id) => !ids.has(id))).toEqual([]);
  });

  it("un ID de la seed que el falso no tiene se detecta", () => {
    const ids = idsDelFalso();
    expect(["bx-prop-0099", ...literales].filter((id) => !ids.has(id))).toEqual(["bx-prop-0099"]);
  });
});

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

conBase("seed y falso: IDs que la seed arma en la base", () => {
  it("todos los crosswalk IDs y job numbers de la seed cargada existen en el falso", async () => {
    expect(url, "Supabase local no responde a `supabase status`").not.toBeNull();
    const cliente = new Client({ connectionString: url! });
    await cliente.connect();
    try {
      const { rows } = await cliente.query<{ id: string }>(`
        select unnest(array[bzzzbx_customer_id, bzzzbx_contact_id, bzzzbx_property_id, bzzzbx_space_id,
                            bzzzbx_service_id, bzzzbx_team_id, bzzzbx_job_id, job_number]) as id from opsrun.request
        union select bzzzbx_message_id from opsrun.request_message
        union select bzzzbx_thread_id from opsrun.request_message
        union select bzzzbx_team_id from opsrun.cleaner_confirmation
        union select bzzzbx_alert_id from opsrun.alert_occurrence
        union select bzzzbx_event_id from opsrun.audit_event
      `);
      const enLaBase = rows.map((r) => r.id).filter((id): id is string => !!id);
      expect(enLaBase.length).toBeGreaterThan(20);
      const ids = idsDelFalso();
      expect(enLaBase.filter((id) => !ids.has(id))).toEqual([]);
    } finally {
      await cliente.end();
    }
  });
});
