// @vitest-environment node
/**
 * Las etapas de Clear alert a Validate contra la base con la seed (OPR-30 a
 * OPR-32, spec §10.2): R4 (In Progress) y R5 (Complete) de la seed recorren las
 * cinco acciones con `datos-sql.ts` y las funciones SQL de la migración, como
 * opsrun_app y con el actor de la transacción. También, el observador de hechos,
 * la lectura de la ventana y del tablero con lo que dejó Clear alert, y que la
 * lista de reglas limpiables del código sea la de la base.
 *
 * Corre con OPSRUN_REQUIERE_BASE=1 (el job de Postgres del CI). Todo pasa en una
 * transacción que se deshace al final: el E2E que viene después ve la seed
 * intacta. Para eso se conecta como el administrador local y se concede
 * opsrun_app (para actuar como el servidor), igual que las pruebas pgTAP.
 *
 * `OPSRUN_PRUEBA_ADMIN_URL` deja apuntar a otra base local (por ejemplo, una
 * temporal); si no, usa la del Supabase local.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { crearFalso } from "@/lib/bzzzbx/falso";
import { ajusteDeActor, type Actor } from "@/lib/db/pool";
import { crearJobDeLaRequest } from "@/lib/fotos/datos-sql";
import { crearDatosDelObservador } from "@/lib/observados/datos-sql";
import { leerFilas } from "@/lib/tablero/consultas";
import { leerDeOpsrun } from "@/lib/ventana/consultas";

import { urlsSupabaseLocal } from "../../../scripts/supabase-local.mjs";

import { crearDatosDeEtapas, type Ejecutar } from "./datos-sql";
import { REGLAS_LIMPIABLES } from "./reglas";
import type { InstantaneaDeAlerta } from "./tipos";

const R4 = "b0000000-0000-4000-8000-0000000000a4";
const R5 = "b0000000-0000-4000-8000-0000000000a5";
const R6 = "b0000000-0000-4000-8000-0000000000a6";
const OPS_UNO = "0a000000-0000-4000-8000-0000000000a1";
const FINANCE_UNO = "0a000000-0000-4000-8000-0000000000b1";
const UNO: Actor = { tipo: "operador", authUserId: "de000000-0000-4000-8000-0000000000a1" };
const FINANCE: Actor = { tipo: "operador", authUserId: "de000000-0000-4000-8000-0000000000b1" };

function urlAdmin(): string | null {
  if (process.env.OPSRUN_PRUEBA_ADMIN_URL) return process.env.OPSRUN_PRUEBA_ADMIN_URL;
  try {
    return urlsSupabaseLocal().admin;
  } catch {
    return null;
  }
}

const requiereBase = process.env.OPSRUN_REQUIERE_BASE === "1";
const conBase = requiereBase ? describe : describe.skip;

conBase("Las etapas contra la base: de Clear alert a Validate", () => {
  let cliente: Client;
  let llamada = 0;
  let cola: Promise<unknown> = Promise.resolve();

  /**
   * Como `comoOpsrunApp`, pero dentro de la transacción de la prueba, con un
   * savepoint por llamada. Un solo cliente: las llamadas van en fila.
   */
  const ejecutar: Ejecutar = (fn, opciones) => {
    const turno = cola.then(() => ejecutarUna(fn, opciones));
    cola = turno.catch(() => {});
    return turno;
  };

  const ejecutarUna: Ejecutar = async (fn, { actor } = {}) => {
    const punto = `llamada_${++llamada}`;
    await cliente.query(`savepoint ${punto}`);
    try {
      await cliente.query("set local role opsrun_app");
      const declarado = actor ? ajusteDeActor(actor) : null;
      await cliente.query("select set_config('opsrun.auth_user_id', $1, true), set_config('opsrun.system_actor', $2, true)", [
        declarado?.ajuste === "opsrun.auth_user_id" ? declarado.valor : "",
        declarado?.ajuste === "opsrun.system_actor" ? declarado.valor : "",
      ]);
      const resultado = await fn(cliente as never);
      await cliente.query("reset role");
      await cliente.query(`release savepoint ${punto}`);
      return resultado;
    } catch (e) {
      await cliente.query(`rollback to savepoint ${punto}`);
      await cliente.query("reset role");
      throw e;
    }
  };

  const version = async (id: string) =>
    (await cliente.query<{ v: string }>("select change_seq::text as v from opsrun.request where id = $1", [id])).rows[0]!.v;

  const eventos = async (id: string) =>
    (
      await cliente.query<{ event_type: string; actor_operator_id: string | null; reason: string | null; details: Record<string, unknown> }>(
        "select event_type, actor_operator_id, reason, details from opsrun.audit_event where request_id = $1 order by id",
        [id],
      )
    ).rows;

  /** La instantánea que leería el servidor en BzzzBX (el falso trae la de R4). */
  const alertaDeR4 = async (): Promise<InstantaneaDeAlerta> => {
    const a = (await crearFalso().lectura.obtener("alert_result", "bx-alert-0006"))!;
    return { bzzzbxAlertId: a.bzzzbx_alert_id, ruleId: a.rule_id, ruleVersion: a.rule_version, level: a.level, reasonText: a.reason_text, openedAt: a.opened_at };
  };

  beforeAll(async () => {
    const url = urlAdmin();
    expect(url, "Supabase local no responde a `supabase status`").not.toBeNull();
    cliente = new Client({ connectionString: url! });
    await cliente.connect();
    await cliente.query("begin");
    await cliente.query("grant opsrun_app to current_user with inherit false, set true");
    // Los helpers de opsrun_private solo los ejecuta su dueño: para leer clearable_rules se actúa como él.
    await cliente.query("grant opsrun_migrador to current_user with inherit false, set true");
  });

  afterAll(async () => {
    await cliente?.query("rollback").catch(() => {});
    await cliente?.end();
  });

  const datos = () => crearDatosDeEtapas(ejecutar);

  it("la lista de reglas limpiables del código es la de la base", async () => {
    await cliente.query("savepoint reglas");
    await cliente.query("set local role opsrun_migrador");
    const { rows } = await cliente.query<{ reglas: string[] }>("select opsrun_private.clearable_rules() as reglas");
    await cliente.query("reset role");
    await cliente.query("release savepoint reglas");
    expect([...rows[0]!.reglas].sort()).toEqual([...REGLAS_LIMPIABLES].sort());
  });

  it("R4 llega In Progress con su MEC-003 sin limpiar (solo trae resueltas las dos Delayed de la seed) y sin hechos del job", async () => {
    const fila = (await leerFilas(cliente as never)).find((f) => f.id === R4)!;
    expect(fila).toMatchObject({ status: "scheduled", approved_at: null, validated_at: null, entered_po_number: null, alertas_limpiadas: ["bx-alert-0002", "bx-alert-0009"] });
  });

  it("Clear alert: crea la ocurrencia con la instantánea, la resuelve, deja Audit con el motivo y la tarjeta y la ventana la descuentan", async () => {
    const alerta = await alertaDeR4();
    const antes = await version(R4);
    const id = await datos().limpiarAlerta({ requestId: R4, version: antes, alerta, motivo: "Large unit, called ahead." }, UNO);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const { rows } = await cliente.query(
      "select rule_id, level::text, reason_text, resolution::text, resolved_by, resolution_reason from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-0006'",
    );
    expect(rows).toEqual([
      {
        rule_id: "MEC-003",
        level: "amber",
        reason_text: "Running 45 min over the window.",
        resolution: "cleared_by_operator",
        resolved_by: OPS_UNO,
        resolution_reason: "Large unit, called ahead.",
      },
    ]);
    const cleared = (await eventos(R4)).filter((e) => e.event_type === "alert_cleared");
    expect(cleared).toEqual([
      expect.objectContaining({
        actor_operator_id: OPS_UNO,
        reason: "Large unit, called ahead.",
        details: { bzzzbx_alert_id: "bx-alert-0006", rule_id: "MEC-003" },
      }),
    ]);
    // Clear alert no toca la fila de la request: la versión es la misma.
    expect(await version(R4)).toBe(antes);

    // La lectura del tablero y la de la ventana ya la traen como limpiada (P-7).
    expect((await leerFilas(cliente as never)).find((f) => f.id === R4)!.alertas_limpiadas).toEqual(["bx-alert-0002", "bx-alert-0006", "bx-alert-0009"]);
    expect((await leerDeOpsrun(cliente as never, R4))!.fila.alertas_limpiadas).toEqual(["bx-alert-0002", "bx-alert-0006", "bx-alert-0009"]);

    // Otra vez la misma alerta: ya resuelta.
    await expect(datos().limpiarAlerta({ requestId: R4, version: await version(R4), alerta, motivo: "Again" }, UNO)).rejects.toMatchObject({
      codigo: "alerta_ya_resuelta",
    });
    // Una regla que no se limpia ni la crea.
    await expect(
      datos().limpiarAlerta({ requestId: R4, version: await version(R4), alerta: { ...alerta, bzzzbxAlertId: "bx-alert-x", ruleId: "OPS-001" }, motivo: "No" }, UNO),
    ).rejects.toMatchObject({ codigo: "alerta_no_limpiable" });
    expect((await cliente.query("select 1 from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-x'")).rowCount).toBe(0);
  });

  it("R4 de punta a punta: Mark as OSS, Approve, Enter PO y Validate dejan su Audit en orden, con su persona", async () => {
    const d = datos();
    await d.marcarOss({ requestId: R4, marca: "oss", version: await version(R4), motivo: null }, UNO);
    // Aprobado, la marca no cambia (P-12); y validar antes de aprobar no se puede.
    await expect(d.validar({ requestId: R4, version: await version(R4), poRequerido: false, poDelJob: null }, FINANCE)).rejects.toMatchObject({
      codigo: "sin_aprobar",
    });
    await d.aprobar({ requestId: R4, version: await version(R4) }, UNO);
    await expect(d.marcarOss({ requestId: R4, marca: "not_oss", version: await version(R4), motivo: null }, UNO)).rejects.toMatchObject({ codigo: "ya_aprobado" });
    await expect(d.aprobar({ requestId: R4, version: await version(R4) }, UNO)).rejects.toMatchObject({ codigo: "ya_aprobado" });
    await d.capturarPo({ requestId: R4, poNumber: "PO-EX-0004", version: await version(R4) }, UNO);
    await d.validar({ requestId: R4, version: await version(R4), poRequerido: true, poDelJob: null }, FINANCE);
    // Validado, el PO no cambia (P-13).
    await expect(d.capturarPo({ requestId: R4, poNumber: "PO-OTRO", version: await version(R4) }, UNO)).rejects.toMatchObject({ codigo: "ya_validado" });

    const lista = (await eventos(R4)).filter((e) => !["request_received", "request_assigned", "request_scheduled", "details_confirmed", "sender_confirmed", "cleaner_confirmed", "job_checked_in", "job_started", "alert_opened", "alert_resolved"].includes(e.event_type));
    expect(lista.map((e) => [e.event_type, e.actor_operator_id])).toEqual([
      ["alert_cleared", OPS_UNO],
      ["oss_marked", OPS_UNO],
      ["job_approved", OPS_UNO],
      ["po_entered", OPS_UNO],
      ["job_validated", FINANCE_UNO],
    ]);
    expect(lista[1]!.details).toEqual({ mark: "oss", previous_mark: null });
    expect(lista[3]!.details).toEqual({ po_number: "PO-EX-0004", previous_po_number: null });
    expect(lista[4]!.details).toEqual({ po_required: true, po_source: "opsrun", po_number: "PO-EX-0004" });

    // La ventana lee lo que quedó.
    const fila = (await leerDeOpsrun(cliente as never, R4))!.fila;
    expect(fila).toMatchObject({
      oss_mark: "oss",
      oss_source: "operator",
      entered_po_number: "PO-EX-0004",
      approved_by_nombre: "Ops Uno",
      validated_by_nombre: "Finance Uno",
    });
    expect(fila.approved_at).toMatch(/Z$/);
    expect(fila.validated_at).toMatch(/Z$/);
    expect(fila.entered_po_at).toMatch(/Z$/);
  });

  it("R5 (Complete, OSS automático): cambia la marca, aprueba y valida con el PO del job o sin él", async () => {
    const d = datos();
    // La marca automática es de la seed: el operador la cambia.
    expect((await cliente.query("select oss_source::text from opsrun.request where id = $1", [R5])).rows[0]).toEqual({ oss_source: "auto" });
    await expect(d.marcarOss({ requestId: R5, marca: "oss", version: await version(R5), motivo: null }, UNO)).rejects.toMatchObject({ codigo: "sin_cambios" });
    await d.marcarOss({ requestId: R5, marca: "not_oss", version: await version(R5), motivo: "Photos were fine" }, UNO);
    expect((await eventos(R5)).at(-1)).toMatchObject({ event_type: "oss_marked", reason: "Photos were fine", details: { mark: "not_oss", previous_mark: "oss" } });
    await d.aprobar({ requestId: R5, version: await version(R5) }, UNO);

    // El cliente exige PO y no hay ninguno: Add PO (OP027). Con el del job de PINCH, pasa y dice de dónde vino.
    await expect(d.validar({ requestId: R5, version: await version(R5), poRequerido: true, poDelJob: null }, FINANCE)).rejects.toMatchObject({ codigo: "falta_po" });
    expect((await eventos(R5)).some((e) => e.event_type === "job_validated")).toBe(false);
    await d.validar({ requestId: R5, version: await version(R5), poRequerido: true, poDelJob: "PO-EX-0005" }, FINANCE);
    expect((await eventos(R5)).at(-1)).toMatchObject({
      event_type: "job_validated",
      actor_operator_id: FINANCE_UNO,
      // El PO de PINCH desbloquea pero no se copia a Audit.
      details: { po_required: true, po_source: "pinch", po_number: null },
    });
  });

  it("una versión vieja es cambio_concurrente y no escribe; una request sin job es job_no_programado", async () => {
    const d = datos();
    const vieja = String(Number(await version(R6)) - 1);
    await expect(d.aprobar({ requestId: R6, version: vieja }, UNO)).rejects.toMatchObject({ codigo: "cambio_concurrente" });
    await expect(d.aprobar({ requestId: "b0000000-0000-4000-8000-0000000000a1", version: "1" }, UNO)).rejects.toMatchObject({ codigo: "job_no_programado" });
    await expect(d.aprobar({ requestId: "b0000000-0000-4000-8000-0000000000ff", version: "1" }, UNO)).rejects.toMatchObject({ codigo: "request_no_encontrada" });
  });

  it("sin actor o con uno que no existe, las funciones fallan con 42501 y no escriben", async () => {
    const sinActor = crearDatosDeEtapas((fn, o) => ejecutar(fn, { ...o, actor: undefined }));
    await expect(sinActor.aprobar({ requestId: R6, version: await version(R6) }, UNO)).rejects.toMatchObject({ code: "42501" });
    const fantasma = crearDatosDeEtapas(ejecutar);
    await expect(
      fantasma.aprobar({ requestId: R6, version: await version(R6) }, { tipo: "operador", authUserId: "de000000-0000-4000-8000-0000000000ee" }),
    ).rejects.toMatchObject({ code: "42501" });
    expect((await eventos(R6)).filter((e) => e.event_type === "job_approved")).toHaveLength(1); // el de la seed
  });

  it("R6 de la seed llega validada, con su job_validated, y su PO viene de PINCH", async () => {
    const fila = (await leerDeOpsrun(cliente as never, R6))!.fila;
    expect(fila).toMatchObject({ validated_by_nombre: "Finance Uno", entered_po_number: null, oss_mark: "not_oss" });
    expect(fila.validated_at).toMatch(/Z$/);
    expect((await eventos(R6)).filter((e) => e.event_type === "job_validated")).toHaveLength(1);
  });

  it("el observador escribe los hechos de R4 como actor de sistema, una vez; repetido no duplica; el job desconocido no escribe", async () => {
    const observador = crearDatosDelObservador(ejecutar);
    const antes = (await eventos(R4)).length;
    const hecho = { bzzzbxJobId: "bx-job-0004", tipo: "job_completed", bzzzbxEventId: "bx-evt-etapas-1", ocurridoEn: "2026-11-27T15:30:00.000Z" };
    expect(await observador.registrar(hecho)).toMatch(/^\d+$/);
    expect(await observador.registrar(hecho)).toBeNull();
    expect(await observador.registrar({ ...hecho, bzzzbxJobId: "bx-job-no-existe", bzzzbxEventId: "bx-evt-etapas-2" })).toBeNull();
    const despues = await eventos(R4);
    expect(despues.length).toBe(antes + 1);
    expect(despues.at(-1)).toMatchObject({ event_type: "job_completed", actor_operator_id: null, details: {} });
    // Un tipo que no es observado lo rechaza la base.
    await expect(observador.registrar({ ...hecho, tipo: "job_approved", bzzzbxEventId: "bx-evt-etapas-3" })).rejects.toMatchObject({ code: "22023" });
    expect(await observador.jobsEnlazados()).toEqual(expect.arrayContaining(["bx-job-0003", "bx-job-0004", "bx-job-0005", "bx-job-0006"]));
    expect((await observador.jobsEnlazados()).length).toBeGreaterThanOrEqual(4);
  });

  it("la lectura del job de la request (fotos) solo lee: R6 tiene job y R1, que no está programada, no", async () => {
    const jobDe = crearJobDeLaRequest(ejecutar);
    expect(await jobDe(R6)).toBe("bx-job-0006");
    expect(await jobDe("b0000000-0000-4000-8000-0000000000a1")).toBeNull();
    expect(await jobDe("b0000000-0000-4000-8000-0000000000ff")).toBeNull();
  });
});
