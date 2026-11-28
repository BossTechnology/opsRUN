// @vitest-environment node
/**
 * Enlace request ↔ job observado en la Fase A (spec Fase A §4 a §6), contra el
 * falso de BzzzBX y unos datos de opsRUN en memoria.
 */
import { describe, expect, it, vi } from "vitest";

import { BzzzbxNoDisponible } from "@/lib/bzzzbx/errores";
import { BUSCAR_JOBS_MAX, type Job } from "@/lib/bzzzbx/tipos";
import { crearFalso, RelojManual } from "@/lib/bzzzbx/falso";
import type { Actor } from "@/lib/db/pool";

import {
  confirmarEnlace,
  EnlaceInvalido,
  proponerEnlaces,
  rechazarEnlace,
  type DatosDeEnlace,
  type RequestParaEnlace,
} from "./enlace";

const OPERADOR: Actor = { tipo: "operador", authUserId: "5a000000-0000-4000-8000-0000000000a1" };
const R2 = "b0000000-0000-4000-8000-0000000000a2";

function preparar(cambios: Partial<RequestParaEnlace> = {}, opciones: { rechazados?: string[] } = {}) {
  const reloj = new RelojManual();
  const falso = crearFalso({ reloj });
  const dia = (n: number) => new Date(reloj.ahora().getTime() + n * 86_400_000).toISOString().slice(0, 10);
  const request: RequestParaEnlace = {
    id: R2,
    status: "open",
    bzzzbx_job_id: null,
    change_seq: "1",
    received_at: new Date(reloj.ahora().getTime() - 3 * 3_600_000).toISOString(),
    bzzzbx_customer_id: "bx-cust-0001",
    bzzzbx_property_id: "bx-prop-0002",
    service_date: dia(2),
    window_start: "09:00",
    window_end: "12:00",
    bzzzbx_team_id: "bx-team-0001",
    ...cambios,
  };
  // bx-job-0003 es de R3: ya enlazado a otra request.
  const enlazadosAOtra = new Set(["bx-job-0003", "bx-job-0004", "bx-job-0005", "bx-job-0006"]);
  const datos = {
    leerRequest: vi.fn(async (id: string) => (id === request.id ? request : null)),
    jobsEnlazadosAOtra: vi.fn(async (_requestId: string, ids: string[]) => new Set(ids.filter((id) => enlazadosAOtra.has(id)))),
    jobsRechazados: vi.fn(async () => new Set(opciones.rechazados ?? [])),
    jobsReenlazados: vi.fn(async () => new Set<string>()),
    enlazar: vi.fn(async () => {}),
    rechazar: vi.fn(async () => {}),
    cambiar: vi.fn(async () => {}),
  } satisfies DatosDeEnlace;
  const buscar = vi.spyOn(falso.lectura, "buscarJobs");
  return { deps: { lectura: falso.lectura, datos }, datos, falso, buscar, dia };
}

describe("proponerEnlaces", () => {
  it("propone primero el job que coincide en propiedad y fecha, marcado como Suggested", async () => {
    const { deps } = preparar();
    const { candidatos, motivo_vacio } = await proponerEnlaces(deps, R2);
    expect(motivo_vacio).toBeUndefined();
    expect(candidatos.map((c) => c.job.bzzzbx_job_id)).toEqual(["bx-job-0102", "bx-job-0105", "bx-job-0103"]);
    expect(candidatos[0].sugerido).toBe(true);
    expect(candidatos[0].coincide).toEqual(["misma_propiedad", "mismo_cliente", "misma_fecha", "misma_ventana", "mismo_equipo"]);
    expect(candidatos[1].sugerido).toBe(false);
    expect(candidatos[1].coincide).toEqual(["misma_propiedad", "misma_fecha", "misma_ventana", "mismo_equipo"]);
    expect(candidatos[2].coincide).toEqual(["misma_propiedad", "mismo_cliente"]);
  });

  it("con propiedad y cliente busca por la propiedad, en la fecha del borrador ± 3 días", async () => {
    const { deps, buscar, dia } = preparar();
    await proponerEnlaces(deps, R2);
    expect(buscar).toHaveBeenCalledWith({ bzzzbx_property_id: "bx-prop-0002", desde: dia(-1), hasta: dia(5) });
  });

  it("descarta los cancelados y los enlazados a otra request", async () => {
    const { deps } = preparar({ bzzzbx_property_id: null });
    const ids = (await proponerEnlaces(deps, R2)).candidatos.map((c) => c.job.bzzzbx_job_id);
    expect(ids).not.toContain("bx-job-0104");
    expect(ids).not.toContain("bx-job-0003");
    expect(ids).toContain("bx-job-0102");
  });

  it("sin propiedad busca por cliente", async () => {
    const { deps, buscar, dia } = preparar({ bzzzbx_property_id: null });
    const { candidatos } = await proponerEnlaces(deps, R2);
    expect(buscar).toHaveBeenCalledWith({ bzzzbx_customer_id: "bx-cust-0001", desde: dia(-1), hasta: dia(5) });
    expect(candidatos.map((c) => c.job.bzzzbx_job_id)).not.toContain("bx-job-0105");
  });

  it("marca truncado cuando BzzzBX devolvió el máximo, aunque después se descarten algunos", async () => {
    const { deps, falso, dia } = preparar();
    const relleno = (n: number): Job & { version: string; leido_en: string } => ({
      bzzzbx_job_id: `bx-job-9${String(n).padStart(3, "0")}`,
      job_number: `EX-9${String(n).padStart(4, "0")}`,
      bzzzbx_customer_id: "bx-cust-0002",
      bzzzbx_property_id: "bx-prop-0002",
      bzzzbx_space_id: null,
      bzzzbx_service_id: "bx-svc-0001",
      service_date: dia(3),
      window_start: null,
      window_end: null,
      status: n % 2 === 0 ? "cancelled" : "scheduled",
      bzzzbx_team_id: null,
      po_number: null,
      version: "v",
      leido_en: new Date(0).toISOString(),
    });
    vi.spyOn(falso.lectura, "buscarJobs").mockResolvedValueOnce(Array.from({ length: BUSCAR_JOBS_MAX }, (_, n) => relleno(n)));
    const propuesta = await proponerEnlaces(deps, R2);
    expect(propuesta.truncado).toBe(true);
    expect(propuesta.candidatos.length).toBe(BUSCAR_JOBS_MAX / 2);
  });

  it("no marca truncado con menos del máximo", async () => {
    const { deps } = preparar();
    expect((await proponerEnlaces(deps, R2)).truncado).toBe(false);
  });

  it("no vuelve a proponer un job que el operador rechazó para esta request", async () => {
    const { deps } = preparar({}, { rechazados: ["bx-job-0102"] });
    const { candidatos } = await proponerEnlaces(deps, R2);
    expect(candidatos.map((c) => c.job.bzzzbx_job_id)).toEqual(["bx-job-0105", "bx-job-0103"]);
    expect(candidatos.every((c) => !c.sugerido)).toBe(true);
  });

  it("sin fecha busca desde el día UTC antes de la llegada hasta 30 días después", async () => {
    const { deps, buscar, dia } = preparar({ bzzzbx_customer_id: null, service_date: null });
    const { candidatos } = await proponerEnlaces(deps, R2);
    expect(buscar).toHaveBeenCalledWith({ bzzzbx_property_id: "bx-prop-0002", desde: dia(-1), hasta: dia(30) });
    expect(candidatos.map((c) => c.job.bzzzbx_job_id)).toEqual(["bx-job-0102", "bx-job-0105", "bx-job-0103"]);
    expect(candidatos.every((c) => !c.sugerido)).toBe(true);
  });

  it("una request que llega de noche en América (02:00Z) ve un job del día anterior en UTC", async () => {
    const { deps, buscar } = preparar({ service_date: null, received_at: "2030-01-16T02:00:00Z" });
    await proponerEnlaces(deps, R2);
    expect(buscar).toHaveBeenCalledWith({ bzzzbx_property_id: "bx-prop-0002", desde: "2030-01-15", hasta: "2030-02-15" });
  });

  it("sin cliente ni propiedad no busca y dice por qué", async () => {
    const { deps, buscar } = preparar({ bzzzbx_customer_id: null, bzzzbx_property_id: null });
    expect(await proponerEnlaces(deps, R2)).toEqual({ candidatos: [], truncado: false, motivo_vacio: "sin_cliente_ni_propiedad" });
    expect(buscar).not.toHaveBeenCalled();
  });

  it("una request ya programada no tiene propuestas", async () => {
    const { deps, buscar } = preparar({ status: "scheduled" });
    expect(await proponerEnlaces(deps, R2)).toEqual({ candidatos: [], truncado: false, motivo_vacio: "request_no_abierta" });
    expect(buscar).not.toHaveBeenCalled();
  });

  it("una request que no existe da EnlaceInvalido", async () => {
    const { deps } = preparar();
    await expect(proponerEnlaces(deps, "b0000000-0000-4000-8000-0000000000ff")).rejects.toMatchObject({
      codigo: "request_no_encontrada",
    });
  });

  it("si no queda ningún candidato lo dice", async () => {
    const { deps } = preparar({ bzzzbx_customer_id: null, bzzzbx_property_id: "bx-prop-0001" });
    expect(await proponerEnlaces(deps, R2)).toEqual({ candidatos: [], truncado: false, motivo_vacio: "sin_candidatos" });
  });

  it("con BzzzBX caído lanza BzzzbxNoDisponible y no propone nada", async () => {
    const { deps, falso } = preparar();
    falso.lectura.noDisponible(true);
    await expect(proponerEnlaces(deps, R2)).rejects.toBeInstanceOf(BzzzbxNoDisponible);
  });
});

describe("confirmarEnlace", () => {
  it("relee el job y enlaza con su job number y el actor", async () => {
    const { deps, datos } = preparar();
    await confirmarEnlace(deps, { requestId: R2, bzzzbxJobId: "bx-job-0102" }, OPERADOR);
    expect(datos.enlazar).toHaveBeenCalledWith(
      { requestId: R2, bzzzbxJobId: "bx-job-0102", jobNumber: "EX-00102" },
      OPERADOR,
    );
  });

  it.each([
    ["bx-job-0104", "job_cancelado"],
    ["bx-no-existe-0000", "job_no_encontrado"],
  ])("no enlaza %s (%s)", async (job, codigo) => {
    const { deps, datos } = preparar();
    const intento = confirmarEnlace(deps, { requestId: R2, bzzzbxJobId: job }, OPERADOR);
    await expect(intento).rejects.toBeInstanceOf(EnlaceInvalido);
    await expect(intento).rejects.toMatchObject({ codigo });
    expect(datos.enlazar).not.toHaveBeenCalled();
  });

  it("con BzzzBX caído no enlaza", async () => {
    const { deps, datos, falso } = preparar();
    falso.lectura.noDisponible(true);
    await expect(confirmarEnlace(deps, { requestId: R2, bzzzbxJobId: "bx-job-0102" }, OPERADOR)).rejects.toBeInstanceOf(
      BzzzbxNoDisponible,
    );
    expect(datos.enlazar).not.toHaveBeenCalled();
  });
});

describe("rechazarEnlace", () => {
  it("guarda el rechazo con el motivo recortado, o sin motivo", async () => {
    const { deps, datos } = preparar();
    await rechazarEnlace(deps, { requestId: R2, bzzzbxJobId: "bx-job-0103", motivo: "  Different date  " }, OPERADOR);
    await rechazarEnlace(deps, { requestId: R2, bzzzbxJobId: "bx-job-0102", motivo: "   " }, OPERADOR);
    expect(datos.rechazar).toHaveBeenNthCalledWith(1, { requestId: R2, bzzzbxJobId: "bx-job-0103", motivo: "Different date" }, OPERADOR);
    expect(datos.rechazar).toHaveBeenNthCalledWith(2, { requestId: R2, bzzzbxJobId: "bx-job-0102", motivo: null }, OPERADOR);
  });
});
