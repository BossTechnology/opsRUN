"use client";

import { useCallback, useState, useTransition } from "react";

import type { AccionVista, ResultadoAccion } from "@/lib/acciones/tipos";
import type { VentanaJob } from "@/lib/ventana/tipos";

import { useAccionDeLaVentana } from "./accion-de-la-ventana";
import { ejecutarAccion } from "./acciones";
import { PANELES_DE_ACCION } from "./paneles-accion";

/** Largo máximo del motivo; el servidor lo vuelve a comprobar (`MOTIVO_MAX`). */
const MOTIVO_MAX = 500;

type Props = {
  requestId: string;
  /** `change_seq` de la request que ve el operador. */
  version: string;
  acciones: AccionVista[];
  /** La ventana de este momento: los paneles de Assign y Confirm (OPR-28) leen de ella. Sin ella no hay paneles propios. */
  ventana?: VentanaJob;
  /** El operador que actúa ("Assign to me"); null si no hay. */
  actorId?: string | null;
  /** Para pruebas de componente: reemplaza a la Server Action. */
  ejecutar?: (entrada: Parameters<typeof ejecutarAccion>[0]) => Promise<ResultadoAccion>;
};

/** Lo que el panel dice del resultado (spec OPR-26 §5.1). */
export function textoDelResultado(r: ResultadoAccion): string {
  switch (r.tipo) {
    case "guardada":
      return "Saved";
    case "instruccion":
      return "Sending…";
    case "rechazada":
      return r.mensaje;
  }
}

/**
 * Action bar (spec OPR-26 §5): `Action ▾` + `Go`. Elegir una acción abre un
 * panel con su nombre, lo que hace, el motivo y `Cancel`/`Go`. Lo que no corre
 * se ve en gris con su razón y no se puede elegir, pero esto no es la defensa:
 * el servidor vuelve a calcular la disponibilidad en `ejecutarAccion`.
 */
export function BarraAcciones({ requestId, version, acciones, ventana, actorId = null, ejecutar = ejecutarAccion }: Props) {
  const [codigo, setCodigo] = useState("");
  const [motivo, setMotivo] = useState("");
  // Lo que eligió el operador en el panel propio de la acción, y si ya está completo.
  const [datos, setDatos] = useState<{ valores: Record<string, unknown>; completo: boolean }>({ valores: {}, completo: false });
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const [enCurso, iniciar] = useTransition();
  // Lo que pidió un botón de la pestaña Alerts (OPR-34 §5.3): la acción elegida y lo que se le prellena.
  const { pedida } = useAccionDeLaVentana();
  const [pedidaVista, setPedidaVista] = useState(pedida?.n ?? 0);
  const [inicial, setInicial] = useState<Record<string, unknown> | null>(null);

  const accion = acciones.find((a) => a.codigo === codigo);
  const corre = accion?.disponibilidad.tipo === "disponible";
  const Panel = ventana && accion && corre ? PANELES_DE_ACCION[accion.codigo] : undefined;
  const motivoCompleto = !accion || accion.motivo !== "obligatorio" || motivo.trim() !== "";
  // Con una instrucción en camino no se vuelve a lanzar hasta que cierre.
  const enCamino = resultado?.tipo === "instruccion";
  const panelCompleto = !Panel || datos.completo;
  const puedeIr = Boolean(accion) && corre && motivoCompleto && panelCompleto && !enCurso && !enCamino;

  function elegir(nuevo: string, prellenado: Record<string, unknown> | null = null) {
    setCodigo(nuevo);
    setMotivo("");
    setResultado(null);
    setDatos({ valores: {}, completo: false });
    setInicial(prellenado);
  }

  // Un botón de una alerta pidió una acción: se abre elegida, con su panel prellenado. Se ajusta durante el render
  // (el patrón de React para estado derivado), sin efectos. No ejecuta nada: corre solo con Go.
  if (pedida && pedida.n !== pedidaVista) {
    setPedidaVista(pedida.n);
    elegir(pedida.codigo, pedida.datos);
  }

  // El panel avisa cada vez que cambia lo que eligió el operador.
  const alCambiar = useCallback((valores: Record<string, unknown>, completo: boolean) => {
    setDatos((previo) =>
      previo.completo === completo && JSON.stringify(previo.valores) === JSON.stringify(valores) ? previo : { valores, completo },
    );
  }, []);

  function ir() {
    // No se frena aquí por la disponibilidad: el servidor decide y dice por qué.
    if (!accion || enCurso) return;
    iniciar(async () => {
      try {
        setResultado(
          await ejecutar({
            requestId,
            codigo: accion.codigo,
            motivo: motivo.trim() || null,
            datos: Panel ? datos.valores : {},
            version,
          }),
        );
      } catch {
        setResultado({ tipo: "rechazada", codigo: "error", mensaje: "Something went wrong. Try again." });
      }
    });
  }

  // Un solo Go: en la barra mientras no hay acción elegida, y en el panel cuando se abre.
  const botonGo = (
    <button type="button" data-testid="go" disabled={!puedeIr} onClick={ir}>
      Go
    </button>
  );

  return (
    <section className="barra-acciones" data-testid="barra-acciones" aria-label="Actions">
      <div className="barra-acciones-fila">
        <label>
          <span className="etiqueta-campo">Action</span>
          <select
            aria-label="Action"
            data-testid="accion"
            value={codigo}
            onChange={(e) => elegir(e.target.value)}
            disabled={acciones.length === 0}
          >
            <option value="">{acciones.length === 0 ? "No actions for this job" : "Choose an action"}</option>
            {acciones.map((a) => (
              <option
                key={a.codigo}
                value={a.codigo}
                disabled={a.disponibilidad.tipo !== "disponible"}
                data-disponibilidad={a.disponibilidad.tipo}
              >
                {a.nota ? `${a.etiqueta} — ${a.nota}` : a.etiqueta}
              </option>
            ))}
          </select>
        </label>
        {accion ? null : botonGo}
      </div>

      {accion ? (
        <div className="panel-accion" data-testid="panel-accion" data-accion={accion.codigo}>
          <h3>{accion.etiqueta}</h3>
          <p>{accion.descripcion}</p>
          {accion.nota ? (
            <p className="nota-gris" data-testid="nota-accion">
              {accion.nota}
            </p>
          ) : null}
          {Panel && ventana ? (
            <Panel
              key={pedidaVista}
              requestId={requestId}
              etapa={ventana.etapa}
              bzzzbx={ventana.bzzzbx}
              zona={ventana.zona}
              ventana={ventana}
              actorId={actorId}
              inicial={inicial}
              onCambio={alCambiar}
            />
          ) : null}
          {accion.motivo !== "no" ? (
            <label>
              <span className="etiqueta-campo">
                Reason{accion.motivo === "obligatorio" ? " (required)" : " (optional)"}
              </span>
              <textarea
                data-testid="motivo"
                value={motivo}
                maxLength={MOTIVO_MAX}
                rows={3}
                aria-required={accion.motivo === "obligatorio"}
                onChange={(e) => setMotivo(e.target.value)}
              />
              <span className="contador" data-testid="contador-motivo">
                {motivo.length}/{MOTIVO_MAX}
              </span>
            </label>
          ) : null}
          <div className="panel-acciones-botones">
            <button type="button" data-testid="cancelar-accion" onClick={() => elegir("")}>
              Cancel
            </button>
            {botonGo}
          </div>
          <p
            className="resultado"
            role="status"
            data-testid="resultado-accion"
            data-tipo={resultado?.tipo ?? "ninguno"}
          >
            {enCurso ? "Working…" : resultado ? textoDelResultado(resultado) : ""}
          </p>
        </div>
      ) : null}
    </section>
  );
}
