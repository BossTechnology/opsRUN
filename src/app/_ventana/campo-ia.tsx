"use client";

import { useId, useState, useTransition } from "react";

import type { ResultadoAccion } from "@/lib/acciones/tipos";
import type { VistaDeCampoIa } from "@/lib/analisis-ia/tipos";
import { valorDeEntrada } from "@/lib/analisis-ia/forma";
import type { CampoDeIa } from "@/lib/bzzzbx/tipos-ia";

/** Lo que hace Accept, Change y Reject: una decisión sobre la sugerencia, con el valor final si se corrige. */
export type DecidirIa = (entrada: { suggestionId: string; decision: "accepted" | "corrected" | "rejected"; finalValue?: unknown }) => Promise<ResultadoAccion>;

const TEXTOS_LARGOS: CampoDeIa[] = ["access_notes"];
const POR_CROSSWALK: CampoDeIa[] = ["property", "space", "service", "sender"];

/** Lo que el operador leyó cuando la decisión no se pudo guardar. */
const textoDelResultado = (r: ResultadoAccion): string | null => (r.tipo === "rechazada" ? r.mensaje : null);

function inicialDeTexto(campo: CampoDeIa, borrador: unknown): string {
  if (borrador === null || borrador === undefined) return "";
  if (campo === "beds") return String(borrador);
  return typeof borrador === "string" ? borrador : "";
}

/**
 * Un campo del borrador con una sugerencia de IA abierta (spec OPR-36 §10.2): el chip AI, el
 * motivo de la IA ("Why?") y los tres controles. Accept cierra la sugerencia sin cambiar el
 * valor; Change abre la edición en el lugar (texto, fecha, ventana y camas con un campo de la forma de
 * `forma.ts`; un crosswalk ID, solo las alternativas de la IA y los espacios de la propiedad: la
 * búsqueda libre es de `update_request_detail`); Reject vacía el borrador si todavía tiene el valor
 * de la IA. Los tres pasan por `ejecutarAccion`, que vuelve a comprobar todo en el servidor.
 */
export function CampoIa({ vista, decidir }: { vista: VistaDeCampoIa; decidir: DecidirIa }) {
  const id = useId();
  const abierta = vista.abierta;
  const [razonVisible, setRazonVisible] = useState(false);
  const [editando, setEditando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  const [texto, setTexto] = useState(() => inicialDeTexto(vista.campo, vista.borrador));
  const [inicio, setInicio] = useState(() => (vista.borrador as { start?: string } | null)?.start ?? "");
  const [fin, setFin] = useState(() => (vista.borrador as { end?: string } | null)?.end ?? "");
  const [eleccion, setEleccion] = useState(0);

  if (!abierta) return null;

  const crosswalk = POR_CROSSWALK.includes(vista.campo);
  const opciones = abierta.opciones;
  const valorEditado: unknown | null = crosswalk
    ? (opciones[eleccion]?.valor ?? null)
    : vista.campo === "time_window"
      ? valorDeEntrada("time_window", { start: inicio, end: fin })
      : valorDeEntrada(vista.campo, texto);

  const enviar = (decision: "accepted" | "corrected" | "rejected", finalValue?: unknown) => {
    setMensaje(null);
    empezar(async () => {
      const r = await decidir({ suggestionId: abierta.id, decision, ...(finalValue === undefined ? {} : { finalValue }) });
      const error = textoDelResultado(r);
      if (error) setMensaje(error);
      else setEditando(false);
    });
  };

  return (
    <span className="ia-campo" data-testid={`ia-${vista.campo}`} data-sugerencia={abierta.id}>
      <span className="marca-ai" data-testid="ia-marca" title="Suggested by the AI. Confirm it or change it.">
        AI
      </span>
      {abierta.igualAlBorrador ? null : (
        <span className="ia-propuesta" data-testid="ia-propuesta">
          {" "}
          AI suggested {abierta.texto}
          {abierta.secundario ? <span className="ia-secundario"> {abierta.secundario}</span> : null}
        </span>
      )}
      {abierta.razon ? (
        <>
          <button
            type="button"
            className="ia-enlace"
            aria-expanded={razonVisible}
            aria-controls={`${id}-razon`}
            onClick={() => setRazonVisible((v) => !v)}
          >
            Why?
          </button>
          {razonVisible ? (
            <span className="razon-ai" id={`${id}-razon`} data-testid="ia-razon">
              {" "}
              {abierta.razon}
            </span>
          ) : null}
        </>
      ) : null}
      <span className="ia-controles" role="group" aria-label={`AI ${vista.nombreCorto}`}>
        <button
          type="button"
          className="ia-boton"
          aria-label={`Accept AI ${vista.nombreCorto}`}
          disabled={pendiente || !abierta.igualAlBorrador}
          title={abierta.igualAlBorrador ? "Accept" : "The value changed; change it or reject it"}
          onClick={() => enviar("accepted")}
        >
          ✓
        </button>
        <button
          type="button"
          className="ia-boton"
          aria-label={`Change AI ${vista.nombreCorto}`}
          aria-expanded={editando}
          disabled={pendiente}
          onClick={() => setEditando((e) => !e)}
        >
          Change
        </button>
        <button type="button" className="ia-boton" aria-label={`Reject AI ${vista.nombreCorto}`} disabled={pendiente} onClick={() => enviar("rejected")}>
          ✕
        </button>
      </span>

      {editando ? (
        <span className="ia-edicion" data-testid="ia-edicion">
          {crosswalk ? (
            opciones.length > 0 ? (
              <span role="radiogroup" aria-label={`Choose another ${vista.nombreCorto}`}>
                {opciones.map((o, i) => (
                  <label key={`${i}-${String(o.valor)}`} className="ia-opcion">
                    <input type="radio" name={`${id}-opcion`} checked={eleccion === i} onChange={() => setEleccion(i)} /> {o.texto}
                    {o.secundario ? <span className="ia-secundario"> {o.secundario}</span> : null}
                  </label>
                ))}
              </span>
            ) : (
              <span className="ia-secundario">The AI has no other option. Search it in PINCH tools.</span>
            )
          ) : vista.campo === "time_window" ? (
            <span>
              <input type="time" aria-label="Window start" value={inicio} onChange={(e) => setInicio(e.target.value)} />
              {" – "}
              <input type="time" aria-label="Window end" value={fin} onChange={(e) => setFin(e.target.value)} />
            </span>
          ) : vista.campo === "service_date" ? (
            <input type="date" aria-label="Date" value={texto} onChange={(e) => setTexto(e.target.value)} />
          ) : vista.campo === "beds" ? (
            <input type="number" min={0} max={50} step={1} inputMode="numeric" aria-label="Beds" value={texto} onChange={(e) => setTexto(e.target.value)} />
          ) : TEXTOS_LARGOS.includes(vista.campo) ? (
            <textarea aria-label={vista.etiqueta} rows={2} maxLength={500} value={texto} onChange={(e) => setTexto(e.target.value)} />
          ) : (
            <input type="text" aria-label={vista.etiqueta} maxLength={vista.campo === "unit" ? 32 : 64} value={texto} onChange={(e) => setTexto(e.target.value)} />
          )}
          <button type="button" className="ia-boton" disabled={pendiente || valorEditado === null} onClick={() => enviar("corrected", valorEditado)}>
            Save
          </button>
          <button type="button" className="ia-boton" disabled={pendiente} onClick={() => setEditando(false)}>
            Cancel
          </button>
        </span>
      ) : null}
      {mensaje ? (
        <span className="ia-error" role="alert" data-testid="ia-error">
          {" "}
          {mensaje}
        </span>
      ) : null}
    </span>
  );
}
