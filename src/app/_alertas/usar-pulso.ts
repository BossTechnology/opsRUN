"use client";

import { useState } from "react";

/**
 * (Se llama `usePulso` y no `usarPulso` como en el spec, para que la regla de hooks del lint lo reconozca.)
 * Si la insignia de Alerts (o el ícono de la barra) debe latir (spec OPR-34 §5.2
 * y P-13): cuando en los ids rojos de Needs action aparece uno que no estaba en
 * el pintado anterior de esta misma ventana. El primer pintado fija la base y no
 * late. Un pintado igual al anterior deja el pulso como estaba; uno distinto lo
 * recalcula. La animación (3 ciclos) es de CSS y con `prefers-reduced-motion:
 * reduce` no hay: el color basta.
 *
 * Recibe solo los ids rojos: una alerta ámbar nueva no hace latir. Se ajusta
 * durante el render (el patrón de React para estado derivado de props), sin
 * efectos, para que `router.refresh()` (que conserva el estado del cliente) lo
 * actualice en el mismo pintado.
 */
export function usePulso(idsRojos: readonly string[]): boolean {
  const clave = [...idsRojos].sort().join("|");
  const [estado, setEstado] = useState({ clave, ids: idsRojos, pulso: false });

  if (estado.clave !== clave) {
    const antes = new Set(estado.ids);
    setEstado({ clave, ids: idsRojos, pulso: idsRojos.some((id) => !antes.has(id)) });
    return idsRojos.some((id) => !antes.has(id));
  }
  return estado.pulso;
}
