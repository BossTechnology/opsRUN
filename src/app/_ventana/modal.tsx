"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * La ventana encima del tablero (spec OPR-26 §2, P-1): el tablero sigue
 * debajo. Se cierra con el botón ✕, con Esc o con atrás del navegador, y
 * vuelve al tablero sin recargarlo (`router.back()`).
 */
export function Modal({ children }: { children: ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cerrar = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) router.back();
    };
    window.addEventListener("keydown", cerrar);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", cerrar);
  }, [router]);

  return (
    <div className="modal-fondo" data-testid="modal-fondo">
      <div
        ref={ref}
        className="modal-ventana"
        role="dialog"
        aria-modal="true"
        aria-label="Job window"
        tabIndex={-1}
        data-testid="modal"
      >
        <button type="button" className="modal-cerrar" aria-label="Close" data-testid="cerrar" onClick={() => router.back()}>
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
