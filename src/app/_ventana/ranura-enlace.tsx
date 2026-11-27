"use client";

import { useState, useTransition } from "react";

import type { Candidato, Coincidencia, MotivoVacio } from "@/lib/fase-a/enlace";
import { BUSCAR_JOBS_MAX } from "@/lib/bzzzbx/tipos";
import type { ResultadoAccion } from "@/lib/acciones/tipos";
import { fechaYVentana } from "@/lib/tablero/formato";
import type { PropsRanuraEnlace } from "@/lib/ventana/ranuras";

/** Largo máximo del motivo; `ejecutarAccion` lo vuelve a comprobar (`MOTIVO_MAX`). */
const MOTIVO_MAX = 500;

export const TEXTO_TRUNCADO = `Showing the first ${BUSCAR_JOBS_MAX} jobs. There may be more: narrow the property or the date.`;
export const TEXTO_BZZZBX_CAIDO = "BzzzBX unavailable";

/** Lo que dice la ranura cuando no hay candidatos (spec Fase A §4 y OPR-26 §7.2). `request_no_abierta` no se muestra. */
export const TEXTO_VACIO: Record<Exclude<MotivoVacio, "request_no_abierta">, string> = {
  sin_cliente_ni_propiedad: "Confirm who it is from first",
  sin_candidatos: "No matching job found in PINCH tools yet",
};

const ETIQUETA_COINCIDENCIA: Record<Coincidencia, string> = {
  misma_propiedad: "Same property",
  mismo_cliente: "Same customer",
  misma_fecha: "Same date",
  misma_ventana: "Same window",
  mismo_equipo: "Same cleaner",
};

/** Lo que falta del gate de Schedule, en el orden del spec (§7.2). */
export function faltantesDelGate(gate: PropsRanuraEnlace["gate"]): string[] {
  const falta: string[] = [];
  if (!gate.dueno) falta.push("Owner");
  if (!gate.details) falta.push("Details");
  if (!gate.sender) falta.push("Sender");
  if (!gate.cleaner) falta.push("Cleaner");
  return falta;
}

const textoDelResultado = (r: ResultadoAccion): string =>
  r.tipo === "rechazada" ? r.mensaje : r.tipo === "guardada" ? "Saved" : "Sending…";

function FilaCandidato({
  candidato,
  cleaner,
  puedeConfirmar,
  ocupado,
  rechazando,
  motivo,
  onConfirmar,
  onAbrirRechazo,
  onCerrarRechazo,
  onMotivo,
  onRechazar,
}: {
  candidato: Candidato;
  cleaner: string;
  puedeConfirmar: boolean;
  ocupado: boolean;
  rechazando: boolean;
  motivo: string;
  onConfirmar: () => void;
  onAbrirRechazo: () => void;
  onCerrarRechazo: () => void;
  onMotivo: (texto: string) => void;
  onRechazar: () => void;
}) {
  const { job } = candidato;
  return (
    <li
      className="candidato"
      data-testid="candidato-enlace"
      data-job={job.bzzzbx_job_id}
      data-sugerido={candidato.sugerido}
    >
      <div className="candidato-datos">
        <strong>{job.job_number}</strong>
        {candidato.sugerido ? (
          <span className="etiqueta-sugerido" data-testid="sugerido">
            Suggested
          </span>
        ) : null}
        <span>{fechaYVentana(job.service_date, job.window_start, job.window_end)}</span>
        <span>{cleaner}</span>
      </div>
      <ul className="candidato-coincidencias" aria-label="Why it matches">
        {candidato.coincide.map((c) => (
          <li key={c}>{ETIQUETA_COINCIDENCIA[c]}</li>
        ))}
      </ul>
      <div className="panel-acciones-botones">
        <button
          type="button"
          data-testid="confirmar-enlace"
          aria-label={`Confirm ${job.job_number}`}
          disabled={!puedeConfirmar || ocupado}
          onClick={onConfirmar}
        >
          Confirm
        </button>
        <button
          type="button"
          data-testid="rechazar-enlace"
          aria-label={`Reject ${job.job_number}`}
          disabled={ocupado}
          aria-expanded={rechazando}
          onClick={rechazando ? onCerrarRechazo : onAbrirRechazo}
        >
          Not this one
        </button>
      </div>
      {rechazando ? (
        <div className="candidato-rechazo" data-testid="rechazo-enlace">
          <label>
            <span className="etiqueta-campo">Reason (optional)</span>
            <textarea
              data-testid="motivo-rechazo"
              value={motivo}
              maxLength={MOTIVO_MAX}
              rows={2}
              onChange={(e) => onMotivo(e.target.value)}
            />
          </label>
          <div className="panel-acciones-botones">
            <button type="button" data-testid="cancelar-rechazo" onClick={onCerrarRechazo}>
              Cancel
            </button>
            <button type="button" data-testid="enviar-rechazo" disabled={ocupado} onClick={onRechazar}>
              Reject job
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Enlace de la Fase A (spec OPR-26 §7.2, spec Fase A §4 a §6): los jobs que
 * pueden ser el de la request, con Suggested, el aviso de `truncado`, el motivo
 * de lista vacía y el gate de Schedule. Confirmar y rechazar son Server Actions
 * que pasan por `ejecutarAccion`: la disponibilidad, el actor y el refresco son
 * del servidor. Ninguna lectura de BzzzBX sale del navegador.
 */
export function RanuraEnlace({ propuesta, gate, confirmar, rechazar, equipos = {}, ...base }: PropsRanuraEnlace) {
  const [enCurso, iniciar] = useTransition();
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const [rechazando, setRechazando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const faltan = faltantesDelGate(gate);
  const puedeConfirmar = faltan.length === 0;

  // Una Server Action que falla de forma inesperada se dice igual que una rechazada.
  function correr(accion: () => Promise<ResultadoAccion>, alTerminar?: () => void) {
    iniciar(async () => {
      try {
        const r = await accion();
        setResultado(r);
        if (r.tipo !== "rechazada") alTerminar?.();
      } catch {
        setResultado({ tipo: "rechazada", codigo: "error", mensaje: "Something went wrong. Try again." });
      }
    });
  }

  const cuerpo = (() => {
    if ("error" in propuesta) {
      return (
        <p className="nota-gris" role="status" data-testid="enlace-caido">
          {TEXTO_BZZZBX_CAIDO}
        </p>
      );
    }
    const { candidatos, truncado, motivo_vacio } = propuesta;
    return (
      <>
        {truncado ? (
          <p className="aviso-truncado" role="status" data-testid="aviso-truncado">
            {TEXTO_TRUNCADO}
          </p>
        ) : null}
        {candidatos.length === 0 && motivo_vacio && motivo_vacio !== "request_no_abierta" ? (
          <p className="nota-gris" data-testid="enlace-vacio" data-motivo={motivo_vacio}>
            {TEXTO_VACIO[motivo_vacio]}
          </p>
        ) : null}
        {candidatos.length > 0 ? (
          <ul className="lista-candidatos" data-testid="lista-candidatos">
            {candidatos.map((c) => (
              <FilaCandidato
                key={c.job.bzzzbx_job_id}
                candidato={c}
                cleaner={(c.job.bzzzbx_team_id && equipos[c.job.bzzzbx_team_id]) || "— —"}
                puedeConfirmar={puedeConfirmar}
                ocupado={enCurso}
                rechazando={rechazando === c.job.bzzzbx_job_id}
                motivo={motivo}
                onConfirmar={() => correr(() => confirmar(c.job.bzzzbx_job_id))}
                onAbrirRechazo={() => {
                  setRechazando(c.job.bzzzbx_job_id);
                  setMotivo("");
                  setResultado(null);
                }}
                onCerrarRechazo={() => setRechazando(null)}
                onMotivo={setMotivo}
                onRechazar={() =>
                  correr(
                    () => rechazar(c.job.bzzzbx_job_id, motivo.trim() || null),
                    () => setRechazando(null),
                  )
                }
              />
            ))}
          </ul>
        ) : null}
      </>
    );
  })();

  return (
    <section
      className="ranura ranura-enlace"
      data-ranura="enlace"
      data-etapa={base.etapa}
      data-gate={`${gate.dueno ? "O" : "-"}${gate.details ? "D" : "-"}${gate.sender ? "S" : "-"}${gate.cleaner ? "C" : "-"}`}
      aria-label="Link to the job in PINCH tools"
    >
      <h2>Job in PINCH tools</h2>
      {faltan.length > 0 ? (
        <p className="nota-gris" data-testid="gate-enlace">
          Before linking, confirm: {faltan.join(", ")}
        </p>
      ) : null}
      {cuerpo}
      <p
        className="resultado"
        role="status"
        data-testid="resultado-enlace"
        data-tipo={resultado?.tipo ?? "ninguno"}
        hidden={!enCurso && !resultado}
      >
        {enCurso ? "Working…" : resultado ? textoDelResultado(resultado) : ""}
      </p>
    </section>
  );
}
