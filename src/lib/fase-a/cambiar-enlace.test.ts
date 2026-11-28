// @vitest-environment node
/**
 * Change linked job (OPR-29, spec §8): `proponerEnlaces` con `paraCambio` y `cambiarEnlaceDeJob`, contra el falso de
 * BzzzBX y unos datos de opsRUN en memoria. R11 de la seed está enlazada a bx-job-0111 y puede pasar a bx-job-0112.
 */
import { describe, expect, it, vi } from "vitest";

import { crearFalso, RelojManual } from "@/lib/bzzzbx/falso";
import { BzzzbxNoDisponible } from "@/lib/bzzzbx/errores";
import type { Actor } from "@/lib/db/pool";

import { cambiarEnlaceDeJob, EnlaceInvalido, proponerEnlaces, type DatosDeEnlace, type RequestParaEnlace } from "./enlace";

const OPERADOR: Actor = { tipo: "operador", authUserId: "5a000000-0000-4000-8000-0000000000a1" };
const R11 = "b0000000-0000-4000-8000-000000000a11";
const AHORA = new Date("2026-11-27T15:00:00Z");

function preparar(cambios: Partial<RequestParaEnlace> = {}, opciones: { reenlazados?: string[]; enlazadosAOtra?: string[] } = {}) {
  const falso = crearFalso({ reloj: new RelojManual(AHORA) });
  const dia = (n: number) => new Date(AHORA.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  const request: RequestParaEnlace = {
    id: R11,
    status: "scheduled",
    bzzzbx_job_id: "bx-job-0111",
    change_seq: "211",
    received_at: new Date(AHORA.getTime() - 86_400_000).toISOString(),
    bzzzbx_customer_id: "bx-cust-0002",
    bzzzbx_property_id: "bx-prop-0006",
    service_date: dia(1),
    window_start: "09:00",
    window_end: "12:00",
    bzzzbx_team_id: "bx-team-0002",
    ...cambios,
  };
  const datos = {
    leerRequest: vi.fn(async (id: string) => (id === request.id ? request : null)),
    jobsEnlazadosAOtra: vi.fn(async (_r: string, ids: string[]) => new Set(ids.filter((id) => (opciones.enlazadosAOtra ?? []).includes(id)))),
    jobsRechazados: vi.fn(async () => new Set<string>()),
    jobsReenlazados: vi.fn(async () => new Set(opciones.reenlazados ?? [])),
    enlazar: vi.fn(async () => {}),
    rechazar: vi.fn(async () => {}),
    cambiar: vi.fn(async () => {}),
  } satisfies DatosDeEnlace;
  return { falso, datos, deps: { lectura: falso.lectura, datos } };
}

const cambio = (parche: Partial<{ version: string; bzzzbxJobId: string; motivo: string }> = {}) => ({
  requestId: R11,
  version: "211",
  bzzzbxJobId: "bx-job-0112",
  motivo: "PINCH cancelled the job and created another.",
  ...parche,
});

describe("proponerEnlaces para un cambio (§8.2)", () => {
  it("propone los jobs de la propiedad sin el actual, y sin los ya enlazados a otra request", async () => {
    const { deps } = preparar({}, { enlazadosAOtra: ["bx-job-0109"] });
    const { candidatos, motivo_vacio } = await proponerEnlaces(deps, R11, { paraCambio: true });
    expect(motivo_vacio).toBeUndefined();
    const ids = candidatos.map((c) => c.job.bzzzbx_job_id);
    expect(ids).toContain("bx-job-0112");
    expect(ids).not.toContain("bx-job-0111");
    expect(ids).not.toContain("bx-job-0109");
  });

  it("descarta los jobs que ya dejaron de ser de la request (los from_bzzzbx_job_id de sus job_relinked)", async () => {
    const { deps } = preparar({}, { reenlazados: ["bx-job-0112"] });
    const { candidatos } = await proponerEnlaces(deps, R11, { paraCambio: true });
    expect(candidatos.map((c) => c.job.bzzzbx_job_id)).not.toContain("bx-job-0112");
  });

  it("no ofrece un job cancelado en PINCH", async () => {
    const { deps, falso } = preparar();
    falso.lectura.cambiar("job", "bx-job-0112", { status: "cancelled" });
    const { candidatos } = await proponerEnlaces(deps, R11, { paraCambio: true });
    expect(candidatos.map((c) => c.job.bzzzbx_job_id)).not.toContain("bx-job-0112");
  });

  it("las lecturas de la base van una tras otra", async () => {
    const { deps, datos } = preparar();
    let enCurso = 0;
    let maximo = 0;
    for (const nombre of ["jobsEnlazadosAOtra", "jobsRechazados", "jobsReenlazados"] as const) {
      const original = datos[nombre] as (...a: unknown[]) => Promise<Set<string>>;
      (datos as Record<string, unknown>)[nombre] = async (...args: unknown[]) => {
        enCurso += 1;
        maximo = Math.max(maximo, enCurso);
        await new Promise((r) => setTimeout(r, 1));
        enCurso -= 1;
        return original(...args);
      };
    }
    await proponerEnlaces(deps, R11, { paraCambio: true });
    expect(maximo).toBe(1);
  });

  it("una request abierta pide el enlace de siempre, y una programada sin paraCambio no propone nada", async () => {
    const abierta = preparar({ status: "open", bzzzbx_job_id: null });
    expect((await proponerEnlaces(abierta.deps, R11)).candidatos.length).toBeGreaterThan(0);
    expect(abierta.datos.jobsReenlazados).not.toHaveBeenCalled();
    expect(await proponerEnlaces(abierta.deps, R11, { paraCambio: true })).toMatchObject({ candidatos: [], motivo_vacio: "request_no_abierta" });
    const programada = preparar();
    expect(await proponerEnlaces(programada.deps, R11)).toMatchObject({ candidatos: [], motivo_vacio: "request_no_abierta" });
  });
});

describe("cambiarEnlaceDeJob (§8.1)", () => {
  it("relee el job nuevo y el actual, y cambia el enlace con el job number de BzzzBX y la versión que vio el operador", async () => {
    const { deps, datos, falso } = preparar();
    const obtener = vi.spyOn(falso.lectura, "obtener");
    const eventos = vi.spyOn(falso.lectura, "listarPor");
    await cambiarEnlaceDeJob(deps, cambio({ motivo: "  PINCH replaced it.  " }), OPERADOR);
    expect(obtener).toHaveBeenCalledWith("job", "bx-job-0112");
    expect(eventos).toHaveBeenCalledWith("jobtracker_event", { bzzzbx_job_id: "bx-job-0111" });
    expect(datos.cambiar).toHaveBeenCalledWith(
      { requestId: R11, version: "211", bzzzbxJobId: "bx-job-0112", jobNumber: "EX-00112", motivo: "PINCH replaced it." },
      OPERADOR,
    );
  });

  it.each([
    ["un job que no existe en BzzzBX", { bzzzbxJobId: "bx-job-9999" }, {}, "job_no_encontrado"],
    ["el mismo job", { bzzzbxJobId: "bx-job-0111" }, {}, "mismo_job"],
    ["un motivo vacío", { motivo: "   " }, {}, "motivo_requerido"],
    ["una request abierta", {}, { status: "open" as const, bzzzbx_job_id: null }, "request_no_programada"],
  ])("rechaza %s sin llamar a la base", async (_nombre, parche, request, codigo) => {
    const { deps, datos } = preparar(request);
    await expect(cambiarEnlaceDeJob(deps, cambio(parche), OPERADOR)).rejects.toMatchObject({ name: "EnlaceInvalido", codigo });
    expect(datos.cambiar).not.toHaveBeenCalled();
  });

  it("rechaza un job cancelado en PINCH, sin llamar a la base", async () => {
    const { deps, datos, falso } = preparar();
    falso.lectura.cambiar("job", "bx-job-0112", { status: "cancelled" });
    await expect(cambiarEnlaceDeJob(deps, cambio(), OPERADOR)).rejects.toMatchObject({ codigo: "job_cancelado" });
    expect(datos.cambiar).not.toHaveBeenCalled();
  });

  it("rechaza un job actual con check-in en PINCH, sin llamar a la base (S-11)", async () => {
    const { deps, datos, falso } = preparar();
    falso.lectura.poner("jobtracker_event", {
      bzzzbx_event_id: "bx-evt-9111",
      bzzzbx_job_id: "bx-job-0111",
      kind: "checked_in",
      occurred_at: "2026-11-27T14:00:00.000Z",
    });
    await expect(cambiarEnlaceDeJob(deps, cambio(), OPERADOR)).rejects.toMatchObject({ codigo: "job_actual_con_checkin" });
    expect(datos.cambiar).not.toHaveBeenCalled();
  });

  it("un job actual cancelado, sin check-in, sí se puede cambiar (PINCH lo canceló y creó otro)", async () => {
    const { deps, datos, falso } = preparar();
    falso.lectura.cambiar("job", "bx-job-0111", { status: "cancelled" });
    await cambiarEnlaceDeJob(deps, cambio(), OPERADOR);
    expect(datos.cambiar).toHaveBeenCalledTimes(1);
  });

  it("con BzzzBX caído no escribe y deja subir el error del puerto", async () => {
    const { deps, datos, falso } = preparar();
    vi.spyOn(falso.lectura, "obtener").mockRejectedValue(new BzzzbxNoDisponible("caído"));
    await expect(cambiarEnlaceDeJob(deps, cambio(), OPERADOR)).rejects.toMatchObject({ name: "BzzzbxNoDisponible" });
    expect(datos.cambiar).not.toHaveBeenCalled();
  });

  it("los errores de la base que el operador provoca suben como EnlaceInvalido", async () => {
    const { deps, datos } = preparar();
    datos.cambiar.mockRejectedValueOnce(new EnlaceInvalido("con_hechos_del_job"));
    await expect(cambiarEnlaceDeJob(deps, cambio(), OPERADOR)).rejects.toMatchObject({ codigo: "con_hechos_del_job" });
  });
});
