import { Suspense } from "react";

import { Modal } from "@/app/_ventana/modal";
import { VentanaCargando, VentanaDelJob } from "@/app/_ventana/ventana-del-job";

type Props = {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function Contenido({ params, searchParams }: Props) {
  const [{ requestId }, consulta] = await Promise.all([params, searchParams]);
  const tab = typeof consulta.tab === "string" ? consulta.tab : null;
  return <VentanaDelJob requestId={requestId} tab={tab} modo="overlay" />;
}

/**
 * La Job window encima del tablero (OPR-26, P-1): ruta interceptada de
 * `/job/[requestId]`. El tablero sigue debajo; Esc, ✕ o atrás vuelven a él sin
 * recargarlo. La recarga y la URL directa abren la página completa.
 */
export default function VentanaEncimaDelTablero(props: Props) {
  return (
    <Modal>
      <Suspense fallback={<VentanaCargando />}>
        <Contenido {...props} />
      </Suspense>
    </Modal>
  );
}
