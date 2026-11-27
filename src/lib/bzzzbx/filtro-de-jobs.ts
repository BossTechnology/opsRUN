/**
 * Reglas de `FiltroDeJobs` (spec Fase A §3). Las aplica cualquier
 * implementación del puerto antes de leer, así un filtro inválido falla igual
 * contra el falso y contra el real.
 */
import { FiltroInvalido } from "./errores";
import { BUSCAR_JOBS_MAX_DIAS, type FiltroDeJobs } from "./tipos";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Las reglas de `FiltroDeJobs`, iguales para cualquier implementación. */
export function validarFiltroDeJobs(filtro: FiltroDeJobs): void {
  if (!filtro.bzzzbx_customer_id && !filtro.bzzzbx_property_id) {
    throw new FiltroInvalido("buscarJobs exige cliente o propiedad");
  }
  const desde = FECHA.test(filtro.desde) ? Date.parse(`${filtro.desde}T00:00:00Z`) : NaN;
  const hasta = FECHA.test(filtro.hasta) ? Date.parse(`${filtro.hasta}T00:00:00Z`) : NaN;
  if (Number.isNaN(desde) || Number.isNaN(hasta)) {
    throw new FiltroInvalido("buscarJobs exige desde y hasta como YYYY-MM-DD");
  }
  if (desde > hasta) throw new FiltroInvalido("buscarJobs: desde es posterior a hasta");
  if ((hasta - desde) / DIA_MS + 1 > BUSCAR_JOBS_MAX_DIAS) {
    throw new FiltroInvalido(`buscarJobs: el rango pasa de ${BUSCAR_JOBS_MAX_DIAS} días`);
  }
}
