// @vitest-environment node
/**
 * Change linked job de R11 de punta a punta contra la base con la seed (OPR-29, spec §11.2). Corre solo con
 * OPSRUN_REQUIERE_BASE=1 (job de E2E del CI, base nueva), como las demás. Todo dentro de una transacción que se
 * deshace; las llamadas van como `opsrun_app`, con el actor declarado como lo hace el pool.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { crearFalso, RelojManual } from "@/lib/bzzzbx/falso";
import { ajusteDeActor, type Actor } from "@/lib/db/pool";

import { urlsSupabaseLocal } from "../../../scripts/supabase-local.mjs";

import { crearDatosDeEnlace, type Ejecutar } from "./datos-sql";
import { cambiarEnlaceDeJob, proponerEnlaces } from "./enlace";

const R11 = "b0000000-0000-4000-8000-000000000a11";
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

conBase("Change linked job de R11 contra la base", () => {
  let cliente: Client;
  let llamada = 0;
  let cola: Promise<unknown> = Promise.resolve();

  /** Como `comoOpsrunApp`, pero dentro de la transacción de la prueba, con un savepoint por llamada. Un solo cliente: en fila. */
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
    // El operador necesita login para declararse como actor.
    await cliente.query("set local role opsrun_migrador");
    await cliente.query("update opsrun.operator set auth_user_id = $1 where id = $2", [AUTH, OPERADOR_ID]);
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

  const request = async () =>
    (
      await cliente.query<{ status: string; bzzzbx_job_id: string; job_number: string; scheduled_at: string; change_seq: string }>(
        "select status::text, bzzzbx_job_id, job_number, scheduled_at::text, change_seq::text from opsrun.request where id = $1",
        [R11],
      )
    ).rows[0]!;

  it("R11 está Scheduled y enlazada a bx-job-0111, con las tres confirmaciones vigentes", async () => {
    expect(await request()).toMatchObject({ status: "scheduled", bzzzbx_job_id: "bx-job-0111", job_number: "EX-00111" });
    const { rows } = await cliente.query("select count(*)::int as n from opsrun.request_confirmation where request_id = $1 and superseded_at is null", [R11]);
    expect(rows[0]!.n).toBe(3);
  });

  it("propone bx-job-0112 y no el actual", async () => {
    const { candidatos, truncado } = await proponerEnlaces(deps(), R11, { paraCambio: true });
    expect(truncado).toBe(false);
    const ids = candidatos.map((c) => c.job.bzzzbx_job_id);
    expect(ids).toContain("bx-job-0112");
    expect(ids).not.toContain("bx-job-0111");
    // La misma propiedad y cliente en otro día: lo que dice el spec (§12).
    expect(candidatos.find((c) => c.job.bzzzbx_job_id === "bx-job-0112")!.coincide).toEqual(
      expect.arrayContaining(["misma_propiedad", "mismo_cliente", "mismo_equipo"]),
    );
  });

  it("con una versión vieja la base rechaza el cambio como cambio_concurrente, sin escribir", async () => {
    const antes = await request();
    await expect(
      cambiarEnlaceDeJob(deps(), { requestId: R11, version: String(Number(antes.change_seq) - 1), bzzzbxJobId: "bx-job-0112", motivo: "x" }, OPERADOR),
    ).rejects.toMatchObject({ codigo: "cambio_concurrente" });
    expect(await request()).toEqual(antes);
  });

  it("sin actor la base no cambia el job (42501)", async () => {
    const d = deps();
    const antes = await request();
    const sinActor = crearDatosDeEnlace((fn, o) => ejecutar(fn, { ...o, actor: undefined }));
    await expect(
      cambiarEnlaceDeJob({ ...d, datos: sinActor }, { requestId: R11, version: antes.change_seq, bzzzbxJobId: "bx-job-0112", motivo: "x" }, OPERADOR),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await request()).toEqual(antes);
  });

  it("cambia el job a bx-job-0112 sin salir de Scheduled, y deja su Audit con el motivo y los cuatro valores", async () => {
    const antes = await request();
    await cambiarEnlaceDeJob(
      deps(),
      { requestId: R11, version: antes.change_seq, bzzzbxJobId: "bx-job-0112", motivo: "PINCH cancelled the job and created another." },
      OPERADOR,
    );
    expect(await request()).toMatchObject({ status: "scheduled", bzzzbx_job_id: "bx-job-0112", job_number: "EX-00112", scheduled_at: antes.scheduled_at });
    const { rows } = await cliente.query(
      "select actor_operator_id, reason, details from opsrun.audit_event where request_id = $1 and event_type = 'job_relinked'",
      [R11],
    );
    expect(rows).toEqual([
      {
        actor_operator_id: OPERADOR_ID,
        reason: "PINCH cancelled the job and created another.",
        details: { from_bzzzbx_job_id: "bx-job-0111", from_job_number: "EX-00111", to_bzzzbx_job_id: "bx-job-0112", to_job_number: "EX-00112" },
      },
    ]);
    const confirmaciones = await cliente.query("select count(*)::int as n from opsrun.request_confirmation where request_id = $1 and superseded_at is null", [R11]);
    expect(confirmaciones.rows[0]!.n).toBe(3);
  });

  it("después, el job viejo ya no se propone para R11 y el nuevo es el actual", async () => {
    const { candidatos } = await proponerEnlaces(deps(), R11, { paraCambio: true });
    const ids = candidatos.map((c) => c.job.bzzzbx_job_id);
    expect(ids).not.toContain("bx-job-0111");
    expect(ids).not.toContain("bx-job-0112");
  });

  it("una request con hechos del job (aprobada) ya no cambia de job: OP040 como con_hechos_del_job", async () => {
    await cliente.query("set local role opsrun_migrador");
    await cliente.query("update opsrun.request set approved_at = now(), approved_by = $2 where id = $1", [R11, OPERADOR_ID]);
    await cliente.query("reset role");
    const actual = await request();
    await expect(
      cambiarEnlaceDeJob(deps(), { requestId: R11, version: actual.change_seq, bzzzbxJobId: "bx-job-0110", motivo: "x" }, OPERADOR),
    ).rejects.toMatchObject({ codigo: "con_hechos_del_job" });
    expect(await request()).toEqual(actual);
  });
});
