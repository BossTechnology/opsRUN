/**
 * Lectura de BzzzBX para la Job window (spec OPR-26 §2, §6.1 y §8.2): reutiliza
 * `leerDeBzzzbx` del tablero con una sola fila y agrega el contacto, el cleaner
 * y las alertas de los mensajes del hilo. Todo en paralelo y dentro de un
 * presupuesto de 1,5 s [S-2]: pasado eso cuenta como BzzzBX caído y la ventana
 * se pinta con lo último leído de esa request (en memoria del proceso, nunca
 * en la base) y el aviso. Nada de esto se guarda.
 */
import { esNoDisponible, BzzzbxNoDisponible } from "../bzzzbx/errores";
import type { LecturaBzzzbx } from "../bzzzbx/puertos";
import type { AlertResult, Message, Photo } from "../bzzzbx/tipos";
import { leerDeBzzzbx } from "../tablero/leer";

import { LEIDOS_VENTANA_VACIOS, type FilaVentana, type LeidosVentana } from "./tipos";

export const PRESUPUESTO_BZZZBX_MS = 1500;

/** Lo último que respondió BzzzBX por request, y cuándo. */
export type MemoriaVentana = Map<string, { leidos: LeidosVentana; en: string }>;

/** Cuántas requests recuerda el proceso; la más vieja sale primero. */
const MAX_RECORDADAS = 200;

export function conPresupuesto<T>(trabajo: Promise<T>, ms: number): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout>;
  const vencido = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new BzzzbxNoDisponible("BzzzBX tardó más que el presupuesto")), ms);
  });
  // Si el trabajo termina tarde y falla, nadie lo escucha: que no sea un rechazo sin manejar.
  trabajo.catch(() => {});
  return Promise.race([trabajo, vencido]).finally(() => clearTimeout(temporizador));
}

/** Lo que la IA propuso (OPR-36 §7): sus nombres se leen junto a lo demás, dentro del mismo presupuesto, y nunca se guardan. */
export type ExtrasDeLectura = { propiedades: string[]; servicios: string[]; clientes: string[]; contactos: string[] };

/** Suma lo leído de los IDs propuestos a lo ya leído, sin repetir. */
function sumar<T>(base: T[], extra: T[], id: (x: T) => string): T[] {
  const vistos = new Set(base.map(id));
  return [...base, ...extra.filter((x) => !vistos.has(id(x)))];
}

async function leerTodo(fila: FilaVentana, hilos: string[], lectura: LecturaBzzzbx, extras?: ExtrasDeLectura): Promise<LeidosVentana> {
  // Una sola fila: el original va por `bzzzbx_thread_id`, como en el tablero.
  const [base, contacto, equipo, fotos, propuestas] = await Promise.all([
    leerDeBzzzbx([{ ...fila, bzzzbx_thread_id: hilos[0] ?? fila.bzzzbx_thread_id }], lectura),
    fila.bzzzbx_contact_id ? lectura.obtener("contact", fila.bzzzbx_contact_id) : null,
    fila.bzzzbx_team_id ? lectura.obtener("cleaner_team", fila.bzzzbx_team_id) : null,
    // La galería del Job tracker (OPR-30): solo la lista; la imagen llega por /api/fotos.
    fila.bzzzbx_job_id ? lectura.listarPor("photo", { bzzzbx_job_id: fila.bzzzbx_job_id }) : ([] as Photo[]),
    leerPropuestas(lectura, extras),
  ]);

  // Los demás hilos de la request y las alertas de los mensajes de todos (S-8).
  const otros = await Promise.all(hilos.slice(1).map((id) => lectura.listarPor("message", { bzzzbx_thread_id: id })));
  const mensajes: Message[] = [...base.mensajes, ...otros.flat()];
  const deMensajes = await Promise.all(
    mensajes.map((m) => lectura.listarPor("alert_result", { sujeto: { tipo: "message", bzzzbx_message_id: m.bzzzbx_message_id } })),
  );

  // Y las que opsRUN tiene abiertas con un mensaje (OPR-34, P-3): se releen por id, como en el tablero.
  const porId = fila.alertas_de_mensaje.length > 0 ? await lectura.obtenerVarios("alert_result", fila.alertas_de_mensaje) : [];

  const alertas = new Map<string, AlertResult>();
  for (const a of [...base.alertas, ...deMensajes.flat(), ...porId]) alertas.set(a.bzzzbx_alert_id, a);

  // El puerto agrega `version` y `leido_en`; son parte del tipo `Leido`.
  return {
    ...base,
    properties: sumar(base.properties, propuestas.propiedades, (p) => p.bzzzbx_property_id),
    services: sumar(base.services, propuestas.servicios, (s) => s.bzzzbx_service_id),
    customers: sumar(base.customers, propuestas.clientes, (c) => c.bzzzbx_customer_id),
    mensajes,
    alertas: [...alertas.values()],
    contactos: sumar(contacto ? [contacto] : [], propuestas.contactos, (c) => c.bzzzbx_contact_id),
    equipos: equipo ? [equipo] : [],
    fotos,
  };
}

async function leerPropuestas(lectura: LecturaBzzzbx, extras?: ExtrasDeLectura) {
  const pedir = <E extends "property" | "service" | "customer" | "contact">(entidad: E, ids: string[] | undefined) =>
    ids && ids.length > 0 ? lectura.obtenerVarios(entidad, ids) : Promise.resolve([]);
  const [propiedades, servicios, clientes, contactos] = await Promise.all([
    pedir("property", extras?.propiedades),
    pedir("service", extras?.servicios),
    pedir("customer", extras?.clientes),
    pedir("contact", extras?.contactos),
  ]);
  return { propiedades, servicios, clientes, contactos };
}

export type EntradaDeLectura = {
  fila: FilaVentana;
  hilos: string[];
  lectura: LecturaBzzzbx;
  ahora: Date;
  memoria: MemoriaVentana;
  presupuestoMs?: number;
  /** Los IDs que propuso la IA, para leer también sus nombres (OPR-36). */
  extras?: ExtrasDeLectura;
};

export async function leerVentanaDeBzzzbx({
  fila,
  hilos,
  lectura,
  ahora,
  memoria,
  presupuestoMs = PRESUPUESTO_BZZZBX_MS,
  extras,
}: EntradaDeLectura): Promise<{ leidos: LeidosVentana; bzzzbx: { disponible: boolean; actualizadoEn: string | null } }> {
  try {
    const leidos = await conPresupuesto(leerTodo(fila, hilos, lectura, extras), presupuestoMs);
    const en = ahora.toISOString();
    memoria.delete(fila.id); // se vuelve a insertar al final: la más reciente
    memoria.set(fila.id, { leidos, en });
    if (memoria.size > MAX_RECORDADAS) memoria.delete(memoria.keys().next().value!);
    return { leidos, bzzzbx: { disponible: true, actualizadoEn: en } };
  } catch (e) {
    if (!esNoDisponible(e)) throw e;
    const previo = memoria.get(fila.id);
    return {
      leidos: previo?.leidos ?? LEIDOS_VENTANA_VACIOS,
      bzzzbx: { disponible: false, actualizadoEn: previo?.en ?? null },
    };
  }
}
