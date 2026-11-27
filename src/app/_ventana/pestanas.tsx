"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { IdPestana, Pestana } from "@/lib/ventana/tipos";

type Props = {
  pestanas: Pestana[];
  /** La pestaña que abre la ventana (§4.2) y si la eligió la regla de Alerts. */
  inicial: { id: IdPestana; porRegla: boolean };
  /** Alertas que piden acción ahora, para la vuelta a la propiedad (§4.2). */
  pideAccion: number;
  /** El contenido de cada pestaña disponible, ya renderizado en el servidor. */
  paneles: Partial<Record<IdPestana, ReactNode>>;
};

/**
 * Pestañas de la Job window (spec OPR-26 §4). Cambiar de pestaña no pide nada
 * al servidor: todos los paneles llegan renderizados y aquí solo se muestra
 * uno. La pestaña activa va en la URL (`?tab=`) con `history.replaceState`,
 * que Next integra sin salir de la ruta interceptada.
 *
 * $ y People se ven pero no se seleccionan, ni con clic ni con teclado. Su nombre
 * accesible es "$" o "People" y la nota ("Not available in this release") es su
 * descripción, no su nombre.
 */
export function Pestanas({ pestanas, inicial, pideAccion, paneles }: Props) {
  const [elegida, setElegida] = useState<IdPestana>(inicial.id);
  // Alerts la abrió la regla (no el operador): si ya no hay alertas que pidan acción, vuelve a la propiedad [S-9].
  const [porRegla, setPorRegla] = useState(inicial.porRegla);
  const refs = useRef(new Map<IdPestana, HTMLButtonElement>());

  // Se ajusta durante el render (patrón de React para estado derivado de props), sin pasar por un efecto.
  if (porRegla && elegida === "alerts" && pideAccion === 0) {
    setElegida("property");
    setPorRegla(false);
  }

  // Si la pestaña elegida dejó de existir (la etapa cambió), cae a la inicial.
  const activa = pestanas.some((p) => p.id === elegida && !p.deshabilitada) ? elegida : inicial.id;

  function seleccionar(id: IdPestana) {
    setElegida(id);
    setPorRegla(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", id);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // Sin historial (pruebas, previsualizaciones): la pestaña igual cambia.
    }
  }

  function alTeclado(evento: KeyboardEvent, id: IdPestana) {
    const disponibles = pestanas.filter((p) => !p.deshabilitada);
    const i = disponibles.findIndex((p) => p.id === id);
    let destino: Pestana | undefined;
    if (evento.key === "ArrowRight") destino = disponibles[(i + 1) % disponibles.length];
    else if (evento.key === "ArrowLeft") destino = disponibles[(i - 1 + disponibles.length) % disponibles.length];
    else if (evento.key === "Home") destino = disponibles[0];
    else if (evento.key === "End") destino = disponibles.at(-1);
    else return;
    evento.preventDefault();
    if (!destino) return;
    seleccionar(destino.id);
    refs.current.get(destino.id)?.focus();
  }

  return (
    <div className="pestanas">
      <div role="tablist" aria-label="Job sections" className="pestanas-lista">
        {pestanas.map((p) => (
          <button
            key={p.id}
            ref={(el) => {
              if (el) refs.current.set(p.id, el);
              else refs.current.delete(p.id);
            }}
            type="button"
            role="tab"
            id={`pestana-${p.id}`}
            data-testid="pestana"
            data-pestana={p.id}
            aria-selected={!p.deshabilitada && p.id === activa}
            aria-controls={p.deshabilitada ? undefined : `panel-${p.id}`}
            aria-disabled={p.deshabilitada ? "true" : undefined}
            // El nombre es la pestaña ("$", "People"); la nota va de descripción, no de nombre.
            aria-label={p.deshabilitada ? p.nombre : undefined}
            aria-describedby={p.deshabilitada && p.titulo ? `pestana-${p.id}-nota` : undefined}
            title={p.titulo}
            tabIndex={!p.deshabilitada && p.id === activa ? 0 : -1}
            className={p.id === "alerts" ? "pestana pestana-alertas" : "pestana"}
            onClick={() => {
              if (!p.deshabilitada) seleccionar(p.id);
            }}
            onKeyDown={(e) => {
              if (p.deshabilitada) {
                // Ni Enter ni espacio la seleccionan; las flechas siguen entre las disponibles.
                if (e.key === "Enter" || e.key === " ") e.preventDefault();
                return;
              }
              alTeclado(e, p.id);
            }}
          >
            {p.nombre}
            {p.id === "alerts" && p.conteo ? (
              <span className="alerta-mini" data-testid="conteo-alertas" data-nivel="amber">
                {p.conteo}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {pestanas
        .filter((p) => p.deshabilitada && p.titulo)
        .map((p) => (
          <span key={p.id} id={`pestana-${p.id}-nota`} hidden>
            {p.titulo}
          </span>
        ))}
      {pestanas
        .filter((p) => !p.deshabilitada)
        .map((p) => (
          <div
            key={p.id}
            role="tabpanel"
            id={`panel-${p.id}`}
            aria-labelledby={`pestana-${p.id}`}
            hidden={p.id !== activa}
            data-testid="panel"
            data-panel={p.id}
            className="panel-pestana"
          >
            {paneles[p.id]}
          </div>
        ))}
    </div>
  );
}
