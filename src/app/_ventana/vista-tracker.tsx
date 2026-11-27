import type { VistaTracker } from "@/lib/tracker/armar";

import { GaleriaDeFotos } from "./galeria-fotos";

import "./etapas.css";

/**
 * La pestaña Job tracker (spec OPR-30 §4.1): una fila de estado y ventana, y
 * Arrival, Start, End y Duration. Todo se lee de BzzzBX al pintar; nada se
 * guarda. Debajo, la galería de fotos.
 */
export function VistaTrackerPestana({ vista, etapa }: { vista: VistaTracker; etapa: string }) {
  const { duracion } = vista;
  return (
    <section className="ranura ranura-tracker" data-ranura="tracker" data-etapa={etapa} aria-label="Job tracker">
      <dl className="tracker-filas" data-testid="tracker">
        <div className="tracker-fila" data-testid="tracker-estado">
          <dt>Status</dt>
          <dd>
            <span data-testid="tracker-etapa">{vista.etapa}</span>
            {vista.runningLong ? (
              <span className="chip-running" data-testid="chip-running-long">
                Running long
              </span>
            ) : null}
            <span className="tracker-ventana" data-testid="tracker-ventana">
              {vista.ventana}
            </span>
          </dd>
        </div>
        <div className="tracker-fila" data-testid="tracker-llegada">
          <dt>Arrival</dt>
          <dd>{vista.llegada}</dd>
        </div>
        <div className="tracker-fila" data-testid="tracker-inicio">
          <dt>Start</dt>
          <dd>{vista.inicio}</dd>
        </div>
        <div className="tracker-fila" data-testid="tracker-fin">
          <dt>End</dt>
          <dd>{vista.fin}</dd>
        </div>
        <div className="tracker-fila" data-testid="tracker-duracion" data-corriendo={duracion.corriendo}>
          <dt>Duration</dt>
          <dd>
            {duracion.valor}
            {duracion.corriendo ? <span className="tracker-running"> · running</span> : null}
            <span className="tracker-esperada"> · expected {duracion.esperada}</span>
          </dd>
        </div>
      </dl>
      <GaleriaDeFotos before={vista.fotos.before} after={vista.fotos.after} disponible={vista.fotosDisponibles} />
    </section>
  );
}
