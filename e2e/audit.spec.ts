import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

/**
 * La pestaña Audit (OPR-35, criterios B1 a B8 del spec) contra el build de
 * producción, la seed y el stand-in de BzzzBX, con OPSRUN_ZONA_HORARIA=
 * America/New_York fija en playwright.config.mts y OPSRUN_ACTOR_DEMO=1.
 *
 * Corre en su propio proyecto, después del resto (`dependencies`), porque B1 y
 * B7 enlazan R7 y R7 solo se puede enlazar una vez por base: si corriera a la
 * vez, las pruebas de la Job window que miran a R7 en Requests verían el cambio.
 * Por lo mismo, en una base ya usada (R7 enlazada) B1 y B7 se saltan; con una
 * base nueva corren.
 *
 * Los botones del enlace de la Fase A (OPR-28) no están en esta ranura todavía.
 * B1 y B7 hacen las mismas llamadas que harán esos botones: las funciones SQL
 * `opsrun.reject_job_link` y `opsrun.link_observed_job`, como `opsrun_app` y con
 * el actor de Ops Uno, el que elige "Acting as" (OPR-26, P-2). La pestaña lee lo
 * que esas funciones dejan en Audit; esa es la parte que se prueba.
 */
test.describe.configure({ mode: "serial" });

const R = (n: number) => `b0000000-0000-4000-8000-0000000000a${n}`;
/** `auth_user_id` inventado de Ops Uno en la seed (OPR-26, P-2). */
const AUTH_OPS_UNO = "de000000-0000-4000-8000-0000000000a1";
const ZONA = "America/New_York";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function control(page: Page, pedido: Record<string, unknown>) {
  const r = await page.request.post("/api/falso", { data: pedido });
  expect(r.ok(), await r.text()).toBe(true);
}

const pestana = (page: Page, id: string) => page.locator(`[data-testid="pestana"][data-pestana="${id}"]`);
const audit = (page: Page) => page.locator('[data-ranura="audit"]');
const filas = (page: Page) => audit(page).getByTestId("audit-fila");
const eventos = (page: Page) => audit(page).getByTestId("audit-evento").allInnerTexts();

async function abrirAudit(page: Page, n: number) {
  await page.goto(`/job/${R(n)}?tab=audit`);
  await expect(page.getByTestId("encabezado")).toBeVisible();
  await expect(audit(page).getByRole("list", { name: "Audit" })).toBeVisible();
}

/** El texto de una fila del Audit, con el evento como clave. */
async function fila(page: Page, evento: string, indice = 0) {
  return filas(page).filter({ has: page.getByTestId("audit-evento").getByText(evento, { exact: true }) }).nth(indice);
}

/** La conexión como opsrun_app, la misma del servidor: la fija playwright.config.mts. */
function urlDeLaApp(): string {
  const url = process.env.OPSRUN_DATABASE_URL;
  if (!url) throw new Error("falta OPSRUN_DATABASE_URL (la fija playwright.config.mts)");
  return url;
}

/** Las mismas llamadas que harán los botones del enlace, como opsrun_app y con el actor elegido. */
async function comoOperador<T>(authUserId: string, fn: (db: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: urlDeLaApp() });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('opsrun.auth_user_id', $1, true)", [authUserId]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

async function estadoDeR7(): Promise<string> {
  const c = new pg.Client({ connectionString: urlDeLaApp() });
  await c.connect();
  try {
    const { rows } = await c.query<{ status: string }>("select status::text as status from opsrun.request where id = $1", [R(7)]);
    return rows[0]!.status;
  } finally {
    await c.end();
  }
}

test.beforeEach(async ({ page }) => {
  await control(page, { accion: "reiniciar" });
});

test("B8: en Requests no hay pestaña Audit (R2 y R7 antes del enlace)", async ({ page }) => {
  test.skip((await estadoDeR7()) !== "open", "R7 ya está enlazada en esta base: se necesita una base nueva");
  for (const n of [2, 7]) {
    await page.goto(`/job/${R(n)}`);
    await expect(page.getByTestId("encabezado")).toBeVisible();
    await expect(pestana(page, "property")).toBeVisible();
    await expect(pestana(page, "audit")).toHaveCount(0);
  }
});

test("B2: los identificadores de EX-00003", async ({ page }) => {
  await abrirAudit(page, 3);
  await expect(page.getByTestId("audit-request")).toHaveText(/^R\d+$/);
  await expect(page.getByTestId("audit-job-number")).toHaveText("EX-00003");
  await expect(page.getByTestId("audit-work-app-number")).toHaveText("EX-00003");
  await expect(page.getByTestId("audit-zona")).toHaveText("Times in EST");
});

test("B3: la historia completa de EX-00006, en orden de tiempo", async ({ page }) => {
  await abrirAudit(page, 6);
  // OSS, Approved y la alerta comparten hora en la seed (se desempata por id), igual que el PO y su resolución.
  expect(await eventos(page)).toEqual([
    "Request received",
    "Assigned",
    "Details confirmed",
    "Sender confirmed",
    "Cleaner confirmed",
    "Scheduled",
    "Checked in",
    "Completed",
    "Marked as OSS / Not OSS",
    "Approved & confirmed",
    "Alert opened",
    "PO entered",
    "Alert resolved",
    "Validated",
    "Paid",
  ]);

  // Lo observado de PINCH lleva su marca; lo que se hizo en opsRUN, no.
  for (const e of ["Checked in", "Completed", "Paid"]) await expect(await fila(page, e)).toContainText("Observed");
  for (const e of ["Scheduled", "PO entered", "Approved & confirmed"]) await expect(await fila(page, e)).not.toContainText("Observed");
  await expect(audit(page).getByText("Observed")).toHaveCount(3);

  // La alerta TRN-005, abierta y resuelta "Fixed by action" por Finance Uno.
  const abierta = await fila(page, "Alert opened");
  await expect(abierta).toContainText("TRN-005 PO missing");
  await expect(abierta).toContainText("Customer requires a PO.");
  await expect(abierta.getByTestId("audit-persona")).toHaveText("BzzzBX");
  const resuelta = await fila(page, "Alert resolved");
  await expect(resuelta).toContainText("Fixed by action");
  await expect(resuelta.getByTestId("audit-persona")).toHaveText("Finance Uno");

  // Cada hora es un <time datetime> y todas salen con fecha.
  const tiempos = audit(page).locator("time");
  await expect(tiempos).toHaveCount(15); // con el Validated de OPR-32
  const horas = await tiempos.evaluateAll((els) => els.map((e) => [e.getAttribute("datetime"), e.textContent]));
  const instantes = horas.map(([iso]) => Date.parse(iso!));
  expect(instantes).toEqual([...instantes].sort((a, b) => a - b));
  for (const [, texto] of horas) expect(texto).toMatch(/^[A-Z][a-z]{2} \d{1,2}(, \d{4})?, \d{1,2}:\d{2}\s(AM|PM)$/);
});

test("B4: el motivo visible en EX-00005, con quién lo hizo", async ({ page }) => {
  await abrirAudit(page, 5);
  const fin = await fila(page, "Ended manually");
  await expect(fin.getByTestId("audit-motivo")).toHaveText("Reason: Cleaner finished but the app did not sync.");
  await expect(fin.getByTestId("audit-persona")).toHaveText("Ops Dos");

  const limpiada = await fila(page, "Alert cleared");
  await expect(limpiada).toContainText("MEC-003 Running long");
  await expect(limpiada.getByTestId("audit-motivo")).toHaveText("Reason: Large unit, cleaner called ahead.");
  await expect(limpiada.getByTestId("audit-persona")).toHaveText("Ops Dos");
  // El OSS automático lo hizo el sistema.
  await expect((await fila(page, "Marked as OSS / Not OSS")).getByTestId("audit-persona")).toHaveText("opsRUN");
  // Solo las filas con motivo lo muestran.
  await expect(audit(page).getByTestId("audit-motivo")).toHaveCount(2);
});

test("B1 y B7: el enlace de R7 queda en Audit con hora y nombre, y aparece sin recargar", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  test.skip((await estadoDeR7()) !== "open", "R7 ya está enlazada en esta base: se necesita una base nueva");

  // B7: otro contexto del navegador con R7 abierto en la pestaña de la propiedad.
  const contexto = await browser.newContext({ baseURL: baseURL! });
  const primero = await contexto.newPage();
  try {
    await primero.goto(`/job/${R(7)}?tab=property`);
    await expect(primero.getByTestId("encabezado")).toBeVisible();
    await expect(pestana(primero, "audit")).toHaveCount(0);

    // Ops Uno rechaza un candidato y confirma el bueno.
    const antes = Date.now();
    await comoOperador(AUTH_OPS_UNO, async (db) => {
      await db.query("select opsrun.reject_job_link($1, $2, $3)", [R(7), "bx-job-0105", "Different customer."]);
    });
    await comoOperador(AUTH_OPS_UNO, async (db) => {
      await db.query("select opsrun.link_observed_job($1, $2, $3)", [R(7), "bx-job-0107", "EX-00107"]);
    });
    const despues = Date.now();

    // B7: en menos de 1 minuto y sin recargar, la pestaña Audit aparece sola.
    await expect(pestana(primero, "audit")).toBeVisible({ timeout: 60_000 });
    expect(Date.now() - despues, "la pestaña tardó más de 1 minuto en aparecer").toBeLessThan(60_000);
    await pestana(primero, "audit").click();
    await expect(audit(primero).getByRole("list", { name: "Audit" })).toBeVisible();

    // B1: en orden, con la hora y el nombre.
    expect(await eventos(primero)).toEqual([
      "Request received",
      "Assigned",
      "Details confirmed",
      "Sender confirmed",
      "Cleaner confirmed",
      "Job link rejected",
      "Scheduled",
    ]);
    const asignada = await fila(primero, "Assigned");
    await expect(asignada).toContainText("to Ops Dos");
    await expect(asignada).toContainText("Original");
    expect(await asignada.getByTestId("audit-persona").innerText()).toBe("Ops Dos");

    const rechazo = await fila(primero, "Job link rejected");
    await expect(rechazo).toContainText("job EX-00105");
    await expect(rechazo.getByTestId("audit-persona")).toHaveText("Ops Uno");
    await expect(rechazo.getByTestId("audit-motivo")).toHaveText("Reason: Different customer.");
    const programada = await fila(primero, "Scheduled");
    await expect(programada).toContainText("linked to observed job EX-00107");
    await expect(programada.getByTestId("audit-persona")).toHaveText("Ops Uno");

    // La hora de los dos últimos es la del reloj del test en Nueva York, ± 1 minuto.
    for (const f of [rechazo, programada]) {
      const iso = await f.locator("time").getAttribute("datetime");
      const t = Date.parse(iso!);
      expect(t).toBeGreaterThanOrEqual(antes - 60_000);
      expect(t).toBeLessThanOrEqual(despues + 60_000);
      const esperada = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: ZONA,
      }).format(new Date(t));
      expect(await f.locator("time").innerText()).toBe(esperada);
    }

    // B6 (R7 tras B1): ni zendesk, ni crosswalk IDs, ni uuids.
    const texto = await audit(primero).innerText();
    expect(texto.toLowerCase()).not.toContain("zendesk");
    expect(texto).not.toMatch(/bx-/i);
    expect(texto).not.toMatch(UUID);
  } finally {
    await contexto.close();
  }
});

test("B5: con BzzzBX caído el Audit se ve completo en lo de opsRUN y lo de PINCH sale — —", async ({ page }) => {
  // Necesita el rechazo que deja B1; sin él (base ya usada y R7 enlazada antes) no hay qué comprobar.
  test.skip((await estadoDeR7()) === "open", "R7 no se enlazó en esta corrida");
  await control(page, { accion: "no_disponible", valor: true });
  await abrirAudit(page, 7);
  await expect(page.getByTestId("franja-bzzzbx")).toBeVisible();

  // Lo de opsRUN, completo.
  expect(await eventos(page)).toEqual([
    "Request received",
    "Assigned",
    "Details confirmed",
    "Sender confirmed",
    "Cleaner confirmed",
    "Job link rejected",
    "Scheduled",
  ]);
  await expect(await fila(page, "Assigned")).toContainText("to Ops Dos");
  await expect(await fila(page, "Scheduled")).toContainText("linked to observed job EX-00107");
  await expect(await fila(page, "Job link rejected")).toContainText("Reason: Different customer.");
  // Lo de PINCH, no.
  const rechazo = await fila(page, "Job link rejected");
  await expect(rechazo).toContainText("job — —");
  await expect(rechazo).not.toContainText("EX-00105");
});

test("B6: ni Zendesk, ni crosswalk IDs, ni uuids en EX-00003 a EX-00006", async ({ page }) => {
  for (const n of [3, 4, 5, 6]) {
    await abrirAudit(page, n);
    const texto = await audit(page).innerText();
    expect(texto.length, `EX-0000${n} sin texto`).toBeGreaterThan(100);
    expect(texto.toLowerCase(), `EX-0000${n}`).not.toContain("zendesk");
    expect(texto, `EX-0000${n}`).not.toMatch(/bx-/i);
    expect(texto, `EX-0000${n}`).not.toMatch(UUID);
  }
});
