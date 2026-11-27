import { connection } from "next/server";
import { Suspense } from "react";

import type { PropsRanuraTracker } from "@/lib/ventana/ranuras";
import { datosDeTracker } from "@/lib/ventana/servidor";

import { VistaTrackerPestana } from "./vista-tracker";

/** El Job tracker leído en el servidor, en su propio server component (spec OPR-30 §4.1). */
async function ContenidoTracker(props: PropsRanuraTracker) {
  await connection();
  const datos = await datosDeTracker(props.requestId);
  if (!datos) return null;
  return <VistaTrackerPestana vista={datos.vista} etapa={props.etapa} />;
}

/**
 * OPR-30: pestaña Job tracker, desde In Progress. Reemplaza el marcador de OPR-26
 * sin cambiar el contrato (`PropsRanuraTracker = PropsRanuraBase`) y conserva su
 * `data-ranura="tracker"`. Con su propio `Suspense`: no frena el encabezado. No hay
 * sondeo propio: el de la ventana refresca todo cuando cambia algo.
 */
export function RanuraTracker(props: PropsRanuraTracker) {
  return (
    <Suspense
      fallback={
        <div className="ranura ranura-tracker" data-ranura="tracker" data-etapa={props.etapa} aria-busy="true">
          <p>Loading job tracker…</p>
        </div>
      }
    >
      <ContenidoTracker {...props} />
    </Suspense>
  );
}
