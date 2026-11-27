// @vitest-environment node
/**
 * La lectura del Audit contra la base con la seed, como opsrun_app. Corre solo
 * con OPSRUN_REQUIERE_BASE=1 (job de E2E del CI, base nueva), como las del
 * tablero y la Job window. Con OPSRUN_DATABASE_URL se apunta a otra base.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

import { urlsSupabaseLocal } from "../../../scripts/supabase-local.mjs";
import { comoOpsrunApp, crearPool } from "../db/pool";

import { armarAudit, idsParaNombres, textoDeLaVista } from "./armar";
import { leerAudit, type Ejecutar } from "./consultas";
import { SIN_NOMBRES } from "./tipos";

function urlApp(): string | null {
  if (process.env.OPSRUN_DATABASE_URL) return process.env.OPSRUN_DATABASE_URL;
  try {
    return urlsSupabaseLocal().app;
  } catch {
    return null;
  }
}

const requiereBase = process.env.OPSRUN_REQUIERE_BASE === "1";
const url = requiereBase ? urlApp() : null;
const conBase = requiereBase ? describe : describe.skip;

const id = (n: number) => `b0000000-0000-4000-8000-0000000000a${n}`;

conBase("leerAudit contra la seed", () => {
  const origen = crearPool({ tipo: "url", url: url ?? "postgresql://sin-base" });
  afterAll(() => origen.end());

  /** `comoOpsrunApp` sobre el pool de la prueba, con un espía que ve con qué opciones la llaman. */
  function conEspia() {
    const espia = vi.fn(((fn, opciones) => comoOpsrunApp(fn, { ...opciones, origen })) as Ejecutar);
    return { ejecutar: espia as Ejecutar, espia };
  }
  const leer = (n: number | string) => leerAudit(typeof n === "number" ? id(n) : n, conEspia().ejecutar);

  it("R6: sus eventos en orden de tiempo, con nombres de operador, alertas y motivos", async () => {
    const { identificadores, filas } = await leer(6);
    expect(identificadores).toMatchObject({ job_number: "EX-00006" });
    expect(typeof identificadores!.r_number).toBe("number");

    // Lo que ve la pestaña, en orden: received, assigned, las tres confirmaciones, scheduled, check-in, completed…
    const tipos = filas.map((f) => f.event_type);
    expect(tipos).toEqual([
      "request_received",
      "request_assigned",
      "details_confirmed",
      "sender_confirmed",
      "cleaner_confirmed",
      "request_scheduled",
      "job_checked_in",
      "job_completed",
      // Misma hora (4 días atrás) para OSS, Approved y la alerta: se desempata por id.
      "oss_marked",
      "job_approved",
      "alert_opened",
      // Y a los 3 días el PO y la resolución de la alerta que él arregla.
      "po_entered",
      "alert_resolved",
      // OPR-32: Finance Uno la validó casi tres días atrás, antes de que se pagara.
      "job_validated",
      "job_paid",
    ]);
    // Ya viene del más viejo al más nuevo.
    const instantes = filas.map((f) => Date.parse(f.occurred_at));
    expect(instantes).toEqual([...instantes].sort((a, b) => a - b));

    const por = (t: string) => filas.find((f) => f.event_type === t)!;
    expect(por("request_assigned")).toMatchObject({ actor_nombre: "Finance Uno", a_operador: "Finance Uno", label: "Assigned" });
    expect(por("cleaner_confirmed")).toMatchObject({ metodo: "phone", actor_nombre: "Finance Uno" });
    expect(por("alert_opened")).toMatchObject({ alerta_regla: "TRN-005", alerta_nivel: "amber", alerta_texto: "Customer requires a PO." });
    expect(por("alert_resolved")).toMatchObject({ alerta_resolucion: "fixed_by_action", actor_nombre: "Finance Uno" });
    expect(por("po_entered")).toMatchObject({ instruccion_label: "Enter PO" });
    expect(por("job_paid")).toMatchObject({ source: "bzzzbx_observed", actor_kind: "bzzzbx", actor_nombre: null });
  });

  it("R5: el motivo de End manually y el de Alert cleared", async () => {
    const { filas } = await leer(5);
    expect(filas.find((f) => f.event_type === "job_ended_manually")).toMatchObject({
      reason: "Cleaner finished but the app did not sync.",
      actor_nombre: "Ops Dos",
    });
    expect(filas.find((f) => f.event_type === "alert_cleared")).toMatchObject({
      reason: "Large unit, cleaner called ahead.",
      alerta_regla: "MEC-003",
      alerta_resolucion: "cleared_by_operator",
      actor_nombre: "Ops Dos",
    });
  });

  it("R3: confirmaciones con su método y request_scheduled con su job number", async () => {
    const { filas } = await leer(3);
    expect(filas.filter((f) => f.event_type.endsWith("_confirmed")).map((f) => [f.event_type, f.metodo])).toEqual([
      ["details_confirmed", "operator"],
      ["sender_confirmed", "operator"],
      ["cleaner_confirmed", "phone"],
    ]);
    expect(filas.find((f) => f.event_type === "request_scheduled")).toMatchObject({ job_number: "EX-00003", modo: null });
  });

  it("R7: la historia previa al enlace (recibida, asignada y las tres confirmaciones), sin Scheduled", async () => {
    const { filas } = await leer(7);
    expect(filas.map((f) => f.event_type)).toEqual([
      "request_received",
      "request_assigned",
      "details_confirmed",
      "sender_confirmed",
      "cleaner_confirmed",
    ]);
    expect(filas[1]).toMatchObject({ a_operador: "Ops Dos" });
  });

  it("R1: análisis de IA con su número de sugerencias, y aceptada y corregida con el label del campo", async () => {
    const { filas } = await leer(1);
    const por = (t: string) => filas.find((f) => f.event_type === t)!;
    expect(por("ai_analysis_completed")).toMatchObject({ sugerencias: 5, actor_kind: "ai" });
    expect(por("ai_suggestion_accepted")).toMatchObject({ ia_campo: "property", ia_campo_label: "Property", ia_valor: "bx-prop-0001" });
    expect(por("ai_suggestion_corrected")).toMatchObject({ ia_campo: "beds", ia_campo_label: "Beds", ia_valor: 3, ia_valor_final: 2 });
  });

  it("de punta a punta con la seed: R6 armado no trae ids internos, de PINCH ni Zendesk", async () => {
    const { identificadores, filas } = await leer(6);
    const vista = armarAudit({
      filas,
      identificadores: identificadores!,
      nombres: SIN_NOMBRES,
      zona: "America/New_York",
      ahora: new Date(),
    });
    const texto = textoDeLaVista(vista);
    expect(texto).not.toMatch(/bx-/i);
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(texto.toLowerCase()).not.toContain("zendesk");
    expect(idsParaNombres(filas)).toEqual({ job: [], cleaner_team: [], property: [], service: [] });
  });

  it("los eventos de operación (sin request) no salen en ningún job", async () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      const { filas } = await leer(n);
      expect(filas.some((f) => f.event_type === "operator_added")).toBe(false);
    }
  });

  it("un uuid sin request da la lista vacía, sin error", async () => {
    expect(await leer("b0000000-0000-4000-8000-00000000ffff")).toEqual({ identificadores: null, filas: [] });
  });

  it("algo que no es un uuid da la lista vacía sin tocar la base", async () => {
    const { ejecutar, espia } = conEspia();
    expect(await leerAudit("no-es-uuid", ejecutar)).toEqual({ identificadores: null, filas: [] });
    expect(espia).not.toHaveBeenCalled();
  });

  it("llama a comoOpsrunApp sin `escritura` y sin `actor`: corre en `begin read only`", async () => {
    const { ejecutar, espia } = conEspia();
    await leerAudit(id(6), ejecutar);
    expect(espia).toHaveBeenCalledTimes(1);
    // Ni segundo argumento: nada de { escritura: true } ni de { actor }.
    expect(espia.mock.calls[0]!.length).toBe(1);
    expect(espia.mock.calls[0]![1]).toBeUndefined();
  });

  it("la transacción en la que corre es de solo lectura, y opsrun_app no puede escribir en Audit", async () => {
    // La misma transacción que abre `leerAudit` (sin opciones).
    const lectura = await comoOpsrunApp(
      async (db) => {
        const { rows } = await db.query<{ read_only: string; rol: string }>(
          "select current_setting('transaction_read_only') as read_only, current_user as rol",
        );
        return rows[0]!;
      },
      { origen },
    );
    expect(lectura).toEqual({ read_only: "on", rol: "opsrun_app" });

    // Y aunque la transacción dejara escribir, opsrun_app no tiene INSERT (G2).
    await expect(
      comoOpsrunApp(
        (db) =>
          db.query("insert into opsrun.audit_event (event_type, actor_kind, occurred_at) values ('request_received', 'system', now())"),
        { origen, escritura: true },
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
