import { connection } from "next/server";
import { Suspense } from "react";

import { obtenerAudit } from "@/lib/audit/servidor";
import type { PropsRanuraAudit } from "@/lib/ventana/ranuras";

import { VistaAuditPestana } from "./vista-audit";

/** El Audit leído en el servidor, en su propio server component (spec OPR-35 §8). */
async function ContenidoAudit(props: PropsRanuraAudit) {
  await connection();
  const vista = await obtenerAudit({
    requestId: props.requestId,
    zona: props.zona,
    bzzzbxDisponible: props.bzzzbx.disponible,
  });
  return <VistaAuditPestana vista={vista} etapa={props.etapa} />;
}

/**
 * OPR-35: pestaña Audit, desde Scheduled. Reemplaza el marcador de OPR-26 sin
 * cambiar el contrato (`PropsRanuraAudit = PropsRanuraBase`) y conserva su
 * `data-ranura="audit"`. Con su propio `Suspense`: no frena el encabezado.
 *
 * No hay sondeo propio: el cursor de `/api/tablero/cambios` incluye el último
 * `audit_event.id`, así que un evento nuevo dispara el `router.refresh()` de la
 * ventana y esta ranura se vuelve a pintar (§7.3).
 */
export function RanuraAudit(props: PropsRanuraAudit) {
  return (
    <Suspense
      fallback={
        <div className="ranura ranura-audit" data-ranura="audit" data-etapa={props.etapa} aria-busy="true">
          <p className="audit-vacio">Loading audit…</p>
        </div>
      }
    >
      <ContenidoAudit {...props} />
    </Suspense>
  );
}
