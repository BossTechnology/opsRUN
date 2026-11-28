import type { VistaAlertas } from "@/lib/alertas/tipos";
import { hora } from "@/lib/tablero/formato";

import { BotonDeAlerta } from "./boton-de-alerta";
import "./alertas.css";

type Props = {
  vista: VistaAlertas;
  etapa: string;
  /** El estado de BzzzBX al leer (§5.5): con BzzzBX caído, Needs action trae lo último leído y lo dice. */
  bzzzbx?: { disponible: boolean; actualizadoEn: string | null };
};

/**
 * La pestaña Alerts (spec OPR-34 §5): tres secciones, Needs action, Waiting y
 * Resolved, cada una con su `<section aria-labelledby>`, su `<ul>` y su
 * `data-testid`; cada fila lleva `data-testid="alerta"` con su regla, nivel y
 * sección. Solo presenta: no lee nada ni tiene datos propios. La raíz conserva
 * `data-ranura="alertas"` (OPR-26). Las horas ya vienen en la zona de la operación.
 *
 * Los botones de Needs action no ejecutan nada: abren la acción en la action bar
 * (`BotonDeAlerta`).
 */
export function VistaAlertasPestana({ vista, etapa, bzzzbx }: Props) {
  const { needsAction, waiting, resolved } = vista;
  return (
    <section className="ranura ranura-alertas" data-ranura="alertas" data-etapa={etapa} data-testid="alertas" aria-label="Alerts">
      <section aria-labelledby="alertas-needs-action-titulo" data-testid="alertas-needs-action" className="alertas-seccion">
        <h3 id="alertas-needs-action-titulo">
          Needs action <span className="conteo">({needsAction.length})</span>
        </h3>
        {bzzzbx && !bzzzbx.disponible ? (
          <p className="franja-caida" role="status" data-testid="alertas-franja">
            BzzzBX unavailable · {bzzzbx.actualizadoEn ? `last update ${hora(bzzzbx.actualizadoEn, vista.zona)}` : "no data yet"}
          </p>
        ) : null}
        {needsAction.length === 0 ? (
          <p data-testid="sin-alertas">No alerts need action</p>
        ) : (
          <ul className="lista-alertas">
            {needsAction.map((f) => (
              <li key={f.id} className="alerta-fila" data-testid="alerta" data-seccion="needs-action" data-regla={f.regla} data-nivel={f.nivel} data-alerta={f.id}>
                <div className="alerta-cabeza">
                  <span className="alerta-mini" data-nivel={f.nivel}>
                    {f.nivel === "red" ? "Red" : "Amber"}
                  </span>
                  <strong data-testid="alerta-regla">{f.nombreRegla}</strong>
                </div>
                <p className="alerta-motivo" data-testid="alerta-motivo">
                  {f.motivo}
                </p>
                <p className="alerta-tiempo">
                  <span data-testid="alerta-duracion">{f.duracion}</span> ·{" "}
                  <time dateTime={f.abiertaIso} data-testid="alerta-abierta">
                    {f.abiertaTexto}
                  </time>
                  {f.repeticiones ? (
                    <>
                      {" "}
                      · <span data-testid="alerta-repeticiones">Repeats on this job: {f.repeticiones}</span>
                    </>
                  ) : null}
                </p>
                <div className="alerta-boton-zona">
                  <BotonDeAlerta boton={f.boton} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="alertas-waiting-titulo" data-testid="alertas-waiting" className="alertas-seccion">
        <h3 id="alertas-waiting-titulo">
          Waiting <span className="conteo">({waiting.length})</span>
        </h3>
        {waiting.length === 0 ? (
          <p className="alertas-ninguna" data-testid="sin-espera">
            None
          </p>
        ) : (
          <ul className="lista-alertas">
            {waiting.map((f) => (
              <li key={f.id} className="alerta-fila" data-testid="alerta" data-seccion="waiting" data-espera={f.id}>
                <div className="alerta-cabeza">
                  <strong data-testid="espera-que">{f.que}</strong>
                  <span className="alerta-estado" data-testid="espera-estado">
                    {f.estado}
                  </span>
                </div>
                <p className="alerta-tiempo">
                  <span data-testid="espera-cleaner">{f.aQuien}</span> · <span data-testid="espera-desde">{f.desde}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="alertas-resolved-titulo" data-testid="alertas-resolved" className="alertas-seccion">
        <h3 id="alertas-resolved-titulo">
          Resolved <span className="conteo">({resolved.length})</span>
        </h3>
        {resolved.length === 0 ? (
          <p className="alertas-ninguna" data-testid="sin-resueltas">
            None
          </p>
        ) : (
          <ul className="lista-alertas">
            {resolved.map((f) => (
              <li key={f.id} className="alerta-fila" data-testid="alerta" data-seccion="resolved" data-regla={f.regla} data-nivel={f.nivel} data-alerta={f.id}>
                <div className="alerta-cabeza">
                  <span className="alerta-mini" data-nivel={f.nivel}>
                    {f.nivel === "red" ? "Red" : "Amber"}
                  </span>
                  <strong data-testid="alerta-regla">{f.nombreRegla}</strong>
                </div>
                <p className="alerta-motivo" data-testid="alerta-motivo">
                  {f.motivo}
                </p>
                <p className="alerta-tiempo">
                  <time dateTime={f.abiertaIso} data-testid="alerta-abierta-y-resuelta">
                    {f.abiertaYResuelta}
                  </time>{" "}
                  · <span data-testid="alerta-duracion">{f.duracion}</span>
                  {f.repeticiones ? (
                    <>
                      {" "}
                      · <span data-testid="alerta-repeticiones">Repeats on this job: {f.repeticiones}</span>
                    </>
                  ) : null}
                </p>
                <p className="alerta-quien" data-testid="alerta-quien">
                  {f.quien}
                </p>
                {f.razon ? (
                  <p className="alerta-razon" data-testid="alerta-razon">
                    {f.razon}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
