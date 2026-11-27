// @vitest-environment node
/**
 * La ruta de fotos (OPR-30 §4.2 y §7.3): 404 con una foto de otro job o una
 * request inexistente, 503 con BzzzBX caído, la imagen tal cual si todo cuadra, y
 * nunca escribe en la base (espía sobre el pool: toda lectura va en solo lectura,
 * sin actor).
 */
import { describe, expect, it, vi } from "vitest";

import { crearFalso, RelojManual } from "@/lib/bzzzbx/falso";
import type { Actor, Tx } from "@/lib/db/pool";

import { CONSULTA_JOB_DE_LA_REQUEST, crearJobDeLaRequest, type Ejecutar } from "./datos-sql";
import { servirFoto, type DependenciasDeFoto } from "./servir";

const R6 = "b0000000-0000-4000-8000-0000000000a6";
const R4 = "b0000000-0000-4000-8000-0000000000a4";
const NO_EXISTE = "b0000000-0000-4000-8000-0000000000ff";

function preparar() {
  const falso = crearFalso({ reloj: new RelojManual(new Date("2026-11-27T15:00:00Z")) });
  const trabajos: Record<string, string | null> = { [R6]: "bx-job-0006", [R4]: "bx-job-0004" };
  const jobDeLaRequest = vi.fn(async (id: string) => trabajos[id] ?? null);
  const deps: DependenciasDeFoto = { jobDeLaRequest, lectura: falso.lectura };
  return { falso, deps, jobDeLaRequest };
}

describe("servirFoto", () => {
  it("una foto del job de la request: la imagen tal cual, con su tipo", async () => {
    const { deps } = preparar();
    const r = await servirFoto({ fotoId: "bx-photo-0001", requestId: R6 }, deps);
    expect(r.estado).toBe(200);
    if (r.estado !== 200) return;
    expect(r.contentType).toBe("image/svg+xml");
    const svg = new TextDecoder().decode(r.bytes);
    expect(svg).toContain("Before");
    expect(svg).toContain("bx-photo-0001");
  });

  it("la foto After lleva su fase", async () => {
    const { deps } = preparar();
    const r = await servirFoto({ fotoId: "bx-photo-0002", requestId: R6 }, deps);
    expect(r.estado === 200 && new TextDecoder().decode(r.bytes)).toContain("After");
  });

  it("una foto de otro job, o una request inexistente, son 404", async () => {
    const { deps } = preparar();
    // La foto 0001 es del job de R6, no del de R4.
    expect(await servirFoto({ fotoId: "bx-photo-0001", requestId: R4 }, deps)).toEqual({ estado: 404 });
    expect(await servirFoto({ fotoId: "bx-photo-0001", requestId: NO_EXISTE }, deps)).toEqual({ estado: 404 });
  });

  it("una foto que BzzzBX no conoce es 404", async () => {
    const { deps } = preparar();
    expect(await servirFoto({ fotoId: "bx-photo-9999", requestId: R6 }, deps)).toEqual({ estado: 404 });
  });

  it("sin request, con una request que no es un uuid o con un id de foto raro: 404 sin leer nada", async () => {
    const { deps, jobDeLaRequest } = preparar();
    for (const [fotoId, requestId] of [
      ["bx-photo-0001", null],
      ["bx-photo-0001", ""],
      ["bx-photo-0001", "no-es-uuid"],
      ["../etc/passwd", R6],
      ["", R6],
      ["a".repeat(500), R6],
    ] as const) {
      expect(await servirFoto({ fotoId, requestId }, deps), `${fotoId} ${requestId}`).toEqual({ estado: 404 });
    }
    expect(jobDeLaRequest).not.toHaveBeenCalled();
  });

  it("BzzzBX caído: 503, no 404", async () => {
    const { deps, falso } = preparar();
    falso.lectura.noDisponible(true);
    expect(await servirFoto({ fotoId: "bx-photo-0001", requestId: R6 }, deps)).toEqual({ estado: 503 });
  });

  it("solo sirve imágenes: otro tipo de contenido es 404", async () => {
    const { deps, falso } = preparar();
    vi.spyOn(falso.lectura, "leerFoto").mockResolvedValue({ contentType: "text/html", bytes: new TextEncoder().encode("<script>x</script>") });
    expect(await servirFoto({ fotoId: "bx-photo-0001", requestId: R6 }, deps)).toEqual({ estado: 404 });
    vi.spyOn(falso.lectura, "leerFoto").mockResolvedValue({ contentType: "image/png", bytes: new Uint8Array(0) });
    expect(await servirFoto({ fotoId: "bx-photo-0001", requestId: R6 }, deps)).toEqual({ estado: 404 });
  });

  it("un error que no es de BzzzBX caído sube", async () => {
    const { deps, falso } = preparar();
    vi.spyOn(falso.lectura, "listarPor").mockRejectedValue(new Error("falla rara"));
    await expect(servirFoto({ fotoId: "bx-photo-0001", requestId: R6 }, deps)).rejects.toThrow("falla rara");
  });
});

describe("la lectura del job de la request nunca escribe", () => {
  it("corre sin `escritura` ni `actor`: en solo lectura, como opsrun_app", async () => {
    const opciones: ({ escritura?: boolean; actor?: Actor } | undefined)[] = [];
    const consultas: string[] = [];
    const ejecutar: Ejecutar = async (fn, o) => {
      opciones.push(o);
      return fn({
        query: async (sql: string) => {
          consultas.push(sql);
          return { rows: [{ bzzzbx_job_id: "bx-job-0006" }] };
        },
      } as unknown as Tx);
    };
    expect(await crearJobDeLaRequest(ejecutar)(R6)).toBe("bx-job-0006");
    expect(opciones).toEqual([undefined]);
    expect(consultas).toEqual([CONSULTA_JOB_DE_LA_REQUEST]);
    expect(CONSULTA_JOB_DE_LA_REQUEST).not.toMatch(/\b(insert|update|delete|select\s+opsrun\.)/i);
  });

  it("una request sin job (o que no existe) da null", async () => {
    const ejecutar: Ejecutar = async (fn) => fn({ query: async () => ({ rows: [] }) } as unknown as Tx);
    expect(await crearJobDeLaRequest(ejecutar)(NO_EXISTE)).toBeNull();
    const sinJob: Ejecutar = async (fn) => fn({ query: async () => ({ rows: [{ bzzzbx_job_id: null }] }) } as unknown as Tx);
    expect(await crearJobDeLaRequest(sinJob)(R4)).toBeNull();
  });
});
