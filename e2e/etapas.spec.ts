import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

/**
 * In Progress, Complete y Validation hasta Paid (OPR-30, OPR-31 y OPR-32,
 * criterios E1 a E9 del spec docs/spec/opr-30-31-32-etapas.md §10.3) contra el
 * build de producción, la seed y el stand-in de BzzzBX, con OPSRUN_ACTOR_DEMO=1 y
 * OPSRUN_ZONA_HORARIA=America/New_York fijos en playwright.config.mts.
 *
 * Corre en su propio proyecto, después de `chromium-assign`, porque E1 lleva R8 de
 * Scheduled a Paid y E5 aprueba R5 (los dos una vez por base), y E2 limpia la alerta
 * de R4 (también una vez). En una base ya usada esas pruebas se saltan limpio; con
 * una base nueva corren.
 *
 * Los criterios E6, E7 y E8 van dentro de E1 y E5 por la misma razón: cada uno
 * necesita un job en una etapa concreta y solo R8 y R5 la atraviesan una vez:
 * - E6 (no corre forzando el `disabled`): en E1, con el job en Validation sin PO
 *   y el cliente que lo exige; End manually en su propia prueba (R4).
 * - E7 (BzzzBX caído): en E1, Approve, Mark as OSS y Enter PO corren; Validate
 *   queda en gris con "BzzzBX unavailable".
 * - E8 (cambio concurrente): en E5, con R5.
 * El observador de hechos de PINCH (Checked in, Started, Completed, Paid · Observed)
 * corre en el ciclo de fondo (tarea `observador_etapas`, cada 15 s): E1 espera a que
 * escriba los de R8 y comprueba que Audit los trae marcados como observados.
 */
test.describe.configure({ mode: "serial" });

const R = (n: number) => `b0000000-0000-4000-8000-0000000000a${n}`;
const OPS_UNO = "0a000000-0000-4000-8000-0000000000a1";
const OPS_DOS = "0a000000-0000-4000-8000-0000000000a2";
const FINANCE_UNO = "0a000000-0000-4000-8000-0000000000b1";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const MIN = 60_000;
const hace = (ms: number) => new Date(Date.now() - ms).toISOString();

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

const contar = async (sql: string, parametros: unknown[]) => Number((await consultar<{ n: string }>(sql, parametros))[0]!.n);
const estadoDe = async (id: string) =>
  (await consultar<{ status: string; approved: boolean; validated: boolean }>(
    "select status::text, approved_at is not null as approved, validated_at is not null as validated from opsrun.request where id = $1",
    [id],
  ))[0]!;

const pestana = (page: Page, id: string) => page.locator(`[data-testid="pestana"][data-pestana="${id}"]`);
const columna = (page: Page, etapa: string) => page.locator(`[data-testid="columna"][data-etapa="${etapa}"]`);
const audit = (page: Page) => page.locator('[data-ranura="audit"]');
// La ranura ya cargada (no el marcador "Loading…" del Suspense, que lleva el mismo `data-ranura`).
const tracker = (page: Page) => page.locator('section[data-ranura="tracker"]');
const billing = (page: Page) => page.locator('section[data-ranura="billing"]');
const resultado = (page: Page) => page.getByTestId("resultado-accion");
/** Una escritura puede tardar con la máquina cargada: el servidor escribe, vuelve a leer y refresca. */
const GUARDADO = { timeout: 20_000 };
const opcion = (page: Page, codigo: string) => page.locator(`[data-testid="accion"] option[value="${codigo}"]`);
const cursor = async (page: Page) => ((await (await page.request.get("/api/tablero/cambios")).json()) as { cursor: string }).cursor;

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

/** Quita el `disabled` de Go y entrega el clic al manejador de React: lo que llega al servidor es lo mismo. El servidor decide. */
async function pulsarGoForzado(page: Page) {
  await page.getByTestId("go").evaluate((boton: HTMLButtonElement) => {
    boton.removeAttribute("disabled");
    const clave = Object.keys(boton).find((k) => k.startsWith("__reactProps"))!;
    (boton as unknown as Record<string, { onClick: () => void }>)[clave].onClick();
  });
}

/** Una acción sin panel propio o con el panel ya completo: la elige y pulsa Go. */
async function correrAccion(page: Page, codigo: string, motivo?: string) {
  await elegirAccion(page, codigo);
  if (motivo !== undefined) await page.getByTestId("motivo").fill(motivo);
  await expect(page.getByTestId("go")).toBeEnabled();
  await page.getByTestId("go").click();
  await expect(resultado(page)).toHaveText("Saved", GUARDADO);
}

/**
 * Approve & confirm: el job pasa a Validation y la acción deja de ser de esta etapa, así que el panel
 * desaparece con la ventana nueva y no queda un "Saved" que mirar: se espera la etapa nueva.
 */
async function aprobar(page: Page) {
  await elegirAccion(page, "approve_confirm");
  await expect(page.getByTestId("go")).toBeEnabled();
  await page.getByTestId("go").click();
  await expect(page.getByTestId("stage")).toHaveText("Validation", { timeout: 60_000 });
}

async function abrir(page: Page, id: string, tab?: string) {
  await page.goto(`/job/${id}${tab ? `?tab=${tab}` : ""}`);
  await expect(page.getByTestId("encabezado")).toBeVisible();
  await expect(page.getByTestId("barra-acciones")).toBeVisible();
}

/** Recarga la ventana con lo que pasó en el origen (sin esperar al sondeo de 15 s). */
async function recargar(page: Page, id: string, tab?: string) {
  await abrir(page, id, tab);
}

const eventosDeAudit = (page: Page) => audit(page).getByTestId("audit-evento").allInnerTexts();
const filaDeAudit = (page: Page, evento: string, indice = 0) =>
  audit(page)
    .getByTestId("audit-fila")
    .filter({ has: page.getByTestId("audit-evento").getByText(evento, { exact: true }) })
    .nth(indice);

/** Lleva R8 de Requests a Scheduled (D1 de OPR-28), por si assign-confirm no corrió o se saltó. */
async function llevarR8AScheduled(page: Page) {
  await abrir(page, R(8));
  await actuarComo(page, OPS_UNO);
  await elegirAccion(page, "assign");
  await page.getByTestId("assign-to-me").click();
  await page.getByTestId("go").click();
  await expect(resultado(page)).toHaveText("Saved", GUARDADO);
  await correrAccion(page, "confirm_details");
  await correrAccion(page, "confirm_sender");
  await elegirAccion(page, "confirm_cleaner");
  await page.getByRole("radio", { name: "Confirm by phone" }).check();
  await page.getByTestId("go").click();
  await expect(resultado(page)).toHaveText("Saved", GUARDADO);
  await page.getByTestId("accion").selectOption("");
  await pestana(page, "property").click();
  const fila = page.locator('[data-ranura="enlace"] [data-testid="candidato-enlace"][data-job="bx-job-0108"]');
  await expect(async () => {
    await fila.getByRole("button", { name: "Confirm EX-00108" }).click();
    await expect(page.getByTestId("stage")).toHaveText("Scheduled", { timeout: 2000 });
  }).toPass({ timeout: 15_000 });
}

test.beforeEach(async ({ page }) => {
  await control(page, { accion: "reiniciar" });
});

test("E3: Job tracker de R4: estado y ventana en una fila, Arrival y Start con hora, End `— —`, running con la esperada y Running long", async ({ page }) => {
  await abrir(page, R(4), "tracker");
  await expect(pestana(page, "tracker")).toHaveAttribute("aria-selected", "true");
  await expect(tracker(page)).toBeVisible();
  await expect(page.getByTestId("tracker-etapa")).toHaveText("In Progress");
  await expect(page.getByTestId("tracker-ventana")).toHaveText(/^\w{3}, \w{3} \d{1,2} · 8:00 AM–11:00 AM$/);
  await expect(page.getByTestId("tracker-llegada")).toContainText(/\w{3} \d{1,2}, \d{1,2}:\d{2} (AM|PM)/);
  await expect(page.getByTestId("tracker-inicio")).toContainText(/\w{3} \d{1,2}, \d{1,2}:\d{2} (AM|PM)/);
  await expect(page.getByTestId("tracker-fin")).toContainText("— —");
  await expect(page.getByTestId("tracker-duracion")).toContainText("running");
  await expect(page.getByTestId("tracker-duracion")).toContainText("expected 3h 00m");
  await expect(page.getByTestId("sin-fotos")).toHaveText("No photos");
  // Mientras la MEC-003 está abierta (opsRUN no la ha limpiado), el chip.
  const limpiada = (await contar("select count(*)::text as n from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-0006' and resolved_at is not null", [])) > 0;
  if (limpiada) await expect(page.getByTestId("chip-running-long")).toHaveCount(0);
  else await expect(page.getByTestId("chip-running-long")).toHaveText("Running long");
});

test("E2: Clear alert exige motivo; con motivo, Audit dice 'Alert cleared' con su razón, y la alerta deja de contar aunque BzzzBX la dé abierta", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const limpiada = async () =>
    (await contar("select count(*)::text as n from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-0006' and resolved_at is not null", [])) > 0;
  test.skip((await limpiada()) && testInfo.retry === 0, "La MEC-003 de R4 ya está limpiada en esta base: se necesita una base nueva");

  await abrir(page, R(4));
  await actuarComo(page, OPS_UNO);
  // R4 abre en Alerts: la MEC-003 pide acción.
  await expect(pestana(page, "alerts")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("alerta")).toHaveAttribute("data-regla", "MEC-003");
  await expect(opcion(page, "end_job_manually")).toBeDisabled();

  if (!(await limpiada())) {
    await elegirAccion(page, "clear_alert");
    await expect(page.getByTestId("alerta-limpiable")).toContainText("MEC-003 Running long");
    await expect(page.getByTestId("go")).toBeDisabled();
    await page.getByTestId("motivo").fill("   ");
    await expect(page.getByTestId("go")).toBeDisabled();
    await page.getByTestId("motivo").fill("Large unit, called ahead.");
    await expect(page.getByTestId("go")).toBeEnabled();
    await page.getByTestId("go").click();
    await expect(resultado(page)).toHaveText("Saved", GUARDADO);
  }

  // Deja de contar en la ventana y en el tablero, aunque el stand-in de BzzzBX la siga dando abierta (P-7).
  await recargar(page, R(4));
  await expect(page.getByTestId("conteo-alertas")).toHaveCount(0);
  await expect(opcion(page, "clear_alert")).toHaveText("Clear alert — No alert to clear");
  await expect(opcion(page, "clear_alert")).toBeDisabled();
  await page.goto("/");
  await expect(columna(page, "in_progress").getByTestId("alertas-columna")).toHaveCount(0);

  await abrir(page, R(4), "audit");
  const cleared = filaDeAudit(page, "Alert cleared");
  await expect(cleared).toContainText("MEC-003 Running long");
  await expect(cleared).toContainText("Cleared by operator");
  await expect(cleared.getByTestId("audit-motivo")).toHaveText("Reason: Large unit, called ahead.");
  await expect(cleared.getByTestId("audit-persona")).toHaveText("Ops Uno");
});

test("E6 (End manually): no corre forzando el disabled: 'Available when actions are switched on' y el cursor no cambia", async ({ page }) => {
  await abrir(page, R(4));
  await actuarComo(page, OPS_UNO);
  await expect(opcion(page, "end_job_manually")).toHaveText("End manually — Available when actions are switched on");
  await expect(opcion(page, "end_job_manually")).toBeDisabled();
  const antes = await cursor(page);
  const eventosAntes = await contar("select count(*)::text as n from opsrun.audit_event where request_id = $1", [R(4)]);
  await elegirAunqueEsteDeshabilitada(page, "end_job_manually");
  await page.getByTestId("motivo").fill("Cleaner finished but the app did not sync.");
  await pulsarGoForzado(page);
  await expect(resultado(page)).toHaveText("Available when actions are switched on");
  await expect(resultado(page)).toHaveAttribute("data-tipo", "rechazada");
  expect(await cursor(page)).toBe(antes);
  expect(await contar("select count(*)::text as n from opsrun.audit_event where request_id = $1", [R(4)])).toBe(eventosAntes);
  expect(await contar("select count(*)::text as n from opsrun.request where id = $1 and ended_manually_at is not null", [R(4)])).toBe(0);
});

test("E4: la galería de R6: Before y After; un clic agranda, Esc cierra y el foco vuelve a la miniatura", async ({ page }) => {
  // Desde el tablero, con la Job window encima: Esc cierra la foto y no la ventana.
  await page.goto("/");
  await expect(page.getByTestId("columna")).toHaveCount(5);
  await page.getByTestId("fila-paid").locator("summary").click();
  await page.locator(`[data-testid="tarjeta"][data-request="${R(6)}"]`).click();
  await expect(page.getByTestId("encabezado")).toBeVisible();
  await pestana(page, "tracker").click();

  const antes = page.getByTestId("fotos-before").getByTestId("miniatura");
  const despues = page.getByTestId("fotos-after").getByTestId("miniatura");
  await expect(antes).toHaveCount(1);
  await expect(despues).toHaveCount(1);
  await expect(antes.getByRole("img")).toHaveAttribute("alt", /^Before photo, \w{3} \d{1,2}, \d{1,2}:\d{2} (AM|PM)$/);
  await expect(page.getByTestId("sin-fotos")).toHaveCount(0);
  // La imagen llega por la ruta del servidor (el SVG inventado del stand-in) y se pinta de verdad.
  await expect.poll(() => antes.getByRole("img").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);

  await antes.click();
  const dialogo = page.getByTestId("foto-dialogo");
  await expect(dialogo).toBeVisible();
  await expect(dialogo).toHaveJSProperty("open", true);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("foto-grande")).toHaveAttribute("alt", /^After photo/);
  await page.keyboard.press("Escape");
  await expect(dialogo).toHaveCount(0);
  await expect(antes).toBeFocused();
  // La Job window sigue ahí: Esc no la cerró.
  await expect(page.getByTestId("encabezado")).toBeVisible();

  // La ruta de la imagen: private, no-store, y 404 con una foto que no es del job.
  const ok = await page.request.get(`/api/fotos/bx-photo-0001?request=${R(6)}`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["cache-control"]).toBe("private, no-store");
  expect(ok.headers()["content-type"]).toBe("image/svg+xml");
  expect((await page.request.get(`/api/fotos/bx-photo-0001?request=${R(4)}`)).status()).toBe(404);
  expect((await page.request.get(`/api/fotos/bx-photo-0001?request=b0000000-0000-4000-8000-0000000000ff`)).status()).toBe(404);
  expect((await page.request.get(`/api/fotos/bx-photo-0001`)).status()).toBe(404);
});

test("E9: R6 pagada: tarjeta verde en 'Paid (n)', Billing con 'Paid <fecha>' sin control editable y el PO en solo lectura", async ({ page }) => {
  await page.goto("/");
  const fila = columna(page, "validation").getByTestId("fila-paid");
  await expect(fila.locator("summary")).toHaveText(/^Paid \(\d+\)$/);
  await fila.locator("summary").click();
  const tarjeta = fila.locator(`[data-testid="tarjeta"][data-request="${R(6)}"]`);
  await expect(tarjeta).toHaveAttribute("data-color", "pagada");
  await expect(tarjeta.getByTestId("estado")).toHaveText(/^Paid \w{3} \d{1,2}$/);

  await abrir(page, R(6), "billing");
  await expect(billing(page)).toBeVisible();
  await expect(page.getByTestId("billing-paid")).toContainText(/^Paid\s*Paid \w{3} \d{1,2}$/);
  await expect(page.getByTestId("billing-validada")).toContainText("Validated");
  await expect(page.getByTestId("billing-validada")).toContainText("by Finance Uno");
  await expect(page.getByTestId("billing-oss")).toContainText("Not OSS");
  await expect(page.getByTestId("billing-aprobada")).toContainText("by Finance Uno");
  // Validado: el PO es de solo lectura y viene de PINCH. Paid no tiene control.
  await expect(page.getByTestId("po-valor")).toHaveText("PO-EX-0006");
  await expect(billing(page).getByRole("textbox")).toHaveCount(0);
  await expect(billing(page).getByRole("button")).toHaveCount(0);
  // Enter PO y Validate dicen por qué no corren.
  await expect(opcion(page, "write_po")).toHaveText("Enter PO — Already validated");
  await expect(opcion(page, "record_validation")).toHaveText("Validate — Already validated");
  // Su Audit trae Validated, de Finance Uno.
  await pestana(page, "audit").click();
  await expect(filaDeAudit(page, "Validated")).toContainText("Finance Uno");
});

test("E5 y E8: R5 (Complete, OSS 'auto'): Mark as OSS, un cambio concurrente, y Approve & confirm lleva la tarjeta a Validation", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const aprobada = async () => (await estadoDe(R(5))).approved;
  test.skip((await aprobada()) && testInfo.retry === 0, "R5 ya está aprobada en esta base: se necesita una base nueva");

  const instrucciones = () => contar("select count(*)::text as n from opsrun.instruction where request_id = $1", [R(5)]);
  const instruccionesAntes = await instrucciones();
  const contexto1 = await browser.newContext({ baseURL: baseURL! });
  const contexto2 = await browser.newContext({ baseURL: baseURL! });
  try {
    const uno = await contexto1.newPage();
    const dos = await contexto2.newPage();

    if (!(await aprobada())) {
      // El segundo operador abre R5 y su sondeo no corre: no se entera de lo que pase después.
      await dos.route("**/api/tablero/cambios**", (ruta) => ruta.abort());
      await abrir(dos, R(5));
      await actuarComo(dos, OPS_DOS);
      await expect(dos.getByTestId("stage")).toHaveText("Complete");

      await abrir(uno, R(5));
      await actuarComo(uno, OPS_UNO);
      await expect(uno.getByTestId("stage")).toHaveText("Complete");
      await expect(uno.getByTestId("chip-oss")).toHaveText("OSS"); // la marca automática de la seed

      // E5: el panel marca 'auto' y el operador lo cambia a Not OSS.
      await elegirAccion(uno, "mark_oss");
      await expect(uno.getByTestId("oss-actual")).toHaveText("Current: OSS (auto)");
      await expect(uno.getByTestId("go")).toBeDisabled(); // la marca que ya tiene
      await uno.getByRole("radio", { name: "Not OSS" }).check();
      await uno.getByTestId("motivo").fill("Photos were fine");
      await uno.getByTestId("go").click();
      await expect(resultado(uno)).toHaveText("Saved", GUARDADO);
      expect(await consultar("select oss_mark::text, oss_source::text from opsrun.request where id = $1", [R(5)])).toEqual([
        { oss_mark: "not_oss", oss_source: "operator" },
      ]);

      // E8: el otro, con la versión de antes, no aprueba.
      await elegirAccion(dos, "approve_confirm");
      await dos.getByTestId("go").click();
      await expect(resultado(dos)).toHaveText("This job changed. Review and try again.");
      await expect(resultado(dos)).toHaveAttribute("data-tipo", "rechazada");
      expect(await contar("select count(*)::text as n from opsrun.audit_event where request_id = $1 and event_type = 'job_approved'", [R(5)])).toBe(0);
      expect((await estadoDe(R(5))).approved).toBe(false);
    } else {
      await abrir(uno, R(5));
      await actuarComo(uno, OPS_UNO);
    }

    // E5: Approve & confirm; la tarjeta pasa a Validation en menos de 1 minuto.
    await recargar(uno, R(5));
    if (await uno.getByTestId("stage").filter({ hasText: "Complete" }).count()) {
      await elegirAccion(uno, "approve_confirm");
      await expect(uno.getByTestId("approve-oss")).toContainText("Not OSS");
      await uno.getByTestId("go").click();
    }
    await expect(uno.getByTestId("stage")).toHaveText("Validation", { timeout: 60_000 });
    await uno.goto("/");
    await expect(columna(uno, "validation").locator(`[data-testid="tarjeta"][data-request="${R(5)}"]`)).toBeVisible({ timeout: 60_000 });
    expect(await contar("select count(*)::text as n from opsrun.audit_event where request_id = $1 and event_type = 'job_approved'", [R(5)])).toBe(1);
    // Approve no manda nada al requester (S-9).
    expect(await contar("select count(*)::text as n from opsrun.audit_event where request_id = $1 and event_type = 'requester_notified'", [R(5)])).toBe(0);
    // Fase A: ni Mark as OSS ni Approve mandan una instrucción a BzzzBX.
    expect(await instrucciones()).toBe(instruccionesAntes);
  } finally {
    await contexto1.close();
    await contexto2.close();
  }
});

test("E1: de Requests a Paid sobre el stand-in, con cada paso en Audit (R8)", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const validada = async () => (await estadoDe(R(8))).validated;
  test.skip((await validada()) && testInfo.retry === 0, "R8 ya está validada en esta base: se necesita una base nueva");

  // El stand-in se reinicia en cada prueba: lo que E1 pone en BzzzBX lo repone si hay un reintento.
  const enBzzzbx = async () => {
    const etapa = (await estadoDe(R(8))).status;
    if (etapa === "open") return;
    await control(page, { accion: "poner", entidad: "jobtracker_event", valor: { bzzzbx_event_id: "bx-evt-e101", bzzzbx_job_id: "bx-job-0108", kind: "checked_in", occurred_at: hace(30 * MIN) } });
    await control(page, { accion: "poner", entidad: "jobtracker_event", valor: { bzzzbx_event_id: "bx-evt-e102", bzzzbx_job_id: "bx-job-0108", kind: "started", occurred_at: hace(25 * MIN) } });
  };

  await test.step("R8 llega a Scheduled (D1 de OPR-28)", async () => {
    if ((await estadoDe(R(8))).status === "open") await llevarR8AScheduled(page);
    await abrir(page, R(8));
    await actuarComo(page, OPS_UNO);
    await expect(page.getByTestId("stage")).toHaveText("Scheduled");
    // Fase B: Reschedule y Cancel job se ven en gris y no corren.
    await expect(opcion(page, "reschedule_job")).toHaveText("Reschedule — Available when actions are switched on");
    await expect(opcion(page, "cancel_job")).toHaveText("Cancel job — Available when actions are switched on");
  });

  await test.step("check-in e inicio: In Progress con Job tracker (Arrival y Start)", async () => {
    await enBzzzbx();
    await recargar(page, R(8), "tracker");
    await expect(page.getByTestId("stage")).toHaveText("In Progress");
    await expect(tracker(page)).toBeVisible();
    await expect(page.getByTestId("tracker-llegada")).toContainText(/\d{1,2}:\d{2} (AM|PM)/);
    await expect(page.getByTestId("tracker-inicio")).toContainText(/\d{1,2}:\d{2} (AM|PM)/);
    await expect(page.getByTestId("tracker-fin")).toContainText("— —");
    await expect(page.getByTestId("tracker-duracion")).toContainText("running");
    await expect(page.getByTestId("tracker-duracion")).toContainText("expected 3h 00m");
    await expect(page.getByTestId("sin-fotos")).toHaveText("No photos");
    await expect(page.getByTestId("chip-running-long")).toHaveCount(0);
  });

  await test.step("una MEC-003 abierta: Clear alert con motivo, y deja de contar en la tarjeta y en la ventana", async () => {
    // La OPS-001 de R8 (sin dueño) la cierra BzzzBX cuando ve el dueño por el write-back; el stand-in no lo hace solo.
    await control(page, { accion: "cambiar", entidad: "alert_result", id: "bx-alert-0005", parche: { cleared_at: new Date().toISOString() } });
    await control(page, {
      accion: "poner",
      entidad: "alert_result",
      valor: {
        bzzzbx_alert_id: "bx-alert-e103",
        sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0108" },
        rule_id: "MEC-003",
        rule_version: "1",
        level: "amber",
        reason_text: "Running 45 min over the window.",
        opened_at: hace(10 * MIN),
        cleared_at: null,
      },
    });
    await recargar(page, R(8), "tracker");
    await expect(page.getByTestId("chip-running-long")).toHaveText("Running long");
    await page.goto("/");
    const tarjeta = columna(page, "in_progress").locator(`[data-testid="tarjeta"][data-request="${R(8)}"]`);
    await expect(tarjeta).toBeVisible();
    // R4 (si sigue sin limpiar) y R8: el conteo de la columna incluye la de R8.
    const conAlerta = Number((await columna(page, "in_progress").getByTestId("alertas-columna").textContent()) ?? "0");

    await abrir(page, R(8));
    await actuarComo(page, OPS_UNO);
    await expect(pestana(page, "alerts")).toHaveAttribute("aria-selected", "true");
    await elegirAccion(page, "clear_alert");
    await expect(page.getByTestId("go")).toBeDisabled();
    await page.getByTestId("motivo").fill("Large unit, called ahead.");
    await page.getByTestId("go").click();
    await expect(resultado(page)).toHaveText("Saved", GUARDADO);

    await recargar(page, R(8));
    await expect(page.getByTestId("conteo-alertas")).toHaveCount(0);
    await page.goto("/");
    const despues = await columna(page, "in_progress").getByTestId("alertas-columna").count();
    const total = despues ? Number((await columna(page, "in_progress").getByTestId("alertas-columna").textContent()) ?? "0") : 0;
    expect(total).toBe(conAlerta - 1);
  });

  await test.step("el job termina y trae una foto Before y una After: Complete, la galería las muestra y agranda", async () => {
    await control(page, { accion: "poner", entidad: "jobtracker_event", valor: { bzzzbx_event_id: "bx-evt-e104", bzzzbx_job_id: "bx-job-0108", kind: "completed", occurred_at: hace(5 * MIN) } });
    await control(page, { accion: "poner", entidad: "photo", valor: { bzzzbx_photo_id: "bx-photo-e105", bzzzbx_job_id: "bx-job-0108", phase: "before", taken_at: hace(25 * MIN), ref: "stand-in:photo/bx-photo-e105" } });
    await control(page, { accion: "poner", entidad: "photo", valor: { bzzzbx_photo_id: "bx-photo-e106", bzzzbx_job_id: "bx-job-0108", phase: "after", taken_at: hace(6 * MIN), ref: "stand-in:photo/bx-photo-e106" } });
    await recargar(page, R(8), "tracker");
    await expect(page.getByTestId("stage")).toHaveText("Complete");
    await expect(page.getByTestId("tracker-fin")).not.toContainText("— —");
    await expect(page.getByTestId("tracker-duracion")).not.toContainText("running");
    await expect(page.getByTestId("fotos-before").getByTestId("miniatura")).toHaveCount(1);
    await expect(page.getByTestId("fotos-after").getByTestId("miniatura")).toHaveCount(1);
    await page.getByTestId("fotos-after").getByTestId("miniatura").click();
    await expect(page.getByTestId("foto-dialogo")).toBeVisible();
    await expect(page.getByTestId("foto-grande")).toHaveAttribute("alt", /^After photo/);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("foto-dialogo")).toHaveCount(0);
  });

  await test.step("Mark as OSS y después Not OSS: el chip OSS aparece y se va", async () => {
    await recargar(page, R(8));
    await elegirAccion(page, "mark_oss");
    await page.getByRole("radio", { name: "OSS", exact: true }).check();
    await page.getByTestId("go").click();
    await expect(resultado(page)).toHaveText("Saved", GUARDADO);
    await recargar(page, R(8));
    await expect(page.getByTestId("chip-oss")).toHaveText("OSS");
    await correrAccionOss(page, "Not OSS");
    await recargar(page, R(8));
    await expect(page.getByTestId("chip-oss")).toHaveCount(0);
  });

  await test.step("E7: con BzzzBX caído, Approve & confirm corre y Validate se ve en gris con 'BzzzBX unavailable'", async () => {
    await control(page, { accion: "no_disponible", valor: false });
    await recargar(page, R(8)); // lo último leído queda en la memoria de la ventana
    await control(page, { accion: "no_disponible", valor: true });
    try {
      await recargar(page, R(8));
      await expect(page.getByTestId("franja-bzzzbx")).toBeVisible();
      await expect(opcion(page, "approve_confirm")).toBeEnabled();
      await expect(opcion(page, "mark_oss")).toBeEnabled();
      await aprobar(page);
      await recargar(page, R(8));
      await expect(page.getByTestId("stage")).toHaveText("Validation");
      await expect(opcion(page, "record_validation")).toHaveText("Validate — BzzzBX unavailable");
      await expect(opcion(page, "record_validation")).toBeDisabled();
      await expect(opcion(page, "write_po")).toBeEnabled();
    } finally {
      await control(page, { accion: "no_disponible", valor: false });
    }
  });

  await test.step("E6: Validate en gris con 'Add PO' (el cliente exige PO y no hay), y no corre forzando el disabled", async () => {
    await recargar(page, R(8));
    await actuarComo(page, FINANCE_UNO);
    await expect(opcion(page, "record_validation")).toHaveText("Validate — Add PO");
    await expect(opcion(page, "record_validation")).toBeDisabled();
    const antes = await cursor(page);
    const eventosAntes = await contar("select count(*)::text as n from opsrun.audit_event where request_id = $1 and source <> 'bzzzbx_observed'", [R(8)]);
    await elegirAunqueEsteDeshabilitada(page, "record_validation");
    await expect(page.getByTestId("go")).toBeDisabled();
    await pulsarGoForzado(page);
    await expect(resultado(page)).toHaveText("Add PO");
    await expect(resultado(page)).toHaveAttribute("data-tipo", "rechazada");
    expect(await cursor(page)).toBe(antes);
    expect(await contar("select count(*)::text as n from opsrun.audit_event where request_id = $1 and source <> 'bzzzbx_observed'", [R(8)])).toBe(eventosAntes);
    expect((await estadoDe(R(8))).validated).toBe(false);
  });

  await test.step("E7: con BzzzBX caído, el PO # de Billing se guarda en opsRUN y Billing muestra lo último leído", async () => {
    await recargar(page, R(8), "billing"); // lo último leído, con BzzzBX arriba
    await expect(page.getByTestId("billing-paid")).toContainText("Not paid yet");
    await control(page, { accion: "no_disponible", valor: true });
    try {
      await recargar(page, R(8), "billing");
      await expect(page.getByTestId("franja-bzzzbx")).toBeVisible();
      await expect(page.getByTestId("billing-paid")).toContainText("Not paid yet");
      await expect(page.getByTestId("po-requerido")).toHaveText("PO required");
      await expect(page.getByTestId("guardar-po")).toBeDisabled();
      await page.getByTestId("po-input").fill("PO-EX-0108");
      await page.getByTestId("guardar-po").click();
      await expect(page.getByTestId("resultado-po")).toHaveText("Saved", GUARDADO);
      await expect(opcion(page, "record_validation")).toBeDisabled();
    } finally {
      await control(page, { accion: "no_disponible", valor: false });
    }
    expect(await consultar("select entered_po_number from opsrun.request where id = $1", [R(8)])).toEqual([{ entered_po_number: "PO-EX-0108" }]);
  });

  await test.step("Finance Uno valida: 'Add PO' ya no bloquea, y Validate corre", async () => {
    await recargar(page, R(8));
    await actuarComo(page, FINANCE_UNO);
    await expect(opcion(page, "record_validation")).toHaveText("Validate");
    await correrAccion(page, "record_validation");
    await recargar(page, R(8), "billing");
    await expect(page.getByTestId("billing-validada")).toContainText("by Finance Uno");
    // Validado, el PO deja de ser editable (P-13).
    await expect(page.getByTestId("po-input")).toHaveCount(0);
    await expect(page.getByTestId("po-valor")).toHaveText("PO-EX-0108");
    // Todavía no está pagada: la tarjeta dice Validated.
    await page.goto("/");
    const tarjeta = columna(page, "validation").locator(`[data-testid="tarjeta"][data-request="${R(8)}"]`);
    await expect(tarjeta.getByTestId("estado")).toHaveText(/^Validated \w{3} \d{1,2}$/);
  });

  await test.step("Paid, leído de QuickBooks por el stand-in: tarjeta verde y 'Paid <fecha>' en Billing", async () => {
    await control(page, { accion: "cambiar", entidad: "payment", id: "bx-job-0108", parche: { paid: true, paid_at: hace(MIN), bzzzbx_event_id: "bx-evt-e107" } });
    await page.goto("/");
    const fila = columna(page, "validation").getByTestId("fila-paid");
    await fila.locator("summary").click();
    const tarjeta = fila.locator(`[data-testid="tarjeta"][data-request="${R(8)}"]`);
    await expect(tarjeta).toHaveAttribute("data-color", "pagada");
    await expect(tarjeta.getByTestId("estado")).toHaveText(/^Paid \w{3} \d{1,2}$/);
    await abrir(page, R(8), "billing");
    await expect(page.getByTestId("billing-paid")).toContainText(/Paid \w{3} \d{1,2}$/);
    await expect(page.getByTestId("marca-paid")).toBeVisible();
  });

  await test.step("Audit cuenta la historia en orden, con su persona, y sin ids ni crosswalk", async () => {
    // El observador (ciclo de fondo, cada 15 s) escribe check-in, inicio, fin y pago de R8, una vez cada uno.
    await expect
      .poll(() => contar("select count(*)::text as n from opsrun.audit_event where request_id = $1 and source = 'bzzzbx_observed'", [R(8)]), { timeout: 60_000 })
      .toBe(4);
    await abrir(page, R(8), "audit");
    await expect(audit(page).getByRole("list", { name: "Audit" })).toBeVisible();
    const lista = await eventosDeAudit(page);
    // Los hechos observados llevan la hora de PINCH (puesta con `hace(...)`), así que su sitio entre lo de opsRUN no se fija: se comprueban aparte.
    const observados = ["Checked in", "Started", "Completed", "Paid"];
    expect(lista.filter((e) => observados.includes(e)).sort()).toEqual([...observados].sort());
    expect(lista.indexOf("Checked in")).toBeLessThan(lista.indexOf("Started"));
    expect(lista.indexOf("Started")).toBeLessThan(lista.indexOf("Completed"));
    for (const e of observados) await expect(filaDeAudit(page, e)).toContainText("Observed");
    // exact: la fila de Scheduled dice "linked to observed job", que no es la marca.
    await expect(audit(page).getByText("Observed", { exact: true })).toHaveCount(4);
    expect(await contar("select count(*)::text as n from opsrun.audit_event where request_id = $1 and event_type = 'job_paid'", [R(8)])).toBe(1);
    const desdeScheduled = lista.slice(lista.indexOf("Scheduled") + 1).filter((e) => !observados.includes(e));
    expect(desdeScheduled).toEqual([
      "Alert cleared",
      "Marked as OSS / Not OSS",
      "Marked as OSS / Not OSS",
      "Approved & confirmed",
      "PO entered",
      "Validated",
    ]);
    await expect(filaDeAudit(page, "Alert cleared")).toContainText("MEC-003 Running long");
    await expect(filaDeAudit(page, "Alert cleared").getByTestId("audit-motivo")).toHaveText("Reason: Large unit, called ahead.");
    await expect(filaDeAudit(page, "Alert cleared").getByTestId("audit-persona")).toHaveText("Ops Uno");
    await expect(filaDeAudit(page, "Marked as OSS / Not OSS", 0)).toContainText("· OSS");
    await expect(filaDeAudit(page, "Marked as OSS / Not OSS", 1)).toContainText("· Not OSS");
    await expect(filaDeAudit(page, "Approved & confirmed").getByTestId("audit-persona")).toHaveText("Ops Uno");
    await expect(filaDeAudit(page, "PO entered")).toContainText("· PO PO-EX-0108");
    await expect(filaDeAudit(page, "PO entered").getByTestId("audit-persona")).toHaveText("Finance Uno");
    await expect(filaDeAudit(page, "Validated").getByTestId("audit-persona")).toHaveText("Finance Uno");
    const texto = await audit(page).innerText();
    expect(texto).not.toMatch(/bx-/i);
    expect(texto).not.toMatch(UUID);

    // Lo que la base guardó: ninguna instrucción a BzzzBX en la Fase A, y ningún dato de PINCH copiado.
    expect(await contar("select count(*)::text as n from opsrun.instruction where request_id = $1", [R(8)])).toBe(0);
    const validado = await consultar<{ details: Record<string, unknown> }>("select details from opsrun.audit_event where request_id = $1 and event_type = 'job_validated'", [R(8)]);
    expect(validado[0]!.details).toEqual({ po_required: true, po_source: "opsrun", po_number: "PO-EX-0108" });
  });
});

/** Mark as OSS / Not OSS sin importar cuál: elige la marca por su nombre y corre. */
async function correrAccionOss(page: Page, marca: "OSS" | "Not OSS") {
  await elegirAccion(page, "mark_oss");
  await page.getByRole("radio", { name: marca, exact: true }).check();
  await expect(page.getByTestId("go")).toBeEnabled();
  await page.getByTestId("go").click();
  await expect(resultado(page)).toHaveText("Saved", GUARDADO);
}
