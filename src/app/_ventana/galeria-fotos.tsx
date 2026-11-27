"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { FotoVista } from "@/lib/tracker/armar";

import "./etapas.css";

type Props = {
  before: FotoVista[];
  after: FotoVista[];
  /** BzzzBX respondió: con false todas las miniaturas son "Photo unavailable". */
  disponible: boolean;
};

export const TEXTO_SIN_FOTOS = "No photos";
export const TEXTO_FOTO_NO_DISPONIBLE = "Photo unavailable";

/**
 * La galería de fotos Before / After del Job tracker (spec OPR-30 §4.2). Las
 * miniaturas piden su imagen a `/api/fotos/[id]`, que la pide al puerto de BzzzBX:
 * el navegador nunca habla con BzzzBX y la imagen no se guarda. Un clic o Enter en
 * una miniatura la agranda en un `<dialog>` modal: Esc, ✕ o un clic fuera lo
 * cierran, y las flechas van a la anterior y a la siguiente.
 */
export function GaleriaDeFotos({ before, after, disponible }: Props) {
  const todas = [...before, ...after];
  const [abierta, setAbierta] = useState<string | null>(null);
  const [fallidas, setFallidas] = useState<ReadonlySet<string>>(new Set());
  const dialogo = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const indice = abierta === null ? -1 : todas.findIndex((f) => f.id === abierta);
  const actual = indice >= 0 ? todas[indice] : undefined;

  // El `<dialog>` se abre como modal. Sin `showModal` (jsdom) se deja abierto con el atributo.
  useEffect(() => {
    const d = dialogo.current;
    if (!d || !actual) return;
    if (typeof d.showModal === "function") {
      if (!d.open) d.showModal();
    } else {
      d.setAttribute("open", "");
    }
  }, [actual]);

  function cerrar() {
    const d = dialogo.current;
    if (d?.open && typeof d.close === "function") d.close();
    setAbierta(null);
    // El foco vuelve a la miniatura que se agrandó.
    opener.current?.focus();
  }

  function ir(paso: number) {
    if (todas.length === 0 || indice < 0) return;
    setAbierta(todas[(indice + paso + todas.length) % todas.length]!.id);
  }

  function alTeclado(evento: KeyboardEvent) {
    if (evento.key === "Escape") {
      // Esc cierra la foto y no la Job window que está debajo (el Modal respeta defaultPrevented).
      evento.preventDefault();
      evento.stopPropagation();
      cerrar();
    } else if (evento.key === "ArrowRight") {
      evento.preventDefault();
      ir(1);
    } else if (evento.key === "ArrowLeft") {
      evento.preventDefault();
      ir(-1);
    }
  }

  const noDisponible = (f: FotoVista) => !disponible || fallidas.has(f.id);

  const grupo = (titulo: "Before" | "After", fotos: FotoVista[]) => (
    <section className="galeria-grupo" data-testid={`fotos-${titulo.toLowerCase()}`} aria-label={`${titulo} photos`}>
      <h3>{titulo}</h3>
      {fotos.length === 0 ? (
        <p className="galeria-vacia" data-testid={`sin-fotos-${titulo.toLowerCase()}`}>
          No {titulo.toLowerCase()} photos
        </p>
      ) : (
        <ul className="galeria-lista">
          {fotos.map((f) => (
            <li key={f.id}>
              {noDisponible(f) ? (
                <span className="miniatura miniatura-no-disponible" data-testid="foto-no-disponible" role="img" aria-label={`${f.alt}: ${TEXTO_FOTO_NO_DISPONIBLE}`}>
                  {TEXTO_FOTO_NO_DISPONIBLE}
                </span>
              ) : (
                <button
                  type="button"
                  className="miniatura"
                  data-testid="miniatura"
                  data-foto={f.id}
                  aria-label={f.alt}
                  onClick={(e) => {
                    opener.current = e.currentTarget;
                    setAbierta(f.id);
                  }}
                >
                  {/* Una ruta del servidor, con `no-store`: next/image la cachearía. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.src}
                    alt={f.alt}
                    loading="lazy"
                    onError={() => setFallidas((previas) => new Set(previas).add(f.id))}
                  />
                </button>
              )}
              <span className="miniatura-hora">{f.hora}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="galeria" data-testid="galeria">
      {todas.length === 0 ? (
        <p className="galeria-vacia" data-testid="sin-fotos">
          {TEXTO_SIN_FOTOS}
        </p>
      ) : (
        <>
          {grupo("Before", before)}
          {grupo("After", after)}
        </>
      )}
      {actual ? (
        <dialog
          ref={dialogo}
          className="foto-dialogo"
          data-testid="foto-dialogo"
          aria-label={actual.alt}
          onKeyDown={alTeclado}
          onCancel={(e) => {
            e.preventDefault();
            cerrar();
          }}
          onClick={(e) => {
            // Un clic fuera de la foto (en el fondo del diálogo) lo cierra.
            if (e.target === e.currentTarget) cerrar();
          }}
        >
          <div className="foto-dialogo-contenido">
            <button type="button" className="foto-cerrar" aria-label="Close photo" data-testid="foto-cerrar" onClick={cerrar}>
              ✕
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={actual.src} alt={actual.alt} data-testid="foto-grande" />
            <p className="foto-pie">{actual.alt}</p>
            <div className="foto-navegacion">
              <button type="button" aria-label="Previous photo" data-testid="foto-anterior" onClick={() => ir(-1)} disabled={todas.length < 2}>
                ‹
              </button>
              <button type="button" aria-label="Next photo" data-testid="foto-siguiente" onClick={() => ir(1)} disabled={todas.length < 2}>
                ›
              </button>
            </div>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
