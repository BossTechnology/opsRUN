// @vitest-environment node
import { describe, expect, it } from "vitest";

import { BzzzbxNoDisponible, FiltroInvalido } from "../bzzzbx/errores";
import { crearFalso } from "../bzzzbx/falso";
import type { LecturaBzzzbx } from "../bzzzbx/puertos";
import type { DatosDeEnlace, RequestParaEnlace } from "../fase-a/enlace";

import { propuestaParaLaVentana } from "./propuesta";

const ahora = new Date();
const dia = (d: number) => new Date(ahora.getTime() + d * 86_400_000).toISOString().slice(0, 10);

/** R7 de la seed: cliente 2, propiedad 4, dentro de tres días, 13:00 a 16:00, equipo 1. */
const R7: RequestParaEnlace = {
  id: "b0000000-0000-4000-8000-0000000000a7",
  status: "open",
  received_at: new Date(ahora.getTime() - 4 * 3_600_000).toISOString(),
  bzzzbx_customer_id: "bx-cust-0002",
  bzzzbx_property_id: "bx-prop-0004",
  service_date: dia(3),
  window_start: "13:00",
  window_end: "16:00",
  bzzzbx_team_id: "bx-team-0001",
};

const datos = (request: RequestParaEnlace | null = R7): DatosDeEnlace => ({
  leerRequest: async () => request,
  jobsEnlazadosAOtra: async () => new Set(),
  jobsRechazados: async () => new Set(),
  enlazar: async () => {},
  rechazar: async () => {},
});

describe("propuestaParaLaVentana", () => {
  it("R7 (P-3): el job inventado del falso encaja y sale como sugerido", async () => {
    const { lectura } = crearFalso();
    const propuesta = await propuestaParaLaVentana({ lectura, datos: datos() }, R7.id);
    expect(propuesta).toMatchObject({ truncado: false });
    if ("error" in propuesta) throw new Error("no debía fallar");
    expect(propuesta.candidatos[0]).toMatchObject({
      sugerido: true,
      job: { bzzzbx_job_id: "bx-job-0107", job_number: "EX-00107" },
    });
    expect(propuesta.candidatos[0]!.coincide).toEqual(
      expect.arrayContaining(["misma_propiedad", "mismo_cliente", "misma_fecha", "misma_ventana", "mismo_equipo"]),
    );
  });

  it("sin BzzzBX, el error que pide la ranura (reconocido por nombre)", async () => {
    const { lectura } = crearFalso();
    lectura.noDisponible(true);
    expect(await propuestaParaLaVentana({ lectura, datos: datos() }, R7.id)).toEqual({ error: "bzzzbx_no_disponible" });
    const deOtraCopia = new (class extends Error {})("caído");
    deOtraCopia.name = "BzzzbxNoDisponible";
    const rota = { buscarJobs: () => Promise.reject(deOtraCopia) } as unknown as LecturaBzzzbx;
    expect(await propuestaParaLaVentana({ lectura: rota, datos: datos() }, R7.id)).toEqual({ error: "bzzzbx_no_disponible" });
    expect(new BzzzbxNoDisponible()).toBeInstanceOf(Error);
  });

  it("un filtro que BzzzBX no acepta se ve como sin candidatos, sin romper la ventana", async () => {
    const rota = { buscarJobs: () => Promise.reject(new FiltroInvalido("rango")) } as unknown as LecturaBzzzbx;
    expect(await propuestaParaLaVentana({ lectura: rota, datos: datos() }, R7.id)).toEqual({
      candidatos: [],
      truncado: false,
      motivo_vacio: "sin_candidatos",
    });
  });

  it("un error inesperado sube: no se disfraza", async () => {
    const rota = { buscarJobs: () => Promise.reject(new Error("bug")) } as unknown as LecturaBzzzbx;
    await expect(propuestaParaLaVentana({ lectura: rota, datos: datos() }, R7.id)).rejects.toThrow("bug");
  });
});
