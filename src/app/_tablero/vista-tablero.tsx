import { hora } from "@/lib/tablero/formato";
import type { Tablero } from "@/lib/tablero/tipos";

import { Columna } from "./columna";
import { EnVivo } from "./en-vivo";
import { IconoAlertas, IconoGenerico, IconoRosie } from "./iconos";

const MAS_ADELANTE = "Available in a later release";

/** Botón de algo que no entra en V1.1 beta: se ve, en gris, y no hace nada. */
function NoDisponible({ nombre, conTexto = false }: { nombre: string; conTexto?: boolean }) {
  return (
    <button type="button" className="no-disponible" aria-disabled="true" title={MAS_ADELANTE} aria-label={nombre}>
      <IconoGenerico />
      {conTexto ? <span>{nombre}</span> : null}
    </button>
  );
}

type Props = { tablero: Tablero; zona: string; sondeoMs: number; cursor: string };

export function VistaTablero({ tablero, zona, sondeoMs, cursor }: Props) {
  const { bzzzbx, alertasAbiertas } = tablero;
  const textoEnVivo = bzzzbx.disponible
    ? "Live"
    : `BzzzBX unavailable · ${bzzzbx.actualizadoEn ? `last update ${hora(bzzzbx.actualizadoEn, zona)}` : "no data yet"}`;

  return (
    <div className="tablero">
      <header className="barra">
        {/* Marcador genérico: el logo real no va en el repo (spec OPR-25, P-1). */}
        <span className="logo" aria-label="Logo" role="img">
          Logo
        </span>
        <span className="marca">opsRUN</span>
        <EnVivo
          key={`${bzzzbx.disponible}-${bzzzbx.actualizadoEn}`}
          cursor={cursor}
          sondeoMs={sondeoMs}
          disponible={bzzzbx.disponible}
          texto={textoEnVivo}
        />
        <span className="barra-espacio" />
        <button
          type="button"
          className="alertas-operacion"
          data-testid="alertas-operacion"
          data-nivel={alertasAbiertas.nivel ?? "ninguna"}
          aria-label={`Alerts, ${alertasAbiertas.total} open`}
        >
          <IconoAlertas />
          <span>{alertasAbiertas.total}</span>
        </button>
        <NoDisponible nombre="Alarms" />
        <NoDisponible nombre="Anomalies" />
        <NoDisponible nombre="Actions" />
        <label className="filtro">
          <span className="solo-lector">Operator filter</span>
          <select aria-label="Operator filter" defaultValue="all">
            <option value="all">All operators</option>
            <option value="me" disabled>
              Only me (sign-in required)
            </option>
          </select>
        </label>
      </header>

      <nav className="riel" aria-label="Tools">
        <button type="button" className="rosie" aria-label="Rosie" title="Rosie is not connected yet">
          <IconoRosie />
          <span>Rosie</span>
        </button>
        {["Observe", "Geo", "Incidents", "Activity", "Map"].map((n) => (
          <NoDisponible key={n} nombre={n} conTexto />
        ))}
      </nav>

      <main className="columnas">
        {tablero.columnas.map((c) => (
          <Columna key={c.etapa} columna={c} />
        ))}
      </main>
    </div>
  );
}
