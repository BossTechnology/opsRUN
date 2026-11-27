/**
 * Formatos del tablero, en inglés como los ve el operador. Los instantes se
 * muestran en la zona de la operación (S-6 del spec OPR-25, hasta OPR-4); las
 * fechas de servicio y las ventanas ya llegan locales y no se convierten.
 */
import { SIN_VALOR } from "./tipos";

export function hora(instante: string, zona: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zona }).format(
    new Date(instante),
  );
}

function diaLocal(instante: Date, zona: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(instante);
}

/** La hora sola si es de hoy en la zona de la operación; si no, "Nov 21, 9:30 AM". */
export function horaOFecha(instante: string, ahora: Date, zona: string): string {
  const fecha = new Date(instante);
  if (diaLocal(fecha, zona) === diaLocal(ahora, zona)) return hora(instante, zona);
  const dia = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: zona }).format(fecha);
  return `${dia}, ${hora(instante, zona)}`;
}

/**
 * Siempre con fecha, para el Audit, que se lee días después (OPR-35 §6):
 * "Nov 25, 9:30 AM", y con el año delante si no es el año en curso en esa zona
 * ("Nov 25, 2025, 9:30 AM").
 */
export function horaConFecha(instante: string, ahora: Date, zona: string): string {
  const fecha = new Date(instante);
  const anio = (d: Date) => new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: zona }).format(d);
  const dia = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(anio(fecha) === anio(ahora) ? {} : { year: "numeric" as const }),
    timeZone: zona,
  }).format(fecha);
  return `${dia}, ${hora(instante, zona)}`;
}

/** "13:30" → "1:30 PM". */
function horaDeReloj(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const sufijo = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${sufijo}`;
}

/** "Wed, Nov 25 · 9:00 AM–12:00 PM". La fecha es de calendario: se formatea en UTC para no correrla. */
export function fechaYVentana(fecha: string | null, inicio: string | null, fin: string | null): string {
  if (!fecha) return SIN_VALOR;
  const dia = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${fecha}T00:00:00Z`));
  const ventana = inicio && fin ? `${horaDeReloj(inicio)}–${horaDeReloj(fin)}` : SIN_VALOR;
  return `${dia} · ${ventana}`;
}

export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "";
  const primera = partes[0]!.charAt(0);
  const ultima = partes.length > 1 ? partes.at(-1)!.charAt(0) : "";
  return (primera + ultima).toUpperCase();
}
