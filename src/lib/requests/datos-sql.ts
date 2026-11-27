/**
 * Lo que Assign / Reassign y Confirm details, sender y cleaner escriben en
 * opsRUN, por SQL como opsrun_app (spec OPR-28 §7). Las escrituras van por las
 * funciones de la migración `20261201120000_requests_assign_confirm.sql`, con
 * el actor de la transacción; la base escribe el Audit en la misma transacción.
 */
import type { DatabaseError } from "pg";

import { comoOpsrunApp, type Actor, type Tx } from "@/lib/db/pool";

import { RequestInvalida, type CodigoRequestInvalida, type DatosDeRequests } from "./tipos";

/** Cómo corre cada llamada: por defecto `comoOpsrunApp`; las pruebas pasan su propia transacción. */
export type Ejecutar = <T>(fn: (db: Tx) => Promise<T>, opciones?: { escritura?: boolean; actor?: Actor }) => Promise<T>;

/** Errores de las funciones SQL que el operador puede provocar, con su código de opsRUN. */
const CODIGOS_SQL: Record<string, CodigoRequestInvalida> = {
  OP006: "request_no_encontrada",
  OP007: "request_no_abierta",
  OP013: "cambio_concurrente",
  OP014: "operador_invalido",
  OP015: "ya_es_dueno",
  OP016: "faltan_datos",
  OP017: "ya_confirmada",
  OP018: "respuesta_invalida",
};

/**
 * Dos operadores que confirman lo mismo a la vez pasan los dos el chequeo OP017
 * de la función; el segundo choca con el índice único de la confirmación
 * vigente (23505) y es lo mismo: ya estaba confirmada.
 */
const UNICA_DE_LA_CONFIRMACION_VIGENTE = "request_confirmation_current_key";

async function traducirErrores<T>(promesa: Promise<T>): Promise<T> {
  try {
    return await promesa;
  } catch (e) {
    const error = e as Partial<DatabaseError> | undefined;
    if (error?.code === "23505" && error.constraint === UNICA_DE_LA_CONFIRMACION_VIGENTE) {
      throw new RequestInvalida("ya_confirmada");
    }
    const codigo = CODIGOS_SQL[error?.code ?? ""];
    if (codigo) throw new RequestInvalida(codigo);
    throw e;
  }
}

export function crearDatosDeRequests(
  ejecutar: Ejecutar = (fn, opciones) => comoOpsrunApp(fn, opciones),
): DatosDeRequests {
  const escribir = <T>(actor: Actor, fn: (db: Tx) => Promise<T>) => traducirErrores(ejecutar(fn, { escritura: true, actor }));

  return {
    async asignar({ requestId, operatorId, version, motivo }, actor) {
      await escribir(actor, (db) =>
        db.query("select opsrun.assign_request($1::uuid, $2::uuid, $3::bigint, $4)", [requestId, operatorId, version, motivo]),
      );
    },

    async confirmarDetalles({ requestId, version }, actor) {
      const { rows } = await escribir(actor, (db) =>
        db.query<{ id: string }>("select opsrun.confirm_details($1::uuid, $2::bigint) as id", [requestId, version]),
      );
      return rows[0]!.id;
    },

    async confirmarSender({ requestId, version }, actor) {
      const { rows } = await escribir(actor, (db) =>
        db.query<{ id: string }>("select opsrun.confirm_sender($1::uuid, $2::bigint) as id", [requestId, version]),
      );
      return rows[0]!.id;
    },

    async confirmarCleaner({ requestId, metodo, cleanerConfirmationId, version, motivo }, actor) {
      const { rows } = await escribir(actor, (db) =>
        db.query<{ id: string }>(
          "select opsrun.confirm_cleaner($1::uuid, $2::opsrun.confirmation_method, $3::bigint, $4::uuid, $5) as id",
          [requestId, metodo, version, cleanerConfirmationId, motivo],
        ),
      );
      return rows[0]!.id;
    },
  };
}
