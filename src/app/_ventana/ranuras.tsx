/**
 * Las ranuras de la Job window (spec OPR-26 §7): el lugar, las props y el
 * marcador (`data-ranura`) de cada una. La tarjeta dueña reemplaza el componente
 * y conserva el `data-ranura` sin tocar el marco. Los tipos de props están en
 * `src/lib/ventana/ranuras.ts`. Ya no queda ninguna con el marcador "Coming in a
 * later build" [S-10]: cada una tiene su tarjeta.
 *
 * Ninguna ranura lee de BzzzBX desde el navegador: reciben datos ya leídos y
 * Server Actions.
 */

/** OPR-27: columna izquierda, con su propio Suspense. Vive en `../_conversacion/`. */
export { RanuraConversacion } from "../_conversacion/ranura";

/** OPR-28: arriba de la pestaña de la propiedad, solo en Requests (cliente: tiene estado). */
export { RanuraEnlace } from "./ranura-enlace";

/** OPR-35: pestaña Audit, desde Scheduled. Ya está construida en `./ranura-audit`. */
export { RanuraAudit } from "./ranura-audit";

/** OPR-30: pestaña Job tracker, desde In Progress. */
export { RanuraTracker } from "./ranura-tracker";

/** OPR-32: pestaña Billing, en Validation. */
export { RanuraBilling } from "./ranura-billing";
