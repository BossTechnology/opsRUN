import { connection } from "next/server";

import { obtenerConversacion } from "@/lib/conversacion/servidor";
import type { PropsRanuraConversacion } from "@/lib/ventana/ranuras";

import { Conversacion } from "./composer";

/**
 * La ranura de la conversación (spec OPR-27 §6), en su propio server component
 * y su propio `Suspense` para no frenar el encabezado. Lee en el servidor lo de
 * opsRUN (vínculos, envíos, notas, borradores de IA) y de BzzzBX (mensajes y
 * cleaner, por su puerto); el navegador solo recibe lo ya armado. El contrato
 * de props es el de OPR-26 §7.1 y no cambia.
 */
export async function RanuraConversacion(props: PropsRanuraConversacion) {
  await connection();
  const datos = await obtenerConversacion({
    requestId: props.requestId,
    etapa: props.etapa,
    hilos: props.hilos,
    puedeEnviar: props.puedeEnviar,
    zona: props.zona,
  });
  if (!datos) {
    return (
      <section className="ranura ranura-conversacion" data-ranura="conversacion" aria-label="Conversation">
        <h2>Conversation</h2>
        <p>Job not found.</p>
      </section>
    );
  }
  return <Conversacion datos={datos} zona={props.zona} />;
}
