/**
 * Tipos de las acciones de las etapas In Progress, Complete y Validation (spec
 * OPR-30, OPR-31 y OPR-32): lo que la base puede rechazar y lo que el servidor le
 * pide. Sin imports del servidor: los usan los ejecutores del registro de
 * acciones, que también se cargan en el navegador por sus tipos.
 */
import type { Actor } from "../db/pool";

/** Los errores de las funciones SQL de `20261203120000_etapas_in_progress_a_paid.sql` que el operador puede provocar. */
export type CodigoEtapaInvalida =
  | "request_no_encontrada"
  | "cambio_concurrente"
  | "job_no_programado"
  | "alerta_no_limpiable"
  | "alerta_de_otro_job"
  | "alerta_ya_resuelta"
  | "ya_aprobado"
  | "sin_cambios"
  | "ya_validado"
  | "sin_aprobar"
  | "falta_po"
  | "dato_invalido";

/** La acción no se pudo hacer con esos datos. No se escribió nada. */
export class EtapaInvalida extends Error {
  constructor(readonly codigo: CodigoEtapaInvalida) {
    super(`etapa inválida: ${codigo}`);
    this.name = "EtapaInvalida";
  }
}

/**
 * Next empaqueta por separado rutas y páginas: la clase puede venir de otra
 * copia del módulo y `instanceof` falla. Se reconoce por el nombre, como
 * `esRequestInvalida` y los errores de BzzzBX.
 */
export const esEtapaInvalida = (e: unknown): e is EtapaInvalida =>
  e instanceof Error && e.name === "EtapaInvalida" && typeof (e as { codigo?: unknown }).codigo === "string";

export type MarcaOss = "oss" | "not_oss";

/** La instantánea de la alerta que el servidor leyó en BzzzBX y la base guarda (OPR-20 §3.8). */
export type InstantaneaDeAlerta = {
  bzzzbxAlertId: string;
  ruleId: string;
  ruleVersion: string;
  level: "amber" | "red";
  reasonText: string;
  /** ISO 8601 UTC. */
  openedAt: string;
};

/**
 * Lo que las cinco acciones escriben en opsRUN, todas con el actor de la
 * transacción; las funciones SQL dejan su Audit. Lo que viaja del navegador a la
 * base: el id de la request, la versión, la marca OSS, el PO escrito y el motivo.
 * La instantánea de la alerta, `po_required` y el PO de PINCH los lee el servidor
 * en BzzzBX (frontera de confianza).
 */
export type DatosDeEtapas = {
  /** Devuelve el id de la ocurrencia. */
  limpiarAlerta(entrada: { requestId: string; version: string; alerta: InstantaneaDeAlerta; motivo: string }, actor: Actor): Promise<string>;
  marcarOss(entrada: { requestId: string; marca: MarcaOss; version: string; motivo: string | null }, actor: Actor): Promise<void>;
  aprobar(entrada: { requestId: string; version: string }, actor: Actor): Promise<void>;
  capturarPo(entrada: { requestId: string; poNumber: string; version: string }, actor: Actor): Promise<void>;
  validar(
    entrada: { requestId: string; version: string; poRequerido: boolean; poDelJob: string | null },
    actor: Actor,
  ): Promise<void>;
};
