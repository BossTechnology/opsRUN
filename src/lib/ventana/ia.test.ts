// @vitest-environment node
/**
 * Lo que la Job window lee del análisis de IA (OPR-36 §7): `leerIa` contra la base con la seed, como
 * opsrun_app y en solo lectura (corre con OPSRUN_REQUIERE_BASE=1, como las demás consultas de la ventana), y
 * las funciones puras que sacan los IDs propuestos y sus nombres.
 */
import { afterAll, describe, expect, it } from "vitest";

import { urlsSupabaseLocal } from "../../../scripts/supabase-local.mjs";
import type { SugerenciaLeida } from "../analisis-ia/tipos";
import { comoOpsrunApp, crearPool } from "../db/pool";

import { idsProponidos, leerIa, nombresParaIa } from "./ia";
import { LEIDOS_VENTANA_VACIOS } from "./tipos";

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

const s = (campo: SugerenciaLeida["campo"], rank: number, valor: unknown): SugerenciaLeida => ({ id: `s-${campo}-${rank}`, campo, rank, valor, razon: null });

describe("idsProponidos", () => {
  it("saca los crosswalk IDs de la principal y de las alternativas, sin repetir y sin null", () => {
    expect(
      idsProponidos([
        s("property", 1, "bx-prop-0001"),
        s("property", 2, "bx-prop-0002"),
        s("property", 3, "bx-prop-0001"),
        s("service", 1, "bx-svc-0001"),
        s("sender", 1, { bzzzbx_customer_id: "bx-cust-0001", bzzzbx_contact_id: null }),
        s("sender", 2, { bzzzbx_customer_id: "bx-cust-0002", bzzzbx_contact_id: "bx-cont-0002" }),
        s("unit", 1, "4B"),
      ]),
    ).toEqual({
      propiedades: ["bx-prop-0001", "bx-prop-0002"],
      servicios: ["bx-svc-0001"],
      clientes: ["bx-cust-0001", "bx-cust-0002"],
      contactos: ["bx-cont-0002"],
    });
  });

  it("sin sugerencias, nada que leer", () => {
    expect(idsProponidos([])).toEqual({ propiedades: [], servicios: [], clientes: [], contactos: [] });
  });
});

describe("nombresParaIa", () => {
  it("junta los nombres de lo leído de BzzzBX por crosswalk ID", () => {
    const nombres = nombresParaIa({
      ...LEIDOS_VENTANA_VACIOS,
      properties: [{ bzzzbx_property_id: "bx-prop-0001", name: "Example Tower", city: "X", units: [], default_team_id: null }],
      services: [{ bzzzbx_service_id: "bx-svc-0001", name: "Regular clean", type: "clean" }],
      customers: [{ bzzzbx_customer_id: "bx-cust-0001", name: "Example Group", po_required: false }],
      contactos: [{ bzzzbx_contact_id: "bx-cont-0001", bzzzbx_customer_id: "bx-cust-0001", name: "Ana Ejemplo", email: null, phone: null }],
    } as never);
    expect(nombres).toEqual({
      "bx-prop-0001": "Example Tower",
      "bx-svc-0001": "Regular clean",
      "bx-cust-0001": "Example Group",
      "bx-cont-0001": "Ana Ejemplo",
    });
  });
});

conBase("leerIa contra la seed", () => {
  const origen = crearPool({ tipo: "url", url: url ?? "postgresql://sin-base" });
  afterAll(() => origen.end());
  const leer = (n: number) => comoOpsrunApp((db) => leerIa(db, id(n)), { origen });

  it("R1: el último análisis completed y su sugerencia abierta de un campo de §4.1 (sin cleaner_team ni borradores de mensaje)", async () => {
    const ia = await leer(1);
    expect(ia.analisis).toMatchObject({ id: "e0000000-0000-4000-8000-0000000000a1", estado: "completed" });
    expect(ia.analisis?.requested_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(ia.analisis?.completed_at).not.toBeNull();
    expect(ia.sugerencias.map((x) => [x.campo, x.rank, x.valor])).toEqual([["unit", 1, "4B"]]);
  });

  it("R2, R7 y R8: el análisis completed de la seed (sin sugerencias de §4.1, salvo la propiedad de R8)", async () => {
    for (const n of [2, 7]) {
      const ia = await leer(n);
      expect(ia.analisis).toMatchObject({ estado: "completed" });
      expect(ia.sugerencias).toEqual([]);
    }
    const r8 = await leer(8);
    expect(r8.analisis).toMatchObject({ estado: "completed" });
    expect(r8.sugerencias.map((x) => x.campo)).toEqual(["property"]);
  });

  it("una request scheduled no tiene análisis", async () => {
    expect((await leer(3)).analisis).toBeNull();
  });

  it("solo lee: corre en solo lectura", async () => {
    await expect(
      comoOpsrunApp(async (db) => {
        await leerIa(db, id(1));
        return db.query("select opsrun.start_ai_analysis($1::uuid)", [id(1)]);
      }, { origen }),
    ).rejects.toThrow();
  });
});
