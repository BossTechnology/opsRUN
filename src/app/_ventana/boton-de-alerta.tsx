"use client";

import type { BotonDeAlerta as ModeloDeBoton } from "@/lib/alertas/tipos";

import { useAccionDeLaVentana } from "./accion-de-la-ventana";

/** Lo que dice el botón de una acción que no aplica en la etapa en que está la alerta. */
export const TEXTO_NO_APLICA = "Not available at this stage";

/**
 * El botón de una alerta de Needs action (spec OPR-34 §5.3). **No ejecuta nada**:
 * abre la acción en la action bar, elegida y prellenada; desde ahí corre por
 * `ejecutarAccion`, que recalcula la disponibilidad en el servidor. Si la acción
 * no está disponible, el botón se ve en gris con el mismo motivo que en la barra
 * ("Not built yet", "BzzzBX unavailable", "Add PO"…). La interfaz no es la
 * defensa: quitarle el `disabled` solo abre el panel, y Go lo rechaza el servidor.
 *
 * Message not delivered no es una acción de la barra: lleva el foco al mensaje en
 * la conversación, cuyo botón Edit and resend ya existe (OPR-27, S-6). Ese botón
 * nunca envía ni llama a `ejecutarAccion`: solo mueve el foco (OPR-19 §6.3), y
 * hereda la disponibilidad del Composer (`estado`).
 */
export function BotonDeAlerta({ boton }: { boton: ModeloDeBoton }) {
  const { acciones, elegir } = useAccionDeLaVentana();

  if (boton.tipo === "texto") {
    return boton.texto ? (
      <span className="alerta-sin-boton" data-testid="alerta-sin-boton">
        {boton.texto}
      </span>
    ) : null;
  }

  if (boton.tipo === "reenviar") {
    // Hereda la disponibilidad del modo del canal del Composer (OPR-19 §6.3): en gris con el mismo motivo.
    const razon = boton.estado.disponible ? null : boton.estado.razon;
    return (
      <span className="alerta-accion">
        <button
          type="button"
          className="alerta-boton"
          data-testid="alerta-boton"
          data-accion="edit_and_resend"
          disabled={razon !== null}
          aria-describedby={razon ? `nota-reenviar-${boton.mensajeId}` : undefined}
          onClick={() => enfocarElMensaje(boton.mensajeId)}
        >
          Edit and resend
        </button>
        {razon ? (
          <span className="nota-gris" id={`nota-reenviar-${boton.mensajeId}`} data-testid="alerta-boton-nota">
            {razon}
          </span>
        ) : null}
      </span>
    );
  }

  const accion = acciones.find((a) => a.codigo === boton.codigo);
  const disponible = accion?.disponibilidad.tipo === "disponible";
  const nota = disponible ? null : (accion?.nota ?? TEXTO_NO_APLICA);
  return (
    <span className="alerta-accion">
      <button
        type="button"
        className="alerta-boton"
        data-testid="alerta-boton"
        data-accion={boton.codigo}
        disabled={!disponible}
        aria-describedby={nota ? `nota-${boton.codigo}` : undefined}
        onClick={() => elegir(boton.codigo, boton.prellenado ?? undefined)}
      >
        {accion?.etiqueta ?? boton.codigo}
      </button>
      {nota ? (
        <span className="nota-gris" id={`nota-${boton.codigo}`} data-testid="alerta-boton-nota">
          {nota}
        </span>
      ) : null}
    </span>
  );
}

/** Lleva el foco al mensaje del hilo (su botón Edit and resend si lo tiene, si no, la entrada). */
function enfocarElMensaje(mensajeId: string | null) {
  if (!mensajeId) return;
  const entrada = [...document.querySelectorAll<HTMLElement>("[data-entrada]")].find((e) => e.dataset.entrada === `msg:${mensajeId}`);
  if (!entrada) return;
  const reenviar = entrada.querySelector<HTMLButtonElement>('[data-testid="reenviar"]');
  // Un botón en gris no recibe el foco: entonces, la entrada (el ancla).
  const destino = reenviar && !reenviar.disabled ? reenviar : entrada;
  destino.focus();
  destino.scrollIntoView?.({ block: "nearest" });
}
