/**
 * El registro de acciones (spec OPR-26 §5.3 y §5.4). Una entrada por acción de
 * la action bar. Los nombres son provisionales hasta OPR-4 (P-5): son los
 * `label` de los catálogos `instruction_type` y `audit_event_type` de OPR-20,
 * y se cambian aquí sin migrar datos.
 *
 * En OPR-26 ninguna tiene ejecutor: todas las de V1.1 beta salen
 * `sin_construir` (OPR-28 ya registró los de `schedule` y `reject_job_link`). Cada tarjeta de etapa (OPR-28 a OPR-32) agrega a su entrada
 * el `ejecutor` (y el `panel` si necesita campos propios) y pasa a `disponible`.
 * En la Fase A, las que se hacen en las herramientas de PINCH (crear,
 * reprogramar o cancelar el job) registran la decisión en opsRUN y opsRUN
 * observa el resultado; eso lo decide el ejecutor de cada tarjeta.
 *
 * `necesitaBzzzbx`: la acción lee de BzzzBX o manda una instrucción. Las que
 * solo escriben una decisión en opsRUN (asignar, confirmar, aprobar, marcar
 * OSS, limpiar una alerta) siguen disponibles con BzzzBX caído (S-13).
 */
import { disponibilidadDelComposer } from "../conversacion/composer";
import type { Etapa } from "../tablero/tipos";

import { crearEjecutoresDeEnlace } from "./enlace";
import type { DefinicionAccion } from "./tipos";

/** La conversación (OPR-27): los ejecutores reales se cargan al usarlos; así este registro no arrastra la base al navegador. */
const conversacion = () => import("../conversacion/reales").then((m) => m.ejecutoresReales);
const TODAS_LAS_ETAPAS: Etapa[] = ["requests", "scheduled", "in_progress", "complete", "validation"];

// OPR-28: el enlace de la Fase A. El módulo de servidor se carga al correr, no al importar el registro.
const enlace = crearEjecutoresDeEnlace(async () => (await import("../ventana/servidor")).dependenciasDeEnlaceDeLaVentana());

export const REGISTRO_DE_ACCIONES: DefinicionAccion[] = [
  // Requests (OPR-28)
  {
    codigo: "assign",
    etiqueta: "Assign / Reassign",
    descripcion: "Set who owns this request.",
    etapas: ["requests"],
    enRelease: true,
    motivo: "no",
    necesitaBzzzbx: false,
  },
  {
    codigo: "confirm_details",
    etiqueta: "Confirm details",
    descripcion: "Confirm the property, space and service of the request.",
    etapas: ["requests"],
    enRelease: true,
    motivo: "no",
    necesitaBzzzbx: false,
  },
  {
    codigo: "confirm_sender",
    etiqueta: "Confirm sender",
    descripcion: "Confirm who the request is from.",
    etapas: ["requests"],
    enRelease: true,
    motivo: "no",
    necesitaBzzzbx: false,
  },
  {
    codigo: "confirm_cleaner",
    etiqueta: "Confirm cleaner",
    descripcion: "Confirm the cleaner for the job.",
    etapas: ["requests"],
    enRelease: true,
    motivo: "no",
    necesitaBzzzbx: false,
  },
  {
    codigo: "ask_cleaner",
    etiqueta: "Ask cleaner",
    descripcion: "Text the cleaner to ask if they can take the job.",
    etapas: ["requests"],
    enRelease: true,
    motivo: "no",
    necesitaBzzzbx: true,
    bloqueo: (v) => (v.datos.tienePropiedad ? null : "Choose a property first"),
  },
  {
    // En la Fase A abre el enlace con el job observado (§7.2).
    codigo: "schedule",
    etiqueta: "Schedule",
    descripcion: "Link this request to the job created in the PINCH tools. Choose the job in the list on the property tab.",
    etapas: ["requests"],
    enRelease: true,
    motivo: "no",
    necesitaBzzzbx: true,
    bloqueo: (v) => {
      if (!v.datos.tienePropiedad) return "Choose a property first";
      if (!v.gate.sender) return "Confirm who it is from first";
      return null;
    },
    ejecutor: enlace.schedule,
  },
  {
    // Interna: el rechazo de un candidato del enlace (§7.2). No sale en la action bar.
    codigo: "reject_job_link",
    etiqueta: "Reject job link",
    descripcion: "Say that a proposed job is not the one for this request.",
    etapas: ["requests"],
    enRelease: true,
    motivo: "opcional",
    necesitaBzzzbx: false,
    interna: true,
    ejecutor: enlace.reject_job_link,
  },
  // Scheduled (OPR-29)
  {
    codigo: "reschedule_job",
    etiqueta: "Reschedule",
    descripcion: "Move the job to another date or window.",
    etapas: ["scheduled"],
    enRelease: true,
    motivo: "obligatorio",
    necesitaBzzzbx: true,
  },
  {
    codigo: "cancel_job",
    etiqueta: "Cancel job",
    descripcion: "Cancel the job.",
    etapas: ["scheduled"],
    enRelease: true,
    motivo: "obligatorio",
    necesitaBzzzbx: true,
  },
  // In Progress (OPR-30)
  {
    codigo: "clear_alert",
    etiqueta: "Clear alert",
    descripcion: "Clear an open alert of this job, with a reason.",
    etapas: ["in_progress"],
    enRelease: true,
    motivo: "obligatorio",
    necesitaBzzzbx: false,
  },
  {
    codigo: "end_job_manually",
    etiqueta: "End manually",
    descripcion: "Mark the job as ended when the cleaner's app did not.",
    etapas: ["in_progress"],
    enRelease: true,
    motivo: "obligatorio",
    necesitaBzzzbx: true,
  },
  // Complete (OPR-31)
  {
    codigo: "approve_confirm",
    etiqueta: "Approve & confirm",
    descripcion: "Approve the finished job and send it to Validation.",
    etapas: ["complete"],
    enRelease: true,
    motivo: "no",
    necesitaBzzzbx: false,
  },
  {
    codigo: "mark_oss",
    etiqueta: "Mark as OSS / Not OSS",
    descripcion: "Mark whether the job was done on-site service.",
    etapas: ["complete"],
    enRelease: true,
    motivo: "no",
    necesitaBzzzbx: false,
  },
  {
    // No entra en V1.1 beta: se ve en gris y no corre (principio 6).
    codigo: "reject_reclean",
    etiqueta: "Reject · re-clean",
    descripcion: "Reject the job and ask for a re-clean.",
    etapas: ["complete"],
    enRelease: false,
    motivo: "no",
    necesitaBzzzbx: true,
  },
  // Validation (OPR-32)
  {
    codigo: "write_po",
    etiqueta: "Enter PO",
    descripcion: "Write the PO number on the job.",
    etapas: ["validation"],
    enRelease: true,
    motivo: "no",
    necesitaBzzzbx: true,
  },
  {
    codigo: "record_validation",
    etiqueta: "Validate",
    descripcion: "Record that the job was validated.",
    etapas: ["validation"],
    enRelease: true,
    motivo: "no",
    necesitaBzzzbx: true,
    bloqueo: (v) => (v.datos.poRequerido && !v.datos.tienePo ? "Add PO" : null),
  },
  // Conversación (OPR-27). Internas: las usa el Composer, no la action bar. No dependen
  // del estado de la request (P-6): una nota o un mensaje no se rechaza porque alguien
  // asignó la request. Con el job cancelado no aplican (etapa `cancelled`).
  {
    codigo: "add_note",
    etiqueta: "Add note",
    descripcion: "Write an internal note on the request.",
    etapas: TODAS_LAS_ETAPAS,
    enRelease: true,
    motivo: "no",
    necesitaBzzzbx: false,
    interna: true,
    concurrencia: "ninguna",
    ejecutor: async (ctx, entrada) => (await conversacion()).add_note(ctx, entrada),
  },
  {
    codigo: "send_email",
    etiqueta: "Send email",
    descripcion: "Reply to the customer in the email thread of the request.",
    etapas: TODAS_LAS_ETAPAS,
    enRelease: true,
    motivo: "no",
    // Una instrucción abierta no bloquea el siguiente mensaje (§5.3): el bloqueo es propio.
    necesitaBzzzbx: false,
    interna: true,
    concurrencia: "ninguna",
    bloqueo: (v) => {
      const d = disponibilidadDelComposer({ etapa: v.etapa, bzzzbxDisponible: v.bzzzbx.disponible, hilos: v.hilos, equipoId: v.equipoId });
      return d.customer.disponible ? null : d.customer.razon;
    },
    ejecutor: async (ctx, entrada) => (await conversacion()).send_email(ctx, entrada),
  },
  {
    codigo: "send_text",
    etiqueta: "Send text",
    descripcion: "Text the cleaner of the job.",
    etapas: TODAS_LAS_ETAPAS,
    enRelease: true,
    motivo: "no",
    necesitaBzzzbx: false,
    interna: true,
    concurrencia: "ninguna",
    bloqueo: (v) => {
      const d = disponibilidadDelComposer({ etapa: v.etapa, bzzzbxDisponible: v.bzzzbx.disponible, hilos: v.hilos, equipoId: v.equipoId });
      return d.cleaner.disponible ? null : d.cleaner.razon;
    },
    ejecutor: async (ctx, entrada) => (await conversacion()).send_text(ctx, entrada),
  },
  {
    codigo: "discard_ai_draft",
    etiqueta: "Discard AI draft",
    descripcion: "Discard a draft written by the AI without sending it.",
    etapas: TODAS_LAS_ETAPAS,
    enRelease: true,
    motivo: "no",
    necesitaBzzzbx: false,
    interna: true,
    concurrencia: "ninguna",
    ejecutor: async (ctx, entrada) => (await conversacion()).discard_ai_draft(ctx, entrada),
  },
];
