"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";

import type { PropsPanelAccion } from "@/lib/acciones/tipos";
import { reglaConNombre } from "@/lib/audit/reglas";
import { PO_MAX } from "@/lib/etapas/reglas";
import type { CampoPropiedad, VentanaJob } from "@/lib/ventana/tipos";

import "./etapas.css";

/**
 * Los paneles propios de Assign / Reassign y Confirm details, sender y cleaner
 * (spec OPR-28 §4). Los pinta la action bar cuando se elige la acción. Solo
 * piden lo que el operador decide (a quién, con qué método): lo que se
 * confirma lo calcula la base desde la fila de la request, así que ningún
 * panel manda valores del borrador (§6).
 */

/** Las sugerencias de IA abiertas de un campo marcan AI hasta que alguien confirma o corrige. */
const CAMPOS_DE_IA: Record<CampoPropiedad["clave"], string[]> = {
  customer: ["sender"],
  // La marca de "Who is it from?" va una sola vez, en el cliente.
  contact: [],
  property: ["property"],
  space: ["space", "unit", "beds"],
  service: ["service"],
  date: ["service_date", "time_window"],
  cleaner: ["cleaner_team"],
  po: ["po_number"],
  access: ["access_notes"],
};

function MarcaAI({ razones }: { razones: string[] }) {
  return (
    <>
      <span className="marca-ai" data-testid="marca-ai" title="Suggested by the AI. Confirm it or change it.">
        AI
      </span>
      {razones.length > 0 ? (
        <span className="razon-ai" data-testid="razon-ai">
          {" "}
          {razones.join(" · ")}
        </span>
      ) : null}
    </>
  );
}

/** Un campo con su valor leído de BzzzBX y la marca AI si tiene una sugerencia abierta. */
function Campo({ ventana, clave, etiqueta }: { ventana: VentanaJob; clave: CampoPropiedad["clave"]; etiqueta?: string }) {
  const campo = ventana.propiedad.campos.find((c) => c.clave === clave);
  if (!campo) return null;
  const abiertas = ventana.datos.sugerencias.filter((s) => CAMPOS_DE_IA[clave].includes(s.campo));
  const razones = [...new Set(abiertas.flatMap((s) => (s.razon ? [s.razon] : [])))];
  return (
    <div data-testid={`confirmar-${clave}`}>
      <dt>{etiqueta ?? campo.etiqueta}</dt>
      <dd>
        {campo.valor}
        {campo.noEncontrado ? <span className="no-encontrado"> Not found in BzzzBX</span> : null}
        {abiertas.length > 0 ? <MarcaAI razones={razones} /> : null}
      </dd>
    </div>
  );
}

/** Sin nada que elegir: confirma lo que se ve. Avisa a la barra que ya está completo. */
function useCompletoAlMontar(onCambio: PropsPanelAccion["onCambio"]) {
  useEffect(() => {
    onCambio({}, true);
    // Solo al abrir el panel: `onCambio` cambia de identidad en cada render de la barra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function PanelAssign({ ventana, actorId = null, onCambio }: PropsPanelAccion) {
  const { asignado, cargas } = ventana.encabezado;
  const [elegido, setElegido] = useState<string | null>(null);

  // El dueño actual no se ofrece (OP015): el panel no lo deja elegir.
  const lista = cargas.filter((o) => o.id !== asignado.operadorId);
  const valido = elegido !== null && lista.some((o) => o.id === elegido) ? elegido : null;
  const puedeAsignarseAMi = actorId !== null && actorId !== asignado.operadorId && lista.some((o) => o.id === actorId);

  // Si el elegido dejó de poder serlo (se refrescó la ventana y ya es el dueño), `valido` es null: se desmarca.
  useEffect(() => {
    onCambio(valido ? { operator_id: valido } : {}, valido !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valido]);

  return (
    <fieldset className="panel-assign" data-testid="panel-assign">
      <legend data-testid="modo-assign">
        {asignado.operadorId ? `Reassign from ${asignado.nombre} to` : "Assign this request to"}
      </legend>
      {/* "Me" es el actor de la transacción. Sin actor se ve en gris; el dueño actual no se ofrece. */}
      {actorId === null || puedeAsignarseAMi ? (
        <button
          type="button"
          data-testid="assign-to-me"
          disabled={actorId === null}
          title={actorId === null ? "Choose who is acting first" : undefined}
          onClick={() => actorId && setElegido(actorId)}
        >
          Assign to me
        </button>
      ) : null}
      <ul className="lista-operadores" aria-label="Operators">
        {lista.map((o) => (
          <li key={o.id} data-testid="opcion-operador" data-operador={o.id}>
            <label>
              <input type="radio" name="operador" checked={valido === o.id} onChange={() => setElegido(o.id)} />
              <span>{o.nombre}</span>
              <span className="carga-barra" aria-hidden="true">
                <span style={{ width: `${Math.round(o.proporcion * 100)}%` }} />
              </span>
              <span className="carga-numero" data-testid="carga-operador" data-abiertas={o.abiertas}>
                {o.abiertas} open
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function ListaDeCampos({ children, testid }: { children: ReactNode; testid: string }) {
  return (
    <dl className="campos campos-confirmar" data-testid={testid}>
      {children}
    </dl>
  );
}

export function PanelConfirmDetails({ ventana, onCambio }: PropsPanelAccion) {
  useCompletoAlMontar(onCambio);
  return (
    <ListaDeCampos testid="panel-confirm-details">
      <Campo ventana={ventana} clave="property" />
      <Campo ventana={ventana} clave="space" />
      <Campo ventana={ventana} clave="service" />
      <Campo ventana={ventana} clave="date" />
      <Campo ventana={ventana} clave="access" />
      <Campo ventana={ventana} clave="po" />
    </ListaDeCampos>
  );
}

export function PanelConfirmSender({ ventana, onCambio }: PropsPanelAccion) {
  useCompletoAlMontar(onCambio);
  return (
    <ListaDeCampos testid="panel-confirm-sender">
      <Campo ventana={ventana} clave="customer" etiqueta="Who is it from?" />
      <Campo ventana={ventana} clave="contact" etiqueta="Representative" />
    </ListaDeCampos>
  );
}

type Metodo = "phone" | "cleaner_text";

export function PanelConfirmCleaner({ ventana, onCambio }: PropsPanelAccion) {
  const respuesta = ventana.datos.respuestaDelCleaner;
  // Solo una respuesta del equipo que está en el borrador sirve (OP018 si no).
  const aceptable = respuesta !== null && respuesta.equipoId === ventana.equipoId ? respuesta : null;
  const [metodo, setMetodo] = useState<Metodo | null>(null);
  // Si la respuesta desapareció al refrescar, "Cleaner replied yes" deja de valer.
  const valido: Metodo | null = metodo === "cleaner_text" && aceptable === null ? null : metodo;

  useEffect(() => {
    if (valido === "cleaner_text" && aceptable) onCambio({ method: "cleaner_text", cleaner_confirmation_id: aceptable.id }, true);
    else if (valido === "phone") onCambio({ method: "phone" }, true);
    else onCambio({}, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valido, aceptable?.id]);

  return (
    <fieldset className="panel-confirm-cleaner" data-testid="panel-confirm-cleaner">
      <ListaDeCampos testid="campos-confirm-cleaner">
        <Campo ventana={ventana} clave="cleaner" />
      </ListaDeCampos>
      <p className="etiqueta-campo">How was it confirmed?</p>
      <label>
        <input type="radio" name="metodo" checked={valido === "phone"} onChange={() => setMetodo("phone")} />
        <span>Confirm by phone</span>
      </label>
      {aceptable ? (
        <>
          <label>
            <input type="radio" name="metodo" checked={valido === "cleaner_text"} onChange={() => setMetodo("cleaner_text")} />
            <span>Cleaner replied yes</span>
          </label>
          <p className="lectura-del-cleaner" data-testid="lectura-del-cleaner">
            The cleaner replied. Read the reply in the conversation.
            {aceptable.lectura ? (
              <>
                {" "}
                <MarcaAI razones={[aceptable.lectura]} />
              </>
            ) : null}
          </p>
        </>
      ) : null}
    </fieldset>
  );
}

/**
 * Clear alert (OPR-30 §4.3): la alerta limpiable del job, con su regla, nivel,
 * texto y hace cuánto abrió. Si hay varias se elige una; con una sola ya viene
 * elegida. El motivo es obligatorio y lo pide la barra.
 */
export function PanelClearAlert({ ventana, onCambio }: PropsPanelAccion) {
  const lista = ventana.datos.alertasLimpiables;
  const [elegida, setElegida] = useState<string | null>(null);
  // Una sola alerta ya está elegida; si la elegida dejó de estar (se refrescó la ventana), se desmarca.
  const valida = lista.length === 1 ? lista[0]!.id : lista.some((a) => a.id === elegida) ? elegida : null;

  useEffect(() => {
    onCambio(valida ? { bzzzbx_alert_id: valida } : {}, valida !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valida]);

  return (
    <fieldset className="panel-clear-alert" data-testid="panel-clear-alert">
      <legend>{lista.length > 1 ? "Which alert?" : "Alert to clear"}</legend>
      <ul aria-label="Alerts">
        {lista.map((a) => (
          <li key={a.id} data-testid="alerta-limpiable" data-alerta={a.id} data-regla={a.regla} data-nivel={a.nivel}>
            <label>
              {lista.length > 1 ? (
                <input type="radio" name="alerta" checked={valida === a.id} onChange={() => setElegida(a.id)} />
              ) : null}
              <span className="alerta-mini" data-nivel={a.nivel}>
                {reglaConNombre(a.regla)}
              </span>{" "}
              <span>{a.nivel}</span> · <span>{a.razon}</span> · <span data-testid="alerta-hace">opened {a.abierta}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

const TEXTO_MARCA = { oss: "OSS", not_oss: "Not OSS" } as const;

/**
 * Mark as OSS / Not OSS (OPR-31 §5.1): dos opciones con la actual marcada. Go
 * queda deshabilitado si se elige la marca que ya tiene. El motivo es opcional.
 */
export function PanelMarkOss({ ventana, onCambio }: PropsPanelAccion) {
  const actual = ventana.datos.oss;
  const [elegida, setElegida] = useState<"oss" | "not_oss" | null>(actual);
  const completo = elegida !== null && elegida !== actual;

  useEffect(() => {
    onCambio(elegida ? { mark: elegida } : {}, completo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elegida, completo]);

  return (
    <fieldset className="panel-mark-oss" data-testid="panel-mark-oss">
      <legend data-testid="oss-actual">
        {actual ? `Current: ${TEXTO_MARCA[actual]}${ventana.datos.ossAuto ? " (auto)" : ""}` : "No mark yet"}
      </legend>
      {(["oss", "not_oss"] as const).map((marca) => (
        <label key={marca}>
          <input type="radio" name="oss" checked={elegida === marca} onChange={() => setElegida(marca)} />
          <span>{TEXTO_MARCA[marca]}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Approve & confirm (OPR-31 §5.2): un resumen de lo que se firma y Go. Sin motivo. */
export function PanelApprove({ ventana, onCambio }: PropsPanelAccion) {
  useCompletoAlMontar(onCambio);
  const { fin, oss, ossAuto } = ventana.datos;
  return (
    <dl className="campos campos-confirmar" data-testid="panel-approve">
      <div>
        <dt>Ended</dt>
        <dd data-testid="approve-fin">{fin ?? "— —"}</dd>
      </div>
      <div>
        <dt>OSS status</dt>
        <dd data-testid="approve-oss">{oss ? `${TEXTO_MARCA[oss]}${ossAuto ? " (auto)" : ""}` : "— —"}</dd>
      </div>
    </dl>
  );
}

/**
 * Enter PO (OPR-32 §5.3): el PO que el operador escribe en opsRUN, hasta Validate.
 * Completo si no está vacío, no pasa de 64 caracteres y es otro distinto del
 * capturado.
 */
export function PanelEnterPo({ ventana, onCambio }: PropsPanelAccion) {
  const vigente = ventana.datos.poVigente;
  const capturado = vigente?.fuente === "opsrun" ? vigente.valor : "";
  const [valor, setValor] = useState(capturado);
  const recortado = valor.trim();
  const completo = recortado !== "" && recortado.length <= PO_MAX && recortado !== capturado;

  useEffect(() => {
    onCambio(completo ? { po_number: recortado } : {}, completo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recortado, completo]);

  return (
    <div className="panel-enter-po" data-testid="panel-enter-po">
      <label>
        <span className="etiqueta-campo">PO #</span>
        <input type="text" data-testid="panel-po-input" value={valor} maxLength={PO_MAX} autoComplete="off" onChange={(e) => setValor(e.target.value)} />
      </label>
      {vigente && vigente.fuente !== "opsrun" ? (
        <p className="nota-gris" data-testid="po-otra-fuente">
          {vigente.fuente === "pinch" ? "In PINCH" : "In the request"}: {vigente.valor}
        </p>
      ) : null}
    </div>
  );
}

/** El panel de cada acción que lo tiene, por código. Las demás no piden nada más que el motivo. */
export const PANELES_DE_ACCION: Record<string, ComponentType<PropsPanelAccion>> = {
  assign: PanelAssign,
  confirm_details: PanelConfirmDetails,
  confirm_sender: PanelConfirmSender,
  confirm_cleaner: PanelConfirmCleaner,
  clear_alert: PanelClearAlert,
  mark_oss: PanelMarkOss,
  approve_confirm: PanelApprove,
  write_po: PanelEnterPo,
};
