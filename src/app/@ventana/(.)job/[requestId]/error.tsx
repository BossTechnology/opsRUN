"use client";

import { ErrorDeLaVentana } from "@/app/_ventana/error-ventana";
import { Modal } from "@/app/_ventana/modal";

export default function ErrorDeLaVentanaEncima({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Modal>
      <ErrorDeLaVentana reset={reset} />
    </Modal>
  );
}
