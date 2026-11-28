import "server-only";

/**
 * La pestaña Alerts en el servidor (spec OPR-34 §5 y §7): lo de opsRUN (el
 * historial y Waiting) por el pool de `opsrun_app` en solo lectura, los nombres
 * del cleaner por el puerto de BzzzBX, y `armarAlertas` (pura) con lo leído. Las
 * alertas de Needs action llegan ya leídas y descontadas (`alertasDeLaRequest`,
 * las de la ventana): esta lectura no vuelve a pedirlas. Nada se guarda ni se
 * escribe: una lectura nunca escribe.
 */
import type { AlertResult } from "../bzzzbx/tipos";
import { obtenerConversacion } from "../conversacion/servidor";
import { nombresDeEquipos } from "../ventana/servidor";

import { armarAlertas, mensajesDeLasAlertas } from "./armar";
import { leerAlertas } from "./consultas";
import { arregloDe } from "./reglas";
import type { VistaAlertas } from "./tipos";

export type EntradaDeObtenerAlertas = {
  requestId: string;
  /** `PropsRanuraAlertas.alertas`: las de Needs action, ya leídas y descontadas. */
  abiertas: AlertResult[];
  /** `PropsRanuraBase.zona`. */
  zona: string;
  /** `PropsRanuraBase.bzzzbx.disponible`: con false no se pide ningún nombre. */
  bzzzbxDisponible: boolean;
  /** `PropsRanuraBase.etapa`: con el job cancelado el Composer no envía y Edit and resend queda en gris. */
  etapa?: string;
};

export async function obtenerAlertas({ requestId, abiertas, zona, bzzzbxDisponible, etapa = "requests" }: EntradaDeObtenerAlertas): Promise<VistaAlertas> {
  const { ocurrencias, esperas } = await leerAlertas(requestId);
  const equipos = bzzzbxDisponible ? await nombresDeEquipos(esperas.map((e) => e.bzzzbx_team_id)) : {};
  // Solo si hay una alerta de mensaje abierta: las demás pestañas no leen la conversación.
  const hayDeMensaje = abiertas.some((a) => a.sujeto.tipo === "message" && arregloDe(a.rule_id).tipo === "reenviar");
  const conversacion = hayDeMensaje
    ? await obtenerConversacion({ requestId, etapa, puedeEnviar: bzzzbxDisponible && etapa !== "cancelled", zona })
    : null;
  return armarAlertas({ abiertas, ocurrencias, esperas, equipos, mensajes: mensajesDeLasAlertas(abiertas, conversacion), ahora: new Date(), zona });
}
