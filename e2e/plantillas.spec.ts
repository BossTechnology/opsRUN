import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { actuarComo, esperarVentanaLista } from "./ventana";

/**
 * Plantillas de mensajes y avisos (OPR-18, criterios T1 a T10 de docs/spec/opr-18-plantillas.md §10.3) contra el build
 * de producción, la seed y el stand-in de BzzzBX, con OPSRUN_ACTOR_DEMO=1 y OPSRUN_ZONA_HORARIA=America/New_York
 * fijos en playwright.config.mts.
 *
 * Corre en su propio proyecto, al final: T8 cancela el job de R3 en el falso (se deshace en el siguiente
 * `reiniciar`, pero lo que el ciclo de fondo alcance a observar queda). Cada intento deja su propia huella: lo que se
 * lee de la base es lo que apareció después de una marca tomada al empezar el intento, así un reintento no ve lo del
 * anterior.
 *
 * Los textos esperados se arman aquí, con los nombres que trae el falso (`src/lib/bzzzbx/falso/datos.ts`) y el
 * formato de §4.3, no con cadenas escritas a mano ni con el código que los arma.
 *
 * T9 (Approve & confirm no manda nada) no está aquí: aprobar un job es irreversible por request y esta spec no puede
 * dejar una Complete nueva por intento. Lo cubre `src/lib/plantillas/plantillas-base.test.ts`, contra la base y
 * dentro de una transacción que se deshace, y T6 (Done notice "Not sent" en Validation).
 */
test.describe.configure({ mode: "serial" });
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const R = (n: number) => `b0000000-0000-4000-8000-0000000000a${n}`;
const OPS_UNO = "0a000000-0000-4000-8000-0000000000a1";
const FASE_B = "Available when actions are switched on";
const UNA_VUELTA = { timeout: 60_000 };

// Lo que trae el falso (datos.ts) y la seed.
const R2_PROPIEDAD = "Sample Court";
const R2_ESPACIO = "Unit 12";
const R3_PROPIEDAD = "Demo Lofts";
const R3_UNIDAD = "7C"; // R3 no tiene espacio en BzzzBX: cae a la unidad del borrador
const R6_PROPIEDAD = "Test Terrace";

async function control(page: Page, pedido: Record<string, unknown>) {
  const r = await page.request.post("/api/falso", { data: pedido });
  expect(r.ok(), await r.text()).toBe(true);
}

/** Consulta como opsrun_app, el mismo login del servidor: lo que la base guardó de verdad. */
async function consultar<T extends Record<string, unknown>>(sql: string, parametros: unknown[] = []): Promise<T[]> {
  // playwright.config.mts la pone para los workers.
  const cliente = new pg.Client({ connectionString: process.env.OPSRUN_DATABASE_URL });
  await cliente.connect();
  try {
    return (await cliente.query<T>(sql, parametros)).rows;
  } finally {
    await cliente.end();
  }
}

/** Algo único de este intento: lo que se envía lo lleva, así un reintento (o una corrida anterior en la misma base) no se confunde con él. */
const etiquetaDelIntento = () => `Ref ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** La marca de este intento: el último `audit_event` y la cuenta de instrucciones, antes de hacer nada. */
async function marca() {
  const [fila] = await consultar<{ audit: string; instrucciones: string }>(
    "select (select coalesce(max(id), 0) from opsrun.audit_event)::text as audit, (select count(*) from opsrun.instruction)::text as instrucciones",
  );
  return { audit: fila!.audit, instrucciones: Number(fila!.instrucciones) };
}

/** El Audit de envío de una request que apareció después de la marca, con la plantilla y el payload de su instrucción. */
async function enviosDespues(desde: string, requestId: string) {
  return consultar<{ event_type: string; details: Record<string, unknown>; payload: Record<string, unknown> }>(
    `select a.event_type, a.details, i.payload
       from opsrun.audit_event as a join opsrun.instruction as i on i.id = a.instruction_id
      where a.id > $1::bigint and a.request_id = $2 and a.event_type in ('email_sent', 'text_sent')
      order by a.id`,
    [desde, requestId],
  );
}

/** El día de calendario de la base (`service_date` de una request) como lo escribe una plantilla: "Wed, Nov 25". */
const fechaCorta = (dia: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${dia}T00:00:00Z`));
/** Hoy más n días, en UTC, como el falso arma las fechas de sus jobs (`dia(n)`). */
const dia = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const conversacion = (page: Page) => page.locator('[data-ranura="conversacion"]');
const entradas = (page: Page) => conversacion(page).getByTestId("entrada");
const modo = (page: Page, id: string) => conversacion(page).locator(`[data-testid="modo"][data-modo="${id}"]`);
const caja = (page: Page) => conversacion(page).getByTestId("caja");
const enviar = (page: Page) => conversacion(page).getByTestId("enviar");
const picker = (page: Page) => conversacion(page).getByTestId("plantillas");
const opciones = (page: Page) => conversacion(page).locator("[data-plantilla][role='menuitem']");
const avisos = (page: Page) => conversacion(page).getByTestId("avisos");
const aviso = (page: Page, clave: string) => avisos(page).locator(`[data-testid="aviso"][data-aviso="${clave}"]`);
const burbuja = (page: Page, texto: string) => entradas(page).filter({ hasText: texto });

async function cursor(page: Page): Promise<string> {
  return ((await (await page.request.get("/api/tablero/cambios")).json()) as { cursor: string }).cursor;
}
async function huboCambio(page: Page, desde: string): Promise<boolean> {
  const r = await page.request.get(`/api/tablero/cambios?cursor=${encodeURIComponent(desde)}`);
  return ((await r.json()) as { cambio: boolean }).cambio;
}

/** Abre la ventana del job y espera a que termine de llegar; quien actúa es Ops Uno. */
async function abrir(page: Page, requestId: string) {
  await page.goto(`/job/${requestId}`);
  await expect(page.getByTestId("encabezado")).toBeVisible();
  await actuarComo(page, OPS_UNO);
  await esperarVentanaLista(page);
}

/** Elige el modo del Composer. Se repite hasta que la página se hidrata y React atiende el clic. */
async function elegirModo(page: Page, id: "customer" | "cleaner" | "note") {
  await expect(async () => {
    await modo(page, id).click();
    await expect(modo(page, id)).toHaveAttribute("aria-checked", "true", { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** Abre el menú Templates; se repite hasta que React atiende el clic. */
async function abrirMenu(page: Page) {
  await expect(async () => {
    await picker(page).click();
    await expect(opciones(page).first()).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** Elige una plantilla del menú y espera a que la caja traiga su texto. */
async function elegirPlantilla(page: Page, clave: string) {
  await abrirMenu(page);
  await page.locator(`[data-plantilla="${clave}"]`).click();
  await expect(caja(page)).not.toHaveValue("");
}

/** Deja todo lo que el operador escribe en la caja; Send solo se habilita con React ya hidratado. */
async function escribir(page: Page, texto: string) {
  await expect(async () => {
    await caja(page).fill(texto);
    await expect(caja(page)).toHaveValue(texto, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** Deja que lo enviado cierre: la tarea del ciclo reconcilia y la ranura dice cuántos envíos siguen abiertos. */
async function esperarCierre(page: Page) {
  await expect
    .poll(
      async () => {
        await page.reload();
        await esperarVentanaLista(page);
        return await conversacion(page).getAttribute("data-abiertas");
      },
      { timeout: 60_000, intervals: [2000] },
    )
    .toBe("0");
}

/** Pulsa Send y espera a que el envío salga como una sola burbuja "Sent" con el texto. */
async function enviarYEsperar(page: Page, tipo: "text" | "email", texto: string) {
  await expect(enviar(page)).toBeEnabled();
  await enviar(page).click();
  const b = burbuja(page, texto);
  await expect(b).toHaveCount(1);
  await expect(b).toHaveAttribute("data-tipo", tipo);
  await expect(b.getByTestId("estado-entrega").first()).toHaveText(/Sending…|Sent/);
  // Un instante, la instrucción y el mensaje de BzzzBX se ven a la vez: se espera a que quede una sola burbuja y "Sent".
  await expect(async () => {
    await expect(b).toHaveCount(1, { timeout: 2000 });
    await expect(b.getByTestId("estado-entrega")).toHaveText("Sent", { timeout: 2000 });
  }).toPass({ timeout: 60_000, intervals: [1000] });
  await esperarCierre(page);
  await expect(burbuja(page, texto)).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  await control(page, { accion: "reiniciar" });
});

test("T1 y T2: Confirmation request llena el job de R2 y, editada, sale como texto con su plantilla en el Audit", async ({ page }) => {
  test.setTimeout(150_000);
  const [{ d }] = await consultar<{ d: string }>("select to_char(service_date, 'YYYY-MM-DD') as d from opsrun.request where id = $1", [R(2)]);
  const esperado = `New job: ${R2_PROPIEDAD} ${R2_ESPACIO} on ${fechaCorta(d!)}, 9:00 AM-12:00 PM. Can you confirm?`;
  const antes = await marca();

  await abrir(page, R(2));
  await elegirModo(page, "cleaner");
  await abrirMenu(page);
  await expect(opciones(page)).toHaveCount(1);
  await expect(opciones(page).first()).toHaveText("Confirmation request");
  await page.locator('[data-plantilla="cleaner_confirmation_request"]').click();

  await expect(caja(page)).toHaveValue(esperado);
  await expect(conversacion(page).getByTestId("marca-plantilla")).toHaveText(/Template · Confirmation request/);
  await expect(conversacion(page).getByTestId("sms")).toContainText("1 SMS");
  await expect(conversacion(page).getByTestId("faltan")).toHaveCount(0);

  // T2: se agrega una frase, la marca se queda, y se envía.
  const editado = `${esperado} Thanks! ${etiquetaDelIntento()}`;
  await escribir(page, editado);
  await expect(conversacion(page).getByTestId("marca-plantilla")).toBeVisible();
  await enviarYEsperar(page, "text", editado);

  const envios = await enviosDespues(antes.audit, R(2));
  expect(envios).toHaveLength(1);
  expect(envios[0]!.event_type).toBe("text_sent");
  expect(envios[0]!.details).toMatchObject({ template_key: "cleaner_confirmation_request", template_version: 1 });
  expect(Object.keys(envios[0]!.payload).sort()).toEqual(["body", "bzzzbx_team_id"]);
  expect(envios[0]!.payload.body).toBe(editado);
});

test("T3: Reschedule request deja la fecha y la ventana nuevas a mano: Send espera a que se escriban", async ({ page }) => {
  test.setTimeout(150_000);
  const antes = await marca();
  await abrir(page, R(3));
  await elegirModo(page, "cleaner");
  await abrirMenu(page);
  await expect(opciones(page)).toHaveCount(1);
  await expect(opciones(page).first()).toHaveText("Reschedule request");
  await page.locator('[data-plantilla="reschedule_request"]').click();

  await expect(caja(page)).toHaveValue(`Can we move ${R3_PROPIEDAD} ${R3_UNIDAD} to {{date}}, {{window}}? Please confirm.`);
  await expect(conversacion(page).getByTestId("faltan")).toHaveText("Fill in: {{date}}, {{window}}");
  await expect(enviar(page)).toBeDisabled();

  const nuevo = `Can we move ${R3_PROPIEDAD} ${R3_UNIDAD} to ${fechaCorta(dia(3))}, 1:00 PM-4:00 PM? Please confirm. ${etiquetaDelIntento()}`;
  await escribir(page, nuevo);
  await expect(conversacion(page).getByTestId("faltan")).toHaveCount(0);
  await enviarYEsperar(page, "text", nuevo);

  const envios = await enviosDespues(antes.audit, R(3));
  expect(envios).toHaveLength(1);
  expect(envios[0]!.details).toMatchObject({ template_key: "reschedule_request", template_version: 1 });
});

test("T4: Scheduled notice de R3 sale como correo en el hilo, sin doble espacio, con To de solo lectura", async ({ page }) => {
  test.setTimeout(150_000);
  const antes = await marca();
  await abrir(page, R(3));
  await elegirModo(page, "customer");
  await expect(conversacion(page).getByTestId("para").locator("input, textarea")).toHaveCount(0);
  await abrirMenu(page);
  await expect(opciones(page)).toHaveCount(1);
  await expect(opciones(page).first()).toHaveText("Scheduled notice");
  await page.locator('[data-plantilla="requester_scheduled"]').click();

  const esperado = `Your cleaning at ${R3_PROPIEDAD} ${R3_UNIDAD} is scheduled for ${fechaCorta(dia(1))}, 10:00 AM–2:00 PM.`;
  await expect(caja(page)).toHaveValue(esperado);
  expect(await caja(page).inputValue()).not.toContain("  ");
  await expect(conversacion(page).getByTestId("para").locator("input, textarea")).toHaveCount(0);
  const editado = `${esperado} ${etiquetaDelIntento()}`;
  await escribir(page, editado);
  await enviarYEsperar(page, "email", editado);

  const envios = await enviosDespues(antes.audit, R(3));
  expect(envios).toHaveLength(1);
  expect(envios[0]!.event_type).toBe("email_sent");
  expect(envios[0]!.details).toMatchObject({ template_key: "requester_scheduled", template_version: 1 });
  expect(Object.keys(envios[0]!.payload).sort()).toEqual(["body", "bzzzbx_thread_id"]);
});

test("T5: Done notice solo desde Validation: R6 la ofrece y la envía; R4 (In Progress) no", async ({ page }) => {
  test.setTimeout(150_000);
  await abrir(page, R(4));
  await elegirModo(page, "customer");
  await abrirMenu(page);
  await expect(opciones(page)).toHaveCount(1);
  await expect(opciones(page).first()).toHaveText("Scheduled notice");
  await expect(page.locator('[data-plantilla="requester_done"]')).toHaveCount(0);

  const antes = await marca();
  await abrir(page, R(6));
  await elegirModo(page, "customer");
  await abrirMenu(page);
  await expect(opciones(page)).toHaveText(["Scheduled notice", "Done notice"]);
  await page.locator('[data-plantilla="requester_done"]').click();

  // R6 no tiene espacio ni unidad: el espacio se colapsa y no queda un doble espacio.
  const esperado = `The cleaning at ${R6_PROPIEDAD} is done.`;
  await expect(caja(page)).toHaveValue(esperado);
  expect(esperado).not.toContain("  ");
  const editado = `${esperado} ${etiquetaDelIntento()}`;
  await escribir(page, editado);
  await enviarYEsperar(page, "email", editado);

  const envios = await enviosDespues(antes.audit, R(6));
  expect(envios).toHaveLength(1);
  expect(envios[0]!.details).toMatchObject({ template_key: "requester_done", template_version: 1 });
});

test("T6 y T7: Notices es una vista previa de solo lectura con Copy, y Copy no escribe nada", async ({ page }) => {
  await abrir(page, R(3));
  const sinCambios = await marca();
  const cambios = await cursor(page);

  const programado = aviso(page, "requester_scheduled");
  await expect(avisos(page)).toBeVisible();
  await expect(programado).toContainText("Scheduled notice");
  await expect(programado).toContainText("Email");
  const texto = `Your cleaning at ${R3_PROPIEDAD} ${R3_UNIDAD} is scheduled for ${fechaCorta(dia(1))}, 10:00 AM–2:00 PM.`;
  await expect(programado.getByTestId("aviso-texto")).toHaveText(texto);
  await expect(programado.locator('[data-estado="no-enviado"]')).toHaveText(`Not sent · ${FASE_B}`);
  await expect(aviso(page, "requester_done")).toHaveCount(0);
  // Solo lectura: nada que envíe dentro del panel.
  await expect(avisos(page).getByRole("button")).toHaveText(["Copy"]);
  await expect(avisos(page).locator("form, [data-testid='enviar']")).toHaveCount(0);

  await expect(async () => {
    await programado.getByTestId("copiar-aviso").click();
    await expect(programado.getByTestId("copiar-aviso")).toHaveText("Copied", { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(texto);

  // R6 (Validation) muestra Scheduled y Done; R2 (Requests) no pinta la sección.
  await abrir(page, R(6));
  await expect(avisos(page).locator('[data-testid="aviso"]')).toHaveCount(2);
  await expect(aviso(page, "requester_done")).toContainText(`The cleaning at ${R6_PROPIEDAD} is done.`);
  await expect(aviso(page, "requester_done").locator('[data-estado="no-enviado"]')).toHaveText(`Not sent · ${FASE_B}`);

  // T7: Copy del Composer copia la caja, incluida una edición.
  await abrir(page, R(2));
  await expect(avisos(page)).toHaveCount(0);
  await elegirModo(page, "cleaner");
  await elegirPlantilla(page, "cleaner_confirmation_request");
  const editado = `${await caja(page).inputValue()} See you there.`;
  await escribir(page, editado);
  await expect(async () => {
    await conversacion(page).getByTestId("copiar").click();
    await expect(conversacion(page).getByTestId("copiar")).toHaveText("Copied", { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(editado);

  // Ni copiar ni elegir una plantilla escribieron nada: ninguna instrucción, ningún Audit, el cursor quieto.
  const despues = await marca();
  expect(despues).toEqual(sinCambios);
  expect(await huboCambio(page, cambios)).toBe(false);
});

test("T8: con el job cancelado, el Composer queda en gris sin Templates y Notices trae las dos de cancelación", async ({ page }) => {
  await control(page, { accion: "cambiar", entidad: "job", id: "bx-job-0003", parche: { status: "cancelled" } });
  await abrir(page, R(3));
  await expect(page.getByTestId("stage")).toHaveText("Cancelled", UNA_VUELTA);
  for (const id of ["customer", "cleaner", "note"]) {
    await expect(modo(page, id)).toHaveAttribute("aria-disabled", "true");
    await expect(modo(page, id)).toContainText("Job cancelled");
  }
  await expect(picker(page)).toHaveCount(0);

  const fecha = fechaCorta(dia(1));
  const cleaner = aviso(page, "cancellation_cleaner");
  const requester = aviso(page, "cancellation_requester");
  await expect(cleaner).toContainText("Cancellation (cleaner)");
  await expect(cleaner).toContainText("Text");
  await expect(cleaner.getByTestId("aviso-texto")).toHaveText(`The job at ${R3_PROPIEDAD} ${R3_UNIDAD} on ${fecha} is cancelled.`);
  await expect(requester).toContainText("Cancellation (requester)");
  await expect(requester).toContainText("Email");
  await expect(requester.getByTestId("aviso-texto")).toHaveText(`The cleaning at ${R3_PROPIEDAD} ${R3_UNIDAD} on ${fecha} has been cancelled.`);
  for (const a of [cleaner, requester]) {
    await expect(a.locator('[data-estado="no-enviado"]')).toHaveText(`Not sent · ${FASE_B}`);
    await expect(a.getByTestId("copiar-aviso")).toBeVisible();
  }
  await expect(aviso(page, "requester_scheduled")).toHaveCount(0);
});

test("T10: una plantilla que no es de este modo o etapa se rechaza en el servidor, y sin BzzzBX el picker se apaga", async ({ page }) => {
  test.setTimeout(120_000);
  await abrir(page, R(2));
  await elegirModo(page, "cleaner");
  await elegirPlantilla(page, "cleaner_confirmation_request");
  const antes = await marca();
  const cambios = await cursor(page);

  // La Server Action es la defensa, no el picker: se cambia la clave en lo que sale del navegador.
  for (const impostora of ["reschedule_request", "requester_scheduled", "cualquier_cosa"]) {
    await page.route("**/*", async (ruta) => {
      const pedido = ruta.request();
      const cuerpo = pedido.postData();
      if (pedido.method() === "POST" && pedido.headers()["next-action"] && cuerpo?.includes("cleaner_confirmation_request")) {
        await ruta.continue({ postData: cuerpo.replace('"template_key":"cleaner_confirmation_request"', `"template_key":"${impostora}"`) });
      } else {
        await ruta.continue();
      }
    });
    await expect(enviar(page)).toBeEnabled();
    await enviar(page).click();
    await expect(conversacion(page).getByTestId("error-composer")).toHaveText("That template is not available here.");
    await page.unroute("**/*");
  }
  expect(await marca()).toEqual(antes);
  expect(await huboCambio(page, cambios)).toBe(false);
  await expect(conversacion(page).getByTestId("marca-plantilla")).toBeVisible();

  // Con BzzzBX caído, el modo elegido se apaga con su picker; y el panel conserva lo último leído, con su aviso.
  await abrir(page, R(3));
  await elegirModo(page, "customer");
  await expect(picker(page)).toBeEnabled();
  const texto = `Your cleaning at ${R3_PROPIEDAD} ${R3_UNIDAD} is scheduled for ${fechaCorta(dia(1))}, 10:00 AM–2:00 PM.`;
  await expect(aviso(page, "requester_scheduled").getByTestId("aviso-texto")).toHaveText(texto);
  await control(page, { accion: "no_disponible", valor: true });
  await expect(picker(page)).toBeDisabled(UNA_VUELTA);
  await expect(picker(page)).toHaveAttribute("title", "BzzzBX unavailable");
  await expect(conversacion(page).getByTestId("avisos-caida")).toContainText("BzzzBX unavailable · last update");
  await expect(aviso(page, "requester_scheduled").getByTestId("aviso-texto")).toHaveText(texto);
});
