import { describe, expect, it } from "vitest";

import { leerEntornoSupabase } from "./entorno";

describe("leerEntornoSupabase", () => {
  it("devuelve la URL y la llave del servidor", () => {
    const entorno = leerEntornoSupabase({
      SUPABASE_URL: " http://127.0.0.1:58321 ",
      SUPABASE_SECRET_KEY: "llave-de-prueba",
    });
    expect(entorno).toEqual({ url: "http://127.0.0.1:58321", secretKey: "llave-de-prueba" });
  });

  it("nombra todas las variables que faltan", () => {
    expect(() => leerEntornoSupabase({})).toThrow(
      "Faltan variables de entorno: SUPABASE_URL, SUPABASE_SECRET_KEY",
    );
  });

  it("trata una variable vacía como faltante", () => {
    expect(() =>
      leerEntornoSupabase({ SUPABASE_URL: "http://127.0.0.1:58321", SUPABASE_SECRET_KEY: "  " }),
    ).toThrow("Faltan variables de entorno: SUPABASE_SECRET_KEY");
  });

  it("no usa NEXT_PUBLIC_SUPABASE_URL, que Next congela en el build", () => {
    expect(() =>
      leerEntornoSupabase({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:58321",
        SUPABASE_SECRET_KEY: "llave-de-prueba",
      }),
    ).toThrow("SUPABASE_URL");
  });
});
