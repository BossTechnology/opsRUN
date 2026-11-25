// @vitest-environment node
import { describe, expect, it } from "vitest";

import { crearFalso, RelojManual } from "../bzzzbx/falso";

import { leerTablero, type MemoriaTablero } from "./leer";
import { filasDeLaSeed } from "./prueba-datos";
import { SIN_VALOR, type Tablero } from "./tipos";

const AHORA = new Date("2026-11-24T18:00:00Z");

function preparar() {
  const falso = crearFalso({ reloj: new RelojManual(AHORA) });
  const memoria: MemoriaTablero = { leidos: null, en: null };
  const leer = () =>
    leerTablero({ filas: filasDeLaSeed(AHORA), lectura: falso.lectura, ahora: AHORA, zona: "UTC", memoria });
  return { falso, memoria, leer };
}

const numeros = (t: Tablero) =>
  t.columnas.map((c) => [c.etapa, [...c.tarjetas, ...c.pagadas].map((x) => x.numero)]);

describe("leerTablero", () => {
  it("lee del puerto lo que necesitan las tarjetas", async () => {
    const { leer } = preparar();
    const t = await leer();
    expect(numeros(t)).toEqual([
      ["requests", ["R2", "R1"]],
      ["scheduled", ["EX-00003"]],
      ["in_progress", ["EX-00004"]],
      ["complete", ["EX-00005"]],
      ["validation", ["EX-00006"]],
    ]);
    const r2 = t.columnas[0]!.tarjetas[0]!;
    expect(r2.nombre).toBe("Sample Court Unit 12");
    expect(t.alertasAbiertas.total).toBe(1);
    expect(t.bzzzbx).toEqual({ disponible: true, actualizadoEn: AHORA.toISOString() });
  });

  it("un cambio en el origen se ve en la siguiente lectura", async () => {
    const { falso, leer } = preparar();
    falso.lectura.poner("jobtracker_event", {
      bzzzbx_event_id: "bx-evt-0100", bzzzbx_job_id: "bx-job-0003", kind: "checked_in", occurred_at: AHORA.toISOString(),
    });
    const t = await leer();
    expect(t.columnas.find((c) => c.etapa === "in_progress")!.tarjetas.map((x) => x.numero)).toEqual([
      "EX-00004",
      "EX-00003",
    ]);
  });

  it("con BzzzBX caído usa lo último conocido y lo avisa", async () => {
    const { falso, leer } = preparar();
    const antes = await leer();
    falso.lectura.noDisponible(true);
    const caido = await leer();
    expect(caido.bzzzbx).toEqual({ disponible: false, actualizadoEn: AHORA.toISOString() });
    expect(caido.columnas).toEqual(antes.columnas);
  });

  it("caído sin nada conocido: lo de opsRUN con — — y el aviso", async () => {
    const { falso, leer } = preparar();
    falso.lectura.noDisponible(true);
    const t = await leer();
    expect(t.bzzzbx).toEqual({ disponible: false, actualizadoEn: null });
    const r1 = t.columnas[0]!.tarjetas.find((x) => x.numero === "R1")!;
    expect(r1.nombre).toBe(SIN_VALOR);
    expect(t.columnas.flatMap((c) => c.tarjetas).length + t.columnas[4]!.pagadas.length).toBe(6);
  });

  it("el tablero se ve igual después de reconstruir las proyecciones (Runbook §3.2)", async () => {
    const { falso, leer } = preparar();
    const antes = await leer();
    falso.lectura.reconstruir();
    expect(await leer()).toEqual(antes);
  });
});
