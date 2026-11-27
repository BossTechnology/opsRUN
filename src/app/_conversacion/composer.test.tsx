import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EntradaAccion, ResultadoAccion } from "@/lib/acciones/tipos";
import { disponibilidadDelComposer } from "@/lib/conversacion/composer";
import type { DatosDeConversacion } from "@/lib/conversacion/leer";
import type { BorradorDeIA, EntradaDeHilo } from "@/lib/conversacion/tipos";

// La Server Action y sus dependencias de servidor no corren en jsdom.
vi.mock("@/app/_ventana/acciones", () => ({ ejecutarAccion: vi.fn() }));

import { Conversacion } from "./composer";

afterEach(() => cleanup());

const R2 = "b0000000-0000-4000-8000-0000000000a2";

const BORRADOR: BorradorDeIA = {
  id: "5a000000-0000-4000-8000-0000000000d2",
  field: "draft_customer_reply",
  body: "Hello, we have you down for Friday morning.",
  reason: "Reply to the request.",
};

const ORIGINAL: EntradaDeHilo = {
  id: "msg:bx-msg-0002",
  tipo: "original",
  direccion: "inbound",
  etiqueta: "Original request",
  contraparte: "contact.one@example.test",
  hora: "3:00 PM",
  instante: "2026-11-24T15:00:00Z",
  asunto: "Clean for Sample Court unit 12",
  cuerpo: "Please let us know the window.",
  noEncontrado: false,
  estado: { texto: "Received", tono: "normal" },
  reenviar: null,
};

function datos(parche: Partial<DatosDeConversacion> = {}): DatosDeConversacion {
  return {
    requestId: R2,
    version: "102",
    etapa: "requests",
    entradas: [ORIGINAL],
    mensajesNoDisponibles: false,
    bzzzbx: { disponible: true, actualizadoEn: "2026-11-24T18:00:00Z" },
    modos: disponibilidadDelComposer({ etapa: "requests", bzzzbxDisponible: true, hilos: ["bx-thread-0002"], equipoId: "bx-team-0001" }),
    para: { customer: { to: "contact.one@example.test", cc: "— —" }, cleaner: { nombre: "Team Alpha", telefono: "+1 555 0111" } },
    borradores: { customer: null, cleaner: null },
    abiertos: 0,
    ...parche,
  };
}

const guardada = async (): Promise<ResultadoAccion> => ({ tipo: "guardada" });

function pintar(d = datos(), ejecutar: (e: EntradaAccion) => Promise<ResultadoAccion> = vi.fn(guardada)) {
  render(<Conversacion datos={d} zona="UTC" ejecutar={ejecutar} />);
  return ejecutar as ReturnType<typeof vi.fn>;
}

const modo = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid="modo"][data-modo="${id}"]`)!;
const caja = () => screen.getByTestId("caja") as HTMLTextAreaElement;
const enviar = () => screen.getByTestId("enviar") as HTMLButtonElement;
const escribir = (texto: string) => fireEvent.change(caja(), { target: { value: texto } });
const enviarYEsperar = () => act(async () => void fireEvent.click(enviar()));

describe("Composer: los modos", () => {
  it("un grupo de opciones con Customer, Cleaner y Note, y abre en Note", () => {
    pintar();
    expect(screen.getByRole("radiogroup", { name: "Write to" })).toBeTruthy();
    expect(screen.getAllByRole("radio").map((t) => t.textContent)).toEqual(["Customer", "Cleaner", "Note"]);
    expect(modo("note").getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByRole("radio", { checked: true })).toHaveLength(1);
  });

  it("cambiar de modo no borra lo escrito en otro", () => {
    pintar();
    escribir("Una nota");
    fireEvent.click(modo("customer"));
    expect(caja().value).toBe("");
    escribir("Un correo");
    fireEvent.click(modo("note"));
    expect(caja().value).toBe("Una nota");
    fireEvent.click(modo("customer"));
    expect(caja().value).toBe("Un correo");
  });

  it.each([
    ["BzzzBX caído", { bzzzbx: { disponible: false, actualizadoEn: null }, modos: disponibilidadDelComposer({ etapa: "requests", bzzzbxDisponible: false, hilos: ["h"], equipoId: "e" }) }, "BzzzBX unavailable"],
    ["sin hilo", { modos: disponibilidadDelComposer({ etapa: "requests", bzzzbxDisponible: true, hilos: [], equipoId: "e" }) }, "No email thread for this request"],
  ])("Customer en gris con su razón (%s) y no se puede elegir", (_caso, parche, razon) => {
    pintar(datos(parche));
    expect(modo("customer").disabled).toBe(true);
    expect(modo("customer").getAttribute("aria-disabled")).toBe("true");
    expect(within(modo("customer")).getByTestId("razon-modo").textContent).toBe(razon);
    expect(modo("customer").title).toBe(razon);
    fireEvent.click(modo("customer"));
    expect(modo("note").getAttribute("aria-checked")).toBe("true");
  });

  it("Cleaner en gris sin cleaner: 'Choose a cleaner first'", () => {
    pintar(datos({ modos: disponibilidadDelComposer({ etapa: "requests", bzzzbxDisponible: true, hilos: ["h"], equipoId: null }) }));
    expect(within(modo("cleaner")).getByTestId("razon-modo").textContent).toBe("Choose a cleaner first");
    expect(modo("note").disabled).toBe(false);
  });

  it("con el job cancelado los tres modos están en gris, 'Job cancelled', y no se puede enviar", () => {
    pintar(datos({ etapa: "cancelled", modos: disponibilidadDelComposer({ etapa: "cancelled", bzzzbxDisponible: true, hilos: ["h"], equipoId: "e" }) }));
    for (const id of ["customer", "cleaner", "note"]) {
      expect(modo(id).disabled).toBe(true);
      expect(within(modo(id)).getByTestId("razon-modo").textContent).toBe("Job cancelled");
    }
    expect(caja().disabled).toBe(true);
    expect(enviar().disabled).toBe(true);
    expect(screen.getByTestId("razon-composer").textContent).toBe("Job cancelled");
  });
});

describe("Composer: Send", () => {
  it("está deshabilitado con el cuerpo vacío o con solo espacios, y con él se habilita", () => {
    pintar();
    expect(enviar().disabled).toBe(true);
    escribir("   \n\t ");
    expect(enviar().disabled).toBe(true);
    escribir("Requester prefers mornings.");
    expect(enviar().disabled).toBe(false);
  });

  it.each([
    ["note", 4000],
    ["customer", 10_000],
    ["cleaner", 1600],
  ] as const)("en %s está deshabilitado pasado de %i caracteres y el contador lo dice", (id, limite) => {
    pintar();
    fireEvent.click(modo(id));
    escribir("x".repeat(limite));
    expect(enviar().disabled).toBe(false);
    expect(screen.getByTestId("contador").textContent).toBe(`${limite}/${limite}`);
    escribir("x".repeat(limite + 1));
    expect(enviar().disabled).toBe(true);
    expect(screen.getByTestId("contador").className).toContain("contador-excedido");
  });

  it("una nota se manda como add_note con su cuerpo, vacía la caja y no manda clave ni borrador", async () => {
    const ejecutar = pintar();
    escribir("Requester prefers mornings.");
    await enviarYEsperar();
    expect(ejecutar).toHaveBeenCalledExactlyOnceWith({
      requestId: R2,
      codigo: "add_note",
      motivo: null,
      datos: { body: "Requester prefers mornings." },
      version: "102",
    });
    expect(caja().value).toBe("");
  });

  it("un correo se manda como send_email y un texto como send_text, con una clave de envío", async () => {
    const ejecutar = pintar();
    fireEvent.click(modo("customer"));
    escribir("Scheduled for Friday.");
    await enviarYEsperar();
    fireEvent.click(modo("cleaner"));
    escribir("Can you confirm?");
    await enviarYEsperar();
    const [correo, texto] = ejecutar.mock.calls.map((c) => c[0] as EntradaAccion);
    expect(correo).toMatchObject({ codigo: "send_email", datos: { body: "Scheduled for Friday." } });
    expect(texto).toMatchObject({ codigo: "send_text", datos: { body: "Can you confirm?" } });
    expect(String(correo!.datos.idempotency_key)).toMatch(/^msg-[0-9a-f-]{16,}$/);
    expect(correo!.datos.idempotency_key).not.toBe(texto!.datos.idempotency_key);
    // Ni direcciones ni teléfonos: solo el cuerpo y la clave.
    expect(Object.keys(correo!.datos).sort()).toEqual(["body", "idempotency_key"]);
    expect(JSON.stringify(ejecutar.mock.calls)).not.toMatch(/@|555/);
  });

  it("un error de la acción se ve bajo la caja y el texto no se borra; reintentar el mismo cuerpo usa la misma clave", async () => {
    const ejecutar = vi
      .fn<(e: EntradaAccion) => Promise<ResultadoAccion>>()
      .mockResolvedValueOnce({ tipo: "rechazada", codigo: "no_disponible", mensaje: "BzzzBX unavailable" })
      .mockResolvedValue({ tipo: "instruccion", idempotency_key: "x" });
    pintar(datos(), ejecutar);
    fireEvent.click(modo("customer"));
    escribir("Scheduled for Friday.");
    await enviarYEsperar();
    expect(screen.getByTestId("error-composer").textContent).toBe("BzzzBX unavailable");
    expect(screen.getByTestId("error-composer").hidden).toBe(false);
    expect(caja().value).toBe("Scheduled for Friday.");

    await enviarYEsperar();
    expect(ejecutar.mock.calls[1]![0].datos.idempotency_key).toBe(ejecutar.mock.calls[0]![0].datos.idempotency_key);
    expect(caja().value).toBe("");

    // Otro cuerpo, otra clave.
    escribir("Another message");
    await enviarYEsperar();
    expect(ejecutar.mock.calls[2]![0].datos.idempotency_key).not.toBe(ejecutar.mock.calls[0]![0].datos.idempotency_key);
  });

  it("si la acción lanza, dice que algo falló y conserva el texto", async () => {
    pintar(datos(), vi.fn(async () => Promise.reject(new Error("red"))));
    escribir("Una nota");
    await enviarYEsperar();
    expect(screen.getByTestId("error-composer").textContent).toBe("Something went wrong. Try again.");
    expect(caja().value).toBe("Una nota");
  });

  it("Enviar con el formulario (Enter) también pasa por la acción una sola vez", async () => {
    const ejecutar = pintar();
    escribir("Una nota");
    await act(async () => void fireEvent.submit(screen.getByTestId("composer")));
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });
});

describe("Composer: To, Cc y lo que no corre (P-4)", () => {
  it("Customer muestra el remitente del original y Cc '— —', solo lectura", () => {
    pintar();
    fireEvent.click(modo("customer"));
    expect(screen.getByTestId("para-a").textContent).toBe("contact.one@example.test");
    expect(screen.getByTestId("para-cc").textContent).toBe("— —");
    expect(screen.getByTestId("para").querySelector("input, textarea")).toBeNull();
  });

  it("Cleaner muestra el nombre y el teléfono del equipo, solo lectura", () => {
    pintar();
    fireEvent.click(modo("cleaner"));
    expect(screen.getByTestId("para-a").textContent).toBe("Team Alpha · +1 555 0111");
  });

  it("Edit To, Cc y Temporary number: en gris, aria-disabled, con su título, y un clic no cambia nada", async () => {
    const ejecutar = pintar();
    const vistos: string[] = [];
    for (const [id, controles] of [
      ["customer", ["edit-to", "cc"]],
      ["cleaner", ["edit-to", "temporary-number"]],
    ] as const) {
      fireEvent.click(modo(id));
      const grises = screen.getAllByTestId("gris");
      expect(grises.map((g) => g.getAttribute("data-control"))).toEqual(controles);
      for (const g of grises) {
        vistos.push(g.getAttribute("data-control")!);
        expect(g.getAttribute("aria-disabled")).toBe("true");
        expect((g as HTMLButtonElement).disabled).toBe(true);
        expect(g.getAttribute("title")).toBe("Available in a later release");
        const antes = document.body.innerHTML;
        fireEvent.click(g);
        expect(document.body.innerHTML).toBe(antes);
      }
    }
    expect(new Set(vistos)).toEqual(new Set(["edit-to", "cc", "temporary-number"]));
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("quitar el disabled no hace nada: los controles en gris no tienen manejador ni acción", async () => {
    const ejecutar = pintar();
    fireEvent.click(modo("customer"));
    for (const g of screen.getAllByTestId("gris")) {
      (g as HTMLButtonElement).disabled = false;
      await act(async () => void fireEvent.click(g));
    }
    expect(ejecutar).not.toHaveBeenCalled();
    expect(caja().value).toBe("");
  });
});

describe("Composer: borradores de IA (§5.5)", () => {
  const conBorrador = (parche: Partial<DatosDeConversacion> = {}) => datos({ borradores: { customer: BORRADOR, cleaner: null }, ...parche });

  it("en Customer el borrador aparece en la caja marcado 'AI draft', con su razón y Discard", () => {
    pintar(conBorrador());
    fireEvent.click(modo("customer"));
    expect(caja().value).toBe(BORRADOR.body);
    const marca = screen.getByTestId("borrador-ia");
    expect(within(marca).getByText("AI draft")).toBeTruthy();
    expect(within(marca).getByText("Reply to the request.")).toBeTruthy();
    expect(within(marca).getByTestId("descartar-borrador").textContent).toBe("Discard");
    expect(screen.queryByTestId("aviso-borrador")).toBeNull();
  });

  it("en Note y en Cleaner no hay borrador", () => {
    pintar(conBorrador());
    expect(screen.queryByTestId("borrador-ia")).toBeNull();
    fireEvent.click(modo("cleaner"));
    expect(screen.queryByTestId("borrador-ia")).toBeNull();
    expect(caja().value).toBe("");
  });

  it("Send manda lo que está en la caja, no el borrador, y pasa su id; sin borrador no se ve nada de IA", async () => {
    const ejecutar = pintar(conBorrador());
    fireEvent.click(modo("customer"));
    escribir("Hello, we can do Friday at 10.");
    await enviarYEsperar();
    expect(ejecutar.mock.calls[0]![0]).toMatchObject({
      codigo: "send_email",
      datos: { body: "Hello, we can do Friday at 10.", ai_suggestion_id: BORRADOR.id },
    });
    // El borrador ya se decidió: no vuelve a ofrecerse mientras llega el refresco.
    expect(screen.queryByTestId("borrador-ia")).toBeNull();
    expect(screen.queryByTestId("aviso-borrador")).toBeNull();
  });

  it("enviar el borrador sin tocarlo también pasa su id (accepted)", async () => {
    const ejecutar = pintar(conBorrador());
    fireEvent.click(modo("customer"));
    await enviarYEsperar();
    expect(ejecutar.mock.calls[0]![0].datos).toMatchObject({ body: BORRADOR.body, ai_suggestion_id: BORRADOR.id });
  });

  it("nada sale solo: pintar el Composer con un borrador no llama a ninguna acción", () => {
    const ejecutar = pintar(conBorrador());
    fireEvent.click(modo("customer"));
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("Discard descarta el borrador sin enviar nada y lo quita de la caja", async () => {
    const ejecutar = pintar(conBorrador());
    fireEvent.click(modo("customer"));
    await act(async () => void fireEvent.click(screen.getByTestId("descartar-borrador")));
    expect(ejecutar).toHaveBeenCalledExactlyOnceWith({
      requestId: R2,
      codigo: "discard_ai_draft",
      motivo: null,
      datos: { ai_suggestion_id: BORRADOR.id },
      version: "102",
    });
    expect(screen.queryByTestId("borrador-ia")).toBeNull();
    expect(caja().value).toBe("");
  });

  it("si el operador ya escribió, el borrador no pisa su texto: aviso 'AI draft available · Use it'", () => {
    // El borrador llega después (un refresco), cuando el operador ya escribió.
    const { rerender } = render(<Conversacion datos={datos()} zona="UTC" ejecutar={vi.fn(guardada)} />);
    fireEvent.click(modo("customer"));
    escribir("Mi propio texto");
    rerender(<Conversacion datos={conBorrador()} zona="UTC" ejecutar={vi.fn(guardada)} />);
    expect(caja().value).toBe("Mi propio texto");
    expect(screen.queryByTestId("borrador-ia")).toBeNull();
    const aviso = screen.getByTestId("aviso-borrador");
    expect(aviso.textContent).toContain("AI draft available");

    fireEvent.click(within(aviso).getByTestId("usar-borrador"));
    expect(caja().value).toBe(BORRADOR.body);
    expect(screen.getByTestId("borrador-ia")).toBeTruthy();
  });

  it("un borrador que llega con la caja sin tocar se ve en ella", () => {
    const { rerender } = render(<Conversacion datos={datos()} zona="UTC" ejecutar={vi.fn(guardada)} />);
    fireEvent.click(modo("customer"));
    expect(caja().value).toBe("");
    rerender(<Conversacion datos={conBorrador()} zona="UTC" ejecutar={vi.fn(guardada)} />);
    expect(caja().value).toBe(BORRADOR.body);
  });
});

describe("Hilo: Edit and resend y lo que se ve (§4)", () => {
  const FALLIDO: EntradaDeHilo = {
    id: "ins:i1",
    tipo: "email",
    direccion: "outbound",
    etiqueta: "Email",
    contraparte: null,
    hora: "5:59 PM",
    instante: "2026-11-24T17:59:00Z",
    asunto: null,
    cuerpo: "We can do Friday.",
    noEncontrado: false,
    estado: { texto: "Failed · Forced error (stand-in).", tono: "error" },
    reenviar: { modo: "customer", cuerpo: "We can do Friday." },
  };

  it("cada entrada lleva data-tipo y data-direccion, y el fallo se ve en rojo con role=status", () => {
    pintar(datos({ entradas: [ORIGINAL, FALLIDO] }));
    const entradas = screen.getAllByTestId("entrada");
    expect(entradas.map((e) => [e.getAttribute("data-tipo"), e.getAttribute("data-direccion")])).toEqual([
      ["original", "inbound"],
      ["email", "outbound"],
    ]);
    const estado = within(entradas[1]!).getByTestId("estado-entrega");
    expect(estado.getAttribute("role")).toBe("status");
    expect(estado.className).toContain("entrada-error");
    expect(estado.textContent).toBe("Failed · Forced error (stand-in).");
    expect(within(entradas[0]!).getByTestId("estado-entrega").getAttribute("role")).toBeNull();
  });

  it("Edit and resend copia el cuerpo al Composer en el mismo modo", () => {
    pintar(datos({ entradas: [ORIGINAL, FALLIDO] }));
    expect(modo("note").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("reenviar"));
    expect(modo("customer").getAttribute("aria-checked")).toBe("true");
    expect(caja().value).toBe("We can do Friday.");
    expect(enviar().disabled).toBe(false);
  });

  it("el HTML de un cuerpo no se interpreta: se ve como texto", () => {
    pintar(datos({ entradas: [{ ...ORIGINAL, cuerpo: "<img src=x onerror=alert(1)> Hi" }] }));
    expect(screen.getByTestId("cuerpo").textContent).toBe("<img src=x onerror=alert(1)> Hi");
    expect(document.querySelector("img")).toBeNull();
  });

  it("un mensaje vinculado que BzzzBX no conoce dice 'Message not found in BzzzBX'", () => {
    pintar(datos({ entradas: [{ ...ORIGINAL, cuerpo: null, noEncontrado: true, estado: null }] }));
    expect(screen.getByTestId("mensaje-no-encontrado").textContent).toBe("Message not found in BzzzBX");
  });

  it("con BzzzBX caído: el aviso con la hora de lo último leído; sin lectura previa, 'Messages unavailable'", () => {
    pintar(datos({ bzzzbx: { disponible: false, actualizadoEn: "2026-11-24T18:00:00Z" } }));
    expect(screen.getByTestId("conversacion-caida").textContent).toContain("BzzzBX unavailable · last update 6:00 PM");
    cleanup();
    pintar(datos({ bzzzbx: { disponible: false, actualizadoEn: null }, entradas: [], mensajesNoDisponibles: true }));
    expect(screen.getByTestId("conversacion-caida").textContent).toContain("no data yet");
    expect(screen.getByTestId("mensajes-no-disponibles").textContent).toBe("Messages unavailable");
  });
});
