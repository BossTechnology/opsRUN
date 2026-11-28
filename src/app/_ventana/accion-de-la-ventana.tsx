"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { AccionVista } from "@/lib/acciones/tipos";

/** Una acción que algo de la ventana le pide a la action bar que abra, con lo que se le prellena. */
export type AccionPedida = { codigo: string; datos: Record<string, unknown> | null; n: number };

type Contexto = {
  /** Las acciones de la ventana, con su disponibilidad calculada en el servidor (la misma de la barra). */
  acciones: AccionVista[];
  /** La última acción que se pidió; `n` cambia con cada pedido, aunque sea la misma acción. */
  pedida: AccionPedida | null;
  /**
   * Abre la acción en la action bar, elegida y prellenada. No ejecuta nada: corre
   * solo cuando el operador pulsa Go, por `ejecutarAccion` (OPR-34 §5.3, P-6).
   */
  elegir: (codigo: string, datos?: Record<string, unknown>) => void;
};

const SIN_PROVEEDOR: Contexto = { acciones: [], pedida: null, elegir: () => {} };

const AccionDeLaVentana = createContext<Contexto>(SIN_PROVEEDOR);

/**
 * El único cambio de OPR-34 al marco de la Job window (spec §5.3): un contexto de
 * cliente con `elegir(codigo, datos?)`, que usan los botones de la pestaña Alerts
 * para abrir una acción de la action bar. Rodea la barra y las pestañas.
 */
export function ProveedorDeAcciones({ acciones, children }: { acciones: AccionVista[]; children: ReactNode }) {
  const [pedida, setPedida] = useState<AccionPedida | null>(null);
  const elegir = useCallback((codigo: string, datos?: Record<string, unknown>) => {
    setPedida((previa) => ({ codigo, datos: datos ?? null, n: (previa?.n ?? 0) + 1 }));
  }, []);
  const valor = useMemo(() => ({ acciones, pedida, elegir }), [acciones, pedida, elegir]);
  return <AccionDeLaVentana value={valor}>{children}</AccionDeLaVentana>;
}

/** Fuera de un proveedor (pruebas de un componente suelto) no hay acciones y `elegir` no hace nada. */
export const useAccionDeLaVentana = (): Contexto => useContext(AccionDeLaVentana);
