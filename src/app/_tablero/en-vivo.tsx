"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Props = {
  /** Cursor de cambios que dio el servidor al pintar. */
  cursor: string;
  sondeoMs: number;
  disponible: boolean;
  /** Texto ya formateado en el servidor, en la zona de la operación. */
  texto: string;
};

/**
 * Indicador Live y sondeo de cambios (spec OPR-25 §4). Cada `sondeoMs` le
 * pregunta al servidor si cambió algo; si sí, refresca el tablero (el
 * servidor lo vuelve a leer). No lee datos: solo sí o no.
 */
export function EnVivo({ cursor: inicial, sondeoMs, disponible, texto }: Props) {
  const router = useRouter();
  const [caido, setCaido] = useState(false);

  useEffect(() => {
    let cursor = inicial;
    let vivo = true;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/tablero/cambios?cursor=${encodeURIComponent(cursor)}`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const revision = (await r.json()) as { cambio: boolean; cursor: string };
        if (!vivo) return;
        cursor = revision.cursor;
        setCaido(false);
        if (revision.cambio) router.refresh();
      } catch {
        if (vivo) setCaido(true);
      }
    }, sondeoMs);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [inicial, sondeoMs, router]);

  const estado = caido ? "reconectando" : disponible ? "vivo" : "caido";
  return (
    <span className="en-vivo" data-estado={estado} data-testid="en-vivo" role="status">
      {caido ? "Reconnecting…" : texto}
    </span>
  );
}
