/**
 * La forma de cada campo del análisis de IA (spec OPR-36 §4.1), pura. La usan la
 * tarea `analisis_ia` (para descartar un resultado inválido antes de llamar a la
 * base), la prueba de contrato del puerto y la UI de Change. La base repite las
 * mismas reglas (`opsrun_private.ai_value_valid`): esta es la primera defensa, esa
 * es la última. Sin imports del servidor.
 */
import { CAMPOS_DE_IA, type CampoDeIa, type Propuesta } from "../bzzzbx/tipos-ia";

const CROSSWALK = /^bx-[a-z]{2,10}-[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const HORA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Largo máximo del motivo que guarda opsRUN (P-9). */
export const MOTIVO_MAX = 200;

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const esCrosswalk = (v: unknown): v is string => typeof v === "string" && CROSSWALK.test(v);
const llaves = (o: Record<string, unknown>) => Object.keys(o).sort();

function texto(v: unknown, max: number): boolean {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

function fechaValida(v: unknown): boolean {
  if (typeof v !== "string" || !FECHA.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** ¿`valor` tiene la forma de ese campo? */
export function valorValido(campo: CampoDeIa, valor: unknown): boolean {
  switch (campo) {
    case "property":
    case "space":
    case "service":
      return esCrosswalk(valor);
    case "unit":
      return texto(valor, 32);
    case "access_notes":
      return texto(valor, 500);
    case "po_number":
      return texto(valor, 64);
    case "beds":
      return typeof valor === "number" && Number.isInteger(valor) && valor >= 0 && valor <= 50;
    case "service_date":
      return fechaValida(valor);
    case "time_window": {
      if (!esObjeto(valor) || llaves(valor).join() !== "end,start") return false;
      const { start, end } = valor;
      return typeof start === "string" && typeof end === "string" && HORA.test(start) && HORA.test(end) && start < end;
    }
    case "sender": {
      if (!esObjeto(valor) || llaves(valor).some((k) => k !== "bzzzbx_customer_id" && k !== "bzzzbx_contact_id")) return false;
      if (!esCrosswalk(valor.bzzzbx_customer_id)) return false;
      const contacto = valor.bzzzbx_contact_id;
      return contacto === undefined || contacto === null || esCrosswalk(contacto);
    }
    case "multiple_jobs": {
      if (!esObjeto(valor) || llaves(valor).join() !== "count") return false;
      const n = valor.count;
      return typeof n === "number" && Number.isInteger(n) && n >= 2 && n <= 20;
    }
  }
}

/** Lo que se guarda: `sender` siempre con sus dos claves (la base compara igual a igual con el borrador). */
export function normalizar(campo: CampoDeIa, valor: unknown): unknown {
  if (campo === "sender" && esObjeto(valor)) {
    return { bzzzbx_customer_id: valor.bzzzbx_customer_id, bzzzbx_contact_id: valor.bzzzbx_contact_id ?? null };
  }
  return valor;
}

export const esCampoDeIa = (v: unknown): v is CampoDeIa => typeof v === "string" && (CAMPOS_DE_IA as readonly string[]).includes(v);

/** Una propuesta lista para `record_ai_analysis`: las claves exactas de §4.1, sin nada de PINCH. */
export type PropuestaParaGuardar = { field: CampoDeIa; rank: 1 | 2 | 3; value: unknown; reason: string | null };

export type ResultadoDeForma = { ok: true; propuestas: PropuestaParaGuardar[] } | { ok: false; campo: string; motivo: string };

/**
 * Revisa todas las propuestas de un resultado. Un resultado con una sola inválida se
 * descarta entero (S-9): no se guarda la mitad de un análisis que pudo leer mal. El
 * motivo del descarte nombra el campo y nunca el valor (puede traer datos del correo).
 */
export function validarPropuestas(propuestas: Propuesta[], pedidos: readonly CampoDeIa[]): ResultadoDeForma {
  const vistas = new Set<string>();
  const conPrincipal = new Set<string>();
  const salida: PropuestaParaGuardar[] = [];
  for (const p of propuestas) {
    const campo = String((p as { campo?: unknown }).campo);
    if (!esCampoDeIa(p.campo) || !pedidos.includes(p.campo)) return { ok: false, campo, motivo: "campo_no_pedido" };
    if (p.rank !== 1 && p.rank !== 2 && p.rank !== 3) return { ok: false, campo, motivo: "rango" };
    if (!valorValido(p.campo, p.valor)) return { ok: false, campo, motivo: "forma" };
    if (p.motivo !== null && p.motivo !== undefined && (typeof p.motivo !== "string" || p.motivo.length > MOTIVO_MAX)) {
      return { ok: false, campo, motivo: "motivo" };
    }
    const clave = `${p.campo}:${p.rank}`;
    if (vistas.has(clave)) return { ok: false, campo, motivo: "repetida" };
    vistas.add(clave);
    if (p.rank === 1) conPrincipal.add(p.campo);
    salida.push({ field: p.campo, rank: p.rank, value: normalizar(p.campo, p.valor), reason: p.motivo ?? null });
  }
  const sinPrincipal = salida.find((p) => !conPrincipal.has(p.field));
  if (sinPrincipal) return { ok: false, campo: sinPrincipal.field, motivo: "sin_principal" };
  return { ok: true, propuestas: salida };
}

/**
 * Lo que el operador escribe en Change, ya con la forma del campo; null si no sirve.
 * Para crosswalk IDs no se acepta texto libre: se elige de las alternativas de la IA
 * o de los espacios de la propiedad (la búsqueda libre es de `update_request_detail`, P-5).
 */
export function valorDeEntrada(campo: CampoDeIa, entrada: string | { start: string; end: string }): unknown | null {
  let valor: unknown;
  switch (campo) {
    case "unit":
    case "access_notes":
    case "po_number":
      valor = typeof entrada === "string" ? entrada.trim() : null;
      break;
    case "beds":
      valor = typeof entrada === "string" && /^\d{1,2}$/.test(entrada.trim()) ? Number(entrada.trim()) : null;
      break;
    case "service_date":
      valor = typeof entrada === "string" ? entrada.trim() : null;
      break;
    case "time_window":
      valor = typeof entrada === "object" ? entrada : null;
      break;
    default:
      valor = null;
  }
  return valor !== null && valorValido(campo, valor) ? valor : null;
}
