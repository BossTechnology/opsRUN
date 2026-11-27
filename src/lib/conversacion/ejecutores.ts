/**
 * Los ejecutores de la conversación (spec OPR-27 §5.3 a §5.5): `add_note`,
 * `send_email`, `send_text` y `discard_ai_draft`. Los llama `ejecutarAccion`,
 * el único camino, con el actor de la transacción.
 *
 * Cada uno escribe por una función SQL de la migración `20261130120000`, que
 * deja su Audit en la misma transacción. Un correo o un texto guarda una
 * instrucción `pending` con solo el crosswalk ID (el hilo o el equipo) y lo que
 * escribió el operador: nunca una dirección ni un teléfono leídos de PINCH
 * (P-2). Ya confirmada la transacción, pide la entrega; la respuesta al
 * navegador no espera el resultado (§5.3, paso 4).
 *
 * Nada sale solo: las únicas llamadas a `opsrun.send_email` y
 * `opsrun.send_text` están en este archivo, y las funciones SQL exigen un
 * operador. Una prueba (`nada-sale-solo.test.ts`) lo descubre en el disco.
 *
 * Las dependencias entran por `DependenciasDeEnvio`: aquí no hay base, puerto
 * ni Next. Las reales están en `reales.ts`.
 */
import { esNoDisponible } from "../bzzzbx/errores";
import type { CleanerTeam } from "../bzzzbx/tipos";
import type { Actor, Tx } from "../db/pool";
import type { ContextoAccion, EntradaAccion, ResultadoAccion } from "../acciones/tipos";

import { validarCuerpo } from "./composer";
import type { ModoComposer } from "./tipos";

export type DependenciasDeEnvio = {
  /** Escribe en opsRUN como `opsrun_app`, en una transacción, con el actor declarado. */
  escribir: <T>(actor: Actor, fn: (db: Tx) => Promise<T>) => Promise<T>;
  /** El equipo según BzzzBX; null si no lo conoce. Lanza `BzzzbxNoDisponible` si no responde. */
  equipo: (bzzzbxTeamId: string) => Promise<CleanerTeam | null>;
  /** Pide entregar una instrucción que ya existe en la base. Solo entrega: no crea nada. */
  entregar: (idempotencyKey: string) => void;
};

export type Ejecutor = (ctx: ContextoAccion, entrada: EntradaAccion) => Promise<ResultadoAccion>;

export type EjecutoresDeConversacion = {
  add_note: Ejecutor;
  send_email: Ejecutor;
  send_text: Ejecutor;
  discard_ai_draft: Ejecutor;
};

const rechazada = (codigo: string, mensaje: string): ResultadoAccion => ({ tipo: "rechazada", codigo, mensaje });

const CLAVE = /^[A-Za-z0-9_-]{8,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Los errores de las funciones SQL que el operador puede provocar (por código, nunca por clase). */
function traducir(e: unknown): ResultadoAccion {
  const codigo = (e as { code?: unknown } | null)?.code;
  switch (codigo) {
    case "22023":
      return rechazada("cuerpo_invalido", "That message is not valid.");
    case "OP006":
      return rechazada("no_encontrada", "Job not found.");
    case "OP009":
      return rechazada("hilo_invalido", "That email thread does not belong to this request.");
    case "OP010":
      return rechazada("borrador_invalido", "That AI draft is no longer available.");
    case "OP012":
      return rechazada("clave_repetida", "That message was already sent. Reload and try again.");
    case "42501":
      return rechazada("sin_actor", "Choose who is acting first.");
    default:
      throw e;
  }
}

/** Lo que `datos` trae de un envío, ya revisado. */
function leerEnvio(
  modo: ModoComposer,
  datos: Record<string, unknown>,
): { cuerpo: string; clave: string; borradorId: string | null } | ResultadoAccion {
  const cuerpo = validarCuerpo(modo, datos.body);
  if (!cuerpo.ok) return rechazada("cuerpo_invalido", cuerpo.razon);
  const clave = datos.idempotency_key;
  if (typeof clave !== "string" || !CLAVE.test(clave)) return rechazada("entrada_invalida", "That request is not valid.");
  const borrador = datos.ai_suggestion_id ?? null;
  if (borrador !== null && (typeof borrador !== "string" || !UUID.test(borrador))) {
    return rechazada("entrada_invalida", "That request is not valid.");
  }
  return { cuerpo: cuerpo.cuerpo, clave, borradorId: borrador };
}

const esRechazo = (valor: unknown): valor is ResultadoAccion => typeof valor === "object" && valor !== null && "tipo" in valor;

export function crearEjecutoresDeConversacion(deps: DependenciasDeEnvio): EjecutoresDeConversacion {
  /** Solo un operador escribe aquí; la función SQL lo vuelve a exigir (`require_operator`). */
  const operador = (ctx: ContextoAccion) => ctx.actor.tipo === "operador";
  const sinOperador = () => rechazada("sin_actor", "Only an operator can do this.");

  return {
    async add_note(ctx, entrada) {
      if (!operador(ctx)) return sinOperador();
      const cuerpo = validarCuerpo("note", entrada.datos.body);
      if (!cuerpo.ok) return rechazada("cuerpo_invalido", cuerpo.razon);
      try {
        await deps.escribir(ctx.actor, (db) =>
          db.query("select opsrun.add_note($1::uuid, $2::text)", [entrada.requestId, cuerpo.cuerpo]),
        );
      } catch (e) {
        return traducir(e);
      }
      return { tipo: "guardada" };
    },

    async send_email(ctx, entrada) {
      if (!operador(ctx)) return sinOperador();
      const envio = leerEnvio("customer", entrada.datos);
      if (esRechazo(envio)) return envio;
      // La respuesta va en el hilo del original (S-11); BzzzBX pone asunto y destinatarios.
      const hilo = ctx.ventana.hilos[0];
      if (!hilo) return rechazada("no_disponible", "No email thread for this request");
      try {
        await deps.escribir(ctx.actor, (db) =>
          db.query("select opsrun.send_email($1::uuid, $2::text, $3::text, $4::text, $5::uuid)", [
            entrada.requestId,
            hilo,
            envio.cuerpo,
            envio.clave,
            envio.borradorId,
          ]),
        );
      } catch (e) {
        return traducir(e);
      }
      deps.entregar(envio.clave);
      return { tipo: "instruccion", idempotency_key: envio.clave };
    },

    async send_text(ctx, entrada) {
      if (!operador(ctx)) return sinOperador();
      const envio = leerEnvio("cleaner", entrada.datos);
      if (esRechazo(envio)) return envio;
      const equipoId = ctx.ventana.equipoId;
      if (!equipoId) return rechazada("no_disponible", "Choose a cleaner first");
      // Que el equipo sea el del job lo valida el servidor con el puerto: la base no lee BzzzBX.
      try {
        if (!(await deps.equipo(equipoId))) return rechazada("no_disponible", "Choose a cleaner first");
      } catch (e) {
        if (esNoDisponible(e)) return rechazada("no_disponible", "BzzzBX unavailable");
        throw e;
      }
      try {
        await deps.escribir(ctx.actor, (db) =>
          db.query("select opsrun.send_text($1::uuid, $2::text, $3::text, $4::text, $5::uuid)", [
            entrada.requestId,
            equipoId,
            envio.cuerpo,
            envio.clave,
            envio.borradorId,
          ]),
        );
      } catch (e) {
        return traducir(e);
      }
      deps.entregar(envio.clave);
      return { tipo: "instruccion", idempotency_key: envio.clave };
    },

    async discard_ai_draft(ctx, entrada) {
      if (!operador(ctx)) return sinOperador();
      const id = entrada.datos.ai_suggestion_id;
      if (typeof id !== "string" || !UUID.test(id)) return rechazada("entrada_invalida", "That request is not valid.");
      try {
        await deps.escribir(ctx.actor, (db) => db.query("select opsrun.discard_ai_draft($1::uuid)", [id]));
      } catch (e) {
        return traducir(e);
      }
      return { tipo: "guardada" };
    },
  };
}
