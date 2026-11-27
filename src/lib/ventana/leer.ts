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
import type { AlertResult, Message } from "../bzzzbx/tipos";
import { leerDeBzzzbx } from "../tablero/leer";

import { LEIDOS_VENTANA_VACIOS, type FilaVentana, type LeidosVentana } from "./tipos";

export const PRESUPUESTO_BZZZBX_MS = 1500;

/** Lo último que respondió BzzzBX por request, y cuándo. */
export type MemoriaVentana = Map<string, { leidos: LeidosVentana; en: string }>;

/** Cuántas requests recuerda el proceso; la más vieja sale primero. */
const MAX_RECORDADAS = 200;

function conPresupuesto<T>(trabajo: Promise<T>, ms: number): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout>;
  const vencido = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new BzzzbxNoDisponible("BzzzBX tardó más que el presupuesto")), ms);
  });
  // Si el trabajo termina tarde y falla, nadie lo escucha: que no sea un rechazo sin manejar.
  trabajo.catch(() => {});
  return Promise.race([trabajo, vencido]).finally(() => clearTimeout(temporizador));
}

async function leerTodo(fila: FilaVentana, hilos: string[], lectura: LecturaBzzzbx): Promise<LeidosVentana> {
  // Una sola fila: el original va por `bzzzbx_thread_id`, como en el tablero.
  const [base, contacto, equipo] = await Promise.all([
    leerDeBzzzbx([{ ...fila, bzzzbx_thread_id: hilos[0] ?? fila.bzzzbx_thread_id }], lectura),
    fila.bzzzbx_contact_id ? lectura.obtener("contact", fila.bzzzbx_contact_id) : null,
    fila.bzzzbx_team_id ? lectura.obtener("cleaner_team", fila.bzzzbx_team_id) : null,
  ]);

  // Los demás hilos de la request y las alertas de los mensajes de todos (S-8).
  const otros = await Promise.all(hilos.slice(1).map((id) => lectura.listarPor("message", { bzzzbx_thread_id: id })));
  const mensajes: Message[] = [...base.mensajes, ...otros.flat()];
  const deMensajes = await Promise.all(
    mensajes.map((m) => lectura.listarPor("alert_result", { sujeto: { tipo: "message", bzzzbx_message_id: m.bzzzbx_message_id } })),
  );

  const alertas = new Map<string, AlertResult>();
  for (const a of [...base.alertas, ...deMensajes.flat()]) alertas.set(a.bzzzbx_alert_id, a);

  // El puerto agrega `version` y `leido_en`; son parte del tipo `Leido`.
  return {
    ...base,
    mensajes,
    alertas: [...alertas.values()],
    contactos: contacto ? [contacto] : [],
    equipos: equipo ? [equipo] : [],
  };
}

export type EntradaDeLectura = {
  fila: FilaVentana;
  hilos: string[];
  lectura: LecturaBzzzbx;
  ahora: Date;
  memoria: MemoriaVentana;
  presupuestoMs?: number;
};

export async function leerVentanaDeBzzzbx({
  fila,
  hilos,
  lectura,
  ahora,
  memoria,
  presupuestoMs = PRESUPUESTO_BZZZBX_MS,
}: EntradaDeLectura): Promise<{ leidos: LeidosVentana; bzzzbx: { disponible: boolean; actualizadoEn: string | null } }> {
  try {
    const leidos = await conPresupuesto(leerTodo(fila, hilos, lectura), presupuestoMs);
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
