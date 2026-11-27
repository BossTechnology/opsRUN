"use client";

import { useState, useTransition } from "react";

import type { ResultadoAccion } from "@/lib/acciones/tipos";
import { PO_MAX } from "@/lib/etapas/reglas";

import { ejecutarAccion } from "./acciones";
import { textoDelResultado } from "./barra-acciones";

import "./etapas.css";

type Props = {
  requestId: string;
  /** `change_seq` de la request que ve el operador. */
  version: string;
  /** El PO que el operador ya capturó en opsRUN; null si no hay. */
  capturado: string | null;
  /** Para pruebas de componente: reemplaza a la Server Action. */
  ejecutar?: (entrada: Parameters<typeof ejecutarAccion>[0]) => Promise<ResultadoAccion>;
};

/**
 * El campo PO # de Billing, editable hasta Validate (spec OPR-32 §5.3): pasa por
 * `ejecutarAccion` con el código `write_po`, igual que la acción Enter PO de la
 * action bar, así hereda la disponibilidad, el actor y el refresco.
 */
export function FormularioPo({ requestId, version, capturado, ejecutar = ejecutarAccion }: Props) {
  const [valor, setValor] = useState(capturado ?? "");
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const [enCurso, iniciar] = useTransition();

  const recortado = valor.trim();
  const puedeGuardar = recortado !== "" && recortado !== (capturado ?? "") && !enCurso;

  function guardar() {
    if (!puedeGuardar) return;
    iniciar(async () => {
      try {
        setResultado(await ejecutar({ requestId, codigo: "write_po", motivo: null, datos: { po_number: recortado }, version }));
      } catch {
        setResultado({ tipo: "rechazada", codigo: "error", mensaje: "Something went wrong. Try again." });
      }
    });
  }

  return (
    <form
      className="formulario-po"
      data-testid="formulario-po"
      onSubmit={(e) => {
        e.preventDefault();
        guardar();
      }}
    >
      <label>
        <span className="etiqueta-campo">PO #</span>
        <input
          type="text"
          data-testid="po-input"
          value={valor}
          maxLength={PO_MAX}
          autoComplete="off"
          onChange={(e) => {
            setValor(e.target.value);
            setResultado(null);
          }}
        />
      </label>
      <button type="submit" data-testid="guardar-po" disabled={!puedeGuardar}>
        Save
      </button>
      <span className="resultado" role="status" data-testid="resultado-po" data-tipo={resultado?.tipo ?? "ninguno"}>
        {enCurso ? "Working…" : resultado ? textoDelResultado(resultado) : ""}
      </span>
    </form>
  );
}
