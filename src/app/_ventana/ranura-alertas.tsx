import { connection } from "next/server";
import { Suspense } from "react";

import { obtenerAlertas } from "@/lib/alertas/servidor";
import type { PropsRanuraAlertas } from "@/lib/ventana/ranuras";

import { VistaAlertasPestana } from "./vista-alertas";

/** La pestaña Alerts leída en el servidor, en su propio server component (spec OPR-34 §5). */
async function ContenidoAlertas(props: PropsRanuraAlertas) {
  await connection();
  const vista = await obtenerAlertas({
    requestId: props.requestId,
    abiertas: props.alertas,
    zona: props.zona,
    bzzzbxDisponible: props.bzzzbx.disponible,
    etapa: props.etapa,
  });
  return <VistaAlertasPestana vista={vista} etapa={props.etapa} bzzzbx={props.bzzzbx} />;
}

/**
 * OPR-34: pestaña Alerts, en todas las etapas y siempre la última. Reemplaza el
 * marcador de OPR-26 sin cambiar el contrato (`PropsRanuraAlertas = PropsRanuraBase
 * & { alertas }`) y conserva su `data-ranura="alertas"`. `alertas` son las de Needs
 * action ya leídas y descontadas; la ranura lee lo de opsRUN (Waiting y Resolved)
 * en su propia transacción de solo lectura. Con su propio `Suspense`: no frena el
 * encabezado. No hay sondeo propio: el de la ventana refresca todo cuando cambia algo.
 */
export function RanuraAlertas(props: PropsRanuraAlertas) {
  return (
    <Suspense
      fallback={
        <div className="ranura ranura-alertas" data-ranura="alertas" data-etapa={props.etapa} aria-busy="true">
          <p>Loading alerts…</p>
        </div>
      }
    >
      <ContenidoAlertas {...props} />
    </Suspense>
  );
}
