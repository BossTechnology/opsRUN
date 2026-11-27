/**
 * Las reglas de alerta que Clear alert puede limpiar (spec OPR-30 §4.3, P-6):
 * solo MEC-003 Running long. La lista que cuenta es la de la base,
 * `opsrun_private.clearable_rules()`, que la hace cumplir con `OP020`; esta copia
 * solo decide qué ofrece la interfaz y qué rechaza el servidor sin llamar a la
 * base. Si cambia una, cambia la otra (hay una prueba contra la base que lo
 * comprueba).
 */
export const REGLAS_LIMPIABLES: readonly string[] = ["MEC-003"];

/** Largo máximo del PO (S-14): lo mismo que comprueba la base (`request_entered_po_not_blank`). */
export const PO_MAX = 64;

export const esReglaLimpiable = (regla: string): boolean => REGLAS_LIMPIABLES.includes(regla);
