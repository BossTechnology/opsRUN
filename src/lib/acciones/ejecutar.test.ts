// @vitest-environment node
/**
 * `ejecutarAccion` es el único camino (spec OPR-26 §5.4): recalcula la
 * disponibilidad con los datos del momento y rechaza todo lo que no sea
 * `disponible` sin llamar al ejecutor, sin escribir en la base y sin mandar
 * nada a BzzzBX. La interfaz no es la defensa.
 */
import { describe, expect, it, vi } from "vitest";

import { armarVentana } from "../ventana/armar";
import {
  CONFIRMACIONES_COMPLETAS,
  filaVentana,
  leidosVentanaDelFalso,
  OPERADORES_DE_PRUEBA,
} from "../ventana/prueba-datos";
import type { VentanaJob } from "../ventana/tipos";

import { ejecutar, type DependenciasDeEjecucion } from "./ejecutar";
import type { DefinicionAccion, EntradaAccion } from "./tipos";

const AHORA = new Date("2026-11-24T18:00:00Z");
const R3 = "b0000000-0000-4000-8000-0000000000a3";
const ACTOR = { tipo: "operador", authUserId: "de000000-0000-4000-8000-0000000000a1" } as const;

function ventana(parche: { disponible?: boolean; instruccionAbierta?: boolean } = {}): VentanaJob {
  return armarVentana({
    fila: filaVentana(AHORA, 3),
    leidos: leidosVentanaDelFalso(AHORA),
    hilos: ["bx-thread-0003"],
    operadores: OPERADORES_DE_PRUEBA,
    confirmaciones: CONFIRMACIONES_COMPLETAS,
    instruccionAbierta: parche.instruccionAbierta ?? false,
    ahora: AHORA,
    zona: "UTC",
    bzzzbx: { disponible: parche.disponible ?? true, actualizadoEn: AHORA.toISOString() },
    tab: null,
  });
}

function armar(registro: DefinicionAccion[], v: VentanaJob | null = ventana(), actor: typeof ACTOR | null = ACTOR) {
  const deps = {
    registro,
    leerVentana: vi.fn(async () => v),
    actor: vi.fn(async () => actor),
    refrescar: vi.fn(async () => {}),
  } satisfies DependenciasDeEjecucion;
  return deps;
}

const entrada = (parche: Partial<EntradaAccion> = {}): EntradaAccion => ({
  requestId: R3,
  codigo: "reschedule_job",
  motivo: "Requester asked to move it.",
  datos: {},
  version: "103",
  ...parche,
});

const base = (parche: Partial<DefinicionAccion> = {}): DefinicionAccion => ({
  codigo: "reschedule_job",
  etiqueta: "Reschedule",
  descripcion: "Move the job.",
  etapas: ["scheduled"],
  enRelease: true,
  motivo: "obligatorio",
  necesitaBzzzbx: true,
  ...parche,
});

describe("ejecutarAccion: lo que no corre, no corre", () => {
  it.each([
    ["sin_construir", () => base({ ejecutor: undefined }), "Not built yet"],
    ["fuera_de_release", () => base({ enRelease: false, ejecutor: vi.fn() }), "Not available in this release"],
    ["no_aplica", () => base({ etapas: ["complete"], ejecutor: vi.fn() }), "does not apply"],
    ["bloqueada", () => base({ bloqueo: () => "Add PO", ejecutor: vi.fn() }), "Add PO"],
  ])("rechaza una acción %s sin llamar al ejecutor, al actor ni al refresco", async (_valor, crear, texto) => {
    const def = crear();
    const deps = armar([def]);
    const r = await ejecutar(deps, entrada());
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "no_disponible" });
    expect(r.tipo === "rechazada" && r.mensaje).toContain(texto);
    if (def.ejecutor) expect(def.ejecutor).not.toHaveBeenCalled();
    expect(deps.actor).not.toHaveBeenCalled();
    expect(deps.refrescar).not.toHaveBeenCalled();
  });

  it("vuelve a calcular con los datos del momento: BzzzBX cayó después de pintar la barra", async () => {
    const ejecutor = vi.fn(async () => ({ tipo: "guardada" as const }));
    const deps = armar([base({ ejecutor })], ventana({ disponible: false }));
    const r = await ejecutar(deps, entrada());
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "no_disponible", mensaje: "BzzzBX unavailable" });
    expect(ejecutor).not.toHaveBeenCalled();
  });

  it("una instrucción abierta de la request no deja lanzar otra", async () => {
    const ejecutor = vi.fn(async () => ({ tipo: "guardada" as const }));
    const deps = armar([base({ ejecutor })], ventana({ instruccionAbierta: true }));
    const r = await ejecutar(deps, entrada());
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "no_disponible", mensaje: "Instruction in progress" });
    expect(ejecutor).not.toHaveBeenCalled();
  });

  it("un código desconocido se rechaza antes de leer nada", async () => {
    const ejecutor = vi.fn();
    const deps = armar([base({ ejecutor })]);
    const r = await ejecutar(deps, entrada({ codigo: "borrar_todo" }));
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "no_disponible" });
    expect(ejecutor).not.toHaveBeenCalled();
    expect(deps.leerVentana).not.toHaveBeenCalled();
    expect(deps.actor).not.toHaveBeenCalled();
  });

  it("una request que no existe se rechaza sin llamar al ejecutor", async () => {
    const ejecutor = vi.fn();
    const deps = armar([base({ ejecutor })], null);
    const r = await ejecutar(deps, entrada());
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "no_encontrada" });
    expect(ejecutor).not.toHaveBeenCalled();
  });

  it.each([
    ["sin requestId", { requestId: "" }],
    ["con el código vacío", { codigo: "" }],
    ["con la versión vacía", { version: "" }],
    ["con un motivo que no es texto", { motivo: 5 as unknown as string }],
    ["con datos que no son un objeto", { datos: null as unknown as Record<string, unknown> }],
  ])("una entrada mal formada (%s) se rechaza sin leer nada", async (_caso, parche) => {
    const ejecutor = vi.fn();
    const deps = armar([base({ ejecutor })]);
    const r = await ejecutar(deps, entrada(parche));
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "entrada_invalida" });
    expect(ejecutor).not.toHaveBeenCalled();
    expect(deps.leerVentana).not.toHaveBeenCalled();
  });
});

describe("ejecutarAccion: motivo, concurrencia y actor", () => {
  it("exige el motivo cuando la acción lo pide: vacío o solo espacios", async () => {
    const ejecutor = vi.fn(async () => ({ tipo: "guardada" as const }));
    const deps = armar([base({ ejecutor })]);
    for (const motivo of [null, "", "   \n "]) {
      const r = await ejecutar(deps, entrada({ motivo }));
      expect(r).toMatchObject({ tipo: "rechazada", codigo: "motivo_requerido" });
    }
    expect(ejecutor).not.toHaveBeenCalled();
    expect(deps.refrescar).not.toHaveBeenCalled();
  });

  it("un motivo demasiado largo se rechaza", async () => {
    const ejecutor = vi.fn(async () => ({ tipo: "guardada" as const }));
    const r = await ejecutar(armar([base({ ejecutor })]), entrada({ motivo: "x".repeat(501) }));
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "motivo_invalido" });
    expect(ejecutor).not.toHaveBeenCalled();
  });

  it("si la request cambió desde que la vio el operador, cambio_concurrente", async () => {
    const ejecutor = vi.fn(async () => ({ tipo: "guardada" as const }));
    const deps = armar([base({ ejecutor })]);
    const r = await ejecutar(deps, entrada({ version: "99" }));
    expect(r).toEqual({ tipo: "rechazada", codigo: "cambio_concurrente", mensaje: "This job changed. Review and try again." });
    expect(ejecutor).not.toHaveBeenCalled();
    expect(deps.actor).not.toHaveBeenCalled();
  });

  it("sin actor (nadie eligió quién actúa y no hay login) no corre nada", async () => {
    const ejecutor = vi.fn(async () => ({ tipo: "guardada" as const }));
    const deps = armar([base({ ejecutor })], ventana(), null);
    const r = await ejecutar(deps, entrada());
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "sin_actor" });
    expect(ejecutor).not.toHaveBeenCalled();
    expect(deps.refrescar).not.toHaveBeenCalled();
  });
});

describe("ejecutarAccion: el camino feliz", () => {
  it("llama al ejecutor con el actor y la ventana, con el motivo recortado, y pide el refresco", async () => {
    const ejecutor = vi.fn(async () => ({ tipo: "guardada" as const }));
    const v = ventana();
    const deps = armar([base({ ejecutor })], v);
    const r = await ejecutar(deps, entrada({ motivo: "  Requester asked.  ", datos: { fecha: "2026-12-01" } }));
    expect(r).toEqual({ tipo: "guardada" });
    expect(ejecutor).toHaveBeenCalledTimes(1);
    expect(ejecutor).toHaveBeenCalledWith(
      { actor: ACTOR, ventana: v },
      expect.objectContaining({ requestId: R3, codigo: "reschedule_job", motivo: "Requester asked.", datos: { fecha: "2026-12-01" } }),
    );
    expect(deps.refrescar).toHaveBeenCalledTimes(1);
  });

  it("una acción sin motivo recibe null, y una con instrucción devuelve su clave", async () => {
    const ejecutor = vi.fn<NonNullable<DefinicionAccion["ejecutor"]>>(async () => ({
      tipo: "instruccion",
      idempotency_key: "k-1",
    }));
    const deps = armar([base({ motivo: "no", ejecutor })]);
    const r = await ejecutar(deps, entrada({ motivo: "  " }));
    expect(r).toEqual({ tipo: "instruccion", idempotency_key: "k-1" });
    expect(ejecutor.mock.calls[0]![1].motivo).toBeNull();
  });

  it("el rechazo del propio ejecutor se devuelve y no pide refresco", async () => {
    const ejecutor = vi.fn(async () => ({ tipo: "rechazada" as const, codigo: "job_cancelado", mensaje: "That job is cancelled." }));
    const deps = armar([base({ ejecutor })]);
    const r = await ejecutar(deps, entrada());
    expect(r).toEqual({ tipo: "rechazada", codigo: "job_cancelado", mensaje: "That job is cancelled." });
    expect(deps.refrescar).not.toHaveBeenCalled();
  });

  it("si el ejecutor falla, no se filtra el error y se pide el refresco por si algo cambió", async () => {
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    const ejecutor = vi.fn(async () => {
      throw new Error("connection refused: host interno");
    });
    const deps = armar([base({ ejecutor })]);
    const r = await ejecutar(deps, entrada());
    expect(r).toEqual({ tipo: "rechazada", codigo: "error", mensaje: "Something went wrong. Try again." });
    expect(JSON.stringify(r)).not.toContain("interno");
    expect(deps.refrescar).toHaveBeenCalledTimes(1);
    errores.mockRestore();
  });
});

describe("ejecutarAccion: concurrencia: ninguna (OPR-27, P-6)", () => {
  it("una acción con concurrencia ninguna corre aunque la request haya cambiado", async () => {
    const ejecutor = vi.fn(async () => ({ tipo: "guardada" as const }));
    const deps = armar([base({ concurrencia: "ninguna", motivo: "no", ejecutor })]);
    const r = await ejecutar(deps, entrada({ version: "99", motivo: null }));
    expect(r).toEqual({ tipo: "guardada" });
    expect(ejecutor).toHaveBeenCalledTimes(1);
  });

  it("con concurrencia request (la de por defecto) sigue rechazando un cambio", async () => {
    const ejecutor = vi.fn(async () => ({ tipo: "guardada" as const }));
    for (const concurrencia of [undefined, "request" as const]) {
      const r = await ejecutar(armar([base({ concurrencia, ejecutor })]), entrada({ version: "99" }));
      expect(r).toMatchObject({ tipo: "rechazada", codigo: "cambio_concurrente" });
    }
    expect(ejecutor).not.toHaveBeenCalled();
  });
});

describe("ejecutarAccion: lo de un release posterior no corre (OPR-27 §5.2)", () => {
  it.each(["to", "cc", "from_number"])("`datos` con %s se rechaza no_disponible sin leer la ventana ni llamar al ejecutor", async (campo) => {
    const ejecutor = vi.fn(async () => ({ tipo: "guardada" as const }));
    const deps = armar([base({ concurrencia: "ninguna", motivo: "no", ejecutor })]);
    const r = await ejecutar(deps, entrada({ motivo: null, datos: { body: "Hola", [campo]: "someone@example.test" } }));
    expect(r).toEqual({ tipo: "rechazada", codigo: "no_disponible", mensaje: "Available in a later release" });
    expect(ejecutor).not.toHaveBeenCalled();
    expect(deps.leerVentana).not.toHaveBeenCalled();
    expect(deps.actor).not.toHaveBeenCalled();
    expect(deps.refrescar).not.toHaveBeenCalled();
  });
});

describe("ejecutarAccion: solo un operador actúa", () => {
  it("un actor de sistema no corre ninguna acción", async () => {
    const ejecutor = vi.fn(async () => ({ tipo: "guardada" as const }));
    const deps = armar([base({ ejecutor })]);
    deps.actor.mockResolvedValue({ tipo: "sistema", proceso: "reconciliador" } as never);
    const r = await ejecutar(deps, entrada());
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "sin_actor" });
    expect(ejecutor).not.toHaveBeenCalled();
    expect(deps.refrescar).not.toHaveBeenCalled();
  });
});
