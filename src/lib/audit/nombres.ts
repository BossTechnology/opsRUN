/**
 * Los nombres de PINCH que nombra el Audit (spec OPR-35 §7.2): el cleaner, el
 * job que se rechazó y los valores de IA que son crosswalk IDs. Se leen del
 * puerto de BzzzBX al pintar, con `obtenerVarios` por entidad y en paralelo, y
 * **nunca se guardan** (principio 1). Dentro del presupuesto de la ventana
 * (OPR-26 §2): si BzzzBX está caído, la lectura falla o tarda, no hay nombres y
 * el Audit se ve completo en lo de opsRUN, con "— —" en lo de PINCH. Audit
 * nunca espera a BzzzBX.
 */
import { esNoDisponible } from "../bzzzbx/errores";
import type { LecturaBzzzbx } from "../bzzzbx/puertos";
import { PRESUPUESTO_BZZZBX_MS, conPresupuesto } from "../ventana/leer";

import { SIN_NOMBRES, type EntidadConNombre, type Nombres } from "./tipos";

export type EntradaDeNombres = {
  ids: Record<EntidadConNombre, string[]>;
  lectura: LecturaBzzzbx;
  /** `PropsRanuraBase.bzzzbx.disponible`: con false, ni se llama al puerto. */
  disponible: boolean;
  presupuestoMs?: number;
};

export async function leerNombres({
  ids,
  lectura,
  disponible,
  presupuestoMs = PRESUPUESTO_BZZZBX_MS,
}: EntradaDeNombres): Promise<Nombres> {
  if (!disponible) return SIN_NOMBRES;
  const hayAlgo = Object.values(ids).some((lista) => lista.length > 0);
  if (!hayAlgo) return { ...SIN_NOMBRES, disponible: true };

  try {
    const [jobs, equipos, propiedades, servicios] = await conPresupuesto(
      Promise.all([
        ids.job.length ? lectura.obtenerVarios("job", ids.job) : [],
        ids.cleaner_team.length ? lectura.obtenerVarios("cleaner_team", ids.cleaner_team) : [],
        ids.property.length ? lectura.obtenerVarios("property", ids.property) : [],
        ids.service.length ? lectura.obtenerVarios("service", ids.service) : [],
      ]),
      presupuestoMs,
    );
    return {
      disponible: true,
      job: Object.fromEntries(jobs.map((j) => [j.bzzzbx_job_id, j.job_number])),
      cleaner_team: Object.fromEntries(equipos.map((e) => [e.bzzzbx_team_id, e.name])),
      property: Object.fromEntries(propiedades.map((p) => [p.bzzzbx_property_id, p.name])),
      service: Object.fromEntries(servicios.map((s) => [s.bzzzbx_service_id, s.name])),
    };
  } catch (e) {
    // Se reconoce por nombre, no con instanceof (el falso puede venir de otra copia del módulo).
    if (!esNoDisponible(e)) console.error("[opsRUN] audit: no se pudieron leer los nombres de BzzzBX:", e instanceof Error ? e.name : "error");
    return SIN_NOMBRES;
  }
}
