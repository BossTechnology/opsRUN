import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FASE_B } from "@/lib/acciones/disponibilidad";
import type { EntradaAccion, ResultadoAccion } from "@/lib/acciones/tipos";
import { disponibilidadDelComposer } from "@/lib/conversacion/composer";
import type { DatosDeConversacion } from "@/lib/conversacion/leer";
import type { AvisoDelJob, PlantillaOfrecida } from "@/lib/plantillas/disponibles";

// La Server Action y sus dependencias de servidor no corren en jsdom.
vi.mock("@/app/_ventana/acciones", () => ({ ejecutarAccion: vi.fn() }));

import { Conversacion } from "./composer";

afterEach(() => cleanup());

const R2 = "b0000000-0000-4000-8000-0000000000a2";

const CONFIRMACION: PlantillaOfrecida = {
  clave: "cleaner_confirmation_request",
  version: 1,
  nombre: "Confirmation request",
  canal: "text",
  texto: "New job: Sample Court Unit 12 on Wed, Nov 25, 9:00 AM–12:00 PM. Can you confirm?",
  faltan: [],
};
const REPROGRAMAR: PlantillaOfrecida = {
  clave: "reschedule_request",
  version: 1,
  nombre: "Reschedule request",
  canal: "text",
  texto: "Can we move Sample Court Unit 12 to {{date}}, {{window}}? Please confirm.",
  faltan: ["{{date}}", "{{window}}"],
};
const AGENDADA: PlantillaOfrecida = {
  clave: "requester_scheduled",
  version: 1,
  nombre: "Scheduled notice",
  canal: "email",
  texto: "Your cleaning at Sample Court Unit 12 is scheduled for Wed, Nov 25, 9:00 AM–12:00 PM.",
  faltan: [],
};

function datos(parche: Partial<DatosDeConversacion> = {}): DatosDeConversacion {
  return {
    requestId: R2,
    version: "102",
    etapa: "requests",
    entradas: [],
    mensajesNoDisponibles: false,
    bzzzbx: { disponible: true, actualizadoEn: "2026-11-24T18:00:00Z" },
    modos: disponibilidadDelComposer({ etapa: "requests", bzzzbxDisponible: true, hilos: ["bx-thread-0002"], equipoId: "bx-team-0001" }),
    para: { customer: { to: "contact.one@example.test", cc: "— —" }, cleaner: { nombre: "Team Alpha", telefono: "+1 555 0111" } },
    borradores: { customer: null, cleaner: null },
    plantillas: { customer: [AGENDADA], cleaner: [CONFIRMACION, REPROGRAMAR], avisos: [] },
    abiertos: 0,
    ...parche,
  };
}

const guardada = async (): Promise<ResultadoAccion> => ({ tipo: "guardada" });

function pintar(d = datos(), ejecutar: (e: EntradaAccion) => Promise<ResultadoAccion> = vi.fn(guardada)) {
  const vista = render(<Conversacion datos={d} zona="UTC" ejecutar={ejecutar} />);
  return { ejecutar: ejecutar as ReturnType<typeof vi.fn>, ...vista };
}

const modo = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid="modo"][data-modo="${id}"]`)!;
const caja = () => screen.getByTestId("caja") as HTMLTextAreaElement;
const enviar = () => screen.getByTestId("enviar") as HTMLButtonElement;
const escribir = (texto: string) => fireEvent.change(caja(), { target: { value: texto } });
const abrirPicker = () => fireEvent.click(screen.getByTestId("plantillas"));
const opcion = (clave: string) => document.querySelector<HTMLElement>(`[data-plantilla="${clave}"]`);
const elegir = (clave: string) => {
  abrirPicker();
  fireEvent.click(opcion(clave)!);
};
const enviarYEsperar = () => act(async () => void fireEvent.click(enviar()));

let escritas: string[];
beforeEach(() => {
  escritas = [];
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async (t: string) => void escritas.push(t)) }, configurable: true });
});

describe("el picker Templates", () => {
  it("no hay en Note; en Customer y Cleaner hay un botón Templates", () => {
    pintar();
    expect(screen.queryByTestId("plantillas")).toBeNull();
    fireEvent.click(modo("customer"));
    expect(screen.getByTestId("plantillas").textContent).toContain("Templates");
    fireEvent.click(modo("cleaner"));
    expect(screen.getByTestId("plantillas")).toBeTruthy();
    fireEvent.click(modo("note"));
    expect(screen.queryByTestId("plantillas")).toBeNull();
  });

  it("el menú lista las plantillas del modo por su nombre visible, con data-plantilla", () => {
    pintar();
    fireEvent.click(modo("cleaner"));
    expect(document.querySelector('[data-plantilla]')).toBeNull(); // cerrado hasta que se abre
    abrirPicker();
    const items = [...document.querySelectorAll<HTMLElement>("[data-plantilla]")];
    expect(items.map((i) => [i.dataset.plantilla, i.textContent])).toEqual([
      ["cleaner_confirmation_request", "Confirmation request"],
      ["reschedule_request", "Reschedule request"],
    ]);
    fireEvent.click(modo("customer"));
    abrirPicker();
    expect([...document.querySelectorAll<HTMLElement>("[data-plantilla]")].map((i) => i.textContent)).toEqual(["Scheduled notice"]);
  });

  it("si el modo se apaga mientras está elegido (BzzzBX cae), el botón también, con la misma razón", () => {
    const { rerender } = pintar();
    fireEvent.click(modo("cleaner"));
    expect((screen.getByTestId("plantillas") as HTMLButtonElement).disabled).toBe(false);
    const caido = datos({
      bzzzbx: { disponible: false, actualizadoEn: "2026-11-24T18:00:00Z" },
      modos: disponibilidadDelComposer({ etapa: "requests", bzzzbxDisponible: false, hilos: ["h"], equipoId: "e" }),
      plantillas: { customer: [], cleaner: [], avisos: [] },
    });
    rerender(<Conversacion datos={caido} zona="UTC" ejecutar={vi.fn(guardada)} />);
    const boton = screen.getByTestId("plantillas") as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    expect(boton.title).toBe("BzzzBX unavailable");
  });

  it("sin plantillas para el modo y la etapa, el botón está en gris y lo dice", () => {
    pintar(datos({ plantillas: { customer: [], cleaner: [], avisos: [] } }));
    fireEvent.click(modo("cleaner"));
    const boton = screen.getByTestId("plantillas") as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    expect(boton.title).toBe("No templates for this stage");
  });

  it("elegir una llena la caja con el texto del job, la deja editable y pone la marca", () => {
    const { ejecutar } = pintar();
    fireEvent.click(modo("cleaner"));
    elegir("cleaner_confirmation_request");
    expect(caja().value).toBe(CONFIRMACION.texto);
    expect(caja().disabled).toBe(false);
    expect(screen.getByTestId("marca-plantilla").textContent).toContain("Template · Confirmation request");
    expect(opcion("reschedule_request")).toBeNull(); // el menú se cerró
    expect(screen.queryByTestId("faltan")).toBeNull();
    expect(enviar().disabled).toBe(false);
    // Elegir no envía nada ni llama a ninguna acción.
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("con texto del operador en la caja, pregunta antes de reemplazar; Cancel lo deja como estaba", () => {
    pintar();
    fireEvent.click(modo("cleaner"));
    escribir("Mi propio texto");
    elegir("cleaner_confirmation_request");
    expect(screen.getByTestId("reemplazo").textContent).toContain("Replace what you wrote?");
    expect(caja().value).toBe("Mi propio texto");
    fireEvent.click(screen.getByTestId("cancelar-reemplazo"));
    expect(caja().value).toBe("Mi propio texto");
    expect(screen.queryByTestId("reemplazo")).toBeNull();
    expect(screen.queryByTestId("marca-plantilla")).toBeNull();
  });

  it("Replace llena la caja con la plantilla y pone la marca", () => {
    pintar();
    fireEvent.click(modo("cleaner"));
    escribir("Mi propio texto");
    elegir("cleaner_confirmation_request");
    fireEvent.click(screen.getByTestId("reemplazar-plantilla"));
    expect(caja().value).toBe(CONFIRMACION.texto);
    expect(screen.getByTestId("marca-plantilla")).toBeTruthy();
    expect(screen.queryByTestId("reemplazo")).toBeNull();
  });

  it("una caja vacía o solo de espacios se llena sin preguntar", () => {
    pintar();
    fireEvent.click(modo("cleaner"));
    escribir("   ");
    elegir("cleaner_confirmation_request");
    expect(screen.queryByTestId("reemplazo")).toBeNull();
    expect(caja().value).toBe(CONFIRMACION.texto);
  });

  it("un borrador de IA sin tocar se reemplaza sin preguntar, y sigue ofreciéndose 'AI draft available · Use it'", () => {
    const borrador = { id: "5a000000-0000-4000-8000-0000000000d2", field: "draft_customer_reply" as const, body: "Hello from the AI.", reason: "Reply." };
    pintar(datos({ borradores: { customer: borrador, cleaner: null } }));
    fireEvent.click(modo("customer"));
    expect(caja().value).toBe("Hello from the AI.");
    elegir("requester_scheduled");
    expect(screen.queryByTestId("reemplazo")).toBeNull();
    expect(caja().value).toBe(AGENDADA.texto);
    expect(screen.getByTestId("aviso-borrador").textContent).toContain("AI draft available");
  });

  it("la marca se queda aunque el operador edite; quitarla no borra el texto; vaciar la caja la borra", () => {
    pintar();
    fireEvent.click(modo("cleaner"));
    elegir("cleaner_confirmation_request");
    escribir(`${CONFIRMACION.texto} Thanks!`);
    expect(screen.getByTestId("marca-plantilla")).toBeTruthy();

    fireEvent.click(screen.getByTestId("quitar-plantilla"));
    expect(screen.queryByTestId("marca-plantilla")).toBeNull();
    expect(caja().value).toBe(`${CONFIRMACION.texto} Thanks!`);

    elegir("cleaner_confirmation_request");
    fireEvent.click(screen.getByTestId("reemplazar-plantilla"));
    expect(screen.getByTestId("marca-plantilla")).toBeTruthy();
    escribir("");
    expect(screen.queryByTestId("marca-plantilla")).toBeNull();
  });

  it("la marca es de cada modo: cambiar de modo no la mueve", () => {
    pintar();
    fireEvent.click(modo("cleaner"));
    elegir("cleaner_confirmation_request");
    fireEvent.click(modo("customer"));
    expect(screen.queryByTestId("marca-plantilla")).toBeNull();
    fireEvent.click(modo("cleaner"));
    expect(screen.getByTestId("marca-plantilla").textContent).toContain("Confirmation request");
  });
});

describe("lo que falta por llenar (P-9)", () => {
  it("'Fill in: {{date}}, {{window}}' y Send deshabilitado hasta que no quede ninguno", () => {
    pintar();
    fireEvent.click(modo("cleaner"));
    elegir("reschedule_request");
    expect(screen.getByTestId("faltan").textContent).toBe("Fill in: {{date}}, {{window}}");
    expect(enviar().disabled).toBe(true);

    escribir("Can we move Sample Court Unit 12 to Thu, Nov 26, {{window}}? Please confirm.");
    expect(screen.getByTestId("faltan").textContent).toBe("Fill in: {{window}}");
    expect(enviar().disabled).toBe(true);

    escribir("Can we move Sample Court Unit 12 to Thu, Nov 26, 10:00 AM–2:00 PM? Please confirm.");
    expect(screen.queryByTestId("faltan")).toBeNull();
    expect(enviar().disabled).toBe(false);
  });

  it("pulsar Enter con un {{…}} sin llenar tampoco envía", async () => {
    const { ejecutar } = pintar();
    fireEvent.click(modo("cleaner"));
    elegir("reschedule_request");
    fireEvent.submit(screen.getByTestId("composer"));
    await act(async () => {});
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("no hay 'Fill in' en Note", () => {
    pintar();
    escribir("Una nota con {{llaves}} no pasa nada");
    expect(screen.queryByTestId("faltan")).toBeNull();
    expect(enviar().disabled).toBe(false);
  });
});

describe("Send con plantilla", () => {
  it("manda template_key y template_version con la marca, y el cuerpo es lo que hay en la caja", async () => {
    const { ejecutar } = pintar();
    fireEvent.click(modo("cleaner"));
    elegir("cleaner_confirmation_request");
    escribir(`${CONFIRMACION.texto} Thanks!`);
    await enviarYEsperar();
    expect(ejecutar).toHaveBeenCalledTimes(1);
    const entrada = ejecutar.mock.calls[0]![0] as EntradaAccion;
    expect(entrada.codigo).toBe("send_text");
    expect(entrada.datos).toMatchObject({ body: `${CONFIRMACION.texto} Thanks!`, template_key: "cleaner_confirmation_request", template_version: 1 });
  });

  it("un correo con plantilla manda send_email con su plantilla", async () => {
    const { ejecutar } = pintar();
    fireEvent.click(modo("customer"));
    elegir("requester_scheduled");
    await enviarYEsperar();
    const entrada = ejecutar.mock.calls[0]![0] as EntradaAccion;
    expect(entrada.codigo).toBe("send_email");
    expect(entrada.datos).toMatchObject({ template_key: "requester_scheduled", template_version: 1 });
  });

  it("sin marca no manda ni clave ni versión, y la marca se borra al enviar", async () => {
    const { ejecutar } = pintar();
    fireEvent.click(modo("cleaner"));
    escribir("Can you take it?");
    await enviarYEsperar();
    const sin = (ejecutar.mock.calls[0]![0] as EntradaAccion).datos;
    expect(sin).not.toHaveProperty("template_key");
    expect(sin).not.toHaveProperty("template_version");

    elegir("cleaner_confirmation_request");
    await enviarYEsperar();
    expect(screen.queryByTestId("marca-plantilla")).toBeNull();
    expect(caja().value).toBe("");
  });

  it("un rechazo del servidor deja el texto y la marca para corregir", async () => {
    const rechazo = vi.fn(async (): Promise<ResultadoAccion> => ({ tipo: "rechazada", codigo: "plantilla_invalida", mensaje: "That template is not available here." }));
    pintar(datos(), rechazo);
    fireEvent.click(modo("cleaner"));
    elegir("cleaner_confirmation_request");
    await enviarYEsperar();
    expect(screen.getByTestId("error-composer").textContent).toBe("That template is not available here.");
    expect(caja().value).toBe(CONFIRMACION.texto);
    expect(screen.getByTestId("marca-plantilla")).toBeTruthy();
  });
});

describe("un solo SMS en modo Cleaner (§4.4)", () => {
  it("cuenta 1 SMS hasta 160 y 2 desde 161, solo informativo", () => {
    pintar();
    fireEvent.click(modo("cleaner"));
    expect(screen.getByTestId("sms").textContent).toContain("0 SMS");
    escribir("a".repeat(160));
    expect(screen.getByTestId("sms").textContent).toContain("1 SMS");
    expect(screen.getByTestId("contador").textContent).toBe("160/1600");
    escribir("a".repeat(161));
    expect(screen.getByTestId("sms").textContent).toContain("2 SMS");
    expect(enviar().disabled).toBe(false); // no bloquea (P-8)
  });

  it("con un carácter fuera de GSM-7 el límite es 70", () => {
    pintar();
    fireEvent.click(modo("cleaner"));
    escribir(`${"a".repeat(69)}→`);
    expect(screen.getByTestId("sms").textContent).toContain("1 SMS");
    escribir(`${"a".repeat(70)}→`);
    expect(screen.getByTestId("sms").textContent).toContain("2 SMS");
  });

  it("no hay contador de SMS en Customer ni en Note", () => {
    pintar();
    fireEvent.click(modo("customer"));
    expect(screen.queryByTestId("sms")).toBeNull();
    fireEvent.click(modo("note"));
    expect(screen.queryByTestId("sms")).toBeNull();
  });
});

describe("Copy del Composer (P-5)", () => {
  it("copia lo que hay en la caja, incluida una edición, y no llama a nada más", async () => {
    const { ejecutar } = pintar();
    fireEvent.click(modo("cleaner"));
    elegir("cleaner_confirmation_request");
    escribir(`${CONFIRMACION.texto} See you there.`);
    await act(async () => void fireEvent.click(screen.getByTestId("copiar")));
    expect(escritas).toEqual([`${CONFIRMACION.texto} See you there.`]);
    expect(ejecutar).not.toHaveBeenCalled();
    expect(caja().value).toBe(`${CONFIRMACION.texto} See you there.`);
    expect(screen.getByTestId("copiar").textContent).toContain("Copied");
  });

  it("está en Customer y Cleaner y no en Note; sin texto, en gris", () => {
    pintar();
    expect(screen.queryByTestId("copiar")).toBeNull();
    fireEvent.click(modo("customer"));
    expect((screen.getByTestId("copiar") as HTMLButtonElement).disabled).toBe(true);
    escribir("Hola");
    expect((screen.getByTestId("copiar") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(modo("cleaner"));
    expect(screen.getByTestId("copiar")).toBeTruthy();
  });

  it("si el navegador no deja copiar, lo dice y no pasa nada más", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) }, configurable: true });
    const { ejecutar } = pintar();
    fireEvent.click(modo("customer"));
    escribir("Hola");
    await act(async () => void fireEvent.click(screen.getByTestId("copiar")));
    expect(screen.getByTestId("copiar").textContent).toContain("Copy failed");
    expect(ejecutar).not.toHaveBeenCalled();
  });
});

describe("un refresco nunca pisa el texto (§5.2)", () => {
  it("llegan datos nuevos con otra fecha y la caja conserva lo que el operador puso", () => {
    const { rerender } = pintar();
    fireEvent.click(modo("cleaner"));
    elegir("cleaner_confirmation_request");
    escribir(`${CONFIRMACION.texto} (edited)`);
    const nuevos = datos({ plantillas: { customer: [], cleaner: [{ ...CONFIRMACION, texto: "New job: Sample Court Unit 12 on Thu, Nov 26, 9:00 AM–12:00 PM. Can you confirm?" }], avisos: [] }, version: "103" });
    rerender(<Conversacion datos={nuevos} zona="UTC" ejecutar={vi.fn(guardada)} />);
    expect(caja().value).toBe(`${CONFIRMACION.texto} (edited)`);
    expect(screen.getByTestId("marca-plantilla")).toBeTruthy();
    // Lo que se ofrece ya es lo nuevo.
    abrirPicker();
    fireEvent.click(opcion("cleaner_confirmation_request")!);
    expect(screen.getByTestId("reemplazo")).toBeTruthy();
    fireEvent.click(screen.getByTestId("reemplazar-plantilla"));
    expect(caja().value).toContain("Thu, Nov 26");
  });
});

describe("el panel Notices (§7.2)", () => {
  const SCHEDULED: AvisoDelJob = {
    clave: "requester_scheduled",
    version: 1,
    nombre: "Scheduled notice",
    canal: "email",
    texto: AGENDADA.texto,
    faltan: [],
    sinTexto: null,
  };
  const DONE: AvisoDelJob = { ...SCHEDULED, clave: "requester_done", nombre: "Done notice", texto: "The cleaning at Sample Court Unit 12 is done." };
  const CANCELACION: AvisoDelJob = { ...SCHEDULED, clave: "cancellation_cleaner", nombre: "Cancellation (cleaner)", canal: "text", texto: "The job at Sample Court Unit 12 on Wed, Nov 25 is cancelled." };

  const conAvisos = (avisos: AvisoDelJob[], parche: Partial<DatosDeConversacion> = {}) =>
    datos({ etapa: "scheduled", plantillas: { customer: [], cleaner: [], avisos }, ...parche });

  it("muestra cada aviso con su nombre, su canal, la vista previa llenada y 'Not sent · Available when actions are switched on'", () => {
    pintar(conAvisos([SCHEDULED, DONE]));
    const panel = screen.getByTestId("avisos");
    const items = within(panel).getAllByTestId("aviso");
    expect(items.map((i) => i.dataset.aviso)).toEqual(["requester_scheduled", "requester_done"]);
    expect(items[0]!.textContent).toContain("Scheduled notice");
    expect(items[0]!.textContent).toContain("Email");
    expect(items[0]!.textContent).toContain(AGENDADA.texto);
    const estado = items[0]!.querySelector<HTMLElement>('[data-estado="no-enviado"]')!;
    expect(estado.textContent).toBe(`Not sent · ${FASE_B}`);
    expect(within(items[0]!).getByTestId("copiar-aviso")).toBeTruthy();
  });

  it("el texto de Fase B es el mismo de las acciones que esperan (Reschedule y Cancel)", () => {
    pintar(conAvisos([SCHEDULED]));
    expect(screen.getByTestId("avisos").textContent).toContain(FASE_B);
  });

  it("un aviso de texto dice Text", () => {
    pintar(conAvisos([CANCELACION], { etapa: "cancelled" }));
    expect(screen.getByTestId("avisos").textContent).toContain("Text");
  });

  it("es solo de lectura: ningún botón Send ni nada que llame a una acción", async () => {
    const { ejecutar } = pintar(conAvisos([SCHEDULED, DONE]));
    const panel = screen.getByTestId("avisos");
    expect([...panel.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Copy", "Copy"]);
    expect(panel.querySelector('[type="submit"], form, [data-testid="enviar"]')).toBeNull();
    for (const b of panel.querySelectorAll("button")) await act(async () => void fireEvent.click(b));
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("Copy copia la vista previa y no escribe nada", async () => {
    const { ejecutar } = pintar(conAvisos([SCHEDULED]));
    await act(async () => void fireEvent.click(screen.getByTestId("copiar-aviso")));
    expect(escritas).toEqual([AGENDADA.texto]);
    expect(ejecutar).not.toHaveBeenCalled();
    expect(screen.getByTestId("copiar-aviso").textContent).toContain("Copied");
  });

  it("sin avisos que aplicar, la sección no se pinta", () => {
    pintar(datos());
    expect(screen.queryByTestId("avisos")).toBeNull();
  });

  it("sin lectura previa: 'Preview unavailable · BzzzBX unavailable', y sin Copy", () => {
    pintar(conAvisos([{ ...SCHEDULED, texto: null, sinTexto: "bzzzbx" }], { bzzzbx: { disponible: false, actualizadoEn: null } }));
    const item = screen.getByTestId("aviso");
    expect(item.textContent).toContain("Preview unavailable · BzzzBX unavailable");
    expect(within(item).queryByTestId("copiar-aviso")).toBeNull();
  });

  it("la propiedad que BzzzBX no conoce: 'Check the property' en lugar del texto", () => {
    pintar(conAvisos([{ ...SCHEDULED, texto: null, sinTexto: "propiedad", faltan: ["{{property}}"] }]));
    const item = screen.getByTestId("aviso");
    expect(item.textContent).toContain("Check the property");
    expect(item.textContent).not.toContain("{{property}}");
  });

  it("con BzzzBX caído y lo último leído: el aviso con la hora de la última lectura", () => {
    pintar(conAvisos([SCHEDULED], { bzzzbx: { disponible: false, actualizadoEn: "2026-11-24T18:00:00Z" } }));
    expect(screen.getByTestId("avisos-caida").textContent).toBe("BzzzBX unavailable · last update 6:00 PM");
    expect(screen.getByTestId("aviso").textContent).toContain(AGENDADA.texto);
  });

  it("el texto de un aviso no se interpreta como HTML", () => {
    pintar(conAvisos([{ ...SCHEDULED, texto: "<img src=x onerror=alert(1)> {{date}}" }]));
    expect(screen.getByTestId("avisos").querySelector("img")).toBeNull();
    expect(screen.getByTestId("avisos").textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
