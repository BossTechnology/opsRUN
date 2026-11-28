"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { armarPanelAlertas, TEXTO_SIN_COINCIDENCIAS } from "@/lib/alertas/armar";
import { SIN_FILTROS, type FiltrosDelPanel, type OpcionDeFiltro, type PanelAlertas } from "@/lib/alertas/tipos";
import type { ResumenAlertas } from "@/lib/tablero/tipos";

import "../_ventana/alertas.css";
import { usePulso } from "../_alertas/usar-pulso";

import { IconoAlertas } from "./iconos";

type Props = {
  /** Needs action de toda la operación: el conteo y el color del ícono. */
  resumen: ResumenAlertas;
  panel: PanelAlertas;
  /** Los `bzzzbx_alert_id` rojos de Needs action: lo que compara `usePulso`. */
  idsRojos: string[];
  /** "BzzzBX unavailable · last update 6:00 PM", o null si BzzzBX responde. */
  franja: string | null;
};

const FILTROS = [
  { clave: "nivel", etiqueta: "Level", testid: "filtro-level" },
  { clave: "regla", etiqueta: "Rule", testid: "filtro-rule" },
  { clave: "etapa", etiqueta: "Stage", testid: "filtro-stage" },
  { clave: "asignado", etiqueta: "Assigned to", testid: "filtro-assigned" },
] as const;

const ID_DEL_PANEL = "panel-alertas";

/**
 * El ícono de Alerts de la barra superior y su panel (spec OPR-34 §6). El ícono
 * cuenta Needs action de toda la operación (rojo si alguna es roja, ámbar si no) y
 * late con una roja nueva. El panel es un diálogo no modal debajo del ícono, de
 * cliente, con los datos que el tablero ya leyó en el servidor: no hace lecturas
 * propias ni rutas nuevas. Esc, ✕ o un clic fuera lo cierran y el foco vuelve al
 * ícono; sigue abierto en los refrescos del tablero (`router.refresh()` conserva
 * el estado del cliente) y la lista se actualiza sola. Los filtros viven aquí
 * mientras la página está abierta: no van a la URL (S-8).
 *
 * Cada fila es un enlace a `/job/[requestId]` sin `?tab` (P-8): desde el tablero
 * la ruta interceptada abre la ventana encima, y la regla de la pestaña inicial la
 * abre en Alerts mientras haya algo en Needs action.
 */
export function BotonYPanelDeAlertas({ resumen, panel, idsRojos, franja }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosDelPanel>(SIN_FILTROS);
  const raiz = useRef<HTMLSpanElement>(null);
  const icono = useRef<HTMLButtonElement>(null);
  const pulso = usePulso(idsRojos);

  // Al abrir una Job window (la ruta cambia) el panel se cierra. No se cierra al pulsar la fila: desmontar el enlace a
  // mitad de la navegación deja la ventana interceptada pegada al volver atrás. Se ajusta durante el render, sin efectos.
  const ruta = usePathname();
  const [rutaVista, setRutaVista] = useState(ruta);
  if (ruta !== rutaVista) {
    setRutaVista(ruta);
    setAbierto(false);
  }

  const vista = armarPanelAlertas(panel, filtros);

  function cerrar(devolverElFoco: boolean) {
    setAbierto(false);
    if (devolverElFoco) icono.current?.focus();
  }

  useEffect(() => {
    if (!abierto) return;
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setAbierto(false);
      icono.current?.focus();
    };
    const alClicFuera = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("keydown", alTeclado);
    document.addEventListener("mousedown", alClicFuera);
    return () => {
      document.removeEventListener("keydown", alTeclado);
      document.removeEventListener("mousedown", alClicFuera);
    };
  }, [abierto]);

  const opcion = (o: OpcionDeFiltro) => (
    <option key={o.valor} value={o.valor}>
      {o.texto} ({o.conteo})
    </option>
  );

  return (
    <span className="alertas-barra" ref={raiz}>
      <button
        ref={icono}
        type="button"
        className="alertas-operacion"
        data-testid="alertas-operacion"
        data-nivel={resumen.nivel ?? "ninguna"}
        data-pulso={pulso ? "si" : "no"}
        aria-label={`Alerts, ${resumen.total} open`}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-controls={ID_DEL_PANEL}
        onClick={() => setAbierto((a) => !a)}
      >
        <IconoAlertas />
        <span>{resumen.total}</span>
      </button>

      <div id={ID_DEL_PANEL} className="panel-alertas" role="dialog" aria-label="Alerts" data-testid="panel-alertas" hidden={!abierto}>
        {abierto ? (
          <>
            <div className="panel-alertas-cabeza">
              <h2>Alerts</h2>
              <button type="button" aria-label="Close" data-testid="panel-alertas-cerrar" onClick={() => cerrar(true)}>
                ✕
              </button>
            </div>

            {franja ? (
              <p className="panel-alertas-franja franja-caida" role="status" data-testid="panel-alertas-franja">
                {franja}
              </p>
            ) : null}

            <div className="panel-alertas-filtros" role="group" aria-label="Filters">
              {FILTROS.map((f) => (
                <label key={f.clave}>
                  <span>{f.etiqueta}</span>
                  <select
                    aria-label={f.etiqueta}
                    data-testid={f.testid}
                    value={filtros[f.clave]}
                    onChange={(e) => setFiltros((previos) => ({ ...previos, [f.clave]: e.target.value }) as FiltrosDelPanel)}
                  >
                    {vista.opciones[f.clave].map(opcion)}
                  </select>
                </label>
              ))}
            </div>

            {vista.sinCoincidencias ? (
              <p className="panel-alertas-vacio" data-testid="panel-alertas-sin-coincidencias">
                {TEXTO_SIN_COINCIDENCIAS}{" "}
                <button type="button" data-testid="panel-alertas-limpiar" onClick={() => setFiltros(SIN_FILTROS)}>
                  Clear filters
                </button>
              </p>
            ) : null}

            <details open data-testid="panel-needs-action">
              <summary>
                Needs action <span className="conteo">({vista.filas.length})</span>
              </summary>
              {vista.filas.length === 0 ? (
                <p className="panel-alertas-vacio" data-testid="panel-sin-alertas">
                  No alerts need action
                </p>
              ) : (
                <ul aria-label="Needs action">
                  {vista.filas.map((f) => (
                    <li key={f.id}>
                      <Link
                        href={`/job/${f.requestId}`}
                        className="panel-alertas-fila"
                        data-testid="panel-alerta"
                        data-regla={f.regla}
                        data-nivel={f.nivel}
                        data-request={f.requestId}
                      >
                        <span className="alerta-mini" data-nivel={f.nivel}>
                          {f.nivel === "red" ? "Red" : "Amber"}
                        </span>
                        <span data-testid="panel-regla">{f.nombreRegla}</span>
                        <span data-testid="panel-job">
                          {f.job} <span className="conteo">{f.numero}</span>
                        </span>
                        <span data-testid="panel-etapa">{f.etapaTitulo}</span>
                        <span data-testid="panel-asignado">{f.asignadoNombre ?? "Unassigned"}</span>
                        <span data-testid="panel-duracion">{f.duracion}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </details>

            <details data-testid="panel-waiting">
              <summary>
                Waiting <span className="conteo">({vista.esperas.length})</span>
              </summary>
              {vista.esperas.length === 0 ? (
                <p className="panel-alertas-vacio">None</p>
              ) : (
                <ul aria-label="Waiting">
                  {vista.esperas.map((e) => (
                    <li key={e.id}>
                      <Link
                        href={`/job/${e.requestId}`}
                        className="panel-alertas-fila panel-alertas-espera"
                        data-testid="panel-espera"
                        data-request={e.requestId}
                      >
                        <span>
                          {e.job} <span className="conteo">{e.numero}</span>
                        </span>
                        <span>{e.que}</span>
                        <span>{e.etapaTitulo}</span>
                        <span>{e.desde}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </>
        ) : null}
      </div>
    </span>
  );
}
