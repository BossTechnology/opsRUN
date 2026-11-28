// @vitest-environment node
/**
 * El catálogo en código (spec OPR-18 §4.2): qué se ofrece en qué modo y etapa. La tabla de aquí es la del spec,
 * escrita a mano y completa (cada clave en cada etapa): el catálogo no se prueba contra sí mismo.
 */
import { describe, expect, it } from "vitest";

import { aviso, CATALOGO, CLAVES, ofrecidaEnElComposer, plantillaPermitida, PLACEHOLDERS } from "./catalogo";

const ETAPAS = ["requests", "scheduled", "in_progress", "complete", "validation", "cancelled"] as const;
type Etapa = (typeof ETAPAS)[number];

/** Dónde se ofrece cada clave en el Composer (modo y etapas), tal cual el spec §4.2. */
const COMPOSER: Record<string, { modo: "customer" | "cleaner"; etapas: Etapa[] } | null> = {
  cleaner_confirmation_request: { modo: "cleaner", etapas: ["requests"] },
  reschedule_request: { modo: "cleaner", etapas: ["scheduled"] },
  cancellation_cleaner: null,
  cancellation_requester: null,
  requester_scheduled: { modo: "customer", etapas: ["scheduled", "in_progress", "complete", "validation"] },
  requester_done: { modo: "customer", etapas: ["validation"] },
};

/** Dónde se ve cada clave como aviso del panel Notices. */
const AVISOS: Record<string, Etapa[]> = {
  cleaner_confirmation_request: [],
  reschedule_request: [],
  cancellation_cleaner: ["cancelled"],
  cancellation_requester: ["cancelled"],
  requester_scheduled: ["scheduled", "in_progress", "complete", "validation"],
  requester_done: ["validation"],
};

describe("catálogo de plantillas", () => {
  it("son las seis claves de la tarjeta y los cuatro placeholders", () => {
    expect([...CLAVES].sort()).toEqual(Object.keys(COMPOSER).sort());
    expect([...PLACEHOLDERS]).toEqual(["property", "space", "date", "window"]);
  });

  it("los nombres visibles y los canales son los del spec", () => {
    expect(Object.fromEntries(CLAVES.map((c) => [c, [CATALOGO[c].nombre, CATALOGO[c].canal]]))).toEqual({
      cleaner_confirmation_request: ["Confirmation request", "text"],
      reschedule_request: ["Reschedule request", "text"],
      cancellation_cleaner: ["Cancellation (cleaner)", "text"],
      cancellation_requester: ["Cancellation (requester)", "email"],
      requester_scheduled: ["Scheduled notice", "email"],
      requester_done: ["Done notice", "email"],
    });
  });

  it("reschedule_request deja date y window 'a mano'; ninguna otra", () => {
    expect(CATALOGO.reschedule_request.aMano).toEqual(["date", "window"]);
    for (const c of CLAVES.filter((c) => c !== "reschedule_request")) expect(CATALOGO[c].aMano).toEqual([]);
  });

  for (const clave of Object.keys(COMPOSER)) {
    describe(clave, () => {
      for (const etapa of ETAPAS) {
        for (const modo of ["customer", "cleaner"] as const) {
          const esperada = COMPOSER[clave]?.modo === modo && COMPOSER[clave]!.etapas.includes(etapa);
          it(`en ${modo} · ${etapa} ${esperada ? "se ofrece" : "no se ofrece"}`, () => {
            expect(ofrecidaEnElComposer(clave, modo, etapa)).toBe(esperada);
            expect(plantillaPermitida(clave, modo, etapa)).toBe(esperada);
          });
        }
        const esAviso = AVISOS[clave]!.includes(etapa);
        it(`en ${etapa} ${esAviso ? "es un aviso" : "no es un aviso"}`, () => {
          expect(aviso(clave, etapa)).toBe(esAviso);
        });
      }
    });
  }

  it("una clave que no es del catálogo nunca se ofrece", () => {
    expect(plantillaPermitida("otra_cosa", "customer", "validation")).toBe(false);
    expect(plantillaPermitida("__proto__", "cleaner", "requests")).toBe(false);
    expect(plantillaPermitida("constructor", "cleaner", "requests")).toBe(false);
    expect(ofrecidaEnElComposer("toString", "customer", "scheduled")).toBe(false);
    expect(aviso("hasOwnProperty", "cancelled")).toBe(false);
  });

  it("Note nunca tiene plantillas", () => {
    for (const c of CLAVES) for (const e of ETAPAS) expect(plantillaPermitida(c, "note", e)).toBe(false);
  });
});
