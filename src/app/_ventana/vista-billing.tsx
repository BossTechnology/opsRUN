import type { VistaBilling } from "@/lib/billing/armar";

import { FormularioPo } from "./formulario-po";

import "./etapas.css";

/**
 * La pestaña Billing (spec OPR-32 §5.5): PO # (editable hasta Validate), OSS
 * status, Approved, Validated y Paid. Paid se lee de QuickBooks por BzzzBX y no
 * tiene ningún control; el PO de PINCH se muestra como "In PINCH: …" y nunca se
 * guarda.
 */
export function VistaBillingPestana({
  vista,
  requestId,
  version,
  etapa,
}: {
  vista: VistaBilling;
  requestId: string;
  version: string;
  etapa: string;
}) {
  const { po } = vista;
  const valorDeSoloLectura = po.vigente?.valor ?? "— —";
  // En solo lectura el PO vigente ya es el de PINCH si no hay otro: no se repite.
  const enPinch = po.enPinch !== null && (po.editable || po.enPinch !== valorDeSoloLectura) ? po.enPinch : null;
  return (
    <section className="ranura ranura-billing" data-ranura="billing" data-etapa={etapa} aria-label="Billing">
      <dl className="billing-filas" data-testid="billing">
        <div className="billing-fila" data-testid="billing-po">
          <dt>PO #</dt>
          <dd>
            {po.editable ? (
              <FormularioPo requestId={requestId} version={version} capturado={po.capturado} />
            ) : (
              <span data-testid="po-valor">{valorDeSoloLectura}</span>
            )}
            {po.requerido ? (
              <span className="po-requerido" data-testid="po-requerido">
                PO required
              </span>
            ) : null}
            {enPinch ? (
              <span className="po-en-pinch" data-testid="po-en-pinch">
                In PINCH: {enPinch}
              </span>
            ) : null}
          </dd>
        </div>
        <div className="billing-fila" data-testid="billing-oss">
          <dt>OSS status</dt>
          <dd>
            {vista.oss.texto}
            {vista.oss.auto ? (
              <span className="oss-auto" data-testid="oss-auto">
                {" "}
                auto
              </span>
            ) : null}
          </dd>
        </div>
        <div className="billing-fila" data-testid="billing-aprobada">
          <dt>Approved</dt>
          <dd>{vista.aprobada}</dd>
        </div>
        <div className="billing-fila" data-testid="billing-validada">
          <dt>Validated</dt>
          <dd>{vista.validada}</dd>
        </div>
        <div className="billing-fila" data-testid="billing-paid" data-pagada={vista.pagada.pagada}>
          <dt>Paid</dt>
          <dd>{vista.pagada.texto}</dd>
        </div>
      </dl>
    </section>
  );
}
