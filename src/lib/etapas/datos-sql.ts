/**
 * Lo que Clear alert, Mark as OSS, Approve & confirm, Enter PO y Validate
 * escriben en opsRUN, por SQL como opsrun_app (spec OPR-30 a OPR-32 §7.1). Las
 * escrituras van por las funciones de la migración
 * `20261203120000_etapas_in_progress_a_paid.sql`, con el actor de la transacción;
 * la base escribe el Audit en la misma transacción.
 */
import type { DatabaseError } from "pg";

import { comoOpsrunApp, type Actor, type Tx } from "@/lib/db/pool";

import { EtapaInvalida, type CodigoEtapaInvalida, type DatosDeEtapas } from "./tipos";

/** Cómo corre cada llamada: por defecto `comoOpsrunApp`; las pruebas pasan su propia transacción. */
export type Ejecutar = <T>(fn: (db: Tx) => Promise<T>, opciones?: { escritura?: boolean; actor?: Actor }) => Promise<T>;

/** Errores de las funciones SQL que el operador puede provocar, con su código de opsRUN. */
const CODIGOS_SQL: Record<string, CodigoEtapaInvalida> = {
  OP006: "request_no_encontrada",
  OP013: "cambio_concurrente",
  OP019: "job_no_programado",
  OP020: "alerta_no_limpiable",
  OP021: "alerta_de_otro_job",
  OP022: "alerta_ya_resuelta",
  OP023: "ya_aprobado",
  OP024: "sin_cambios",
  OP025: "ya_validado",
  OP026: "sin_aprobar",
  OP027: "falta_po",
  // El motivo de alert_cleared lo exige el trigger de Audit; la función ya lo pide antes (22023).
  OP002: "dato_invalido",
  "22023": "dato_invalido",
};

async function traducirErrores<T>(promesa: Promise<T>): Promise<T> {
  try {
    return await promesa;
  } catch (e) {
    const error = e as Partial<DatabaseError> | undefined;
    const codigo = CODIGOS_SQL[error?.code ?? ""];
    if (codigo) throw new EtapaInvalida(codigo);
    throw e;
  }
}

export function crearDatosDeEtapas(ejecutar: Ejecutar = (fn, opciones) => comoOpsrunApp(fn, opciones)): DatosDeEtapas {
  const escribir = <T>(actor: Actor, fn: (db: Tx) => Promise<T>) => traducirErrores(ejecutar(fn, { escritura: true, actor }));

  return {
    async limpiarAlerta({ requestId, version, alerta, motivo }, actor) {
      const { rows } = await escribir(actor, (db) =>
        db.query<{ id: string }>(
          `select opsrun.clear_alert($1::uuid, $2::bigint, $3, $4, $5, $6::opsrun.alert_level, $7, $8::timestamptz, $9) as id`,
          [requestId, version, alerta.bzzzbxAlertId, alerta.ruleId, alerta.ruleVersion, alerta.level, alerta.reasonText, alerta.openedAt, motivo],
        ),
      );
      return rows[0]!.id;
    },

    async marcarOss({ requestId, marca, version, motivo }, actor) {
      await escribir(actor, (db) =>
        db.query("select opsrun.mark_oss($1::uuid, $2::opsrun.oss_mark, $3::bigint, $4)", [requestId, marca, version, motivo]),
      );
    },

    async aprobar({ requestId, version }, actor) {
      await escribir(actor, (db) => db.query("select opsrun.approve_job($1::uuid, $2::bigint)", [requestId, version]));
    },

    async capturarPo({ requestId, poNumber, version }, actor) {
      await escribir(actor, (db) => db.query("select opsrun.enter_po($1::uuid, $2, $3::bigint)", [requestId, poNumber, version]));
    },

    async validar({ requestId, version, poRequerido, poDelJob }, actor) {
      await escribir(actor, (db) =>
        db.query("select opsrun.validate_job($1::uuid, $2::bigint, $3::boolean, $4)", [requestId, version, poRequerido, poDelJob]),
      );
    },
  };
}
