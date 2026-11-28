import type { VistaDeCampoIa } from "@/lib/analisis-ia/tipos";
import type { CampoDeIa } from "@/lib/bzzzbx/tipos-ia";
import type { CampoPropiedad, VentanaJob } from "@/lib/ventana/tipos";

import { AvisoVariosJobs } from "./aviso-varios-jobs";
import { CampoIa, type DecidirIa } from "./campo-ia";

/**
 * Los campos de IA (spec OPR-36 §10) de cada fila de la pestaña: la fila de "Space" también lleva
 * la unidad, la de fecha también la ventana, y "Who is it from?" va una sola vez, en el cliente.
 * Las camas no tienen fila propia hoy: se agregan abajo, solo con el análisis de IA.
 */
const CAMPOS_DE_IA_POR_FILA: Partial<Record<CampoPropiedad["clave"], CampoDeIa[]>> = {
  customer: ["sender"],
  property: ["property"],
  space: ["space", "unit"],
  service: ["service"],
  date: ["service_date", "time_window"],
  po: ["po_number"],
  access: ["access_notes"],
};

export const TEXTO_AI_PENDING = "AI pending";

/**
 * Pestaña de la propiedad (spec OPR-26 §4.3): cliente, contacto, propiedad y espacio, servicio,
 * fecha y ventana, cleaner, PO y notas de acceso, con `— —` en lo que falte. Lo que BzzzBX
 * respondió que no conoce lleva "Not found in BzzzBX" (§6.3). El enlace de la Fase A va arriba
 * (lo pone `VentanaDelJob`).
 *
 * Solo en Requests (OPR-36 §10): "AI pending" donde iría el valor de un campo vacío mientras el
 * análisis de IA no llega (no deshabilita nada), el aviso de varios jobs y, en cada campo con una
 * sugerencia abierta, el chip AI con Accept, Change y Reject. El `aria-live` del grupo anuncia
 * cuando "AI pending" se cambia por los valores. Fuera de Requests es de solo lectura, como siempre.
 */
export function PanelPropiedad({ ventana, decidir }: { ventana: VentanaJob; decidir?: DecidirIa }) {
  const ia = ventana.datos.ia ?? null;
  const delCampo = (campo: CampoDeIa): VistaDeCampoIa | null => ia?.campos[campo] ?? null;

  return (
    <>
      {ia?.variosJobs && decidir ? <AvisoVariosJobs aviso={ia.variosJobs} decidir={decidir} /> : null}
      <dl className="campos" data-testid="campos-propiedad" aria-live={ia ? "polite" : undefined}>
        {ventana.propiedad.campos.map((c) => {
          const delaFila = (CAMPOS_DE_IA_POR_FILA[c.clave] ?? []).map(delCampo).filter((v): v is VistaDeCampoIa => v !== null);
          // "AI pending" solo donde no hay nada que mostrar: todos los campos de IA de la fila están vacíos.
          const pendiente = Boolean(ia?.pendiente) && delaFila.length > 0 && delaFila.every((v) => v.vacio);
          return (
            <div key={c.clave} data-testid={`campo-${c.clave}`}>
              <dt>{c.etiqueta}</dt>
              <dd>
                {pendiente ? (
                  <span className="ia-pendiente" data-testid="ia-pendiente">
                    {TEXTO_AI_PENDING}
                  </span>
                ) : (
                  c.valor
                )}
                {c.noEncontrado ? (
                  <span className="no-encontrado" data-testid="no-encontrado">
                    {" "}
                    Not found in BzzzBX
                  </span>
                ) : null}
                {decidir ? delaFila.map((v) => <CampoIa key={v.campo} vista={v} decidir={decidir} />) : null}
              </dd>
            </div>
          );
        })}
        {ia ? (
          <div data-testid="campo-beds">
            <dt>Beds</dt>
            <dd>
              {ia.pendiente && ia.campos.beds.vacio ? (
                <span className="ia-pendiente" data-testid="ia-pendiente">
                  {TEXTO_AI_PENDING}
                </span>
              ) : (
                (ia.campos.beds.borrador as number | null) ?? "— —"
              )}
              {decidir ? <CampoIa vista={ia.campos.beds} decidir={decidir} /> : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </>
  );
}
