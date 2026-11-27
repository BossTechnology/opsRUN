import type { VentanaJob } from "@/lib/ventana/tipos";

import "./etapas.css";

/** Encabezado de la Job window (spec OPR-26 §3): solo lectura. */
export function Encabezado({ ventana }: { ventana: VentanaJob }) {
  const { stage, oss, nombre, linea, precio, asignado, cargas } = ventana.encabezado;
  return (
    <header className="ventana-encabezado" data-testid="encabezado">
      <div className="ventana-titulo">
        <span className="stage" data-testid="stage" data-etapa={stage.etapa}>
          {stage.texto}
          {stage.pagada ? (
            <span className="marca-paid" data-testid="marca-paid" role="img" aria-label="Paid" title="Paid">
              ✓
            </span>
          ) : null}
        </span>
        {oss ? (
          <span className="chip-oss" data-testid="chip-oss" title="OSS">
            OSS
          </span>
        ) : null}
        <h1 data-testid="nombre-job">{nombre}</h1>
      </div>

      <p className="job-linea" data-testid="job-linea">
        <span data-testid="job-numero">{linea.numero}</span>
        <span aria-hidden="true"> · </span>
        <span data-testid="job-fecha">{linea.fecha}</span>
        <span aria-hidden="true"> · </span>
        <span data-testid="job-servicio">{linea.servicio}</span>
        <span aria-hidden="true"> · </span>
        <span data-testid="job-cleaner">{linea.cleaner}</span>
      </p>

      <dl className="ventana-datos">
        <div>
          <dt>Price</dt>
          <dd data-testid="precio">{precio}</dd>
        </div>
        <div>
          <dt>Assigned to</dt>
          <dd data-testid="asignado">{asignado.nombre}</dd>
        </div>
      </dl>

      <ul className="cargas" aria-label="Operator load">
        {cargas.map((c) => (
          <li key={c.id} data-testid="carga" data-operador={c.id} data-abiertas={c.abiertas} title={`${c.nombre}: ${c.abiertas} open`}>
            <span className="carga-nombre">{c.nombre}</span>
            <span className="carga-barra" aria-hidden="true">
              <span style={{ width: `${Math.round(c.proporcion * 100)}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </header>
  );
}
