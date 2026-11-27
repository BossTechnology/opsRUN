import { expect, test, type Page } from "@playwright/test";

/**
 * La entrada de correo (OPR-15, criterios E1 a E6 del spec) contra el build de
 * producción, la seed y el stand-in de BzzzBX, con la entrada corriendo dentro
 * del servidor (ciclo de fondo único, ADR 0006): cada 15 s mira BzzzBX.
 *
 * Corre en su propio proyecto, después del resto: cada prueba crea requests de
 * verdad en la base, y las que miran los conteos de Requests no deben verlas.
 * Cada prueba usa un hilo y un mensaje con id propio (el control `correo_nuevo`
 * los genera únicos por corrida), así que no depende de cuántas veces se corrió
 * en la misma base. Los datos son inventados (example.test).
 */
test.describe.configure({ mode: "serial" });

const UN_MINUTO = 60_000;

async function control(page: Page, pedido: Record<string, unknown>) {
  const r = await page.request.post("/api/falso", { data: pedido });
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()) as { ok: true; bzzzbx_message_id?: string; bzzzbx_thread_id?: string };
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

const tarjeta = (page: Page, requestId: string) => page.locator(`[data-testid="tarjeta"][data-request="${requestId}"]`);

let mensaje = "";
let hilo = "";
let requestId = "";

test.beforeAll(async ({ request }) => {
  // Que el falso empiece de cero. Un E2E que lo reinicia caduca el cursor de la entrada: justo el caso de E5.
  const r = await request.post("/api/falso", { data: { accion: "reiniciar" } });
  expect(r.ok()).toBe(true);
});

test("E1: llega un correo y aparece la request en el tablero en menos de 1 minuto", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(requests(page).first()).toBeVisible();
  const antes = await idsDeRequests(page);

  const inicio = Date.now();
  const correo = await control(page, { accion: "correo_nuevo" });
  mensaje = correo.bzzzbx_message_id!;
  hilo = correo.bzzzbx_thread_id!;
  requestId = await esperarTarjetaNueva(page, antes);
  expect(Date.now() - inicio).toBeLessThan(UN_MINUTO);

  const nueva = tarjeta(page, requestId);
  await expect(nueva).toHaveAttribute("data-numero", /^R\d+$/);
  await expect(nueva).toHaveAttribute("data-color", "sin_dueno");
  await expect(nueva.getByTestId("ciudad")).toHaveText("— —");
  await expect(nueva.getByTestId("servicio")).toHaveText("— — | — —");
  await expect(nueva.getByTestId("chat")).toHaveCount(0);
});

test("E2: un correo, una request", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const antes = await idsDeRequests(page);
  expect(antes).toContain(requestId);
  // El mismo mensaje con otra versión (cambia su entrega): vuelve a pasar por la función y sale duplicate.
  await control(page, { accion: "cambiar", entidad: "message", id: mensaje, parche: { delivery: "sent" } });
  // Dos ciclos de sondeo de la entrada.
  await page.waitForTimeout(35_000);
  await page.reload();
  await expect(requests(page).first()).toBeVisible();
  expect(await idsDeRequests(page)).toEqual(antes);
});

test("E3: la respuesta va a su hilo: no hay otra tarjeta, enciende el chat y Audit lo cuenta", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/");
  const antes = await idsDeRequests(page);
  await control(page, { accion: "correo_nuevo", respuesta_a: hilo });

  // El ícono de chat sale cuando la entrada vincula la respuesta y el tablero la lee (BzzzBX).
  await expect(tarjeta(page, requestId).getByTestId("chat")).toBeVisible({ timeout: UN_MINUTO });
  expect(await idsDeRequests(page)).toEqual(antes);

  await page.goto(`/job/${requestId}?tab=audit`);
  const audit = page.locator('[data-ranura="audit"]');
  await expect(audit.getByRole("list", { name: "Audit" })).toBeVisible();
  const fila = (evento: string) => audit.getByTestId("audit-fila").filter({ has: page.getByTestId("audit-evento").getByText(evento, { exact: true }) });
  await expect(fila("Request received")).toHaveCount(1, { timeout: UN_MINUTO });
  await expect(fila("Email received")).toHaveCount(1, { timeout: UN_MINUTO });
  await expect(fila("Request received").getByTestId("audit-persona")).toHaveText("opsRUN");
  await expect(fila("Email received").getByTestId("audit-persona")).toHaveText("opsRUN");

  await page.goto(`/job/${requestId}`);
  const respuesta = page.locator('[data-ranura="conversacion"]').getByTestId("entrada").filter({ hasText: "can you clean the unit this week" });
  await expect(respuesta.last().getByTestId("estado-entrega")).toHaveText("Received");
});

test("E4: con BzzzBX caído no entra nada; al volver, la tarjeta aparece en menos de 1 minuto", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const antes = await idsDeRequests(page);
  await control(page, { accion: "no_disponible", valor: true });
  await control(page, { accion: "correo_nuevo" });
  // Dos ciclos de la entrada y del sondeo: sin tarjeta nueva y con el aviso.
  await expect(page.getByTestId("en-vivo")).toContainText("BzzzBX unavailable", { timeout: UN_MINUTO });
  await page.waitForTimeout(35_000);
  expect(await idsDeRequests(page)).toEqual(antes);

  const inicio = Date.now();
  await control(page, { accion: "no_disponible", valor: false });
  await esperarTarjetaNueva(page, antes);
  expect(Date.now() - inicio).toBeLessThan(UN_MINUTO);
});

test("E5: tras reiniciar el falso (el cursor caduca) la entrada recupera, sin duplicar la seed", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await expect(requests(page).first()).toBeVisible();
  await control(page, { accion: "reiniciar" });
  await page.reload();
  await expect(requests(page).first()).toBeVisible();
  const antes = await idsDeRequests(page);

  const inicio = Date.now();
  await control(page, { accion: "correo_nuevo" });
  await esperarTarjetaNueva(page, antes);
  expect(Date.now() - inicio).toBeLessThan(UN_MINUTO);
  // El conteo subió en uno: la seed, que la recuperación vio otra vez, no se duplicó.
  expect(await requests(page).count()).toBe(antes.length + 1);
});

test("E6: AI pending: la Job window de la request nueva abre sin sugerencias y sin marcas de IA", async ({ page }) => {
  await page.goto(`/job/${requestId}`);
  await expect(page.getByTestId("encabezado")).toBeVisible();
  await expect(page.getByTestId("marca-ai")).toHaveCount(0);
  await expect(page.locator('[data-ranura="conversacion"]').getByTestId("borrador-ia")).toHaveCount(0);
});
