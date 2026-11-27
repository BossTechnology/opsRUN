import type { Metadata } from "next";
import { Suspense } from "react";

import { VentanaCargando, VentanaDelJob } from "@/app/_ventana/ventana-del-job";

export const metadata: Metadata = { title: "Job window · opsRUN" };

type Props = {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function Contenido({ params, searchParams }: Props) {
  const [{ requestId }, consulta] = await Promise.all([params, searchParams]);
  const tab = typeof consulta.tab === "string" ? consulta.tab : null;
  return <VentanaDelJob requestId={requestId} tab={tab} modo="pagina" />;
}

/**
 * La Job window como página completa (OPR-26): lo que abren la recarga y la
 * URL directa. Desde el tablero se abre encima de él, por la ruta interceptada
 * `@ventana/(.)job/[requestId]`, que muestra esta misma ventana.
 */
export default function PaginaDelJob(props: Props) {
  return (
    <main className="pagina-job">
      <Suspense fallback={<VentanaCargando />}>
        <Contenido {...props} />
      </Suspense>
    </main>
  );
}
