import { connection } from "next/server";
import { Suspense } from "react";

import type { PropsRanuraBilling } from "@/lib/ventana/ranuras";
import { datosDeBilling } from "@/lib/ventana/servidor";

import { VistaBillingPestana } from "./vista-billing";

/** Billing leído en el servidor, en su propio server component (spec OPR-32 §5.5). */
async function ContenidoBilling(props: PropsRanuraBilling) {
  await connection();
  const datos = await datosDeBilling(props.requestId);
  if (!datos) return null;
  return <VistaBillingPestana vista={datos.vista} requestId={props.requestId} version={datos.version} etapa={props.etapa} />;
}

/**
 * OPR-32: pestaña Billing, en Validation. Reemplaza el marcador de OPR-26 sin
 * cambiar el contrato (`PropsRanuraBilling = PropsRanuraBase`) y conserva su
 * `data-ranura="billing"`. Con su propio `Suspense`: no frena el encabezado.
 */
export function RanuraBilling(props: PropsRanuraBilling) {
  return (
    <Suspense
      fallback={
        <div className="ranura ranura-billing" data-ranura="billing" data-etapa={props.etapa} aria-busy="true">
          <p>Loading billing…</p>
        </div>
      }
    >
      <ContenidoBilling {...props} />
    </Suspense>
  );
}
