import { connection } from "next/server";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { accionesVisibles } from "@/lib/acciones/disponibilidad";
import { actorDemoActivo } from "@/lib/actor/demo";
import { operadoresElegibles, operadorElegidoId } from "@/lib/actor/servidor";
import { hora } from "@/lib/tablero/formato";
import { revisarCambiosDelTablero, SONDEO_MS } from "@/lib/tablero/servidor";
import type { PropsRanuraBase } from "@/lib/ventana/ranuras";
import { nombresDeEquipos, obtenerVentana, propuestaDeLaRequest } from "@/lib/ventana/servidor";
import type { IdPestana, VentanaJob } from "@/lib/ventana/tipos";

import { ActorDemo } from "./actor-demo";
import { confirmarEnlace, rechazarEnlace } from "./acciones";
import { BarraAcciones } from "./barra-acciones";
import { Encabezado } from "./encabezado";
import { PanelAlertas, PanelPropiedad } from "./paneles";
import { Pestanas } from "./pestanas";
import { RanuraAudit, RanuraBilling, RanuraConversacion, RanuraEnlace, RanuraTracker } from "./ranuras";
import { Sondeo } from "./sondeo";

export type ModoVentana = "overlay" | "pagina";

/** Lo que muestra la ventana de una request que no existe o cuyo id no es un uuid (§6.3). */
export function JobNoEncontrado() {
  return (
    <section className="ventana ventana-vacia" data-testid="job-no-encontrado">
      <h1>Job not found</h1>
      <p>
        <Link href="/">Board</Link>
      </p>
    </section>
  );
}

/** La ranura del enlace de la Fase A, con su propuesta: solo en Requests. */
async function EnlaceDeLaRequest({ ventana }: { ventana: VentanaJob }) {
  await connection();
  const propuesta = await propuestaDeLaRequest(ventana.requestId);
  if ("motivo_vacio" in propuesta && propuesta.motivo_vacio === "request_no_abierta") return null;
  const base = baseDe(ventana);
  const equipos =
    "candidatos" in propuesta
      ? await nombresDeEquipos(propuesta.candidatos.flatMap((c) => (c.job.bzzzbx_team_id ? [c.job.bzzzbx_team_id] : [])))
      : {};
  return (
    <RanuraEnlace
      {...base}
      propuesta={propuesta}
      equipos={equipos}
      gate={ventana.gate}
      confirmar={confirmarEnlace.bind(null, ventana.requestId, ventana.version)}
      rechazar={rechazarEnlace.bind(null, ventana.requestId, ventana.version)}
    />
  );
}

const baseDe = (v: VentanaJob): PropsRanuraBase => ({
  requestId: v.requestId,
  etapa: v.etapa,
  bzzzbx: v.bzzzbx,
  zona: v.zona,
});

/** El contenido de cada pestaña que toca a esta etapa (§4.3 y §7). */
function panelesDe(v: VentanaJob): Partial<Record<IdPestana, ReactNode>> {
  const base = baseDe(v);
  const paneles: Partial<Record<IdPestana, ReactNode>> = {
    property: (
      <>
        {v.etapa === "requests" ? (
          <Suspense fallback={<p aria-busy="true">Looking for the job…</p>}>
            <EnlaceDeLaRequest ventana={v} />
          </Suspense>
        ) : null}
        <PanelPropiedad ventana={v} />
      </>
    ),
    alerts: <PanelAlertas ventana={v} />,
  };
  if (v.pestanas.some((p) => p.id === "audit")) paneles.audit = <RanuraAudit {...base} />;
  if (v.pestanas.some((p) => p.id === "tracker")) paneles.tracker = <RanuraTracker {...base} />;
  if (v.pestanas.some((p) => p.id === "billing")) paneles.billing = <RanuraBilling {...base} />;
  return paneles;
}

/**
 * La Job window de una request (spec OPR-26): arriba el encabezado y la action
 * bar, a la izquierda la conversación y a la derecha las pestañas. Todo se
 * lee en el servidor en una sola pasada (`obtenerVentana`); la conversación y
 * el enlace van en su propio `Suspense` para no frenar el encabezado.
 */
export async function VentanaDelJob({
  requestId,
  tab,
  modo,
}: {
  requestId: string;
  tab: string | null;
  modo: ModoVentana;
}) {
  await connection();
  // El cursor va antes que la lectura: lo que cambie en medio se ve en el siguiente sondeo.
  const [{ cursor }, ventana] = await Promise.all([revisarCambiosDelTablero(null), obtenerVentana(requestId, tab)]);
  if (!ventana) return <JobNoEncontrado />;

  const acciones = accionesVisibles(ventana);
  const [operadores, elegido] = actorDemoActivo()
    ? await Promise.all([operadoresElegibles(), operadorElegidoId()])
    : [[], null];
  const { bzzzbx, zona } = ventana;
  const pideAccion = ventana.pestanas.find((p) => p.id === "alerts")?.conteo ?? 0;

  return (
    <article className="ventana" data-testid="ventana" data-etapa={ventana.etapa} data-request={ventana.requestId} data-modo={modo}>
      {modo === "pagina" ? (
        <nav className="ventana-nav">
          <Link href="/">Board</Link>
        </nav>
      ) : null}

      {bzzzbx.disponible ? null : (
        <p className="franja-caida" role="status" data-testid="franja-bzzzbx">
          BzzzBX unavailable · {bzzzbx.actualizadoEn ? `last update ${hora(bzzzbx.actualizadoEn, zona)}` : "no data yet"}
        </p>
      )}

      <Encabezado ventana={ventana} />

      <div className="ventana-acciones">
        <BarraAcciones requestId={ventana.requestId} version={ventana.version} acciones={acciones} />
        {operadores.length > 0 ? (
          <ActorDemo operadores={operadores.map((o) => ({ id: o.id, nombre: o.nombre }))} elegido={elegido} />
        ) : null}
      </div>

      <div className="ventana-cuerpo">
        <aside className="ventana-izquierda">
          <Suspense fallback={<p aria-busy="true">Loading conversation…</p>}>
            <RanuraConversacion
              {...baseDe(ventana)}
              hilos={ventana.hilos}
              puedeEnviar={bzzzbx.disponible && ventana.etapa !== "cancelled"}
            />
          </Suspense>
        </aside>
        <section className="ventana-derecha">
          <Pestanas pestanas={ventana.pestanas} inicial={ventana.inicial} pideAccion={pideAccion} paneles={panelesDe(ventana)} />
        </section>
      </div>

      <Sondeo cursor={cursor} sondeoMs={SONDEO_MS} />
    </article>
  );
}

/** Mientras llega la ventana: ya se ve el marco y que algo está pasando. */
export function VentanaCargando() {
  return (
    <section className="ventana ventana-vacia" aria-busy="true" data-testid="ventana-cargando">
      <p>Loading job…</p>
    </section>
  );
}
