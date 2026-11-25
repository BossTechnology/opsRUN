import type { Columna as ModeloColumna } from "@/lib/tablero/tipos";

import { Tarjeta } from "./tarjeta";

export function Columna({ columna }: { columna: ModeloColumna }) {
  const conteo = columna.tarjetas.length + columna.pagadas.length;
  return (
    <section className="columna" data-testid="columna" data-etapa={columna.etapa} aria-labelledby={`col-${columna.etapa}`}>
      <header className="columna-cabeza">
        <h2 id={`col-${columna.etapa}`}>{columna.titulo}</h2>
        <span className="conteo" data-testid="conteo">
          {conteo}
        </span>
        {columna.alertas.total > 0 ? (
          <span
            className="alerta-mini"
            data-testid="alertas-columna"
            data-nivel={columna.alertas.nivel}
            title={`${columna.alertas.total} open alerts`}
          >
            {columna.alertas.total}
          </span>
        ) : null}
      </header>
      <div className="columna-tarjetas">
        {columna.tarjetas.map((t) => (
          <Tarjeta key={t.requestId} tarjeta={t} />
        ))}
        {columna.pagadas.length > 0 ? (
          <details className="fila-paid" data-testid="fila-paid">
            <summary>{`Paid (${columna.pagadas.length})`}</summary>
            {columna.pagadas.map((t) => (
              <Tarjeta key={t.requestId} tarjeta={t} />
            ))}
          </details>
        ) : null}
      </div>
    </section>
  );
}
