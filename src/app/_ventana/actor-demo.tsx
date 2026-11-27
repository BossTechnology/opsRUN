"use client";

import { useTransition } from "react";

import { elegirActor } from "./acciones";

/**
 * Selector "Acting as" de la demo local (OPR-26, P-2). El servidor solo lo
 * pinta si se cumplen las tres condiciones de `actorDemoActivo`; si no, ni
 * llega a esta pantalla. Elegir a alguien guarda su id en una cookie y el
 * servidor declara su `auth_user_id` en cada escritura.
 */
export function ActorDemo({
  operadores,
  elegido,
}: {
  operadores: { id: string; nombre: string }[];
  elegido: string | null;
}) {
  const [enCurso, iniciar] = useTransition();
  return (
    <label className="actor-demo" data-testid="actor-demo">
      <span className="etiqueta-campo">Acting as</span>
      <select
        aria-label="Acting as"
        value={elegido ?? ""}
        disabled={enCurso}
        onChange={(e) => {
          const id = e.target.value;
          iniciar(async () => {
            await elegirActor(id);
          });
        }}
      >
        <option value="">Nobody (read only)</option>
        {operadores.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}
