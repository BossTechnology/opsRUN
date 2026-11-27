import "server-only";

/**
 * El Audit de una request en el servidor (spec OPR-35 §8): opsRUN por el pool
 * de `opsrun_app` en solo lectura, los nombres de PINCH por el puerto de
 * BzzzBX, y `armarAudit` (pura) con lo leído. Nada de esto se guarda.
 */
import { lecturaOAusente } from "../tablero/servidor";

import { armarAudit, idsParaNombres } from "./armar";
import { leerAudit } from "./consultas";
import { leerNombres } from "./nombres";
import type { VistaAudit } from "./tipos";

export type EntradaDeObtenerAudit = {
  requestId: string;
  /** `PropsRanuraBase.zona`. */
  zona: string;
  /** `PropsRanuraBase.bzzzbx.disponible`: con false no se pide ningún nombre. */
  bzzzbxDisponible: boolean;
};

/** La vista del Audit de una request; null si la request no existe. */
export async function obtenerAudit({ requestId, zona, bzzzbxDisponible }: EntradaDeObtenerAudit): Promise<VistaAudit | null> {
  const { identificadores, filas } = await leerAudit(requestId);
  if (!identificadores) return null;
  const nombres = await leerNombres({ ids: idsParaNombres(filas), lectura: lecturaOAusente(), disponible: bzzzbxDisponible });
  return armarAudit({ filas, identificadores, nombres, zona, ahora: new Date() });
}
