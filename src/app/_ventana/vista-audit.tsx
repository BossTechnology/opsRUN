import type { VistaAudit } from "@/lib/audit/tipos";

import "./audit.css";

/**
 * La pestaña Audit (spec OPR-35 §2 y §8): arriba los identificadores y debajo,
 * una fila por evento, del más viejo al más nuevo. Solo presenta: no lee nada
 * ni tiene datos propios. La raíz conserva `data-ranura="audit"` (OPR-26 A14).
 *
 * La lista es un `<ol>` (el orden tiene significado) y cada hora va en un
 * `<time datetime>` en ISO UTC.
 */
export function VistaAuditPestana({ vista, etapa }: { vista: VistaAudit | null; etapa: string }) {
  return (
    <div className="ranura ranura-audit" data-ranura="audit" data-etapa={etapa} data-testid="audit">
      {vista ? (
        <>
          <dl className="audit-ids" data-testid="audit-ids">
            <div>
              <dt>Request</dt>
              <dd data-testid="audit-request">{vista.request}</dd>
            </div>
            <div>
              <dt>Job number</dt>
              <dd data-testid="audit-job-number">{vista.jobNumber}</dd>
            </div>
            <div>
              <dt>Work App number</dt>
              <dd data-testid="audit-work-app-number">{vista.workAppNumber}</dd>
            </div>
          </dl>
          <p className="audit-zona" data-testid="audit-zona">
            {vista.zona}
          </p>
          {vista.filas.length === 0 ? (
            <p className="audit-vacio">No events yet.</p>
          ) : (
            <ol className="audit-lista" aria-label="Audit">
              {vista.filas.map((f) => (
                <li key={f.id} className="audit-fila" data-testid="audit-fila" data-tipo={f.tipo}>
                  <time className="audit-hora" dateTime={f.instante}>
                    {f.hora}
                  </time>
                  <div className="audit-cuerpo">
                    <p className="audit-linea">
                      <span className="audit-evento" data-testid="audit-evento">
                        {f.evento}
                      </span>
                      {f.complemento ? <span className="audit-complemento"> {f.complemento}</span> : null}
                      {f.original ? <span className="audit-marca"> Original</span> : null}
                      {f.observado ? <span className="audit-marca audit-observado"> Observed</span> : null}
                    </p>
                    <p className="audit-persona" data-testid="audit-persona">
                      {f.persona}
                    </p>
                    {f.motivo ? (
                      <p className="audit-motivo" data-testid="audit-motivo">
                        <span className="audit-motivo-etiqueta">Reason:</span> {f.motivo}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : (
        <p className="audit-vacio">No audit history for this job.</p>
      )}
    </div>
  );
}
