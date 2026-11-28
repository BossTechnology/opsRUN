/**
 * El catálogo de plantillas en código (spec OPR-18 §4.2 y §8.1): lo que no es texto. La base (`message_template`)
 * dice qué plantillas existen y su texto; este archivo dice cómo se llaman, en qué modo y etapa se ofrecen en el
 * Composer, cuáles son avisos del panel Notices y qué placeholders se escriben a mano. Es lo único que decide
 * **qué se ofrece**. Funciones y constantes puras: sin base, sin puerto, sin Next.
 *
 * Una clave que está en la base y no aquí no se ofrece; una de aquí sin fila activa tampoco (`disponibles.ts`).
 * Esto no envía nada: ningún camino crea un `send_*` desde una plantilla.
 */
import type { EtapaVentana } from "../ventana/tipos";

/** Los cuatro de la tarjeta, y solo cuatro (S-4). */
export const PLACEHOLDERS = ["property", "space", "date", "window"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export type ModoConPlantillas = "customer" | "cleaner";
export type CanalDePlantilla = "email" | "text";

export type EntradaDeCatalogo = {
  nombre: string;
  canal: CanalDePlantilla;
  /** Dónde se elige en el Composer; null si no se ofrece ahí. */
  composer: { modo: ModoConPlantillas; etapas: readonly EtapaVentana[] } | null;
  /** En qué etapas se ve como aviso del panel Notices; vacío si no es un aviso. */
  avisoEn: readonly EtapaVentana[];
  /** Placeholders que opsRUN no conoce y el operador escribe: quedan siempre literales (§4.3). */
  aMano: readonly Placeholder[];
};

const DE_SCHEDULED_EN_ADELANTE = ["scheduled", "in_progress", "complete", "validation"] as const satisfies readonly EtapaVentana[];

export const CATALOGO = {
  cleaner_confirmation_request: {
    nombre: "Confirmation request",
    canal: "text",
    composer: { modo: "cleaner", etapas: ["requests"] },
    avisoEn: [],
    aMano: [],
  },
  reschedule_request: {
    nombre: "Reschedule request",
    canal: "text",
    composer: { modo: "cleaner", etapas: ["scheduled"] },
    avisoEn: [],
    // La fecha y la ventana nuevas las trae la acción Reschedule en la Fase B (S-9): hoy se escriben.
    aMano: ["date", "window"],
  },
  cancellation_cleaner: {
    nombre: "Cancellation (cleaner)",
    canal: "text",
    // Con el job cancelado el Composer entero está en gris: solo se ve en Notices.
    composer: null,
    avisoEn: ["cancelled"],
    aMano: [],
  },
  cancellation_requester: {
    nombre: "Cancellation (requester)",
    canal: "email",
    composer: null,
    avisoEn: ["cancelled"],
    aMano: [],
  },
  requester_scheduled: {
    nombre: "Scheduled notice",
    canal: "email",
    composer: { modo: "customer", etapas: DE_SCHEDULED_EN_ADELANTE },
    avisoEn: DE_SCHEDULED_EN_ADELANTE,
    aMano: [],
  },
  requester_done: {
    nombre: "Done notice",
    canal: "email",
    // Solo después de Approve & confirm: el aviso Done es sobre un job aprobado (S-7).
    composer: { modo: "customer", etapas: ["validation"] },
    avisoEn: ["validation"],
    aMano: [],
  },
} as const satisfies Record<string, EntradaDeCatalogo>;

export type ClaveDePlantilla = keyof typeof CATALOGO;
export const CLAVES = Object.keys(CATALOGO) as ClaveDePlantilla[];

/** ¿Es una clave del catálogo? (`Object.hasOwn`: "constructor" o "__proto__" no lo son.) */
export function esClave(clave: unknown): clave is ClaveDePlantilla {
  return typeof clave === "string" && Object.hasOwn(CATALOGO, clave);
}

/** ¿Se ofrece en el picker del Composer de este modo y etapa? */
export function ofrecidaEnElComposer(clave: string, modo: string, etapa: EtapaVentana | string): boolean {
  if (!esClave(clave)) return false;
  const c: EntradaDeCatalogo = CATALOGO[clave];
  return c.composer !== null && c.composer.modo === modo && (c.composer.etapas as readonly string[]).includes(etapa);
}

/**
 * La comprobación del servidor al enviar (§8.3): la plantilla es del catálogo, del modo y de la etapa. El picker no
 * es la defensa; esto sí.
 */
export const plantillaPermitida = ofrecidaEnElComposer;

/** ¿Es un aviso del panel Notices en esta etapa? */
export function aviso(clave: string, etapa: EtapaVentana | string): boolean {
  if (!esClave(clave)) return false;
  return (CATALOGO[clave] as EntradaDeCatalogo).avisoEn.includes(etapa as EtapaVentana);
}
