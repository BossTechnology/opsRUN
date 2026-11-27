/**
 * Las ranuras de la Job window (spec OPR-26 §7): el lugar, las props y el
 * marcador de cada una. Mientras su tarjeta no llegue, muestran "Coming in a
 * later build" [S-10]. La tarjeta dueña reemplaza el componente (y conserva el
 * `data-ranura`) sin tocar el marco. Los tipos de props están en
 * `src/lib/ventana/ranuras.ts`.
 *
 * Ninguna ranura lee de BzzzBX desde el navegador: reciben datos ya leídos y
 * Server Actions.
 */
import {
  TEXTO_RANURA_PENDIENTE,
  type PropsRanuraAudit,
  type PropsRanuraBase,
  type PropsRanuraBilling,
  type PropsRanuraConversacion,
  type PropsRanuraEnlace,
  type PropsRanuraTracker,
} from "@/lib/ventana/ranuras";

function Pendiente({ nombre, titulo, base }: { nombre: string; titulo: string; base: PropsRanuraBase }) {
  return (
    <section className="ranura" data-ranura={nombre} data-etapa={base.etapa} aria-label={titulo}>
      <p>{TEXTO_RANURA_PENDIENTE}</p>
    </section>
  );
}

/** OPR-27: columna izquierda, con su propio Suspense. */
export function RanuraConversacion(props: PropsRanuraConversacion) {
  return (
    <section
      className="ranura ranura-conversacion"
      data-ranura="conversacion"
      data-puede-enviar={props.puedeEnviar}
      aria-label="Conversation"
    >
      <h2>Conversation</h2>
      <p>{TEXTO_RANURA_PENDIENTE}</p>
    </section>
  );
}

/** OPR-28: arriba de la pestaña de la propiedad, solo en Requests. */
export function RanuraEnlace(props: PropsRanuraEnlace) {
  return (
    <section
      className="ranura"
      data-ranura="enlace"
      data-gate={`${props.gate.dueno ? "O" : "-"}${props.gate.details ? "D" : "-"}${props.gate.sender ? "S" : "-"}${props.gate.cleaner ? "C" : "-"}`}
      aria-label="Link to the job in PINCH tools"
    >
      <p>{TEXTO_RANURA_PENDIENTE}</p>
    </section>
  );
}

/** OPR-35: pestaña Audit, desde Scheduled. */
export function RanuraAudit(props: PropsRanuraAudit) {
  return <Pendiente nombre="audit" titulo="Audit" base={props} />;
}

/** OPR-30: pestaña Job tracker, desde In Progress. */
export function RanuraTracker(props: PropsRanuraTracker) {
  return <Pendiente nombre="tracker" titulo="Job tracker" base={props} />;
}

/** OPR-32: pestaña Billing, en Validation. */
export function RanuraBilling(props: PropsRanuraBilling) {
  return <Pendiente nombre="billing" titulo="Billing" base={props} />;
}
