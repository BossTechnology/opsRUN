"use client";

/**
 * Las piezas del Composer y del panel Notices que muestran y copian plantillas (spec OPR-18 §7). Aquí no hay
 * ningún envío: este archivo no importa `ejecutarAccion` ni los ejecutores, y un guard del disco
 * (`nada-sale-solo.test.ts`) lo vigila. Elegir una plantilla solo llena la caja de texto; quien envía es el Composer,
 * con Send, igual que con cualquier texto.
 */
import { useState } from "react";

import type { PlantillaOfrecida } from "@/lib/plantillas/disponibles";

/** El botón Templates y su menú: las plantillas del modo y la etapa, por su nombre visible. */
export function SelectorDePlantillas({
  plantillas,
  razonGris,
  onElegir,
}: {
  plantillas: PlantillaOfrecida[];
  /** Por qué el modo está en gris, si lo está: el botón lo repite. */
  razonGris: string | null;
  onElegir: (p: PlantillaOfrecida) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const sinPlantillas = plantillas.length === 0;
  const deshabilitado = razonGris !== null || sinPlantillas;
  const titulo = razonGris ?? (sinPlantillas ? "No templates for this stage" : undefined);

  return (
    <div
      className="plantillas-selector"
      onKeyDown={(e) => {
        if (e.key === "Escape") setAbierto(false);
      }}
    >
      <button
        type="button"
        data-testid="plantillas"
        aria-haspopup="menu"
        aria-expanded={abierto && !deshabilitado}
        disabled={deshabilitado}
        title={titulo}
        onClick={() => setAbierto((a) => !a)}
      >
        Templates
      </button>
      {abierto && !deshabilitado ? (
        <div className="plantillas-menu" role="menu" aria-label="Templates">
          {plantillas.map((p) => (
            <button
              key={p.clave}
              type="button"
              role="menuitem"
              data-plantilla={p.clave}
              onClick={() => {
                setAbierto(false);
                onElegir(p);
              }}
            >
              {p.nombre}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** "Template · Confirmation request", con una x para quitar la marca (no borra el texto). */
export function MarcaDePlantilla({ nombre, onQuitar }: { nombre: string; onQuitar: () => void }) {
  return (
    <span className="marca-plantilla" data-testid="marca-plantilla">
      Template · {nombre}
      <button type="button" data-testid="quitar-plantilla" aria-label="Remove template" onClick={onQuitar}>
        ×
      </button>
    </span>
  );
}

/** "Replace what you wrote? · Replace · Cancel": el texto del operador no se pierde sin avisar. */
export function ReemplazoEnLinea({ onReemplazar, onCancelar }: { onReemplazar: () => void; onCancelar: () => void }) {
  return (
    <p className="plantillas-reemplazo" data-testid="reemplazo" role="alert">
      Replace what you wrote? ·{" "}
      <button type="button" data-testid="reemplazar-plantilla" onClick={onReemplazar}>
        Replace
      </button>{" "}
      ·{" "}
      <button type="button" data-testid="cancelar-reemplazo" onClick={onCancelar}>
        Cancel
      </button>
    </p>
  );
}

/** "Fill in: {{date}}, {{window}}": lo que falta antes de poder enviar. */
export function Faltantes({ faltan }: { faltan: string[] }) {
  if (faltan.length === 0) return null;
  return (
    <p className="plantillas-faltan" data-testid="faltan" role="status">
      {`Fill in: ${faltan.join(", ")}`}
    </p>
  );
}

/**
 * Copy: copia un texto al portapapeles del navegador y nada más (no llama al servidor ni escribe). El "Copied" o el
 * "Copy failed" valen para el texto que se copió; si el texto cambia, el botón vuelve a "Copy".
 */
export function BotonCopiar({ texto, testid, deshabilitado = false }: { texto: string; testid: string; deshabilitado?: boolean }) {
  const [resultado, setResultado] = useState<{ texto: string; ok: boolean } | null>(null);
  const vigente = resultado?.texto === texto ? resultado : null;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setResultado({ texto, ok: true });
    } catch {
      setResultado({ texto, ok: false });
    }
  }

  return (
    <button type="button" className="boton-copiar" data-testid={testid} disabled={deshabilitado} onClick={() => void copiar()}>
      {vigente === null ? "Copy" : vigente.ok ? "Copied" : "Copy failed"}
    </button>
  );
}
