"use client";

import { useRef, useState, useTransition } from "react";

import { ejecutarAccion } from "@/app/_ventana/acciones";
import type { EntradaAccion, ResultadoAccion } from "@/lib/acciones/tipos";
import { TEXTO_PARA_UN_RELEASE_POSTERIOR, validarCuerpo } from "@/lib/conversacion/composer";
import type { DatosDeConversacion } from "@/lib/conversacion/leer";
import { LIMITE_DE_CARACTERES, type ModoComposer } from "@/lib/conversacion/tipos";
import { hora } from "@/lib/tablero/formato";

import { Hilo } from "./hilo";
import "./conversacion.css";

type Props = {
  datos: DatosDeConversacion;
  zona: string;
  /** Para pruebas de componente: reemplaza a la Server Action. */
  ejecutar?: (entrada: EntradaAccion) => Promise<ResultadoAccion>;
};

const MODOS: { id: ModoComposer; nombre: string }[] = [
  { id: "customer", nombre: "Customer" },
  { id: "cleaner", nombre: "Cleaner" },
  { id: "note", nombre: "Note" },
];

const CODIGO_DEL_MODO: Record<ModoComposer, "send_email" | "send_text" | "add_note"> = {
  customer: "send_email",
  cleaner: "send_text",
  note: "add_note",
};

/** Un id al azar para la clave de un envío; `randomUUID` solo existe en contextos seguros (https, localhost). */
function nuevoId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lo que dice el Composer de un resultado que no es un éxito; null si salió bien. */
const mensajeDeError = (r: ResultadoAccion): string | null => (r.tipo === "rechazada" ? r.mensaje : null);

/**
 * La conversación del job: el hilo y, debajo, el Composer con tres modos
 * (Customer, Cleaner y Note), spec OPR-27 §5. Los modos son un grupo de
 * opciones (`radiogroup`) y no un `tablist`: la Job window ya tiene el suyo
 * (pestañas de la propiedad, Audit, Alerts) y los dos no deben confundirse. Un borrador de la IA aparece
 * marcado "AI draft" y nunca sale sin que el operador pulse Send. Edit To, Cc
 * y Temporary number se ven en gris y no corren: no tienen Server Action.
 *
 * Todo envío pasa por `ejecutarAccion`, que vuelve a calcular en el servidor
 * si el modo está disponible: deshabilitar un botón aquí no es la defensa.
 */
export function Conversacion({ datos, zona, ejecutar = ejecutarAccion }: Props) {
  const [modo, setModo] = useState<ModoComposer>("note");
  // null = sin tocar: en Customer y Cleaner se ve el borrador de la IA si lo hay.
  const [textos, setTextos] = useState<Record<ModoComposer, string | null>>({ customer: null, cleaner: null, note: "" });
  // El borrador que el operador ya adoptó en cada modo (lo editó o lo usó).
  const [adoptados, setAdoptados] = useState<Record<ModoComposer, string | null>>({ customer: null, cleaner: null, note: null });
  // Borradores ya enviados o descartados: no se vuelven a ofrecer mientras llega el refresco.
  const [usados, setUsados] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [enCurso, iniciar] = useTransition();
  // La clave de idempotencia de un Send: la misma mientras no cambie el cuerpo, para que un reintento no duplique (S-12).
  const clave = useRef<{ cuerpo: string; valor: string } | null>(null);

  const disponibilidad = datos.modos[modo];
  const borradorBruto = modo === "note" ? null : datos.borradores[modo];
  const borrador = borradorBruto && !usados.includes(borradorBruto.id) ? borradorBruto : null;
  const sinTocar = textos[modo] === null;
  const texto = textos[modo] ?? borrador?.body ?? "";
  const adoptado = borrador !== null && (sinTocar || adoptados[modo] === borrador.id);
  const avisoDeBorrador = borrador !== null && !adoptado && disponibilidad.disponible;

  const limite = LIMITE_DE_CARACTERES[modo];
  const valido = validarCuerpo(modo, texto).ok;
  const puedeEnviar = disponibilidad.disponible && valido && !enCurso;

  function escribir(valor: string) {
    if (borrador && sinTocar) setAdoptados({ ...adoptados, [modo]: borrador.id });
    setTextos({ ...textos, [modo]: valor });
    setError(null);
  }

  function cambiarDeModo(nuevo: ModoComposer) {
    setModo(nuevo);
    setError(null);
  }

  function usarBorrador() {
    if (!borrador) return;
    setTextos({ ...textos, [modo]: borrador.body });
    setAdoptados({ ...adoptados, [modo]: borrador.id });
  }

  function reenviar(deModo: "customer" | "cleaner", cuerpo: string) {
    setModo(deModo);
    setTextos({ ...textos, [deModo]: cuerpo });
    setAdoptados({ ...adoptados, [deModo]: null });
    setError(null);
  }

  function enviar() {
    const cuerpo = validarCuerpo(modo, texto);
    if (!cuerpo.ok) {
      setError(cuerpo.razon);
      return;
    }
    if (enCurso || !disponibilidad.disponible) return;
    const idBorrador = modo !== "note" && adoptado ? borrador!.id : null;
    const datosDeEnvio: Record<string, unknown> = { body: cuerpo.cuerpo };
    if (modo !== "note") {
      if (clave.current?.cuerpo !== cuerpo.cuerpo) clave.current = { cuerpo: cuerpo.cuerpo, valor: `msg-${nuevoId()}` };
      datosDeEnvio.idempotency_key = clave.current.valor;
      if (idBorrador) datosDeEnvio.ai_suggestion_id = idBorrador;
    }
    const delModo = modo;
    iniciar(async () => {
      try {
        const r = await ejecutar({
          requestId: datos.requestId,
          codigo: CODIGO_DEL_MODO[delModo],
          motivo: null,
          datos: datosDeEnvio,
          // Estas acciones no dependen del estado de la request (P-6): el servidor no compara la versión.
          version: datos.version,
        });
        const falla = mensajeDeError(r);
        if (falla) {
          setError(falla);
          return;
        }
        clave.current = null;
        setError(null);
        setTextos((t) => ({ ...t, [delModo]: "" }));
        if (idBorrador) setUsados((u) => [...u, idBorrador]);
      } catch {
        setError("Something went wrong. Try again.");
      }
    });
  }

  function descartar() {
    if (!borrador || enCurso) return;
    const id = borrador.id;
    const cuerpoDelBorrador = borrador.body;
    iniciar(async () => {
      try {
        const r = await ejecutar({
          requestId: datos.requestId,
          codigo: "discard_ai_draft",
          motivo: null,
          datos: { ai_suggestion_id: id },
          version: datos.version,
        });
        const falla = mensajeDeError(r);
        if (falla) {
          setError(falla);
          return;
        }
        setError(null);
        setUsados((u) => [...u, id]);
        // Si lo que hay en la caja es el borrador tal cual, se va con él.
        setTextos((t) => (texto === cuerpoDelBorrador ? { ...t, [modo]: "" } : t));
      } catch {
        setError("Something went wrong. Try again.");
      }
    });
  }

  const para = datos.para;

  return (
    <section
      className="ranura ranura-conversacion"
      data-ranura="conversacion"
      data-etapa={datos.etapa}
      data-abiertas={datos.abiertos}
      data-puede-enviar={datos.modos.customer.disponible || datos.modos.cleaner.disponible}
      aria-label="Conversation"
    >
      <h2>Conversation</h2>

      {datos.bzzzbx.disponible ? null : (
        <p className="hilo-aviso" role="status" data-testid="conversacion-caida">
          BzzzBX unavailable ·{" "}
          {datos.bzzzbx.actualizadoEn ? `last update ${hora(datos.bzzzbx.actualizadoEn, zona)}` : "no data yet"}
        </p>
      )}

      <Hilo entradas={datos.entradas} mensajesNoDisponibles={datos.mensajesNoDisponibles} onReenviar={reenviar} />

      <form
        className="composer"
        data-testid="composer"
        data-modo={modo}
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <div className="composer-modos" role="radiogroup" aria-label="Write to">
          {MODOS.map((m) => {
            const d = datos.modos[m.id];
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                id={`composer-modo-${m.id}`}
                data-testid="modo"
                data-modo={m.id}
                aria-checked={modo === m.id}
                aria-disabled={!d.disponible}
                disabled={!d.disponible}
                title={d.disponible ? undefined : d.razon}
                onClick={() => cambiarDeModo(m.id)}
              >
                {m.nombre}
                {d.disponible ? null : (
                  <span className="composer-razon" data-testid="razon-modo">
                    {d.razon}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {modo === "note" ? null : (
          <div className="composer-para" data-testid="para">
            <div>
              <span className="etiqueta-campo">To</span>{" "}
              {modo === "customer" ? (
                <output data-testid="para-a">{para.customer.to ?? "— —"}</output>
              ) : (
                <output data-testid="para-a">
                  {para.cleaner.nombre ?? "— —"}
                  {para.cleaner.telefono ? ` · ${para.cleaner.telefono}` : ""}
                </output>
              )}
            </div>
            {modo === "customer" ? (
              <div>
                <span className="etiqueta-campo">Cc</span> <output data-testid="para-cc">{para.customer.cc}</output>
              </div>
            ) : null}
            <div className="composer-gris">
              <GrisFuturo control="edit-to">Edit To</GrisFuturo>
              {modo === "customer" ? <GrisFuturo control="cc">Cc</GrisFuturo> : <GrisFuturo control="temporary-number">Temporary number</GrisFuturo>}
            </div>
          </div>
        )}

        {disponibilidad.disponible ? null : (
          <p className="composer-razon-general" data-testid="razon-composer" role="status">
            {disponibilidad.razon}
          </p>
        )}

        {borrador && adoptado ? (
          <div className="borrador-ia" data-testid="borrador-ia">
            <span className="marca-ia">AI draft</span>
            {borrador.reason ? <span className="borrador-razon">{borrador.reason}</span> : null}
            <button type="button" data-testid="descartar-borrador" onClick={descartar} disabled={enCurso || !disponibilidad.disponible}>
              Discard
            </button>
          </div>
        ) : null}
        {avisoDeBorrador ? (
          <p className="borrador-aviso" data-testid="aviso-borrador">
            AI draft available ·{" "}
            <button type="button" data-testid="usar-borrador" onClick={usarBorrador}>
              Use it
            </button>
          </p>
        ) : null}

        <textarea
          data-testid="caja"
          aria-label={modo === "note" ? "Note" : modo === "customer" ? "Email to the customer" : "Text to the cleaner"}
          rows={4}
          value={texto}
          disabled={!disponibilidad.disponible}
          onChange={(e) => escribir(e.target.value)}
        />
        <div className="composer-pie">
          <span className={`contador${texto.length > limite ? " contador-excedido" : ""}`} data-testid="contador">
            {texto.length}/{limite}
          </span>
          <button type="submit" data-testid="enviar" disabled={!puedeEnviar}>
            Send
          </button>
        </div>
        <p className="composer-error" role="alert" data-testid="error-composer" hidden={error === null}>
          {error}
        </p>
      </form>
    </section>
  );
}

/** Edit To, Cc y Temporary number: se ven y no corren (P-4). No tienen Server Action ni manejador. */
function GrisFuturo({ control, children }: { control: "edit-to" | "cc" | "temporary-number"; children: string }) {
  return (
    <button
      type="button"
      className="gris-futuro"
      data-testid="gris"
      data-control={control}
      disabled
      aria-disabled="true"
      title={TEXTO_PARA_UN_RELEASE_POSTERIOR}
    >
      {children}
      <span className="solo-lectores">: {TEXTO_PARA_UN_RELEASE_POSTERIOR}</span>
    </button>
  );
}
