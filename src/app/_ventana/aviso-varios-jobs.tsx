"use client";

import { useState, useTransition } from "react";

import type { VistaIa } from "@/lib/analisis-ia/tipos";

import type { DecidirIa } from "./campo-ia";

/**
 * El aviso de que el correo puede pedir varios jobs (spec OPR-36 §10.3, P-12): solo un aviso con
 * Got it (`accepted`) y Not multiple (`rejected`). No separa la request ni crea nada: el operador
 * decide qué hacer. Arriba de Job details.
 */
export function AvisoVariosJobs({ aviso, decidir }: { aviso: NonNullable<VistaIa["variosJobs"]>; decidir: DecidirIa }) {
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  const enviar = (decision: "accepted" | "rejected") => {
    setMensaje(null);
    empezar(async () => {
      const r = await decidir({ suggestionId: aviso.id, decision });
      if (r.tipo === "rechazada") setMensaje(r.mensaje);
    });
  };

  return (
    <div className="ia-aviso" role="status" data-testid="aviso-varios-jobs">
      <span>AI: this email may ask for {aviso.cantidad} jobs.</span>{" "}
      <button type="button" className="ia-boton" disabled={pendiente} onClick={() => enviar("accepted")}>
        Got it
      </button>{" "}
      <button type="button" className="ia-boton" disabled={pendiente} onClick={() => enviar("rejected")}>
        Not multiple
      </button>
      {mensaje ? (
        <span className="ia-error" role="alert">
          {" "}
          {mensaje}
        </span>
      ) : null}
    </div>
  );
}
