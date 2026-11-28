// @vitest-environment node
/** `plantillasDelJob` (spec OPR-18 §5.1 y §10.2): qué se ofrece por modo y etapa, y los avisos del panel. */
import { describe, expect, it } from "vitest";

import type { Job, Property } from "../bzzzbx/tipos";
import type { DisponibilidadDelModo } from "../conversacion/composer";

import { CLAVES } from "./catalogo";
import { plantillasDelJob, type FilaDePlantilla } from "./disponibles";
import { contarSms } from "./sms";
import type { BorradorDePlantilla } from "./valores";

const FILAS: FilaDePlantilla[] = [
  { key: "cleaner_confirmation_request", version: 1, channel: "text", subject: null, body: "New job: {{property}} {{space}} on {{date}}, {{window}}. Can you confirm?" },
  { key: "reschedule_request", version: 1, channel: "text", subject: null, body: "Can we move {{property}} {{space}} to {{date}}, {{window}}? Please confirm." },
  { key: "cancellation_cleaner", version: 1, channel: "text", subject: null, body: "The job at {{property}} {{space}} on {{date}} is cancelled." },
  { key: "cancellation_requester", version: 1, channel: "email", subject: "Cleaning cancelled", body: "The cleaning at {{property}} {{space}} on {{date}} has been cancelled." },
  { key: "requester_scheduled", version: 1, channel: "email", subject: "Cleaning scheduled", body: "Your cleaning at {{property}} {{space}} is scheduled for {{date}}, {{window}}." },
  { key: "requester_done", version: 1, channel: "email", subject: "Cleaning done", body: "The cleaning at {{property}} {{space}} is done." },
];

const BORRADOR: BorradorDePlantilla = {
  bzzzbx_property_id: "bx-prop-0003",
  bzzzbx_space_id: null,
  unit: "7C",
  service_date: "2026-11-25",
  window_start: "09:00",
  window_end: "12:00",
};
const PROPIEDAD: Property = { bzzzbx_property_id: "bx-prop-0003", name: "Demo Lofts", city: "Sample Town", units: [], default_team_id: null };
const JOB: Job = {
  bzzzbx_job_id: "bx-job-0003",
  job_number: "EX-00003",
  bzzzbx_customer_id: "c",
  bzzzbx_property_id: "bx-prop-0003",
  bzzzbx_space_id: null,
  bzzzbx_service_id: "s",
  service_date: "2026-11-26",
  window_start: "10:00",
  window_end: "14:00",
  status: "scheduled",
  bzzzbx_team_id: "t",
  po_number: null,
};

const LIBRES: Record<"customer" | "cleaner" | "note", DisponibilidadDelModo> = {
  customer: { disponible: true },
  cleaner: { disponible: true },
  note: { disponible: true },
};

const claves = (l: { clave: string }[]) => l.map((x) => x.clave);

function de(etapa: string, parche: Partial<Parameters<typeof plantillasDelJob>[0]> = {}) {
  const desdeJob = etapa !== "requests";
  return plantillasDelJob({
    filas: FILAS,
    etapa: etapa as never,
    modos: LIBRES,
    fuente: { fuente: desdeJob ? "job" : "borrador", borrador: BORRADOR, job: desdeJob ? JOB : null, propiedad: PROPIEDAD },
    ...parche,
  });
}

describe("plantillasDelJob: la tabla de §4.2, etapa por etapa", () => {
  it.each([
    ["requests", { cleaner: ["cleaner_confirmation_request"], customer: [], avisos: [] }],
    ["scheduled", { cleaner: ["reschedule_request"], customer: ["requester_scheduled"], avisos: ["requester_scheduled"] }],
    ["in_progress", { cleaner: [], customer: ["requester_scheduled"], avisos: ["requester_scheduled"] }],
    ["complete", { cleaner: [], customer: ["requester_scheduled"], avisos: ["requester_scheduled"] }],
    ["validation", { cleaner: [], customer: ["requester_scheduled", "requester_done"], avisos: ["requester_scheduled", "requester_done"] }],
    ["cancelled", { cleaner: [], customer: [], avisos: ["cancellation_cleaner", "cancellation_requester"] }],
  ])("%s", (etapa, esperado) => {
    const r = de(etapa);
    expect(claves(r.cleaner)).toEqual(esperado.cleaner);
    expect(claves(r.customer)).toEqual(esperado.customer);
    expect(claves(r.avisos)).toEqual(esperado.avisos);
  });

  it("cada clave del catálogo aparece en alguna parte y ninguna aparece donde no debe", () => {
    const vistas = new Set<string>();
    for (const e of ["requests", "scheduled", "in_progress", "complete", "validation", "cancelled"]) {
      const r = de(e);
      for (const x of [...r.cleaner, ...r.customer, ...r.avisos]) vistas.add(x.clave);
    }
    expect([...vistas].sort()).toEqual([...CLAVES].sort());
  });
});

describe("plantillasDelJob: lo que se ofrece", () => {
  it("trae clave, versión, nombre, canal, el texto llenado y lo que falta", () => {
    const r = de("scheduled");
    expect(r.customer).toEqual([
      {
        clave: "requester_scheduled",
        version: 1,
        nombre: "Scheduled notice",
        canal: "email",
        texto: "Your cleaning at Demo Lofts 7C is scheduled for Thu, Nov 26, 10:00 AM–2:00 PM.",
        faltan: [],
      },
    ]);
  });

  it("reschedule_request deja {{date}} y {{window}} literales y los pide", () => {
    const [r] = de("scheduled").cleaner;
    expect(r!.texto).toBe("Can we move Demo Lofts 7C to {{date}}, {{window}}? Please confirm.");
    expect(r!.faltan).toEqual(["{{date}}", "{{window}}"]);
  });

  it("un modo en gris no trae lista", () => {
    const r = de("scheduled", { modos: { ...LIBRES, cleaner: { disponible: false, razon: "BzzzBX unavailable" } } });
    expect(r.cleaner).toEqual([]);
    expect(claves(r.customer)).toEqual(["requester_scheduled"]);
    const sin = de("scheduled", { modos: { ...LIBRES, customer: { disponible: false, razon: "No email thread for this request" } } });
    expect(sin.customer).toEqual([]);
  });

  it("una clave de la base fuera del catálogo no se ofrece", () => {
    const r = de("requests", { filas: [...FILAS, { key: "cleaner_extra", version: 1, channel: "text", subject: null, body: "Hola {{property}}" }] });
    expect(claves(r.cleaner)).toEqual(["cleaner_confirmation_request"]);
  });

  it("una clave del catálogo sin fila activa no se ofrece", () => {
    const r = de("requests", { filas: FILAS.filter((f) => f.key !== "cleaner_confirmation_request") });
    expect(r.cleaner).toEqual([]);
    const sinNada = de("requests", { filas: [] });
    expect(sinNada).toEqual({ customer: [], cleaner: [], avisos: [] });
  });

  it("una fila de otro canal que el del catálogo no se ofrece", () => {
    const r = de("requests", { filas: FILAS.map((f) => (f.key === "cleaner_confirmation_request" ? { ...f, channel: "email" } : f)) });
    expect(r.cleaner).toEqual([]);
  });

  it("si hay dos filas de la misma clave (no debería), gana la versión más alta", () => {
    const r = de("requests", { filas: [...FILAS, { key: "cleaner_confirmation_request", version: 2, channel: "text", subject: null, body: "V2 {{property}}" }] });
    expect(r.cleaner[0]).toMatchObject({ version: 2, texto: "V2 Demo Lofts" });
  });

  it("sin propiedad en BzzzBX se ofrece con {{property}} literal", () => {
    const r = de("requests", { fuente: { fuente: "borrador", borrador: BORRADOR, job: null, propiedad: null } });
    expect(r.cleaner[0]!.faltan).toEqual(["{{property}}"]);
    expect(r.cleaner[0]!.texto).toContain("{{property}} 7C");
  });

  it("Requests sin fecha ni ventana pide las dos", () => {
    const r = de("requests", { fuente: { fuente: "borrador", borrador: { ...BORRADOR, service_date: null, window_start: null, window_end: null }, job: null, propiedad: PROPIEDAD } });
    expect(r.cleaner[0]!.faltan).toEqual(["{{date}}", "{{window}}"]);
  });
});

describe("plantillasDelJob: un solo SMS (§4.4)", () => {
  it("todo texto que se ofrece o se avisa, lleno con valores típicos, es GSM-7 y de un SMS", () => {
    const textos = [];
    for (const etapa of ["requests", "scheduled", "cancelled"]) {
      const r = de(etapa, {
        fuente: { fuente: etapa === "requests" ? "borrador" : "job", borrador: BORRADOR, job: etapa === "requests" ? null : JOB, propiedad: PROPIEDAD },
      });
      textos.push(...[...r.cleaner, ...r.avisos].filter((p) => p.canal === "text").map((p) => p.texto ?? ""));
    }
    expect(textos.length).toBeGreaterThanOrEqual(3);
    for (const t of textos) expect(contarSms(t), t).toMatchObject({ gsm7: true, mensajes: 1 });
  });

  it("con la media raya del tablero ya no cabría: por eso las de texto llevan guion ASCII", () => {
    expect(contarSms("New job: Sample Court Unit 12 on Wed, Nov 25, 9:00 AM–12:00 PM. Can you confirm?")).toMatchObject({ gsm7: false, mensajes: 2 });
    expect(contarSms("New job: Sample Court Unit 12 on Wed, Nov 25, 9:00 AM-12:00 PM. Can you confirm?")).toMatchObject({ gsm7: true, mensajes: 1 });
  });
});

describe("plantillasDelJob: el panel Notices", () => {
  it("las dos de cancelación llevan su texto llenado", () => {
    const r = de("cancelled");
    expect(r.avisos.map((a) => [a.nombre, a.canal, a.texto, a.sinTexto])).toEqual([
      ["Cancellation (cleaner)", "text", "The job at Demo Lofts 7C on Thu, Nov 26 is cancelled.", null],
      ["Cancellation (requester)", "email", "The cleaning at Demo Lofts 7C on Thu, Nov 26 has been cancelled.", null],
    ]);
  });

  it("no depende de que el modo esté en gris: se ve con el Composer apagado", () => {
    const apagados = { customer: { disponible: false, razon: "Job cancelled" }, cleaner: { disponible: false, razon: "Job cancelled" }, note: { disponible: false, razon: "Job cancelled" } } as const;
    const r = de("cancelled", { modos: apagados });
    expect(r.avisos).toHaveLength(2);
    expect(r.customer).toEqual([]);
    expect(r.cleaner).toEqual([]);
  });

  it("sin lectura previa de BzzzBX, el aviso existe pero sin vista previa", () => {
    const r = de("scheduled", { fuente: null });
    expect(r.avisos).toEqual([
      { clave: "requester_scheduled", version: 1, nombre: "Scheduled notice", canal: "email", texto: null, faltan: [], sinTexto: "bzzzbx" },
    ]);
    expect(r.customer).toEqual([]);
  });

  it("la propiedad que BzzzBX no conoce: 'Check the property' en lugar del texto", () => {
    const r = de("scheduled", { fuente: { fuente: "job", borrador: BORRADOR, job: JOB, propiedad: null } });
    expect(r.avisos[0]).toMatchObject({ clave: "requester_scheduled", texto: null, sinTexto: "propiedad", faltan: ["{{property}}"] });
  });

  it("Requests no tiene avisos", () => {
    expect(de("requests").avisos).toEqual([]);
    expect(de("requests", { fuente: null }).avisos).toEqual([]);
  });
});
