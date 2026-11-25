import type { Tarjeta as ModeloTarjeta } from "@/lib/tablero/tipos";

import { IconoChat, IconoServicio } from "./iconos";

const DESCRIPCION_COLOR: Record<ModeloTarjeta["color"], string | null> = {
  pagada: "Paid",
  sombreada: "Breached",
  borde: "At risk",
  sin_dueno: "Unassigned",
  normal: null,
};

export function Tarjeta({ tarjeta }: { tarjeta: ModeloTarjeta }) {
  const color = DESCRIPCION_COLOR[tarjeta.color];
  return (
    <article
      className="tarjeta"
      data-testid="tarjeta"
      data-numero={tarjeta.numero}
      data-color={tarjeta.color}
      data-request={tarjeta.requestId}
      data-estado={tarjeta.estado.tipo}
      aria-label={`${tarjeta.nombre} ${tarjeta.numero}${color ? `, ${color}` : ""}`}
    >
      <header className="tarjeta-cabeza">
        <span className="tarjeta-nombre" data-testid="nombre">
          {tarjeta.nombre}
        </span>
        <span className="tarjeta-numero">{tarjeta.numero}</span>
      </header>
      <p className="tarjeta-estado" data-testid="estado" data-tipo={tarjeta.estado.tipo}>
        {tarjeta.estado.texto}
      </p>
      <p className="tarjeta-ciudad" data-testid="ciudad">
        {tarjeta.ciudad}
      </p>
      <p className="tarjeta-servicio">
        <IconoServicio tipo={tarjeta.tipo} className="icono" />
        <span data-testid="servicio">{`${tarjeta.tipo} | ${tarjeta.servicio}`}</span>
        {tarjeta.chat ? (
          <span className="tarjeta-chat" title="New message" data-testid="chat">
            <IconoChat />
            <span className="solo-lector">New message</span>
          </span>
        ) : null}
      </p>
      <footer className="tarjeta-pie">
        <span className="tarjeta-flags" data-testid="flags">
          {tarjeta.flags.map((f) => (
            <span key={f} className="flag" data-flag={f}>
              {f}
            </span>
          ))}
        </span>
        {tarjeta.alertas.total > 0 ? (
          <span className="alerta-mini" data-nivel={tarjeta.alertas.nivel} title={`${tarjeta.alertas.total} open alerts`}>
            {tarjeta.alertas.total}
          </span>
        ) : null}
        {tarjeta.dueno ? (
          <span className="dueno" title={`Assigned to ${tarjeta.dueno.nombre}`}>
            {tarjeta.dueno.iniciales}
          </span>
        ) : null}
      </footer>
    </article>
  );
}
