import type { VentanaJob } from "@/lib/ventana/tipos";

/**
 * Pestaña de la propiedad, de solo lectura (spec OPR-26 §4.3): cliente,
 * contacto, propiedad y espacio, servicio, fecha y ventana, cleaner, PO y
 * notas de acceso, con `— —` en lo que falte. Lo que BzzzBX respondió que no
 * conoce lleva "Not found in BzzzBX" (§6.3). El enlace de la Fase A va arriba
 * (lo pone `VentanaDelJob`).
 */
export function PanelPropiedad({ ventana }: { ventana: VentanaJob }) {
  return (
    <dl className="campos" data-testid="campos-propiedad">
      {ventana.propiedad.campos.map((c) => (
        <div key={c.clave} data-testid={`campo-${c.clave}`}>
          <dt>{c.etiqueta}</dt>
          <dd>
            {c.valor}
            {c.noEncontrado ? (
              <span className="no-encontrado" data-testid="no-encontrado">
                {" "}
                Not found in BzzzBX
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
