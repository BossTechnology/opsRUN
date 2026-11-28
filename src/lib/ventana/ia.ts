/**
 * Lo que la Job window lee del análisis de IA (spec OPR-36 §7): el último `ai_analysis`
 * de la request y sus sugerencias sin decidir de los campos de §4.1, la principal y sus
 * alternativas. Como `leerDeOpsrun`, corre como `opsrun_app` en solo lectura, en la misma
 * transacción y una consulta tras otra (un cliente de `pg` no corre dos a la vez). Una
 * lectura nunca escribe ni pide un análisis: este módulo no importa la tarea ni el puerto de IA
 * (`lib/analisis-ia/solo-en-segundo-plano.test.ts`). Va en su propio archivo para no tocar
 * `consultas.ts`.
 */
import type { AnalisisLeido, LecturaDeIa, SugerenciaLeida } from "../analisis-ia/tipos";
import { CAMPOS_DE_IA } from "../bzzzbx/tipos-ia";
import type { Tx } from "../db/pool";

import type { LeidosVentana } from "./tipos";

const iso = (columna: string) => `to_char(${columna} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** El último análisis de la request, el más reciente por hora de pedido. */
export const CONSULTA_ULTIMO_ANALISIS = `
select a.id::text as id, a.status::text as estado,
       ${iso("a.requested_at")} as requested_at,
       ${iso("a.completed_at")} as completed_at
from opsrun.ai_analysis as a
where a.request_id = $1::uuid
order by a.requested_at desc, a.id desc
limit 1`;

/** Las sugerencias sin decidir de los campos de §4.1, con sus alternativas. */
export const CONSULTA_SUGERENCIAS_DE_IA = `
select s.id::text as id, s.field as campo, s.rank::int as rank, s.value as valor, s.reason as razon
from opsrun.ai_suggestion as s
where s.request_id = $1::uuid
  and s.decision is null
  and s.field = any ($2::text[])
order by s.field, s.rank, s.created_at, s.id`;

export async function leerIa(db: Tx, requestId: string): Promise<LecturaDeIa> {
  const analisis = await db.query<AnalisisLeido>(CONSULTA_ULTIMO_ANALISIS, [requestId]);
  const sugerencias = await db.query<SugerenciaLeida>(CONSULTA_SUGERENCIAS_DE_IA, [requestId, [...CAMPOS_DE_IA]]);
  return { analisis: analisis.rows[0] ?? null, sugerencias: sugerencias.rows };
}

/** Los crosswalk IDs que proponen las sugerencias, por entidad, para leer sus nombres de BzzzBX (también los de las alternativas). */
export function idsProponidos(sugerencias: SugerenciaLeida[]) {
  const unicos = (v: (string | null | undefined)[]) => [...new Set(v.filter((x): x is string => typeof x === "string"))];
  const sender = sugerencias.filter((s) => s.campo === "sender").map((s) => s.valor as { bzzzbx_customer_id?: string; bzzzbx_contact_id?: string | null });
  return {
    propiedades: unicos(sugerencias.filter((s) => s.campo === "property").map((s) => s.valor as string)),
    servicios: unicos(sugerencias.filter((s) => s.campo === "service").map((s) => s.valor as string)),
    clientes: unicos(sender.map((s) => s.bzzzbx_customer_id)),
    contactos: unicos(sender.map((s) => s.bzzzbx_contact_id)),
  };
}

export type IdsProponidos = ReturnType<typeof idsProponidos>;

/** Nombre de cada crosswalk ID que BzzzBX leyó para la ventana. Nunca se guarda. */
export function nombresParaIa(leidos: LeidosVentana): Record<string, string> {
  const nombres: Record<string, string> = {};
  for (const p of leidos.properties) nombres[p.bzzzbx_property_id] = p.name;
  for (const s of leidos.services) nombres[s.bzzzbx_service_id] = s.name;
  for (const c of leidos.customers) nombres[c.bzzzbx_customer_id] = c.name;
  for (const c of leidos.contactos) nombres[c.bzzzbx_contact_id] = c.name;
  return nombres;
}
