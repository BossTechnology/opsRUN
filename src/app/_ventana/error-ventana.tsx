"use client";

import Link from "next/link";

/**
 * Error inesperado de la Job window (spec OPR-26 §6.3), por ejemplo la base
 * caída. Sin detalles técnicos ni datos en pantalla.
 */
export function ErrorDeLaVentana({ reset }: { reset: () => void }) {
  return (
    <section className="ventana ventana-vacia" role="alert" data-testid="error-ventana">
      <h1>Something went wrong</h1>
      <p>
        <button type="button" onClick={() => reset()}>
          Try again
        </button>{" "}
        <Link href="/">Board</Link>
      </p>
    </section>
  );
}
