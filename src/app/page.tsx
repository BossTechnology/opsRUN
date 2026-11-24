import { Suspense } from "react";

import { EstadoBase } from "./estado-base";

export default function Home() {
  return (
    <main>
      <h1>opsRUN</h1>
      <p className="subtitulo">Operations console · V1.1 beta</p>
      <Suspense fallback={<p aria-busy="true">Checking database…</p>}>
        <EstadoBase />
      </Suspense>
    </main>
  );
}
