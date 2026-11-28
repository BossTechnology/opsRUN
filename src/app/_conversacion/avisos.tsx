"use client";

/**
 * El panel Notices (spec OPR-18 §7.2): la vista previa de los avisos al requester y de las cancelaciones, de solo
 * lectura. "Not sent · Available when actions are switched on": en la Fase A el aviso lo manda el operador a mano
 * desde las herramientas de PINCH, y Copy le deja el texto en el portapapeles. No hay Send aquí ni nada que llame a
 * una acción: este archivo no importa `ejecutarAccion` ni los ejecutores (un guard del disco lo vigila).
 */
import type { AvisoDelJob } from "@/lib/plantillas/disponibles";
import { hora } from "@/lib/tablero/formato";

import { BotonCopiar } from "./plantillas";

/** El estado de un aviso en la Fase A: el mismo texto de OPR-42 que llevan Reschedule y Cancel job. */
export const TEXTO_AVISO_NO_ENVIADO = "Not sent · Available when actions are switched on";

const CANAL = { email: "Email", text: "Text" } as const;

export function Avisos({
  avisos,
  bzzzbx,
  zona,
}: {
  avisos: AvisoDelJob[];
  bzzzbx: { disponible: boolean; actualizadoEn: string | null };
  zona: string;
}) {
  if (avisos.length === 0) return null;
  return (
    <details className="avisos" data-testid="avisos" open>
      <summary>Notices ({avisos.length})</summary>
      {bzzzbx.disponible || !bzzzbx.actualizadoEn ? null : (
        <p className="hilo-aviso" data-testid="avisos-caida" role="status">
          {`BzzzBX unavailable · last update ${hora(bzzzbx.actualizadoEn, zona)}`}
        </p>
      )}
      <ul className="avisos-lista">
        {avisos.map((a) => (
          <li key={a.clave} className="aviso" data-testid="aviso" data-aviso={a.clave}>
            <p className="aviso-titulo">
              <strong>{a.nombre}</strong> <span className="aviso-canal">{CANAL[a.canal]}</span>
            </p>
            {a.texto !== null ? (
              <p className="aviso-texto" data-testid="aviso-texto">
                {a.texto}
              </p>
            ) : (
              <p className="aviso-texto aviso-sin-texto" data-testid="aviso-sin-texto">
                {a.sinTexto === "propiedad" ? "Check the property" : "Preview unavailable · BzzzBX unavailable"}
              </p>
            )}
            <p className="aviso-estado" data-estado="no-enviado">
              {TEXTO_AVISO_NO_ENVIADO}
            </p>
            {a.texto !== null ? <BotonCopiar texto={a.texto} testid="copiar-aviso" /> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
