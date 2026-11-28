/**
 * Arma la vista de IA de una request para la pestaña de la propiedad (spec OPR-36 §10):
 * por campo, "AI pending", vacío o con una sugerencia abierta. Función pura: sin base,
 * sin puerto y sin reloj. Los nombres de los crosswalk IDs los lee la ventana de BzzzBX y
 * nunca se guardan; si BzzzBX está caído, `texto` es `— —` y el ID sale como texto
 * secundario.
 */
import { CAMPOS_DE_IA, type CampoDeIa } from "../bzzzbx/tipos-ia";
import { SIN_VALOR } from "../tablero/tipos";

import type {
  AnalisisLeido,
  BorradorLeido,
  OpcionDeCambio,
  SugerenciaAbiertaDeIa,
  SugerenciaLeida,
  VistaDeCampoIa,
  VistaIa,
} from "./tipos";

const ETIQUETAS: Record<CampoDeIa, { etiqueta: string; nombreCorto: string }> = {
  property: { etiqueta: "Property", nombreCorto: "property" },
  space: { etiqueta: "Space", nombreCorto: "space" },
  unit: { etiqueta: "Unit", nombreCorto: "unit" },
  beds: { etiqueta: "Beds", nombreCorto: "beds" },
  service: { etiqueta: "Service", nombreCorto: "service" },
  service_date: { etiqueta: "Date", nombreCorto: "date" },
  time_window: { etiqueta: "Window", nombreCorto: "window" },
  access_notes: { etiqueta: "Access notes", nombreCorto: "access notes" },
  po_number: { etiqueta: "PO", nombreCorto: "PO" },
  sender: { etiqueta: "Who is it from?", nombreCorto: "sender" },
  multiple_jobs: { etiqueta: "Multiple jobs", nombreCorto: "multiple jobs" },
};

export type EntradaDeIa = {
  borrador: BorradorLeido;
  analisis: AnalisisLeido | null;
  sugerencias: SugerenciaLeida[];
  /** Nombre de cada crosswalk ID que la ventana pudo leer de BzzzBX (propiedad, servicio, cliente, contacto, espacio). */
  nombres: Record<string, string>;
  /** Los espacios de la propiedad del borrador que la ventana ya lee, para Change de `space`. */
  espacios?: { id: string; label: string }[];
};

const vacioTexto = (v: string | null | undefined) => v === null || v === undefined || v.trim() === "";

/** El valor que el borrador tiene hoy para ese campo, con la forma de §4.1; null si está vacío. */
export function valorDelBorrador(campo: CampoDeIa, b: BorradorLeido): unknown {
  switch (campo) {
    case "property":
      return b.bzzzbx_property_id;
    case "space":
      return b.bzzzbx_space_id;
    case "unit":
      return b.unit;
    case "beds":
      return b.beds ?? null;
    case "service":
      return b.bzzzbx_service_id;
    case "service_date":
      return b.service_date;
    case "time_window":
      return b.window_start && b.window_end ? { start: b.window_start, end: b.window_end } : null;
    case "access_notes":
      return b.access_notes;
    case "po_number":
      return b.po_number;
    case "sender":
      return b.bzzzbx_customer_id || b.bzzzbx_contact_id
        ? { bzzzbx_customer_id: b.bzzzbx_customer_id, bzzzbx_contact_id: b.bzzzbx_contact_id }
        : null;
    case "multiple_jobs":
      return null;
  }
}

/** ¿Alguna columna del borrador de ese campo tiene algo? (La misma regla que `ai_draft_filled` de la base.) */
function estaVacio(campo: CampoDeIa, b: BorradorLeido): boolean {
  switch (campo) {
    case "property":
      return vacioTexto(b.bzzzbx_property_id);
    case "space":
      return vacioTexto(b.bzzzbx_space_id);
    case "unit":
      return b.unit === null;
    case "beds":
      return b.beds === null || b.beds === undefined;
    case "service":
      return vacioTexto(b.bzzzbx_service_id);
    case "service_date":
      return b.service_date === null;
    case "time_window":
      return b.window_start === null && b.window_end === null;
    case "access_notes":
      return b.access_notes === null;
    case "po_number":
      return b.po_number === null;
    case "sender":
      return b.bzzzbx_customer_id === null && b.bzzzbx_contact_id === null;
    case "multiple_jobs":
      return true;
  }
}

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** El valor con palabras: el nombre que leyó BzzzBX, o `— —` y el ID como texto secundario. */
function textoDe(campo: CampoDeIa, valor: unknown, nombres: Record<string, string>, espacios: { id: string; label: string }[]): { texto: string; secundario: string | null } {
  const nombre = (id: unknown) => (typeof id === "string" ? nombres[id] : undefined);
  switch (campo) {
    case "property":
    case "service": {
      const n = nombre(valor);
      return n ? { texto: n, secundario: null } : { texto: SIN_VALOR, secundario: String(valor) };
    }
    case "space": {
      const n = espacios.find((e) => e.id === valor)?.label ?? nombre(valor);
      return n ? { texto: n, secundario: null } : { texto: SIN_VALOR, secundario: String(valor) };
    }
    case "time_window": {
      const w = valor as { start: string; end: string };
      return { texto: `${w.start}–${w.end}`, secundario: null };
    }
    case "sender": {
      const s = valor as { bzzzbx_customer_id: string; bzzzbx_contact_id?: string | null };
      const cliente = nombre(s.bzzzbx_customer_id);
      const contacto = s.bzzzbx_contact_id ? nombre(s.bzzzbx_contact_id) : undefined;
      if (!cliente) return { texto: SIN_VALOR, secundario: [s.bzzzbx_customer_id, s.bzzzbx_contact_id].filter(Boolean).join(" · ") };
      return { texto: contacto ? `${cliente} · ${contacto}` : cliente, secundario: null };
    }
    case "multiple_jobs":
      return { texto: String((valor as { count: number }).count), secundario: null };
    default:
      return { texto: String(valor), secundario: null };
  }
}

function abiertaDe(
  campo: CampoDeIa,
  sugerencias: SugerenciaLeida[],
  e: EntradaDeIa,
): SugerenciaAbiertaDeIa | null {
  const delCampo = sugerencias.filter((s) => s.campo === campo).sort((a, b) => a.rank - b.rank);
  const principal = delCampo.find((s) => s.rank === 1);
  if (!principal) return null;
  const espacios = e.espacios ?? [];
  const { texto, secundario } = textoDe(campo, principal.valor, e.nombres, espacios);
  const borrador = valorDelBorrador(campo, e.borrador);
  const igualAlBorrador = igual(principal.valor, borrador) || (campo === "sender" && igual(normalizarSender(principal.valor), normalizarSender(borrador)));

  const crosswalk = campo === "property" || campo === "service" || campo === "space" || campo === "sender";
  const opciones: OpcionDeCambio[] = [];
  if (crosswalk) {
    // Si el borrador ya no tiene el valor de la IA, se ofrece como "la IA propuso"; las alternativas siempre.
    if (!igualAlBorrador) opciones.push({ valor: principal.valor, ...textoDe(campo, principal.valor, e.nombres, espacios), origen: "ia" });
    for (const alt of delCampo.filter((s) => s.rank > 1)) {
      opciones.push({ valor: alt.valor, ...textoDe(campo, alt.valor, e.nombres, espacios), origen: "alternativa" });
    }
    if (campo === "space") {
      for (const esp of espacios) {
        if (!opciones.some((o) => o.valor === esp.id)) opciones.push({ valor: esp.id, texto: esp.label, secundario: null, origen: "propiedad" });
      }
    }
  }
  return { id: principal.id, valor: principal.valor, texto, secundario, razon: principal.razon, igualAlBorrador, opciones };
}

function normalizarSender(v: unknown): unknown {
  if (typeof v !== "object" || v === null) return v;
  const s = v as { bzzzbx_customer_id?: unknown; bzzzbx_contact_id?: unknown };
  return { bzzzbx_customer_id: s.bzzzbx_customer_id ?? null, bzzzbx_contact_id: s.bzzzbx_contact_id ?? null };
}

export function armarIa(e: EntradaDeIa): VistaIa {
  const pendiente = e.analisis === null || e.analisis.estado !== "completed";
  const campos = Object.fromEntries(
    CAMPOS_DE_IA.map((campo): [CampoDeIa, VistaDeCampoIa] => [
      campo,
      { campo, ...ETIQUETAS[campo], vacio: estaVacio(campo, e.borrador), abierta: abiertaDe(campo, e.sugerencias, e) },
    ]),
  ) as Record<CampoDeIa, VistaDeCampoIa>;

  const varios = campos.multiple_jobs.abierta;
  const cantidad = varios ? Number((varios.valor as { count?: unknown }).count) : 0;
  return {
    pendiente,
    campos,
    variosJobs: varios && cantidad >= 2 ? { id: varios.id, cantidad } : null,
  };
}
