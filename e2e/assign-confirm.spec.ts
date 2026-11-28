import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

/**
 * Assign / Reassign y Confirm details, sender y cleaner (OPR-28, criterios D1 a
 * D5 del spec docs/spec/opr-28-assign-confirm.md §9.3) contra el build de
 * producción, la seed y el stand-in de BzzzBX, con OPSRUN_ACTOR_DEMO=1 y
 * OPSRUN_ZONA_HORARIA=America/New_York fijos en playwright.config.mts.
 *
 * Corre en su propio proyecto, después del resto (`dependencies`), porque D1
 * enlaza R8 y R8 solo se puede enlazar una vez por base: en una base ya usada
 * (R8 enlazada) D1 se salta; con una base nueva corre. Lo que cambia el dueño de
 * R2 (D3 y D5) lo devuelve a Ops Uno al terminar, para que las demás pruebas la
 * vean como la seed.
 */
test.describe.configure({ mode: "serial" });

const R = (n: number) => `b0000000-0000-4000-8000-0000000000a${n}`;
const OPS_UNO = "0a000000-0000-4000-8000-0000000000a1";
const OPS_DOS = "0a000000-0000-4000-8000-0000000000a2";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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

const estadoDeR8 = async () =>
  (await consultar<{ status: string }>("select status::text as status from opsrun.request where id = $1", [R(8)]))[0]!.status;

const contar = async (sql: string, parametros: unknown[]) => Number((await consultar<{ n: string }>(sql, parametros))[0]!.n);

const pestana = (page: Page, id: string) => page.locator(`[data-testid="pestana"][data-pestana="${id}"]`);
const ENLACE = '[data-ranura="enlace"]';
const audit = (page: Page) => page.locator('[data-ranura="audit"]');

async function actuarComo(page: Page, operadorId: string) {
  const selector = page.getByLabel("Acting as");
  await expect(async () => {
    await selector.selectOption(operadorId);
    await expect(selector).toHaveValue(operadorId, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

/** Elige una acción en la action bar, esperando a que la página termine de hidratarse. */
async function elegirAccion(page: Page, codigo: string) {
  await expect(async () => {
    await page.getByTestId("accion").selectOption("");
    await page.getByTestId("accion").selectOption(codigo);
    await expect(page.getByTestId("panel-accion")).toHaveAttribute("data-accion", codigo, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/** Elige la acción tal como la muestra la barra, aunque no corra: le quita el `disabled` a la opción. */
async function elegirAunqueEsteDeshabilitada(page: Page, codigo: string) {
  await expect(async () => {
    await page.getByTestId("accion").evaluate((select: HTMLSelectElement, valor) => {
      for (const o of select.options) o.disabled = false;
      select.value = valor;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, codigo);
    await expect(page.getByTestId("panel-accion")).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

const resultado = (page: Page) => page.getByTestId("resultado-accion");
const operador = (page: Page, id: string) => page.locator(`[data-testid="opcion-operador"][data-operador="${id}"]`);

/** Reasigna con el panel: el operador elegido y Go. */
async function asignarA(page: Page, id: string, motivo?: string) {
  await elegirAccion(page, "assign");
  await operador(page, id).getByRole("radio").check();
  if (motivo) await page.getByTestId("motivo").fill(motivo);
  await page.getByTestId("go").click();
  await expect(resultado(page)).toHaveText("Saved");
}

test.beforeEach(async ({ page }) => {
  await control(page, { accion: "reiniciar" });
});

test("D2: los bloqueos se ven en la barra, con su razón", async ({ page }) => {
  const opcion = (codigo: string) => page.locator(`[data-testid="accion"] option[value="${codigo}"]`);

  await page.goto(`/job/${R(1)}`);
  await expect(page.getByTestId("barra-acciones")).toBeVisible();
  await expect(opcion("confirm_details")).toBeDisabled();
  await expect(opcion("confirm_details")).toHaveText("Confirm details — Complete the details first: Service, Date, Window");
  await expect(opcion("confirm_sender")).toHaveText("Confirm sender — Choose who it is from first");
  await expect(opcion("confirm_cleaner")).toHaveText("Confirm cleaner — Choose a cleaner first");
  // Assign no tiene bloqueo: R1 no tiene dueño y se puede asignar.
  await expect(opcion("assign")).toBeEnabled();

  await page.goto(`/job/${R(2)}`);
  await expect(page.getByTestId("barra-acciones")).toBeVisible();
  await expect(opcion("confirm_details")).toHaveText("Confirm details — Already confirmed");
  await expect(opcion("confirm_sender")).toHaveText("Confirm sender — Already confirmed");
  await expect(opcion("confirm_details")).toBeDisabled();
  await expect(opcion("confirm_sender")).toBeDisabled();
  // R2 tiene equipo en el borrador y su cleaner sin confirmar: esa sí corre.
  await expect(opcion("confirm_cleaner")).toBeEnabled();
});

test("D4: no corre forzando el disabled: el servidor dice Already confirmed y no escribe nada", async ({ page }) => {
  await page.goto(`/job/${R(2)}`);
  await expect(page.getByTestId("barra-acciones")).toBeVisible();
  await actuarComo(page, OPS_UNO);

  const cursor = async () => (await (await page.request.get("/api/tablero/cambios")).json()) as { cursor: string };
  const antes = await cursor();
  const eventosAntes = await contar("select count(*)::text as n from opsrun.audit_event where request_id = $1", [R(2)]);

  await elegirAunqueEsteDeshabilitada(page, "confirm_details");
  const go = page.getByTestId("go");
  await expect(go).toBeDisabled();
  // Se quita el disabled como lo haría quien manipula la página. React ignora los clics sobre un
  // botón cuya prop es disabled: el clic se entrega directo al manejador, que es lo que llega al servidor.
  await go.evaluate((boton: HTMLButtonElement) => {
    boton.removeAttribute("disabled");
    const clave = Object.keys(boton).find((k) => k.startsWith("__reactProps"))!;
    (boton as unknown as Record<string, { onClick: () => void }>)[clave].onClick();
  });
  await expect(resultado(page)).toHaveText("Already confirmed");
  await expect(resultado(page)).toHaveAttribute("data-tipo", "rechazada");

  expect(await cursor()).toEqual(antes);
  expect(await contar("select count(*)::text as n from opsrun.audit_event where request_id = $1", [R(2)])).toBe(eventosAntes);
});

test("D3: un cambio concurrente se rechaza y no confirma nada", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const contexto2 = await browser.newContext({ baseURL: baseURL! });
  const contexto1 = await browser.newContext({ baseURL: baseURL! });
  try {
    // El primero abre R2 y deja a medias Confirm cleaner por teléfono. Su sondeo no corre: no se entera del cambio.
    const primero = await contexto1.newPage();
    await primero.route("**/api/tablero/cambios**", (ruta) => ruta.abort());
    await primero.goto(`/job/${R(2)}`);
    await expect(primero.getByTestId("barra-acciones")).toBeVisible();
    await actuarComo(primero, OPS_UNO);
    await elegirAccion(primero, "confirm_cleaner");
    await primero.getByRole("radio", { name: "Confirm by phone" }).check();
    await expect(primero.getByTestId("go")).toBeEnabled();

    // El segundo reasigna R2 a Ops Dos: cambia su versión.
    const segundo = await contexto2.newPage();
    await segundo.goto(`/job/${R(2)}`);
    await expect(segundo.getByTestId("barra-acciones")).toBeVisible();
    await actuarComo(segundo, OPS_DOS);
    await asignarA(segundo, OPS_DOS);
    await expect(segundo.getByTestId("asignado")).toHaveText("Ops Dos");

    // El primero, con la versión de antes, no confirma.
    await primero.getByTestId("go").click();
    await expect(resultado(primero)).toHaveText("This job changed. Review and try again.");
    await expect(resultado(primero)).toHaveAttribute("data-tipo", "rechazada");
    expect(await contar("select count(*)::text as n from opsrun.audit_event where request_id = $1 and event_type = 'cleaner_confirmed'", [R(2)])).toBe(0);
    expect(await contar("select count(*)::text as n from opsrun.request_confirmation where request_id = $1 and kind = 'cleaner'", [R(2)])).toBe(0);

    // Devuelve R2 a Ops Uno para las demás pruebas.
    await actuarComo(segundo, OPS_DOS);
    await asignarA(segundo, OPS_UNO);
    await expect(segundo.getByTestId("asignado")).toHaveText("Ops Uno");
  } finally {
    await contexto1.close();
    await contexto2.close();
  }
});

test("D5: con BzzzBX caído Assign sigue disponible y asigna: el encabezado lo muestra", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/job/${R(2)}`);
  await expect(page.getByTestId("barra-acciones")).toBeVisible();
  await actuarComo(page, OPS_UNO);
  await expect(page.getByTestId("asignado")).toHaveText("Ops Uno");

  await control(page, { accion: "no_disponible", valor: true });
  try {
    await page.reload();
    await expect(page.getByTestId("franja-bzzzbx")).toBeVisible();
    // Las que mandan algo a BzzzBX se bloquean; Assign y Confirm, que solo escriben en opsRUN, no.
    const opcion = (codigo: string) => page.locator(`[data-testid="accion"] option[value="${codigo}"]`);
    await expect(opcion("ask_cleaner")).toBeDisabled();
    await expect(opcion("assign")).toBeEnabled();
    await expect(opcion("confirm_cleaner")).toBeEnabled();

    await asignarA(page, OPS_DOS);
    await expect(page.getByTestId("asignado")).toHaveText("Ops Dos");
    // El panel de Confirm sigue abriendo con BzzzBX caído (muestra lo último leído, o — — si no hay nada).
    await elegirAccion(page, "confirm_cleaner");
    await expect(page.getByTestId("confirmar-cleaner")).toBeVisible();
  } finally {
    await control(page, { accion: "no_disponible", valor: false });
  }
  // La devuelve a Ops Uno, con BzzzBX otra vez disponible.
  await page.reload();
  await expect(page.getByTestId("barra-acciones")).toBeVisible();
  await asignarA(page, OPS_UNO);
  await expect(page.getByTestId("asignado")).toHaveText("Ops Uno");
});

test("D1: R8 nueva → asignar → 3 confirmaciones → enlazar", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  // R8 se enlaza una sola vez por base: en una base ya usada esta prueba se salta limpio.
  test.skip((await estadoDeR8()) !== "open" && testInfo.retry === 0, "R8 ya está enlazada en esta base: se necesita una base nueva");
  const yaEnlazada = (await estadoDeR8()) !== "open";

  if (!yaEnlazada) {
    // R8 llega sin dueño y abre en Alerts por OPS-001.
    await page.goto(`/job/${R(8)}`);
    await expect(page.getByTestId("encabezado")).toBeVisible();
    await expect(page.getByTestId("stage")).toHaveText("Requests");
    await expect(page.getByTestId("asignado")).toHaveText("Unassigned");
    await expect(pestana(page, "alerts")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("alertas-needs-action").getByTestId("alerta")).toHaveAttribute("data-regla", "OPS-001");

    await actuarComo(page, OPS_UNO);

    // Assign to me.
    await elegirAccion(page, "assign");
    await expect(page.getByTestId("modo-assign")).toHaveText("Assign this request to");
    await expect(page.getByTestId("go")).toBeDisabled();
    await page.getByTestId("assign-to-me").click();
    await expect(page.getByTestId("go")).toBeEnabled();
    await page.getByTestId("go").click();
    await expect(resultado(page)).toHaveText("Saved");
    await expect(page.getByTestId("asignado")).toHaveText("Ops Uno");

    // Reassign a Ops Dos, con motivo.
    await asignarA(page, OPS_DOS, "Covering the weekend");
    await expect(page.getByTestId("asignado")).toHaveText("Ops Dos");

    // Confirm details: el panel muestra lo que se confirma, con la marca AI de la propiedad.
    await elegirAccion(page, "confirm_details");
    const detalles = page.getByTestId("panel-confirm-details");
    await expect(detalles.getByTestId("confirmar-property")).toContainText("Mock Gardens");
    await expect(detalles.getByTestId("confirmar-service")).toContainText("Deep clean");
    await expect(detalles.getByTestId("confirmar-property").getByTestId("marca-ai")).toBeVisible();
    await expect(detalles.getByTestId("confirmar-service").getByTestId("marca-ai")).toHaveCount(0);
    await page.getByTestId("go").click();
    await expect(resultado(page)).toHaveText("Saved");

    // Confirm sender.
    await elegirAccion(page, "confirm_sender");
    await expect(page.getByTestId("confirmar-customer")).toContainText("Demo Housing Co");
    await expect(page.getByTestId("confirmar-contact")).toContainText("Contact Four");
    await page.getByTestId("go").click();
    await expect(resultado(page)).toHaveText("Saved");

    // Confirm cleaner por teléfono: sin una respuesta del cleaner no se ofrece "Cleaner replied yes".
    await elegirAccion(page, "confirm_cleaner");
    await expect(page.getByTestId("confirmar-cleaner")).toContainText("Team Gamma");
    await expect(page.getByRole("radio", { name: "Cleaner replied yes" })).toHaveCount(0);
    await expect(page.getByTestId("go")).toBeDisabled();
    await page.getByRole("radio", { name: "Confirm by phone" }).check();
    await page.getByTestId("motivo").fill("Called the cleaner");
    await page.getByTestId("go").click();
    await expect(resultado(page)).toHaveText("Saved");

    // Las tres ya están confirmadas: las acciones dicen por qué no corren.
    await expect(page.locator('[data-testid="accion"] option[value="confirm_details"]')).toHaveText("Confirm details — Already confirmed");

    // La ranura del enlace ya no pide nada, y bx-job-0108 es el candidato sugerido.
    await page.getByTestId("accion").selectOption("");
    await pestana(page, "property").click();
    await expect(page.locator(ENLACE)).toHaveAttribute("data-gate", "ODSC");
    await expect(page.getByTestId("gate-enlace")).toHaveCount(0);
    const fila = page.locator(`${ENLACE} [data-testid="candidato-enlace"][data-job="bx-job-0108"]`);
    await expect(fila).toBeVisible();
    await expect(fila.getByTestId("sugerido")).toHaveText("Suggested");
    await expect(fila).toContainText("EX-00108");
    await expect(async () => {
      await fila.getByRole("button", { name: "Confirm EX-00108" }).click();
      await expect(page.getByTestId("stage")).toHaveText("Scheduled", { timeout: 2000 });
    }).toPass({ timeout: 15_000 });
  } else {
    await page.goto(`/job/${R(8)}`);
  }

  await expect(page.getByTestId("stage")).toHaveText("Scheduled");
  await expect(page.getByTestId("asignado")).toHaveText("Ops Dos");

  // Audit cuenta la historia, en orden y con Ops Uno como persona de cada paso.
  await page.goto(`/job/${R(8)}?tab=audit`);
  await expect(audit(page).getByRole("list", { name: "Audit" })).toBeVisible();
  expect(await audit(page).getByTestId("audit-evento").allInnerTexts()).toEqual([
    "Request received",
    // La OPS-001 de la seed (bx-alert-0005), que el registrador de alertas anota al abrirse (OPR-34).
    "Alert opened",
    "Assigned",
    "Reassigned",
    "Details confirmed",
    "AI suggestion accepted",
    "Sender confirmed",
    "Cleaner confirmed",
    "Scheduled",
  ]);
  const filaDe = (evento: string) =>
    audit(page).getByTestId("audit-fila").filter({ has: page.getByTestId("audit-evento").getByText(evento, { exact: true }) });
  await expect(filaDe("Assigned")).toContainText("to Ops Uno");
  await expect(filaDe("Assigned")).toContainText("Original");
  await expect(filaDe("Reassigned")).toContainText("from Ops Uno to Ops Dos");
  await expect(filaDe("Reassigned")).not.toContainText("Original");
  await expect(filaDe("Reassigned").getByTestId("audit-motivo")).toHaveText("Reason: Covering the weekend");
  await expect(filaDe("Cleaner confirmed")).toContainText("by phone");
  await expect(filaDe("Cleaner confirmed").getByTestId("audit-motivo")).toHaveText("Reason: Called the cleaner");
  await expect(filaDe("Scheduled")).toContainText("linked to observed job EX-00108");
  for (const evento of ["Assigned", "Reassigned", "Details confirmed", "Sender confirmed", "Cleaner confirmed", "Scheduled"]) {
    await expect(filaDe(evento).getByTestId("audit-persona"), evento).toHaveText("Ops Uno");
  }
  // Ni crosswalk IDs ni uuids a la vista.
  const texto = await audit(page).innerText();
  expect(texto).not.toMatch(/bx-/i);
  expect(texto).not.toMatch(UUID);

  // Lo que la base guardó: valores del borrador y crosswalk IDs, sin nombres; y ninguna instrucción a BzzzBX.
  const confirmaciones = await consultar<{ kind: string; method: string; confirmed_value: Record<string, unknown> }>(
    "select kind::text, method::text, confirmed_value from opsrun.request_confirmation where request_id = $1 order by kind",
    [R(8)],
  );
  expect(confirmaciones.map((c) => [c.kind, c.method])).toEqual([
    ["cleaner", "phone"],
    ["details", "operator"],
    ["sender", "operator"],
  ]);
  expect(confirmaciones.find((c) => c.kind === "sender")!.confirmed_value).toEqual({
    bzzzbx_customer_id: "bx-cust-0003",
    bzzzbx_contact_id: "bx-cont-0004",
  });
  expect(JSON.stringify(confirmaciones)).not.toMatch(/Mock Gardens|Demo Housing|Team Gamma|555/);
  expect(await contar("select count(*)::text as n from opsrun.instruction where request_id = $1", [R(8)])).toBe(0);
  expect(await consultar("select decision::text from opsrun.ai_suggestion where request_id = $1", [R(8)])).toEqual([{ decision: "accepted" }]);
});
