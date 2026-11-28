// @vitest-environment node
/**
 * Assign y Confirm de punta a punta contra la base con la seed (OPR-28, spec
 * §9.2): R8 de la seed, sin dueño y sin confirmaciones, recorre Requests entera
 * con `datos-sql.ts` y las funciones SQL de la migración, como opsrun_app y con
 * el actor de la transacción; después se enlaza con bx-job-0108 en el falso de
 * BzzzBX.
 *
 * Corre con OPSRUN_REQUIERE_BASE=1 (el job de Postgres del CI). Todo pasa en
 * una transacción que se deshace al final: el E2E que viene después ve la seed
 * intacta. Para eso se conecta como el administrador local y se concede
 * opsrun_app (para actuar como el servidor), igual que las pruebas pgTAP.
 *
 * `OPSRUN_PRUEBA_ADMIN_URL` deja apuntar a otra base local (por ejemplo, una
 * temporal); si no, usa la del Supabase local.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { crearFalso, RelojManual } from "@/lib/bzzzbx/falso";
import { ajusteDeActor, type Actor } from "@/lib/db/pool";
import { confirmarEnlace, proponerEnlaces } from "@/lib/fase-a/enlace";
import { crearDatosDeEnlace } from "@/lib/fase-a/datos-sql";
import { leerParaConfirmar } from "@/lib/ventana/confirmar";

import { urlsSupabaseLocal } from "../../../scripts/supabase-local.mjs";

import { crearDatosDeRequests, type Ejecutar } from "./datos-sql";

const R8 = "b0000000-0000-4000-8000-0000000000a8";
const OPS_UNO = "0a000000-0000-4000-8000-0000000000a1";
const OPS_DOS = "0a000000-0000-4000-8000-0000000000a2";
const OPERADOR: Actor = { tipo: "operador", authUserId: "de000000-0000-4000-8000-0000000000a1" };

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

conBase("Assign y Confirm contra la base: R8 de punta a punta", () => {
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

  const version = async () =>
    (await cliente.query<{ v: string }>("select change_seq::text as v from opsrun.request where id = $1", [R8])).rows[0]!.v;

  const eventos = async () =>
    (
      await cliente.query<{ event_type: string; actor_operator_id: string | null; details: Record<string, unknown> }>(
        "select event_type, actor_operator_id, details from opsrun.audit_event where request_id = $1 order by id",
        [R8],
      )
    ).rows;

  beforeAll(async () => {
    const url = urlAdmin();
    expect(url, "Supabase local no responde a `supabase status`").not.toBeNull();
    cliente = new Client({ connectionString: url! });
    await cliente.connect();
    await cliente.query("begin");
    await cliente.query("grant opsrun_app to current_user with inherit false, set true");
  });

  afterAll(async () => {
    await cliente?.query("rollback").catch(() => {});
    await cliente?.end();
  });

  const datos = () => crearDatosDeRequests(ejecutar);

  it("R8 llega sin dueño ni confirmaciones, con el borrador completo y la sugerencia de la propiedad abierta", async () => {
    const { rows } = await cliente.query(
      `select owner_operator_id, status::text,
              (select count(*)::int from opsrun.request_confirmation where request_id = r.id) as confirmaciones
         from opsrun.request as r where id = $1`,
      [R8],
    );
    expect(rows).toEqual([{ owner_operator_id: null, status: "open", confirmaciones: 0 }]);
    const { sugerencias, respuestaDelCleaner } = await ejecutar((db) => leerParaConfirmar(db, R8));
    expect(sugerencias).toEqual([{ campo: "property", razon: "Address in the email matches the property." }]);
    expect(respuestaDelCleaner).toBeNull();
  });

  it("una versión vieja se rechaza como cambio_concurrente, y un operador que no existe como operador_invalido", async () => {
    await expect(datos().confirmarDetalles({ requestId: R8, version: "1" }, OPERADOR)).rejects.toMatchObject({
      name: "RequestInvalida",
      codigo: "cambio_concurrente",
    });
    await expect(
      datos().asignar({ requestId: R8, operatorId: "0a000000-0000-4000-8000-0000000000ee", version: await version(), motivo: null }, OPERADOR),
    ).rejects.toMatchObject({ codigo: "operador_invalido" });
  });

  it("sin operador la base no asigna ni confirma", async () => {
    const sinActor = crearDatosDeRequests((fn, o) => ejecutar(fn, { ...o, actor: undefined }));
    await expect(sinActor.asignar({ requestId: R8, operatorId: OPS_UNO, version: await version(), motivo: null }, OPERADOR)).rejects.toMatchObject({
      code: "42501",
    });
    await expect(sinActor.confirmarSender({ requestId: R8, version: await version() }, OPERADOR)).rejects.toMatchObject({ code: "42501" });
  });

  it("asignar, reasignar, tres confirmaciones y enlazar con bx-job-0108: R8 queda Scheduled y Audit lo cuenta en orden", async () => {
    const d = datos();
    await d.asignar({ requestId: R8, operatorId: OPS_UNO, version: await version(), motivo: null }, OPERADOR);
    await expect(d.asignar({ requestId: R8, operatorId: OPS_UNO, version: await version(), motivo: null }, OPERADOR)).rejects.toMatchObject({
      codigo: "ya_es_dueno",
    });
    await d.asignar({ requestId: R8, operatorId: OPS_DOS, version: await version(), motivo: "Covering" }, OPERADOR);

    const idDetalles = await d.confirmarDetalles({ requestId: R8, version: await version() }, OPERADOR);
    await expect(d.confirmarDetalles({ requestId: R8, version: await version() }, OPERADOR)).rejects.toMatchObject({ codigo: "ya_confirmada" });
    await d.confirmarSender({ requestId: R8, version: await version() }, OPERADOR);
    await d.confirmarCleaner({ requestId: R8, metodo: "phone", cleanerConfirmationId: null, version: await version(), motivo: "Called" }, OPERADOR);

    // La confirmación guarda los valores del borrador y crosswalk IDs, calculados por la base.
    const { rows } = await cliente.query<{ confirmed_value: Record<string, unknown> }>(
      "select confirmed_value from opsrun.request_confirmation where id = $1",
      [idDetalles],
    );
    expect(rows[0]!.confirmed_value).toMatchObject({ bzzzbx_property_id: "bx-prop-0005", bzzzbx_service_id: "bx-svc-0002", unit: "5D", beds: 2 });

    // La sugerencia de la propiedad se cerró como aceptada.
    expect((await ejecutar((db) => leerParaConfirmar(db, R8))).sugerencias).toEqual([]);

    // El gate se cumple: el enlace de la Fase A deja la request Scheduled con el job de R8.
    const falso = crearFalso({ reloj: new RelojManual(new Date()) });
    const enlace = { lectura: falso.lectura, datos: crearDatosDeEnlace(ejecutar) };
    const { candidatos } = await proponerEnlaces(enlace, R8);
    expect(candidatos.map((c) => c.job.bzzzbx_job_id)).toEqual(["bx-job-0108"]);
    expect(candidatos[0]!.sugerido).toBe(true);
    await confirmarEnlace(enlace, { requestId: R8, bzzzbxJobId: "bx-job-0108" }, OPERADOR);

    const estado = await cliente.query("select status::text, bzzzbx_job_id, job_number from opsrun.request where id = $1", [R8]);
    expect(estado.rows).toEqual([{ status: "scheduled", bzzzbx_job_id: "bx-job-0108", job_number: "EX-00108" }]);

    expect((await eventos()).map((e) => [e.event_type, e.actor_operator_id])).toEqual([
      ["request_received", null],
      // La OPS-001 de R8 que la seed ya trae anotada (bx-alert-0005, OPR-34).
      ["alert_opened", null],
      ["request_assigned", OPS_UNO],
      ["request_reassigned", OPS_UNO],
      ["details_confirmed", OPS_UNO],
      ["ai_suggestion_accepted", OPS_UNO],
      ["sender_confirmed", OPS_UNO],
      ["cleaner_confirmed", OPS_UNO],
      ["request_scheduled", OPS_UNO],
    ]);
    // Programada, ya no se asigna ni se confirma.
    await expect(d.asignar({ requestId: R8, operatorId: OPS_UNO, version: await version(), motivo: null }, OPERADOR)).rejects.toMatchObject({
      codigo: "request_no_abierta",
    });
  });
});
