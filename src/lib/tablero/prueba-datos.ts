/**
 * Datos de prueba del tablero: filas de `opsrun.request` como las de
 * `supabase/seed.sql` y lo que el falso de BzzzBX devuelve para ellas.
 * Solo para pruebas. Todo inventado.
 */
import { datosIniciales } from "../bzzzbx/falso/datos";

import type { FilaRequest, Leidos } from "./tipos";

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

const base = (ahora: Date, n: number): FilaRequest => ({
  id: `b0000000-0000-4000-8000-0000000000a${n}`,
  r_number: n,
  status: "open",
  received_at: new Date(ahora.getTime() - n * HORA).toISOString(),
  owner_operator_id: null,
  owner_display_name: null,
  bzzzbx_customer_id: null,
  bzzzbx_property_id: null,
  bzzzbx_space_id: null,
  unit: null,
  bzzzbx_service_id: null,
  service_date: null,
  window_start: null,
  window_end: null,
  po_number: null,
  bzzzbx_job_id: null,
  job_number: null,
  ended_manually_at: null,
  oss_mark: null,
  approved_at: null,
  bzzzbx_thread_id: `bx-thread-000${n}`,
});

const dia = (ahora: Date, d: number) => new Date(ahora.getTime() + d * DIA).toISOString().slice(0, 10);

const OPS_UNO = { owner_operator_id: "0a000000-0000-4000-8000-0000000000a1", owner_display_name: "Ops Uno" };
const OPS_DOS = { owner_operator_id: "0a000000-0000-4000-8000-0000000000a2", owner_display_name: "Ops Dos" };
const FIN_UNO = { owner_operator_id: "0a000000-0000-4000-8000-0000000000b1", owner_display_name: "Finance Uno" };

function programada(ahora: Date, n: number): Partial<FilaRequest> {
  return { status: "scheduled", bzzzbx_job_id: `bx-job-000${n}`, job_number: `EX-0000${n}` };
}

/** R1 a R6 de la seed. */
export function filasDeLaSeed(ahora: Date): FilaRequest[] {
  return [
    { ...base(ahora, 1), received_at: new Date(ahora.getTime() - 20 * MIN).toISOString(), bzzzbx_property_id: "bx-prop-0001", unit: "4B" },
    {
      ...base(ahora, 2), ...OPS_UNO, received_at: new Date(ahora.getTime() - 3 * HORA).toISOString(),
      bzzzbx_customer_id: "bx-cust-0001", bzzzbx_property_id: "bx-prop-0002", bzzzbx_space_id: "bx-space-0002", unit: "12",
      bzzzbx_service_id: "bx-svc-0001", service_date: dia(ahora, 2), window_start: "09:00", window_end: "12:00",
    },
    {
      ...base(ahora, 3), ...OPS_UNO, ...programada(ahora, 3), received_at: new Date(ahora.getTime() - 2 * DIA).toISOString(),
      bzzzbx_customer_id: "bx-cust-0001", bzzzbx_property_id: "bx-prop-0003", unit: "7C", bzzzbx_service_id: "bx-svc-0001",
      service_date: dia(ahora, 1), window_start: "10:00", window_end: "14:00", po_number: "PO-EX-0003",
    },
    {
      ...base(ahora, 4), ...OPS_DOS, ...programada(ahora, 4), received_at: new Date(ahora.getTime() - 3 * DIA).toISOString(),
      bzzzbx_customer_id: "bx-cust-0002", bzzzbx_property_id: "bx-prop-0004", bzzzbx_service_id: "bx-svc-0002",
      service_date: dia(ahora, 0), window_start: "08:00", window_end: "11:00",
    },
    {
      ...base(ahora, 5), ...OPS_DOS, ...programada(ahora, 5), received_at: new Date(ahora.getTime() - 5 * DIA).toISOString(),
      bzzzbx_customer_id: "bx-cust-0002", bzzzbx_property_id: "bx-prop-0005", unit: "2A", bzzzbx_service_id: "bx-svc-0001",
      service_date: dia(ahora, -1), window_start: "13:00", window_end: "16:00",
      ended_manually_at: new Date(ahora.getTime() - 20 * HORA).toISOString(), oss_mark: "oss",
    },
    {
      ...base(ahora, 6), ...FIN_UNO, ...programada(ahora, 6), received_at: new Date(ahora.getTime() - 9 * DIA).toISOString(),
      bzzzbx_customer_id: "bx-cust-0003", bzzzbx_property_id: "bx-prop-0006", bzzzbx_service_id: "bx-svc-0003",
      service_date: dia(ahora, -5), window_start: "09:00", window_end: "15:00",
      oss_mark: "not_oss", approved_at: new Date(ahora.getTime() - 4 * DIA).toISOString(),
    },
  ];
}

/** Todo lo del falso, como si se hubiera leído. */
export function leidosDelFalso(ahora: Date): Leidos {
  const d = datosIniciales(ahora);
  return {
    jobs: d.job,
    properties: d.property,
    customers: d.customer,
    services: d.service,
    eventos: d.jobtracker_event,
    mensajes: d.message,
    pagos: d.payment,
    alertas: d.alert_result,
    salud: d.job_health,
  };
}
