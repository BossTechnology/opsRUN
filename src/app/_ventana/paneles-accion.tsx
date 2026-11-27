"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";

import type { PropsPanelAccion } from "@/lib/acciones/tipos";
import type { CampoPropiedad, VentanaJob } from "@/lib/ventana/tipos";

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

/** El panel de cada acción que lo tiene, por código. Las demás no piden nada más que el motivo. */
export const PANELES_DE_ACCION: Record<string, ComponentType<PropsPanelAccion>> = {
  assign: PanelAssign,
  confirm_details: PanelConfirmDetails,
  confirm_sender: PanelConfirmSender,
  confirm_cleaner: PanelConfirmCleaner,
};
