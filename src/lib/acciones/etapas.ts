/**
 * Ejecutores de Clear alert, Mark as OSS, Approve & confirm, Enter PO y Validate
 * (spec OPR-30, OPR-31 y OPR-32 §7.1). Los cinco pasan por `ejecutarAccion`, que
 * ya comprobó la disponibilidad, el motivo y la versión; aquí se revisan los
 * datos que vienen del navegador, se vuelve a leer en BzzzBX lo que la base no
 * debe creerle al navegador (la alerta, el job y el cliente) y se llama a la base
 * con el actor de la transacción. La función SQL deja el Audit en la misma
 * transacción.
 *
 * En la Fase A ninguna manda una instrucción a BzzzBX: son decisiones de opsRUN.
 * Los datos inválidos se rechazan **sin llamar a la base**.
 *
 * Las dependencias entran por una función para no cargar el módulo de servidor
 * (`server-only`, pool de la base) hasta que la acción corre de verdad.
 */
import { esNoDisponible } from "../bzzzbx/errores";
import type { LecturaBzzzbx } from "../bzzzbx/puertos";
import { esReglaLimpiable, PO_MAX } from "../etapas/reglas";
import { esEtapaInvalida, type CodigoEtapaInvalida, type DatosDeEtapas, type MarcaOss } from "../etapas/tipos";

import type { DefinicionAccion, ResultadoAccion } from "./tipos";

export const TEXTO_SIN_ALERTA = "No alert to clear";
export const TEXTO_YA_VALIDADO = "Already validated";
export const TEXTO_ADD_PO = "Add PO";

/** Lo que el operador lee cuando la acción no se pudo hacer. Nada se escribió. */
export const MENSAJES_DE_ETAPAS: Record<CodigoEtapaInvalida, string> = {
  request_no_encontrada: "Job not found.",
  cambio_concurrente: "This job changed. Review and try again.",
  job_no_programado: "This request has no job yet.",
  alerta_no_limpiable: "This alert can't be cleared here.",
  alerta_de_otro_job: "That alert is not from this job.",
  alerta_ya_resuelta: "This alert is already resolved.",
  ya_aprobado: "This job is already approved.",
  sin_cambios: "Nothing to change.",
  ya_validado: "This job is already validated.",
  sin_aprobar: "Approve the job first.",
  falta_po: TEXTO_ADD_PO,
  dato_invalido: "Check the value and try again.",
};

export const MENSAJE_SIN_ALERTA = "Choose an alert first.";
export const MENSAJE_SIN_MARCA = "Choose OSS or Not OSS first.";

type Dependencias = { datos: DatosDeEtapas; lectura: LecturaBzzzbx };
type ObtenerDependencias = () => Promise<Dependencias>;
type Ejecutor = NonNullable<DefinicionAccion["ejecutor"]>;

const rechazada = (codigo: string, mensaje: string): ResultadoAccion => ({ tipo: "rechazada", codigo, mensaje });
const rechazadaPorEtapa = (codigo: CodigoEtapaInvalida): ResultadoAccion => rechazada(codigo, MENSAJES_DE_ETAPAS[codigo]);

/** Los errores que el operador puede provocar son un resultado; el resto sube y `ejecutarAccion` lo registra. */
function comoResultado(e: unknown): ResultadoAccion {
  if (esEtapaInvalida(e)) return rechazadaPorEtapa(e.codigo);
  throw e;
}

/** Con BzzzBX caído a mitad de la acción: la lectura fresca no se pudo hacer, y no se escribe nada. */
const bzzzbxCaido = () => rechazada("bzzzbx_no_disponible", "BzzzBX unavailable");

/** El texto de un campo que llegó de `datos` (viene del navegador); null si no vino o no es texto. */
function textoDe(datos: Record<string, unknown>, clave: string): string | null {
  const valor = datos[clave];
  return typeof valor === "string" ? valor : null;
}

export function crearEjecutoresDeEtapas(
  obtener: ObtenerDependencias,
): Record<"clear_alert" | "mark_oss" | "approve_confirm" | "write_po" | "record_validation", Ejecutor> {
  return {
    clear_alert: async ({ actor, ventana }, entrada) => {
      const alertaId = textoDe(entrada.datos, "bzzzbx_alert_id")?.trim();
      if (!alertaId || alertaId.length > 200) return rechazada("alerta_no_elegida", MENSAJE_SIN_ALERTA);
      // El motivo es obligatorio y `ejecutarAccion` ya lo exigió; aquí no llega vacío.
      const motivo = entrada.motivo;
      if (!motivo) return rechazada("motivo_requerido", "A reason is required.");

      const { datos, lectura } = await obtener();
      // Se vuelve a leer la alerta en BzzzBX: tiene que existir, estar abierta y ser del job o de la request (P-5).
      let alerta;
      try {
        alerta = await lectura.obtener("alert_result", alertaId);
      } catch (e) {
        if (esNoDisponible(e)) return bzzzbxCaido();
        throw e;
      }
      const esDeLaRequest =
        alerta !== null &&
        ((alerta.sujeto.tipo === "job" && ventana.datos.bzzzbxJobId !== null && alerta.sujeto.bzzzbx_job_id === ventana.datos.bzzzbxJobId) ||
          (alerta.sujeto.tipo === "request" && alerta.sujeto.request_id === entrada.requestId));
      if (!alerta || !esDeLaRequest) return rechazadaPorEtapa("alerta_de_otro_job");
      if (alerta.cleared_at !== null) return rechazadaPorEtapa("alerta_ya_resuelta");
      if (!esReglaLimpiable(alerta.rule_id)) return rechazadaPorEtapa("alerta_no_limpiable");

      try {
        await datos.limpiarAlerta(
          {
            requestId: entrada.requestId,
            version: entrada.version,
            motivo,
            alerta: {
              bzzzbxAlertId: alerta.bzzzbx_alert_id,
              ruleId: alerta.rule_id,
              ruleVersion: alerta.rule_version,
              level: alerta.level,
              reasonText: alerta.reason_text,
              openedAt: alerta.opened_at,
            },
          },
          actor,
        );
        return { tipo: "guardada" };
      } catch (e) {
        return comoResultado(e);
      }
    },

    mark_oss: async ({ actor }, entrada) => {
      const marca: MarcaOss | null = entrada.datos.mark === "oss" || entrada.datos.mark === "not_oss" ? entrada.datos.mark : null;
      if (!marca) return rechazada("marca_no_elegida", MENSAJE_SIN_MARCA);
      try {
        await (await obtener()).datos.marcarOss({ requestId: entrada.requestId, marca, version: entrada.version, motivo: entrada.motivo }, actor);
        return { tipo: "guardada" };
      } catch (e) {
        return comoResultado(e);
      }
    },

    approve_confirm: async ({ actor }, entrada) => {
      try {
        await (await obtener()).datos.aprobar({ requestId: entrada.requestId, version: entrada.version }, actor);
        return { tipo: "guardada" };
      } catch (e) {
        return comoResultado(e);
      }
    },

    write_po: async ({ actor }, entrada) => {
      const po = textoDe(entrada.datos, "po_number")?.trim() ?? "";
      if (po === "" || po.length > PO_MAX) return rechazadaPorEtapa("dato_invalido");
      try {
        await (await obtener()).datos.capturarPo({ requestId: entrada.requestId, poNumber: po, version: entrada.version }, actor);
        return { tipo: "guardada" };
      } catch (e) {
        return comoResultado(e);
      }
    },

    record_validation: async ({ actor, ventana }, entrada) => {
      const jobId = ventana.datos.bzzzbxJobId;
      if (!jobId) return rechazadaPorEtapa("job_no_programado");
      const { datos, lectura } = await obtener();
      // Se vuelven a leer el job y el cliente en BzzzBX: si el cliente exige PO y no hay uno, no se sabe sin leerlo.
      let job;
      let cliente;
      try {
        job = await lectura.obtener("job", jobId);
        cliente = job ? await lectura.obtener("customer", job.bzzzbx_customer_id) : null;
      } catch (e) {
        if (esNoDisponible(e)) return bzzzbxCaido();
        throw e;
      }
      if (!job) return rechazada("job_no_encontrado", "BzzzBX doesn't know this job.");
      // Sin saber si el cliente exige PO no se valida (lo más conservador).
      if (!cliente) return rechazada("cliente_no_encontrado", "BzzzBX doesn't know this customer.");
      try {
        await datos.validar(
          { requestId: entrada.requestId, version: entrada.version, poRequerido: cliente.po_required, poDelJob: job.po_number },
          actor,
        );
        return { tipo: "guardada" };
      } catch (e) {
        return comoResultado(e);
      }
    },
  };
}
