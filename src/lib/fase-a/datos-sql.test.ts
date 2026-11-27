// @vitest-environment node
/**
 * Enlace de la Fase A de punta a punta contra la base con la seed (spec Fase A
 * §8): el falso de BzzzBX, `datos-sql.ts` y las funciones SQL de la migración,
 * como opsrun_app y con el actor de la transacción.
 *
 * Corre con OPSRUN_REQUIERE_BASE=1 (el job de Postgres del CI). Todo pasa en
 * una transacción que se deshace al final: el E2E que viene después ve la
 * seed intacta. Para eso se conecta como el administrador local, se concede
 * opsrun_migrador (para preparar R2) y opsrun_app (para actuar como el
 * servidor), igual que las pruebas pgTAP.
 *
 * `OPSRUN_PRUEBA_ADMIN_URL` deja apuntar a otra base local (por ejemplo, una
 * temporal); si no, usa la del Supabase local.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { crearFalso, RelojManual } from "@/lib/bzzzbx/falso";
import { ajusteDeActor, type Actor } from "@/lib/db/pool";

import { urlsSupabaseLocal } from "../../../scripts/supabase-local.mjs";

import { crearDatosDeEnlace, type Ejecutar } from "./datos-sql";
import { confirmarEnlace, proponerEnlaces, rechazarEnlace } from "./enlace";

const R1 = "b0000000-0000-4000-8000-0000000000a1";
const R2 = "b0000000-0000-4000-8000-0000000000a2";
const OPERADOR_ID = "0a000000-0000-4000-8000-0000000000a1";
const AUTH = "5a000000-0000-4000-8000-0000000000f1";
const OPERADOR: Actor = { tipo: "operador", authUserId: AUTH };

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

conBase("Fase A contra la base: proponer, rechazar y confirmar", () => {
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

  beforeAll(async () => {
    const url = urlAdmin();
    expect(url, "Supabase local no responde a `supabase status`").not.toBeNull();
    cliente = new Client({ connectionString: url! });
    await cliente.connect();
    await cliente.query("begin");
    await cliente.query("grant opsrun_migrador to current_user with inherit true, set true");
    await cliente.query("grant opsrun_app to current_user with inherit false, set true");
    // R2 tiene details y sender; le falta el cleaner para el gate. Y el operador necesita login.
    await cliente.query("set local role opsrun_migrador");
    await cliente.query("update opsrun.operator set auth_user_id = $1 where id = $2", [AUTH, OPERADOR_ID]);
    await cliente.query(
      `insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
       values ($1, 'cleaner', 'phone', '{"bzzzbx_team_id": "bx-team-0001"}', $2)`,
      [R2, OPERADOR_ID],
    );
    await cliente.query("reset role");
  });

  afterAll(async () => {
    await cliente?.query("rollback").catch(() => {});
    await cliente?.end();
  });

  function deps() {
    // El reloj del falso en el día de hoy de la base: la seed usa current_date.
    const falso = crearFalso({ reloj: new RelojManual(new Date()) });
    return { lectura: falso.lectura, datos: crearDatosDeEnlace(ejecutar) };
  }

  it("propone para R2 el job de PINCH que encaja, y no los ya enlazados a otras requests", async () => {
    const { candidatos } = await proponerEnlaces(deps(), R2);
    expect(candidatos.map((c) => c.job.bzzzbx_job_id)).toEqual(["bx-job-0102", "bx-job-0105", "bx-job-0103"]);
    expect(candidatos[0].sugerido).toBe(true);
  });

  it("un rechazo queda en Audit y ese job ya no se propone para R2", async () => {
    const d = deps();
    await rechazarEnlace(d, { requestId: R2, bzzzbxJobId: "bx-job-0103", motivo: "Different date" }, OPERADOR);
    const { candidatos } = await proponerEnlaces(d, R2);
    expect(candidatos.map((c) => c.job.bzzzbx_job_id)).toEqual(["bx-job-0102", "bx-job-0105"]);
    const { rows } = await cliente.query(
      `select reason, actor_operator_id, details from opsrun.audit_event
        where request_id = $1 and event_type = 'job_link_rejected'`,
      [R2],
    );
    expect(rows).toEqual([{ reason: "Different date", actor_operator_id: OPERADOR_ID, details: { bzzzbx_job_id: "bx-job-0103" } }]);
  });

  it("sin el gate completo la base no enlaza R1, y lo dice como EnlaceInvalido", async () => {
    await expect(confirmarEnlace(deps(), { requestId: R1, bzzzbxJobId: "bx-job-0102" }, OPERADOR)).rejects.toMatchObject({
      codigo: "gate_incompleto",
    });
  });

  it("al confirmar, R2 queda Scheduled con el job y su Audit", async () => {
    await confirmarEnlace(deps(), { requestId: R2, bzzzbxJobId: "bx-job-0102" }, OPERADOR);
    const { rows } = await cliente.query(
      "select status, bzzzbx_job_id, job_number from opsrun.request where id = $1",
      [R2],
    );
    expect(rows).toEqual([{ status: "scheduled", bzzzbx_job_id: "bx-job-0102", job_number: "EX-00102" }]);
    const audit = await cliente.query(
      `select actor_operator_id, details from opsrun.audit_event
        where request_id = $1 and event_type = 'request_scheduled'`,
      [R2],
    );
    expect(audit.rows).toEqual([
      { actor_operator_id: OPERADOR_ID, details: { mode: "linked", bzzzbx_job_id: "bx-job-0102", job_number: "EX-00102" } },
    ]);
    expect(await proponerEnlaces(deps(), R2)).toEqual({ candidatos: [], truncado: false, motivo_vacio: "request_no_abierta" });
  });

  it("sin operador la base no enlaza", async () => {
    const d = deps();
    const sinActor = crearDatosDeEnlace((fn, o) => ejecutar(fn, { ...o, actor: undefined }));
    await expect(
      confirmarEnlace({ ...d, datos: sinActor }, { requestId: R1, bzzzbxJobId: "bx-job-0103" }, OPERADOR),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
