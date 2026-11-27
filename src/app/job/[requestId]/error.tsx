"use client";

import { ErrorDeLaVentana } from "@/app/_ventana/error-ventana";

export default function ErrorDelJob({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="pagina-job">
      <ErrorDeLaVentana reset={reset} />
    </main>
  );
}
