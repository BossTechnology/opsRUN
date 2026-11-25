import { Suspense } from "react";

import { EstadoBase } from "./estado-base";

/** Salud de la base, para quien despliega. El tablero está en `/`. */
export default function Salud() {
  return (
    <main className="pagina-salud">
      <h1>opsRUN</h1>
      <p className="subtitulo">Operations console · V1.1 beta</p>
      <Suspense fallback={<p aria-busy="true">Checking database…</p>}>
        <EstadoBase />
      </Suspense>
    </main>
  );
}
