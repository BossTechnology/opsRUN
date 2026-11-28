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
import { nombresDeEquipos } from "../ventana/servidor";

import { armarAlertas } from "./armar";
import { leerAlertas } from "./consultas";
import type { VistaAlertas } from "./tipos";

export type EntradaDeObtenerAlertas = {
  requestId: string;
  /** `PropsRanuraAlertas.alertas`: las de Needs action, ya leídas y descontadas. */
  abiertas: AlertResult[];
  /** `PropsRanuraBase.zona`. */
  zona: string;
  /** `PropsRanuraBase.bzzzbx.disponible`: con false no se pide ningún nombre. */
  bzzzbxDisponible: boolean;
};

export async function obtenerAlertas({ requestId, abiertas, zona, bzzzbxDisponible }: EntradaDeObtenerAlertas): Promise<VistaAlertas> {
  const { ocurrencias, esperas } = await leerAlertas(requestId);
  const equipos = bzzzbxDisponible ? await nombresDeEquipos(esperas.map((e) => e.bzzzbx_team_id)) : {};
  return armarAlertas({ abiertas, ocurrencias, esperas, equipos, ahora: new Date(), zona });
}
