/**
 * Arma la pestaña Audit (spec OPR-35 §2): ordena, pone la persona, el
 * complemento por tipo y la hora en la zona de la operación. Pura: sin base,
 * sin puerto y sin reloj propio (`ahora` entra por parámetro).
 *
 * La pestaña descubre los tipos desde el catálogo (`label` viene de
 * `audit_event_type`); aquí solo se agregan complementos a los que los tienen.
 * Un tipo nuevo se ve solo, con su label, su persona y su motivo (S-9).
 */
import { horaConFecha } from "../tablero/formato";
import { SIN_VALOR } from "../tablero/tipos";

import { reglaConNombre } from "./reglas";
import {
  ENTIDADES_CON_NOMBRE,
  type EntidadConNombre,
  type FilaDeAudit,
  type FilaDeVista,
  type IdentificadoresDeAudit,
  type Nombres,
  type VistaAudit,
} from "./tipos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CROSSWALK = /^bx-/i;

/** Campos de la IA cuyo valor es un crosswalk ID, y la entidad del puerto que lo nombra. */
const ENTIDAD_DEL_CAMPO: Record<string, EntidadConNombre> = {
  property: "property",
  service: "service",
  cleaner_team: "cleaner_team",
};

const PERSONA_NO_OPERADOR = { system: "opsRUN", ai: "AI", bzzzbx: "BzzzBX" } as const;

const NIVEL = { amber: "Amber", red: "Red" } as const;
const RESOLUCION = {
  auto_cleared: "Cleared automatically",
  fixed_by_action: "Fixed by action",
  cleared_by_operator: "Cleared by operator",
} as const;
const METODO = { phone: "by phone", cleaner_text: "by text" } as const;

function persona(f: FilaDeAudit): string {
  if (f.actor_kind === "operator") return f.actor_nombre?.trim() || SIN_VALOR;
  return PERSONA_NO_OPERADOR[f.actor_kind];
}

/** Un valor de IA como lo ve el operador: nunca un crosswalk ID, un uuid ni JSON en crudo. */
function valorDeIA(campo: string | null, valor: unknown, nombres: Nombres): string {
  if (valor === null || valor === undefined) return SIN_VALOR;
  if (typeof valor === "number") return String(valor);
  if (typeof valor === "boolean") return valor ? "Yes" : "No";
  if (Array.isArray(valor)) {
    const partes = valor.map((v) => (typeof v === "object" ? SIN_VALOR : valorDeIA(campo, v, nombres)));
    return partes.length ? partes.join(", ") : SIN_VALOR;
  }
  if (typeof valor !== "string") return SIN_VALOR;
  const entidad = campo ? ENTIDAD_DEL_CAMPO[campo] : undefined;
  if (entidad) return nombres[entidad][valor] ?? SIN_VALOR;
  if (CROSSWALK.test(valor) || UUID.test(valor)) return SIN_VALOR;
  return valor.trim() || SIN_VALOR;
}

function complementoDeAlerta(f: FilaDeAudit): string | null {
  if (!f.alerta_regla) return null;
  const partes = [reglaConNombre(f.alerta_regla)];
  if (f.alerta_nivel) partes.push(NIVEL[f.alerta_nivel]);
  if (f.event_type === "alert_opened" && f.alerta_texto) partes.push(f.alerta_texto);
  if ((f.event_type === "alert_resolved" || f.event_type === "alert_cleared") && f.alerta_resolucion) {
    partes.push(RESOLUCION[f.alerta_resolucion]);
  }
  return `· ${partes.join(" · ")}`;
}

function complementoDeIA(f: FilaDeAudit, nombres: Nombres): string | null {
  if (!f.ia_campo_label && !f.ia_campo) return null;
  const campo = f.ia_campo_label ?? f.ia_campo;
  const propuesto = valorDeIA(f.ia_campo, f.ia_valor, nombres);
  if (f.event_type === "ai_suggestion_corrected") {
    return `· ${campo}: ${propuesto} → ${valorDeIA(f.ia_campo, f.ia_valor_final, nombres)}`;
  }
  return `· ${campo}: ${propuesto}`;
}

/** El complemento de §2.4 para un tipo, o null (la regla general: solo label, persona y motivo). */
function complemento(f: FilaDeAudit, nombres: Nombres): string | null {
  switch (f.event_type) {
    case "request_assigned":
      return f.a_operador ? `to ${f.a_operador}` : null;
    case "request_reassigned":
      return f.de_operador && f.a_operador ? `from ${f.de_operador} to ${f.a_operador}` : null;
    case "details_confirmed":
    case "sender_confirmed":
    case "cleaner_confirmed": {
      const metodo = f.metodo ? METODO[f.metodo as keyof typeof METODO] : undefined;
      return metodo ? `· ${metodo}` : null;
    }
    case "request_scheduled":
      if (!f.job_number) return null;
      return f.modo === "linked" ? `· linked to observed job ${f.job_number}` : `· job ${f.job_number}`;
    case "job_link_rejected": {
      if (!nombres.disponible) return `· job ${SIN_VALOR}`;
      const numero = f.bzzzbx_job_id ? nombres.job[f.bzzzbx_job_id] : undefined;
      return numero ? `· job ${numero}` : "· a proposed job";
    }
    case "alert_opened":
    case "alert_level_changed":
    case "alert_resolved":
    case "alert_cleared":
      return complementoDeAlerta(f);
    case "ai_analysis_completed":
      if (f.sugerencias === null) return null;
      return `· ${f.sugerencias} ${f.sugerencias === 1 ? "suggestion" : "suggestions"}`;
    case "ai_analysis_failed":
      return "· worked by hand";
    case "ai_suggestion_accepted":
    case "ai_suggestion_rejected":
    case "ai_suggestion_corrected":
      return complementoDeIA(f, nombres);
    case "instruction_failed": {
      const partes = [f.instruccion_label, f.instruccion_error].filter((p): p is string => Boolean(p));
      return partes.length ? `· ${partes.join(" · ")}` : null;
    }
    case "cleaner_asked":
    case "cleaner_replied":
    case "cleaner_declined":
      return `· ${(f.equipo_id && nombres.cleaner_team[f.equipo_id]) || SIN_VALOR}`;
    default:
      return null;
  }
}

/** Orden de §2.3: `occurred_at` y, a igual hora, `id`. Compara el instante, no el texto (los ids son bigint). */
function comparar(a: FilaDeAudit, b: FilaDeAudit): number {
  const ta = Date.parse(a.occurred_at);
  const tb = Date.parse(b.occurred_at);
  if (ta !== tb) return ta - tb;
  // Los microsegundos que `Date` no ve: el texto ISO de igual forma ordena igual.
  if (a.occurred_at !== b.occurred_at) return a.occurred_at < b.occurred_at ? -1 : 1;
  const ia = BigInt(a.id);
  const ib = BigInt(b.id);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/** "Times in EST": la abreviatura de la zona de la operación a esta hora. */
function etiquetaDeZona(zona: string, ahora: Date): string {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: zona, timeZoneName: "short" }).formatToParts(ahora);
  const abreviatura = partes.find((p) => p.type === "timeZoneName")?.value ?? zona;
  return `Times in ${abreviatura}`;
}

export type EntradaDeAudit = {
  filas: FilaDeAudit[];
  identificadores: IdentificadoresDeAudit;
  nombres: Nombres;
  zona: string;
  ahora: Date;
};

export function armarAudit({ filas, identificadores, nombres, zona, ahora }: EntradaDeAudit): VistaAudit {
  const ordenadas = [...filas].sort(comparar);
  const primeraAsignacion = ordenadas.find((f) => f.event_type === "request_assigned");
  const numero = identificadores.job_number?.trim() || SIN_VALOR;

  const vista: FilaDeVista[] = ordenadas.map((f) => {
    const original = f === primeraAsignacion;
    return {
      id: f.id,
      instante: new Date(f.occurred_at).toISOString(),
      hora: horaConFecha(f.occurred_at, ahora, zona),
      tipo: f.event_type,
      evento: f.label,
      complemento: complemento(f, nombres),
      original,
      observado: f.source === "bzzzbx_observed",
      persona: persona(f),
      motivo: f.reason?.trim() || null,
    };
  });

  return {
    request: `R${identificadores.r_number}`,
    jobNumber: numero,
    // P-7: el mismo valor que el Job number hasta revisarlo contra el User Guide §10.3.
    workAppNumber: numero,
    zona: etiquetaDeZona(zona, ahora),
    filas: vista,
  };
}

/** Lo que hay que pedir al puerto para nombrar lo de PINCH (§7.2), sin repetir. */
export function idsParaNombres(filas: FilaDeAudit[]): Record<EntidadConNombre, string[]> {
  const ids: Record<EntidadConNombre, Set<string>> = {
    job: new Set(),
    cleaner_team: new Set(),
    property: new Set(),
    service: new Set(),
  };
  for (const f of filas) {
    if (f.event_type === "job_link_rejected" && f.bzzzbx_job_id) ids.job.add(f.bzzzbx_job_id);
    if (f.equipo_id) ids.cleaner_team.add(f.equipo_id);
    const entidad = f.ia_campo ? ENTIDAD_DEL_CAMPO[f.ia_campo] : undefined;
    if (entidad) {
      for (const v of [f.ia_valor, f.ia_valor_final]) if (typeof v === "string") ids[entidad].add(v);
    }
  }
  const salida = {} as Record<EntidadConNombre, string[]>;
  for (const e of ENTIDADES_CON_NOMBRE) salida[e] = [...ids[e]];
  return salida;
}

/** Todo el texto de la vista en una cadena: para las pruebas de "nada interno" y "sin Zendesk". */
export function textoDeLaVista(v: VistaAudit): string {
  return [
    v.request,
    v.jobNumber,
    v.workAppNumber,
    v.zona,
    ...v.filas.flatMap((f) => [f.hora, f.evento, f.complemento, f.original ? "Original" : null, f.observado ? "Observed" : null, f.persona, f.motivo]),
  ]
    .filter((t): t is string => Boolean(t))
    .join("\n");
}
