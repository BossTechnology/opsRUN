// @vitest-environment node
/**
 * `leerConversacion` con plantillas (spec OPR-18 §5 y §10.2): la lectura trae las plantillas activas de opsRUN y la
 * propiedad (y el job) de BzzzBX, arma el picker y los avisos, usa lo último leído con BzzzBX caído, y una lectura
 * nunca escribe: el puerto solo se usa para leer y la base solo se consulta.
 */
import { describe, expect, it, vi } from "vitest";

import { crearFalso, RelojManual } from "../bzzzbx/falso";
import type { LecturaBzzzbx } from "../bzzzbx/puertos";

import { CONSULTA_PLANTILLAS, CONSULTA_REQUEST, type LecturaDeConversacion } from "./consultas";
import { leerConversacion, type MemoriaConversacion } from "./leer";

const AHORA = new Date("2026-11-24T18:00:00Z");
const R2 = "b0000000-0000-4000-8000-0000000000a2";

const PLANTILLAS = [
  { key: "cleaner_confirmation_request", version: 1, channel: "text", subject: null, body: "New job: {{property}} {{space}} on {{date}}, {{window}}. Can you confirm?" },
  { key: "requester_scheduled", version: 1, channel: "email", subject: "Cleaning scheduled", body: "Your cleaning at {{property}} {{space}} is scheduled for {{date}}, {{window}}." },
  { key: "cancellation_cleaner", version: 1, channel: "text", subject: null, body: "The job at {{property}} {{space}} on {{date}} is cancelled." },
];

function opsrun(parche: Partial<LecturaDeConversacion["request"]> = {}): LecturaDeConversacion {
  return {
    request: {
      bzzzbx_job_id: null,
      bzzzbx_team_id: "bx-team-0001",
      change_seq: "102",
      bzzzbx_property_id: "bx-prop-0002",
      bzzzbx_space_id: "bx-space-0002",
      unit: "12",
      service_date: "2026-11-26",
      window_start: "09:00",
      window_end: "12:00",
      ...parche,
    },
    vinculos: [],
    envios: [],
    notas: [],
    operadores: [],
    borradores: { customer: null, cleaner: null },
    plantillas: PLANTILLAS,
  };
}

function montar() {
  const falso = crearFalso({ reloj: new RelojManual(AHORA) });
  const memoria: MemoriaConversacion = new Map();
  const leer = (etapa: string, op: LecturaDeConversacion, lectura: LecturaBzzzbx = falso.lectura, puedeEnviar = true) =>
    leerConversacion({ requestId: R2, etapa, hilos: ["bx-thread-0002"], puedeEnviar, zona: "UTC", opsrun: op, lectura, ahora: AHORA, memoria });
  return { falso, memoria, leer };
}

describe("la lectura trae las plantillas", () => {
  it("las consultas leen message_template activas y las columnas del borrador, sin escribir", () => {
    expect(CONSULTA_PLANTILLAS).toMatch(/from opsrun\.message_template/);
    expect(CONSULTA_PLANTILLAS).toMatch(/where\s+\w+\.active/);
    expect(CONSULTA_REQUEST).toMatch(/bzzzbx_property_id/);
    expect(CONSULTA_REQUEST).toMatch(/\.unit\b/);
    for (const sql of [CONSULTA_PLANTILLAS, CONSULTA_REQUEST]) expect(sql).not.toMatch(/\b(insert|update|delete)\b/i);
  });

  it("en Requests, el picker de Cleaner trae Confirmation request con la propiedad de BzzzBX y el borrador de la request", async () => {
    const { leer } = montar();
    const d = await leer("requests", opsrun());
    expect(d.plantillas.cleaner).toEqual([
      {
        clave: "cleaner_confirmation_request",
        version: 1,
        nombre: "Confirmation request",
        canal: "text",
        texto: "New job: Sample Court Unit 12 on Thu, Nov 26, 9:00 AM-12:00 PM. Can you confirm?",
        faltan: [],
      },
    ]);
    expect(d.plantillas.customer).toEqual([]);
    expect(d.plantillas.avisos).toEqual([]);
  });

  it("desde Scheduled manda el job de BzzzBX: la fecha y la ventana son las del job", async () => {
    const { leer } = montar();
    const d = await leer("scheduled", opsrun({ bzzzbx_job_id: "bx-job-0003", bzzzbx_property_id: "bx-prop-0003", bzzzbx_space_id: null, unit: "7C" }));
    const aviso = d.plantillas.avisos.find((a) => a.clave === "requester_scheduled")!;
    expect(aviso.texto).toMatch(/^Your cleaning at Demo Lofts 7C is scheduled for \w{3}, \w{3} \d+, 10:00 AM–2:00 PM\.$/);
    expect(aviso.sinTexto).toBeNull();
  });

  it("con el job cancelado, el panel trae las dos de cancelación y el picker no ofrece nada", async () => {
    const { leer } = montar();
    const d = await leer("cancelled", opsrun({ bzzzbx_job_id: "bx-job-0003", bzzzbx_property_id: "bx-prop-0003" }), undefined, false);
    expect(d.plantillas.avisos.map((a) => a.clave)).toEqual(["cancellation_cleaner"]);
    expect(d.plantillas.cleaner).toEqual([]);
    expect(d.plantillas.customer).toEqual([]);
  });

  it("la propiedad que BzzzBX no conoce: se ofrece con {{property}} literal", async () => {
    const { leer } = montar();
    const d = await leer("requests", opsrun({ bzzzbx_property_id: "bx-prop-9999" }));
    expect(d.plantillas.cleaner[0]!.faltan).toEqual(["{{property}}"]);
  });

  it("con BzzzBX caído y sin lectura previa: modo en gris, sin picker, y el panel dice que no hay vista previa", async () => {
    const { falso, leer } = montar();
    falso.lectura.noDisponible(true);
    const d = await leer("scheduled", opsrun({ bzzzbx_job_id: "bx-job-0003" }));
    expect(d.bzzzbx.disponible).toBe(false);
    expect(d.plantillas.customer).toEqual([]);
    expect(d.plantillas.cleaner).toEqual([]);
    expect(d.plantillas.avisos).toEqual([expect.objectContaining({ clave: "requester_scheduled", texto: null, sinTexto: "bzzzbx" })]);
  });

  it("con BzzzBX caído y lectura previa: el picker sigue en gris y el panel usa lo último leído", async () => {
    const { falso, leer } = montar();
    const op = opsrun({ bzzzbx_job_id: "bx-job-0003" });
    const antes = await leer("scheduled", op);
    const textoAntes = antes.plantillas.avisos[0]!.texto;
    expect(textoAntes).toContain("Demo Lofts");

    falso.lectura.noDisponible(true);
    const d = await leer("scheduled", op);
    expect(d.bzzzbx.disponible).toBe(false);
    expect(d.bzzzbx.actualizadoEn).not.toBeNull();
    expect(d.plantillas.customer).toEqual([]); // el modo está en gris
    expect(d.plantillas.avisos[0]!.texto).toBe(textoAntes);
  });

  it("sin la tabla (la migración no corrió): el picker no aparece y nada se rompe", async () => {
    const { leer } = montar();
    const d = await leer("requests", { ...opsrun(), plantillas: [] });
    expect(d.plantillas).toEqual({ customer: [], cleaner: [], avisos: [] });
  });
});

describe("una lectura nunca escribe", () => {
  it("leerConversacion solo llama a métodos de lectura del puerto", async () => {
    const { falso, leer } = montar();
    const llamadas: string[] = [];
    const espia = new Proxy(falso.lectura, {
      get(objetivo, nombre, receptor) {
        const valor = Reflect.get(objetivo, nombre, receptor);
        if (typeof valor !== "function") return valor;
        return (...args: unknown[]) => {
          llamadas.push(String(nombre));
          return (valor as (...a: unknown[]) => unknown).apply(objetivo, args);
        };
      },
    }) as LecturaBzzzbx;
    await leer("scheduled", opsrun({ bzzzbx_job_id: "bx-job-0003" }), espia);
    expect(llamadas.length).toBeGreaterThan(0);
    expect(llamadas.filter((n) => !/^(obtener|obtenerVarios|listarPor)$/.test(n))).toEqual([]);
  });

  it("pedir las plantillas no agrega llamadas fuera del puerto de lectura ni temporizadores", async () => {
    vi.useFakeTimers();
    try {
      const { leer } = montar();
      await leer("requests", opsrun());
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
