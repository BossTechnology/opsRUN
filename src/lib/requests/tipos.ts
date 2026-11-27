/**
 * Tipos de Assign / Reassign y Confirm details, sender y cleaner (spec OPR-28):
 * lo que la base puede rechazar y lo que el servidor le pide. Sin imports del
 * servidor: lo usan los ejecutores del registro de acciones, que también se
 * cargan en el navegador por sus tipos.
 */
import type { Actor } from "../db/pool";

/** Los errores de las funciones SQL de la migración `20261201120000_requests_assign_confirm.sql` que el operador puede provocar. */
export type CodigoRequestInvalida =
  | "request_no_encontrada"
  | "request_no_abierta"
  | "cambio_concurrente"
  | "operador_invalido"
  | "ya_es_dueno"
  | "faltan_datos"
  | "ya_confirmada"
  | "respuesta_invalida";

/** La acción no se pudo hacer con esos datos. No se escribió nada. */
export class RequestInvalida extends Error {
  constructor(readonly codigo: CodigoRequestInvalida) {
    super(`request inválida: ${codigo}`);
    this.name = "RequestInvalida";
  }
}

/**
 * Next empaqueta por separado rutas y páginas: la clase puede venir de otra
 * copia del módulo y `instanceof` falla. Se reconoce por el nombre, como
 * `esEnlaceInvalido` y los errores de BzzzBX.
 */
export const esRequestInvalida = (e: unknown): e is RequestInvalida =>
  e instanceof Error && e.name === "RequestInvalida" && typeof (e as { codigo?: unknown }).codigo === "string";

export type MetodoDeCleaner = "phone" | "cleaner_text";

/**
 * Lo que las cuatro acciones escriben en opsRUN. Todas con el actor de la
 * transacción; las funciones SQL dejan su Audit. Lo que viaja a la base son el
 * id de la request, el operador destino, el método, el id de la respuesta, la
 * versión y el motivo: nada del borrador ni de PINCH (spec §6).
 */
export type DatosDeRequests = {
  asignar(
    entrada: { requestId: string; operatorId: string; version: string; motivo: string | null },
    actor: Actor,
  ): Promise<void>;
  /** Devuelve el id de la confirmación. */
  confirmarDetalles(entrada: { requestId: string; version: string }, actor: Actor): Promise<string>;
  confirmarSender(entrada: { requestId: string; version: string }, actor: Actor): Promise<string>;
  confirmarCleaner(
    entrada: {
      requestId: string;
      metodo: MetodoDeCleaner;
      cleanerConfirmationId: string | null;
      version: string;
      motivo: string | null;
    },
    actor: Actor,
  ): Promise<string>;
};
