// @vitest-environment node
/**
 * La prueba de humo del deploy (scripts/humo.mjs) y la revisión del entorno
 * antes de tocar la base (scripts/verificar-entorno.mjs).
 */
import { describe, expect, it } from "vitest";

import { evaluarSalud } from "../../scripts/humo.mjs";
import { verificarEntorno } from "../../scripts/verificar-entorno.mjs";

import { PROHIBIDAS_EN_SERVIDOR } from "./db/entorno";

describe("evaluarSalud", () => {
  it("pasa con la base en la misma migración que la imagen", () => {
    expect(evaluarSalud({ status: "ok", schema_version: "20261124130000" }, "20261124130000").ok).toBe(true);
  });

  it("pasa con la base por delante de la imagen, como tras una vuelta atrás", () => {
    expect(evaluarSalud({ status: "ok", schema_version: "20261201000000" }, "20261124130000").ok).toBe(true);
  });

  it("falla si a la base le faltan migraciones de la imagen", () => {
    const { ok, motivo } = evaluarSalud({ status: "ok", schema_version: "20261124120000" }, "20261124130000");
    expect(ok).toBe(false);
    expect(motivo).toMatch(/faltan migraciones/);
  });

  it("falla si la base no responde o la respuesta no es la esperada", () => {
    expect(evaluarSalud({ status: "error" }, "20261124130000").ok).toBe(false);
    expect(evaluarSalud({ status: "ok", schema_version: null }, "20261124130000").ok).toBe(false);
    expect(evaluarSalud("ok", "20261124130000").ok).toBe(false);
    expect(evaluarSalud(null, "20261124130000").ok).toBe(false);
  });
});

describe("verificarEntorno", () => {
  const secretos = `${process.cwd()}/no-existe/app.env`;
  const base = {
    OPSRUN_SERVIDOR: "1",
    OPSRUN_DB_HOST: "db.ejemplo.test",
    OPSRUN_GOTRUE_URL: "https://auth.ejemplo.test",
    OPSRUN_SECRETS_FILE: secretos,
  };

  it("exige OPSRUN_SERVIDOR=1", () => {
    expect(verificarEntorno({ ...base, OPSRUN_SERVIDOR: undefined })).toEqual([
      expect.stringMatching(/OPSRUN_SERVIDOR/),
    ]);
  });

  it("rechaza cada variable prohibida por nombre, sin mostrar su valor", () => {
    for (const nombre of PROHIBIDAS_EN_SERVIDOR) {
      const problemas = verificarEntorno({ ...base, [nombre]: "valor-secreto-de-prueba" });
      expect(problemas).toContain(`${nombre} no debe estar en el servidor`);
      expect(problemas.join(" ")).not.toContain("valor-secreto-de-prueba");
    }
  });

  it("rechaza el stand-in de BzzzBX en el servidor (OPR-22)", () => {
    expect(verificarEntorno({ ...base, BZZZBX_MODO: "falso" })).toContain("BZZZBX_MODO=falso no se permite en el servidor");
  });

  it("dice si falta el archivo de secretos", () => {
    expect(verificarEntorno(base).join(" ")).toContain("no se pudo leer el archivo de secretos");
  });
});
