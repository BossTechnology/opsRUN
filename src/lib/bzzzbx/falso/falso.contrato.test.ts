// @vitest-environment node
/**
 * El falso en memoria cumple los contratos de lectura y de instrucciones, los
 * mismos que correrá el real de OPR-6 (`../real.contrato.test.ts`).
 */
import { probarContratoDeInstrucciones } from "../contrato/instrucciones.contrato";
import { probarContratoDeLectura } from "../contrato/lectura.contrato";

import { crearFalso, RelojManual } from ".";

probarContratoDeLectura("falso en memoria", async () => {
  const falso = crearFalso();
  return {
    lectura: falso.lectura,
    conocidos: {
      job: "bx-job-0004",
      assignment: "bx-asg-0004",
      customer: "bx-cust-0001",
      contact: "bx-cont-0001",
      property: "bx-prop-0001",
      cleaner_team: "bx-team-0001",
      service: "bx-svc-0001",
      jobtracker_event: "bx-evt-0001",
      photo: "bx-photo-0001",
      message: "bx-msg-0001",
      payment: "bx-job-0006",
      alert_result: "bx-alert-0001",
      job_health: "bx-job-0004",
    },
    relaciones: {
      assignment: { bzzzbx_job_id: "bx-job-0004" },
      contact: { bzzzbx_customer_id: "bx-cust-0002" },
      jobtracker_event: { bzzzbx_job_id: "bx-job-0004" },
      photo: { bzzzbx_job_id: "bx-job-0006" },
      message: { bzzzbx_thread_id: "bx-thread-0002" },
      alert_result: { sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0004" } },
    },
    jobConPropiedad: { bzzzbx_job_id: "bx-job-0004", bzzzbx_property_id: "bx-prop-0004" },
    cambio: {
      entidad: "job_health",
      id: "bx-job-0004",
      provocar: async () => falso.lectura.cambiar("job_health", "bx-job-0004", { status: "breached" }),
    },
  };
});

probarContratoDeInstrucciones("falso en memoria", async () => {
  const reloj = new RelojManual();
  const falso = crearFalso({ reloj });
  return {
    instrucciones: falso.instrucciones,
    instruccionValida: (idempotency_key) => ({
      idempotency_key,
      tipo: "send_text",
      payload: { bzzzbx_team_id: "bx-team-0001", body: "Can you confirm the job?" },
      actor: { tipo: "operator", operator_id: "0a000000-0000-4000-8000-0000000000a1" },
      sujeto: { bzzzbx_job_id: "bx-job-0003" },
    }),
    esperar: async () => reloj.adelantar(falso.instrucciones.pasoMs),
  };
});
