/**
 * El registrador de alertas (spec OPR-34 §4, P-2 aprobada por Henry el
 * 2026-11-27): lee del puerto de BzzzBX qué alertas cambiaron y le pide a la base,
 * una por una, que anote su apertura, su cambio de nivel o su resolución
 * (`opsrun.upsert_alert_occurrence`, como actor de sistema `registrador_alertas`,
 * una transacción por alerta). Sin él no hay Resolved, ni repeticiones, ni
 * "Alert opened" en Audit.
 *
 * Si una alerta está abierta o cerrada lo dice BzzzBX; opsRUN solo anota lo que
 * ve. Quién la arregló y cómo lo decide la base con el Audit de opsRUN (§4.1).
 *
 * Corre en segundo plano, **dentro del único ciclo de fondo de opsRUN** (ADR
 * 0006), como la tarea `registrador_alertas` cada 15 s (`./tarea`, registrada en
 * `tareasDeOpsrun()`): nunca desde una consulta de lectura como
 * `/api/tablero/cambios` (lo vigilan `un-solo-ciclo.test.ts` y
 * `solo-en-segundo-plano.test.ts`). El ciclo garantiza una vuelta a la vez, así
 * que aquí no hay temporizador, límite propio ni `globalThis`; sí hay memoria
 * entre vueltas (el cursor), que vive en el cierre de la tarea. Provisional hasta
 * la read layer de OPR-22.
 *
 * Es pura respecto a sus dependencias (el puerto y los datos), que se piden en
 * cada vuelta: el stand-in de BzzzBX se reemplaza al reiniciarlo. Los errores del
 * puerto se reconocen por nombre, no con `instanceof` (Next empaqueta por
 * separado rutas y páginas).
 */
import { esCursorCaducado, esNoDisponible } from "../bzzzbx/errores";
import type { LecturaBzzzbx } from "../bzzzbx/puertos";
import type { AlertResult, Cursor, Leido, Message } from "../bzzzbx/tipos";

/** Lo que `upsert_alert_occurrence` recibe de cada alerta (§8.2). */
export type AlertaARegistrar = {
  bzzzbx_alert_id: string;
  /** La request que el servidor resolvió desde el sujeto (§3.2). */
  request_id: string;
  rule_id: string;
  rule_version: string;
  level: "amber" | "red";
  reason_text: string;
  /** Solo con sujeto `message`. */
  bzzzbx_message_id: string | null;
  opened_at: string;
  cleared_at: string | null;
};

/** Lo que el registrador lee y escribe en opsRUN. Las lecturas van una tras otra. */
export type DatosDelRegistrador = {
  /** Las requests que no están en Paid ni canceladas (pasada completa, por sujeto). */
  requestsActivas(): Promise<{ id: string; bzzzbx_job_id: string | null }[]>;
  /** Los hilos de esas requests (`request_message.bzzzbx_thread_id`), para las alertas de sus mensajes (pasada completa). */
  hilosActivos(): Promise<string[]>;
  /**
   * Los mensajes salientes vinculados a esas mismas requests (`request_message`, `direction = 'outbound'`): un texto no
   * tiene hilo, así que la pasada completa mira por aquí las alertas de los que fallaron (OPR-19, P-5).
   */
  mensajesSalientesActivos(): Promise<string[]>;
  /** Los `bzzzbx_alert_id` de las ocurrencias abiertas en opsRUN (pasada completa, por id). */
  alertasAbiertas(): Promise<string[]>;
  /** De esos ids de request, los que existen. */
  requestsExistentes(ids: string[]): Promise<Set<string>>;
  /** `bzzzbx_job_id` → id de la request. */
  requestsDeJobs(jobIds: string[]): Promise<Map<string, string>>;
  /** `bzzzbx_message_id` → id de la request (`request_message`). */
  requestsDeMensajes(messageIds: string[]): Promise<Map<string, string>>;
  /** `bzzzbx_thread_id` → id de la request (`request_message`). */
  requestsDeHilos(hilos: string[]): Promise<Map<string, string>>;
  /** `upsert_alert_occurrence` como actor de sistema; devuelve el id de la ocurrencia. */
  registrar(alerta: AlertaARegistrar): Promise<string>;
};

/** Lo que una vuelta usa. Se arma en cada vuelta. */
export type DependenciasDelRegistrador = {
  lectura: LecturaBzzzbx;
  datos: DatosDelRegistrador;
  log?: Pick<Console, "info" | "warn" | "error">;
  /** El reloj, en milisegundos; por defecto `Date.now`. Solo para el plazo del reintento (OPR-19, P-5). */
  ahora?: () => number;
};

export type ResultadoDeVuelta =
  | { estado: "ok"; completa: boolean; leidas: number; registradas: number; saltadas: number }
  | { estado: "no_disponible" }
  | { estado: "cursor_caducado" };

/**
 * Cuánto se reintenta una alerta de mensaje que todavía no lleva a ninguna request (OPR-19, P-5, S-8): un texto que
 * falla antes de que la reconciliación cree su `request_message`. Pasado el plazo se suelta con log.
 */
export const PLAZO_DE_REINTENTO_MS = 10 * 60_000;

/** Lotes de cambios que mira como mucho en una vuelta. */
export const LOTES_POR_VUELTA = 10;
/** Cuántos ids pide a `obtenerVarios` de una vez. */
const POR_LECTURA = 100;

/**
 * Códigos de la base que ningún reintento arregla: la alerta se salta con log y
 * no frena a las demás (§4, S-5). Cualquier otro error corta la pasada y se
 * reintenta con el mismo cursor.
 */
export const CODIGOS_QUE_SE_SALTAN: ReadonlySet<string> = new Set(["22023", "OP035", "OP036"]);

const codigoDe = (e: unknown): string | undefined => (e as { code?: unknown } | null)?.code as string | undefined;
const unicos = <T>(valores: T[]): T[] => [...new Set(valores)];

export function crearRegistrador(dependencias: () => DependenciasDelRegistrador) {
  /** Null al arrancar y tras `CursorCaducado`: la vuelta siguiente hace una pasada completa. */
  let cursor: Cursor | null = null;
  /** Para avisar una vez al caer y una al volver, no cada vuelta. */
  let caido = false;
  /** Alertas sin request ya avisadas: no se repite el log en cada vuelta (S-3). */
  const sinRequestAvisadas = new Set<string>();
  /**
   * Alertas de mensaje que todavía no llevan a ninguna request y cuándo se vieron la primera vez (OPR-19, P-5). En
   * memoria, como el cursor: si el proceso reinicia, la pasada completa las vuelve a ver por el mensaje de su request.
   */
  const sinRequestPorAhora = new Map<string, number>();

  async function leerPorId(lectura: LecturaBzzzbx, ids: string[]): Promise<Leido<AlertResult>[]> {
    const leidas: Leido<AlertResult>[] = [];
    // Uno tras otro: el puerto real puede ser una sola conexión.
    for (let i = 0; i < ids.length; i += POR_LECTURA) {
      leidas.push(...(await lectura.obtenerVarios("alert_result", ids.slice(i, i + POR_LECTURA))));
    }
    return leidas;
  }

  /**
   * La pasada completa (§4): por sujeto para las requests activas y por id para las ocurrencias abiertas. Además, por
   * sujeto mensaje para los mensajes de sus hilos: una alerta de mensaje que abrió mientras el cursor estaba caducado
   * (o antes de arrancar) no es de ningún sujeto request ni job, y sin esto nadie la vería hasta que cambiara.
   */
  async function pasadaCompleta({ lectura, datos }: DependenciasDelRegistrador): Promise<Leido<AlertResult>[]> {
    const alertas = new Map<string, Leido<AlertResult>>();
    for (const r of await datos.requestsActivas()) {
      for (const a of await lectura.listarPor("alert_result", { sujeto: { tipo: "request", request_id: r.id } })) alertas.set(a.bzzzbx_alert_id, a);
      if (r.bzzzbx_job_id) {
        for (const a of await lectura.listarPor("alert_result", { sujeto: { tipo: "job", bzzzbx_job_id: r.bzzzbx_job_id } })) {
          alertas.set(a.bzzzbx_alert_id, a);
        }
      }
    }
    for (const hilo of await datos.hilosActivos()) {
      for (const m of await lectura.listarPor("message", { bzzzbx_thread_id: hilo })) {
        for (const a of await lectura.listarPor("alert_result", { sujeto: { tipo: "message", bzzzbx_message_id: m.bzzzbx_message_id } })) {
          alertas.set(a.bzzzbx_alert_id, a);
        }
      }
    }
    // Los salientes que no llegaron de las requests activas: un texto no tiene hilo (OPR-19, P-5).
    const salientes = await datos.mensajesSalientesActivos();
    for (let i = 0; i < salientes.length; i += POR_LECTURA) {
      for (const m of await lectura.obtenerVarios("message", salientes.slice(i, i + POR_LECTURA))) {
        if (m.direction !== "outbound" || (m.delivery !== "failed" && m.delivery !== "bounced")) continue;
        for (const a of await lectura.listarPor("alert_result", { sujeto: { tipo: "message", bzzzbx_message_id: m.bzzzbx_message_id } })) {
          alertas.set(a.bzzzbx_alert_id, a);
        }
      }
    }
    const pendientes = (await datos.alertasAbiertas()).filter((id) => !alertas.has(id));
    for (const a of await leerPorId(lectura, pendientes)) alertas.set(a.bzzzbx_alert_id, a);
    return [...alertas.values()];
  }

  /** Las alertas que cambiaron desde el cursor, hasta `LOTES_POR_VUELTA` lotes. */
  async function cambiosDeAlertas(lectura: LecturaBzzzbx, desde: Cursor): Promise<{ ids: string[]; cursor: Cursor }> {
    const ids = new Set<string>();
    let actual = desde;
    for (let lotes = 0; lotes < LOTES_POR_VUELTA; lotes++) {
      const lote = await lectura.cambiosDesde(actual);
      for (const c of lote.cambios) if (c.entidad === "alert_result") ids.add(c.id);
      actual = lote.cursor;
      if (!lote.hay_mas) break;
    }
    return { ids: [...ids], cursor: actual };
  }

  /** §3.2: de qué request es cada alerta. Sin request, ninguna entrada. */
  async function requestsDe(
    { lectura, datos }: DependenciasDelRegistrador,
    alertas: Leido<AlertResult>[],
  ): Promise<Map<string, string>> {
    const porSujeto = <T extends AlertResult["sujeto"]["tipo"]>(tipo: T) =>
      alertas.flatMap((a) => (a.sujeto.tipo === tipo ? [a.sujeto as Extract<AlertResult["sujeto"], { tipo: T }>] : []));

    const requests = await datos.requestsExistentes(unicos(porSujeto("request").map((s) => s.request_id)));
    const porJob = await datos.requestsDeJobs(unicos(porSujeto("job").map((s) => s.bzzzbx_job_id)));
    const idsDeMensaje = unicos(porSujeto("message").map((s) => s.bzzzbx_message_id));
    const porMensaje = await datos.requestsDeMensajes(idsDeMensaje);

    // Un mensaje que opsRUN no tiene vinculado puede ser de un hilo de la request: se lee de BzzzBX su hilo.
    const hiloDe = new Map<string, string>();
    const sinVincular = idsDeMensaje.filter((id) => !porMensaje.has(id));
    for (let i = 0; i < sinVincular.length; i += POR_LECTURA) {
      const mensajes: Leido<Message>[] = await lectura.obtenerVarios("message", sinVincular.slice(i, i + POR_LECTURA));
      for (const m of mensajes) if (m.bzzzbx_thread_id) hiloDe.set(m.bzzzbx_message_id, m.bzzzbx_thread_id);
    }
    const porHilo = await datos.requestsDeHilos(unicos([...hiloDe.values()]));

    const resueltas = new Map<string, string>();
    for (const a of alertas) {
      const s = a.sujeto;
      const requestId =
        s.tipo === "request"
          ? requests.has(s.request_id)
            ? s.request_id
            : undefined
          : s.tipo === "job"
            ? porJob.get(s.bzzzbx_job_id)
            : (porMensaje.get(s.bzzzbx_message_id) ?? porHilo.get(hiloDe.get(s.bzzzbx_message_id) ?? ""));
      if (requestId) resueltas.set(a.bzzzbx_alert_id, requestId);
    }
    return resueltas;
  }

  /** Registra las alertas una por una, cada una en su transacción. Lanza ante un error que sí se reintenta. */
  async function registrar(deps: DependenciasDelRegistrador, alertas: Leido<AlertResult>[]) {
    const { datos, log = console } = deps;
    const ahora = (deps.ahora ?? Date.now)();
    const requests = await requestsDe(deps, alertas);
    let registradas = 0;
    let saltadas = 0;
    // Orden estable: la más vieja primero.
    for (const a of [...alertas].sort((x, y) => x.opened_at.localeCompare(y.opened_at) || x.bzzzbx_alert_id.localeCompare(y.bzzzbx_alert_id))) {
      const requestId = requests.get(a.bzzzbx_alert_id);
      if (!requestId) {
        // Sin request no se escribe nada (S-3): ni se muestra en ninguna parte.
        if (!sinRequestAvisadas.has(a.bzzzbx_alert_id)) {
          sinRequestAvisadas.add(a.bzzzbx_alert_id);
          log.warn(`[opsRUN] alertas: la alerta ${a.bzzzbx_alert_id} no es de ninguna request; no se registra`);
        }
        // Una alerta de mensaje puede llegar antes que el vínculo de su request: se reintenta un tiempo (OPR-19, P-5).
        if (a.sujeto.tipo === "message") {
          const desde = sinRequestPorAhora.get(a.bzzzbx_alert_id);
          if (desde === undefined) {
            sinRequestPorAhora.set(a.bzzzbx_alert_id, ahora);
          } else if (ahora - desde >= PLAZO_DE_REINTENTO_MS) {
            sinRequestPorAhora.delete(a.bzzzbx_alert_id);
            log.warn(`[opsRUN] alertas: la alerta ${a.bzzzbx_alert_id} sigue sin request tras ${PLAZO_DE_REINTENTO_MS / 60_000} min; se suelta`);
          }
        }
        saltadas += 1;
        continue;
      }
      try {
        await datos.registrar({
          bzzzbx_alert_id: a.bzzzbx_alert_id,
          request_id: requestId,
          rule_id: a.rule_id,
          rule_version: a.rule_version,
          level: a.level,
          reason_text: a.reason_text,
          bzzzbx_message_id: a.sujeto.tipo === "message" ? a.sujeto.bzzzbx_message_id : null,
          opened_at: a.opened_at,
          cleared_at: a.cleared_at,
        });
        sinRequestPorAhora.delete(a.bzzzbx_alert_id);
        registradas += 1;
      } catch (e) {
        const codigo = codigoDe(e);
        if (codigo && CODIGOS_QUE_SE_SALTAN.has(codigo)) {
          log.error(`[opsRUN] alertas: la base rechaza la alerta ${a.bzzzbx_alert_id} (${codigo}); se salta`);
          saltadas += 1;
          continue;
        }
        throw e;
      }
    }
    return { registradas, saltadas };
  }

  async function trabajar(deps: DependenciasDelRegistrador): Promise<ResultadoDeVuelta> {
    const { lectura } = deps;
    let alertas: Leido<AlertResult>[];
    let siguiente: Cursor;
    const completa = cursor === null;

    if (cursor === null) {
      // El cursor de "ahora" primero, la pasada después: lo que cambie durante la pasada sale en la vuelta
      // siguiente (a lo sumo se ve dos veces y la base es idempotente). El cursor se guarda solo si la pasada
      // termina; si no, la vuelta siguiente vuelve a empezar sin cursor.
      siguiente = (await lectura.cambiosDesde(null)).cursor;
      alertas = await pasadaCompleta(deps);
    } else {
      const cambios = await cambiosDeAlertas(lectura, cursor);
      siguiente = cambios.cursor;
      alertas = await leerPorId(lectura, cambios.ids);
    }

    // Las alertas de mensaje que esperan su request se vuelven a leer en cada vuelta, hasta que el vínculo aparezca o venza el plazo.
    const yaLeidas = new Set(alertas.map((a) => a.bzzzbx_alert_id));
    const porReintentar = [...sinRequestPorAhora.keys()].filter((id) => !yaLeidas.has(id));
    if (porReintentar.length > 0) {
      const releidas = await leerPorId(lectura, porReintentar);
      const vistas = new Set(releidas.map((a) => a.bzzzbx_alert_id));
      for (const id of porReintentar) if (!vistas.has(id)) sinRequestPorAhora.delete(id); // BzzzBX ya no la conoce
      alertas.push(...releidas);
    }

    const { registradas, saltadas } = await registrar(deps, alertas);
    cursor = siguiente;
    return { estado: "ok", completa, leidas: alertas.length, registradas, saltadas };
  }

  return {
    /** El cursor del registrador, para pruebas y diagnóstico. */
    get cursor(): Cursor | null {
      return cursor;
    },

    /**
     * Una vuelta; el ciclo decide cuándo y garantiza que no haya dos a la vez. Si
     * BzzzBX está caído no escribe nada ni avanza el cursor; si el cursor caducó,
     * lo deja en null para hacer la pasada completa en la vuelta siguiente. Cualquier
     * otro error (la base, por ejemplo) sube, con el cursor donde estaba.
     */
    async vuelta(): Promise<ResultadoDeVuelta> {
      const deps = dependencias();
      const log = deps.log ?? console;
      try {
        const resultado = await trabajar(deps);
        if (caido) {
          caido = false;
          log.info("[opsRUN] alertas: BzzzBX volvió");
        }
        return resultado;
      } catch (e) {
        if (esNoDisponible(e)) {
          if (!caido) {
            caido = true;
            log.warn("[opsRUN] alertas: BzzzBX no está disponible; el registrador espera");
          }
          return { estado: "no_disponible" };
        }
        if (esCursorCaducado(e)) {
          cursor = null;
          log.info("[opsRUN] alertas: el cursor caducó; se hace una pasada completa en la vuelta siguiente");
          return { estado: "cursor_caducado" };
        }
        throw e;
      }
    },
  };
}

export type Registrador = ReturnType<typeof crearRegistrador>;
