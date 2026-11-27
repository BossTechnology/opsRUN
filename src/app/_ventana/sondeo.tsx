"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

type Props = {
  /** Cursor de cambios que dio el servidor al pintar. */
  cursor: string;
  sondeoMs: number;
};

/**
 * El mismo sondeo del tablero (spec OPR-26 §8.3): cada `sondeoMs` le pregunta
 * a `/api/tablero/cambios` si algo cambió y, si sí, refresca la ruta; el
 * servidor vuelve a leer la ventana. No lee datos y no pinta nada. No hay ruta
 * nueva.
 */
export function Sondeo({ cursor: inicial, sondeoMs }: Props) {
  const router = useRouter();

  useEffect(() => {
    let cursor = inicial;
    let vivo = true;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/tablero/cambios?cursor=${encodeURIComponent(cursor)}`, { cache: "no-store" });
        if (!r.ok) return;
        const revision = (await r.json()) as { cambio: boolean; cursor: string };
        if (!vivo) return;
        cursor = revision.cursor;
        if (revision.cambio) router.refresh();
      } catch {
        // Sin red: el siguiente sondeo lo intenta de nuevo.
      }
    }, sondeoMs);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [inicial, sondeoMs, router]);

  return null;
}
