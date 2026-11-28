import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

/**
 * El análisis de la request por IA (OPR-36, criterios I1 a I9 del spec
 * docs/spec/opr-36-analisis-ia.md §15.3) contra el build de producción, la seed y el
 * stand-in de BzzzBX, con el ciclo de fondo corriendo dentro del servidor: la entrada
 * (cada 15 s) crea la request y la tarea `analisis_ia` (cada 5 s) pide el análisis al
 * falso y guarda el resultado.
 *
 * Corre en su propio proyecto, al final: cada prueba crea requests de verdad en la base,
 * y las que miran los conteos de Requests no deben verlas. Cada prueba usa su propio
 * correo (`correo_nuevo`, con ID único por corrida) y elige cómo responde la IA del falso
 * (`ia`: normal, lenta, falla, varios). Los datos son inventados (example.test).
 *
 * Lo que dice Audit se lee de la base como opsrun_app: la pestaña Audit existe desde
 * Scheduled y una request en Requests no la tiene.
 */
test.describe.configure({ mode: "serial" });

const UN_MINUTO = 60_000;
const OPS_UNO = "0a000000-0000-4000-8000-0000000000a1";

type Correo = { bzzzbx_message_id: string; bzzzbx_thread_id: string };

async function control(page: Page, pedido: Record<string, unknown>) {
  const r = await page.request.post("/api/falso", { data: pedido });
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()) as Partial<Correo> & { ok: true };
}

const requests = (page: Page) => page.locator('[data-testid="columna"][data-etapa="requests"]').getByTestId("tarjeta");
const idsDeRequests = async (page: Page) => (await requests(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-request")))) as string[];

/** Espera una tarjeta de Requests que no estaba en `antes`; devuelve su request. */
async function esperarTarjetaNueva(page: Page, antes: string[], timeout = UN_MINUTO): Promise<string> {
  let nueva = "";
  await expect(async () => {
    const ahora = await idsDeRequests(page);
    const distintas = ahora.filter((id) => !antes.includes(id));
    expect(distintas).toHaveLength(1);
    nueva = distintas[0]!;
  }).toPass({ timeout, intervals: [1000] });
  return nueva;
}

async function consultar<T extends Record<string, unknown>>(sql: string, parametros: unknown[] = [], url = process.env.OPSRUN_DATABASE_URL): Promise<T[]> {
  if (!url) throw new Error("falta OPSRUN_DATABASE_URL (la fija playwright.config.mts)");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query<T>(sql, parametros)).rows;
  } finally {
    await c.end();
  }
}

/** Los eventos de Audit de una request, en orden, leídos como opsrun_app. */
const auditDe = (requestId: string) =>
  consultar<{ event_type: string; actor_kind: string }>("select event_type, actor_kind::text as actor_kind from opsrun.audit_event where request_id = $1 order by id", [requestId]);

const eventos = async (requestId: string, tipo: string) => (await auditDe(requestId)).filter((e) => e.event_type === tipo);

/** Como el dueño de las tablas: solo para armar un fixture que ninguna acción del operador arma todavía. */
function urlDelDueno(): string {
  // La misma base que la app, con el login del dueño (las claves locales y públicas de supabase/alta-local.sql).
  const url = new URL(process.env.OPSRUN_DATABASE_URL!);
  url.username = "opsrun_migrador";
  url.password = "opsrun_migrador_local";
  return url.toString();
}
const comoDueno = <T extends Record<string, unknown>>(sql: string, parametros: unknown[] = []) => consultar<T>(sql, parametros, urlDelDueno());

/** Pide un correo nuevo con su guion de IA, abre la tarjeta cuando aparece y devuelve la request. */
async function correoConIa(page: Page, ia: string): Promise<{ requestId: string; correo: Correo }> {
  await page.goto("/");
  await expect(requests(page).first()).toBeVisible();
  const antes = await idsDeRequests(page);
  const correo = (await control(page, { accion: "correo_nuevo", ia })) as Correo & { ok: true };
  const requestId = await esperarTarjetaNueva(page, antes);
  return { requestId, correo };
}

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

const campo = (page: Page, clave: string) => page.getByTestId(`campo-${clave}`);
const chip = (page: Page, clave: string, ia?: string) => (ia ? campo(page, clave).getByTestId(`ia-${ia}`) : campo(page, clave)).getByTestId("ia-marca");

/** Espera (con recargas, por si el sondeo tarda) a que el análisis de la request deje sus chips. */
async function esperarElAnalisis(page: Page, requestId: string, timeout = UN_MINUTO) {
  await expect(async () => {
    await page.goto(`/job/${requestId}`);
    await expect(chip(page, "property")).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout, intervals: [3000] });
}

test.beforeAll(async ({ request }) => {
  // Que el falso empiece de cero y sin guiones viejos; la entrada ve el cursor caducado y recupera.
  const r = await request.post("/api/falso", { data: { accion: "reiniciar" } });
  expect(r.ok()).toBe(true);
  test.setTimeout(90_000);
  await new Promise((resolver) => setTimeout(resolver, 32_000));
});

test.afterEach(async ({ page }) => {
  // Un E2E que deja la IA sin servicio no puede dejarla así para el siguiente.
  await control(page, { accion: "ia_no_disponible", valor: false });
});

test("I1: un correo se analiza en menos de 1 minuto: propiedad, servicio, fecha y ventana salen con el chip AI, y Audit lo dice con persona AI", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/");
  await expect(requests(page).first()).toBeVisible();
  const antes = await idsDeRequests(page);

  const inicio = Date.now();
  await control(page, { accion: "correo_nuevo", ia: "normal" });
  const requestId = await esperarTarjetaNueva(page, antes);
  await page.goto(`/job/${requestId}`);
  // Sin recargar: el sondeo de la ventana trae los valores cuando llega el análisis.
  await expect(chip(page, "property")).toBeVisible({ timeout: UN_MINUTO });
  await expect(chip(page, "service")).toBeVisible();
  await expect(chip(page, "date", "service_date")).toBeVisible();
  await expect(chip(page, "date", "time_window")).toBeVisible();
  expect(Date.now() - inicio).toBeLessThan(UN_MINUTO);

  await expect(campo(page, "property")).toContainText("Example Tower");
  await expect(campo(page, "service")).toContainText("Standard clean");
  await expect(campo(page, "date")).toContainText("9:00 AM–12:00 PM");
  await expect(page.getByTestId("ia-pendiente")).toHaveCount(0);
  // "AI analysis completed" con persona AI (la pestaña Audit llega con Scheduled: se lee de la base).
  expect(await eventos(requestId, "ai_analysis_completed")).toEqual([{ event_type: "ai_analysis_completed", actor_kind: "ai" }]);
});

test("I2: con la IA lenta los campos dicen AI pending y la request se trabaja a mano", async ({ page }) => {
  test.setTimeout(150_000);
  const { requestId } = await correoConIa(page, "lenta");
  await page.goto(`/job/${requestId}`);
  await expect(campo(page, "property")).toContainText("AI pending");
  await expect(campo(page, "service")).toContainText("AI pending");
  await expect(campo(page, "beds")).toContainText("AI pending");
  await expect(page.getByTestId("ia-marca")).toHaveCount(0);

  // Ninguna acción se bloquea por la IA: Assign corre, y Confirm details dice qué falta, como sin borrador.
  await actuarComo(page, OPS_UNO);
  await elegirAccion(page, "assign");
  await page.getByTestId("assign-to-me").click();
  await page.getByTestId("go").click();
  await expect(page.getByTestId("resultado-accion")).toHaveText("Saved");
  await expect(page.getByTestId("asignado")).toHaveText("Ops Uno");
  const detalles = page.locator('[data-testid="accion"] option[value="confirm_details"]');
  await expect(detalles).toBeDisabled();
  await expect(detalles).toHaveText("Confirm details — Complete the details first: Property, Service, Date, Window");
});

test("I3: con la IA sin servicio sale AI pending y la entrada sigue creando requests; al volver, el análisis llega en menos de 1 minuto", async ({ page }) => {
  test.setTimeout(240_000);
  await control(page, { accion: "ia_no_disponible", valor: true });
  const primera = await correoConIa(page, "normal");
  await page.goto(`/job/${primera.requestId}`);
  await expect(campo(page, "property")).toContainText("AI pending");

  // La entrada sigue: otro correo durante la caída es otra tarjeta.
  const segunda = await correoConIa(page, "normal");
  expect(segunda.requestId).not.toBe(primera.requestId);

  await page.goto(`/job/${primera.requestId}`);
  await expect(campo(page, "property")).toContainText("AI pending");
  const inicio = Date.now();
  await control(page, { accion: "ia_no_disponible", valor: false });
  // Sin recargar: dentro del límite de 120 s del análisis (o con su reintento).
  await expect(chip(page, "property")).toBeVisible({ timeout: UN_MINUTO });
  expect(Date.now() - inicio).toBeLessThan(UN_MINUTO);
  await expect(campo(page, "property")).toContainText("Example Tower");
});

test("I4: una IA que falla deja AI pending, Audit dice AI analysis failed con persona sistema, y tras dos fallos no hay más intentos", async ({ page }) => {
  test.setTimeout(300_000);
  const { requestId } = await correoConIa(page, "falla");
  await page.goto(`/job/${requestId}`);
  await expect(campo(page, "property")).toContainText("AI pending");

  // El primero falla en unos segundos; el reintento sale a los 60 s y falla también.
  await expect.poll(async () => (await eventos(requestId, "ai_analysis_failed")).length, { timeout: 150_000, intervals: [3000] }).toBe(2);
  expect(await eventos(requestId, "ai_analysis_failed")).toEqual([
    { event_type: "ai_analysis_failed", actor_kind: "system" },
    { event_type: "ai_analysis_failed", actor_kind: "system" },
  ]);
  // Ya no hay más intentos: pasa más de un minuto y siguen siendo dos análisis.
  await page.waitForTimeout(70_000);
  expect(await eventos(requestId, "ai_analysis_failed")).toHaveLength(2);
  const { n } = (await consultar<{ n: string }>("select count(*)::text as n from opsrun.ai_analysis where request_id = $1", [requestId]))[0]!;
  expect(n).toBe("2");
  await page.goto(`/job/${requestId}`);
  await expect(campo(page, "property")).toContainText("AI pending");
});

test("I5: Confirm details acepta lo que propuso la IA: las marcas de los detalles se van y Audit cuenta un accepted por campo", async ({ page }) => {
  test.setTimeout(180_000);
  const { requestId } = await correoConIa(page, "normal");
  await esperarElAnalisis(page, requestId);
  await expect(chip(page, "beds")).toBeVisible();
  await actuarComo(page, OPS_UNO);

  await elegirAccion(page, "confirm_details");
  await page.getByTestId("go").click();
  await expect(page.getByTestId("resultado-accion")).toHaveText("Saved");
  await page.getByTestId("accion").selectOption("");

  for (const clave of ["property", "space", "service", "date", "beds"]) await expect(campo(page, clave).getByTestId("ia-marca")).toHaveCount(0);
  // El sender no es de Confirm details: sigue AI-marked hasta Confirm sender.
  await expect(chip(page, "customer")).toBeVisible();
  const tipos = (await auditDe(requestId)).map((e) => e.event_type);
  expect(tipos).toContain("details_confirmed");
  expect(tipos.filter((t) => t === "ai_suggestion_accepted")).toHaveLength(6);
});

test("I6: corregir queda registrado: Change de las camas a 2 y Save quitan el chip, el campo dice 2 y Audit dice corrected con el operador", async ({ page }) => {
  test.setTimeout(180_000);
  const { requestId } = await correoConIa(page, "normal");
  await esperarElAnalisis(page, requestId);
  await expect(campo(page, "beds")).toContainText("3");
  await actuarComo(page, OPS_UNO);

  await page.getByRole("button", { name: "Change AI beds" }).click();
  await page.getByLabel("Beds").fill("2");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(chip(page, "beds")).toHaveCount(0);
  await expect(campo(page, "beds")).toContainText("2");
  await expect(campo(page, "beds")).not.toContainText("3");

  const corregidos = await consultar<{ actor_kind: string; actor_operator_id: string | null }>(
    "select actor_kind::text as actor_kind, actor_operator_id::text from opsrun.audit_event where request_id = $1 and event_type = 'ai_suggestion_corrected'",
    [requestId],
  );
  expect(corregidos).toEqual([{ actor_kind: "operator", actor_operator_id: OPS_UNO }]);
  const { final_value: valorFinal } = (await consultar<{ final_value: unknown }>(
    "select s.final_value from opsrun.ai_suggestion as s where s.request_id = $1 and s.field = 'beds' and s.rank = 1",
    [requestId],
  ))[0]!;
  expect(valorFinal).toBe(2);
});

test("I7: rechazar la unidad la deja vacía, sin chip, y Audit dice rejected", async ({ page }) => {
  test.setTimeout(180_000);
  const { requestId } = await correoConIa(page, "normal");
  await esperarElAnalisis(page, requestId);
  await expect(campo(page, "space")).toContainText("4B");
  await actuarComo(page, OPS_UNO);

  await page.getByRole("button", { name: "Reject AI unit" }).click();
  await expect(chip(page, "space", "unit")).toHaveCount(0);
  await expect(campo(page, "space")).toContainText("— —");
  await expect(campo(page, "space")).not.toContainText("4B");
  expect(await eventos(requestId, "ai_suggestion_rejected")).toEqual([{ event_type: "ai_suggestion_rejected", actor_kind: "operator" }]);
  // Un análisis posterior no vuelve a llenar ese campo, y nadie lo pidió: la base guarda la decisión.
  const filas = await consultar<{ unit: string | null }>("select unit from opsrun.request where id = $1", [requestId]);
  expect(filas[0]!.unit).toBeNull();
});

test("I8: si el correo pide varios jobs sale el aviso; Not multiple lo quita y deja su evento", async ({ page }) => {
  test.setTimeout(180_000);
  const { requestId } = await correoConIa(page, "varios");
  await esperarElAnalisis(page, requestId);
  const aviso = page.getByTestId("aviso-varios-jobs");
  await expect(aviso).toHaveText(/AI: this email may ask for 2 jobs\./);
  await actuarComo(page, OPS_UNO);

  await aviso.getByRole("button", { name: "Not multiple" }).click();
  await expect(aviso).toHaveCount(0);
  expect(await eventos(requestId, "ai_suggestion_rejected")).toEqual([{ event_type: "ai_suggestion_rejected", actor_kind: "operator" }]);
});

test("I9: un resultado tardío no pisa lo ya firmado: el sender confirmado a mano no cambia y no sale su chip", async ({ page }) => {
  test.setTimeout(240_000);
  const { requestId, correo } = await correoConIa(page, "lenta");
  // El cliente lo pone el fixture (ninguna acción del operador lo escribe todavía; la búsqueda libre es de update_request_detail).
  await comoDueno("update opsrun.request set bzzzbx_customer_id = 'bx-cust-0002' where id = $1", [requestId]);
  await page.goto(`/job/${requestId}`);
  await actuarComo(page, OPS_UNO);

  await elegirAccion(page, "confirm_sender");
  await page.getByTestId("go").click();
  await expect(page.getByTestId("resultado-accion")).toHaveText("Saved");

  // La IA responde tarde, con otro cliente: la tarea guarda el resultado y la base lo deja superseded.
  await control(page, { accion: "ia_terminar", bzzzbx_message_id: correo.bzzzbx_message_id });
  await expect.poll(async () => (await eventos(requestId, "ai_analysis_completed")).length, { timeout: UN_MINUTO, intervals: [2000] }).toBe(1);

  const sender = await consultar<{ decision: string | null }>("select decision::text as decision from opsrun.ai_suggestion where request_id = $1 and field = 'sender' and rank = 1", [requestId]);
  expect(sender).toEqual([{ decision: "superseded" }]);
  const borrador = await consultar<{ bzzzbx_customer_id: string | null; bzzzbx_contact_id: string | null }>(
    "select bzzzbx_customer_id, bzzzbx_contact_id from opsrun.request where id = $1",
    [requestId],
  );
  expect(borrador[0]).toEqual({ bzzzbx_customer_id: "bx-cust-0002", bzzzbx_contact_id: null });
  const vigentes = await consultar<{ kind: string }>("select kind::text as kind from opsrun.request_confirmation where request_id = $1 and superseded_at is null", [requestId]);
  expect(vigentes).toEqual([{ kind: "sender" }]);

  await page.goto(`/job/${requestId}`);
  await expect(campo(page, "customer")).toBeVisible();
  await expect(campo(page, "customer").getByTestId("ia-marca")).toHaveCount(0);
  // Lo que no estaba firmado sí se llenó y está AI-marked.
  await expect(chip(page, "property")).toBeVisible();
});
