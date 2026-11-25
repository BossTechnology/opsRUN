/** Íconos del tablero, en SVG en línea: sin librería ni archivos externos. */
type Props = { className?: string };

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export const IconoAlertas = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

export const IconoChat = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

export const IconoRosie = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z" />
  </svg>
);

/** Uno por tipo de servicio; los desconocidos usan el genérico. */
export function IconoServicio({ tipo, ...p }: Props & { tipo: string }) {
  switch (tipo) {
    case "deep":
      return (
        <svg {...base} {...p}>
          <path d="M12 2.7l5.7 5.7a8 8 0 1 1-11.4 0z" />
        </svg>
      );
    case "move_out":
      return (
        <svg {...base} {...p}>
          <path d="M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
          <path d="M9 21V12h6v9" />
        </svg>
      );
    default:
      return (
        <svg {...base} {...p}>
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
  }
}

/** Gris: lo que no entra en V1.1 beta. Un punto, sin pretender ser el ícono final. */
export const IconoGenerico = (p: Props) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8" />
  </svg>
);
