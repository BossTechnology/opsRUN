import { expect, test, type Page } from "@playwright/test";

/**
 * El tablero (OPR-25) con la seed y el stand-in de BzzzBX. Los estados que la
 * seed no trae y los cambios en el origen se piden a la ruta de control del
 * falso (/api/falso), que solo existe fuera del servidor.
 */
test.describe.configure({ mode: "serial" });

const R1 = "b0000000-0000-4000-8000-0000000000a1";
const R2 = "b0000000-0000-4000-8000-0000000000a2";

async function control(page: Page, pedido: Record<string, unknown>) {
  const r = await page.request.post("/api/falso", { data: pedido });
  expect(r.ok(), await r.text()).toBe(true);
}

const columna = (page: Page, etapa: string) => page.locator(`[data-testid="columna"][data-etapa="${etapa}"]`);
const porNumero = (page: Page, numero: string) => page.locator(`[data-testid="tarjeta"][data-numero="${numero}"]`);
const porRequest = (page: Page, id: string) => page.locator(`[data-testid="tarjeta"][data-request="${id}"]`);

test.beforeEach(async ({ page }) => {
  await control(page, { accion: "reiniciar" });
});

test("cinco columnas, cada request en su etapa, con conteos", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Requests",
    "Scheduled",
    "In Progress",
    "Complete",
    "Validation",
  ]);
  await expect(columna(page, "requests").locator(`[data-request="${R1}"]`)).toBeVisible();
  await expect(columna(page, "requests").locator(`[data-request="${R2}"]`)).toBeVisible();
  await expect(columna(page, "scheduled").locator('[data-numero="EX-00003"]')).toBeVisible();
  await expect(columna(page, "in_progress").locator('[data-numero="EX-00004"]')).toBeVisible();
  await expect(columna(page, "complete").locator('[data-numero="EX-00005"]')).toBeVisible();
  await expect(columna(page, "validation").locator('[data-numero="EX-00006"]')).toBeAttached();

  for (const etapa of ["requests", "scheduled", "in_progress", "complete", "validation"]) {
    const total = await columna(page, etapa).getByTestId("tarjeta").count();
    await expect(columna(page, etapa).getByTestId("conteo")).toHaveText(String(total));
  }
  await expect(columna(page, "requests").getByTestId("alertas-columna")).toHaveText("1");
  await expect(page.getByTestId("alertas-operacion")).toContainText("1");
});

test("anatomía de la tarjeta y — — en lo no definido", async ({ page }) => {
  await page.goto("/");
  const r3 = porNumero(page, "EX-00003");
  await expect(r3.getByTestId("nombre")).toHaveText("Demo Lofts 7C");
  await expect(r3.getByTestId("estado")).toHaveText(/^\w{3}, \w{3} \d{1,2} · 10:00 AM–2:00 PM$/);
  await expect(r3.getByTestId("ciudad")).toHaveText("Sample Town");
  await expect(r3.getByTestId("servicio")).toHaveText("standard | Standard clean");
  await expect(r3.getByTestId("flags")).toHaveText("PO");
  await expect(porNumero(page, "EX-00005").getByTestId("flags")).toHaveText("OSS");
  await expect(porNumero(page, "EX-00004").getByTestId("estado")).toHaveText(/^Checked in /);
  await expect(porRequest(page, R1).getByTestId("servicio")).toHaveText("— — | — —");
});

test("estados de color de la seed: borde rojo, verde pagada en la fila paid", async ({ page }) => {
  await page.goto("/");
  await expect(porNumero(page, "EX-00004")).toHaveAttribute("data-color", "borde");
  await expect(porRequest(page, R1)).toHaveAttribute("data-color", "borde");
  await expect(porRequest(page, R2)).toHaveAttribute("data-color", "normal");

  const paid = page.getByTestId("fila-paid");
  await expect(paid.getByText("Paid (1)")).toBeVisible();
  await paid.getByText("Paid (1)").click();
  const r6 = porNumero(page, "EX-00006");
  await expect(r6).toBeVisible();
  await expect(r6).toHaveAttribute("data-color", "pagada");
  await expect(r6.getByTestId("estado")).toHaveText(/^Paid /);
});

test("sombreado rojo, oscura sin dueño y Delayed", async ({ page }) => {
  await control(page, { accion: "cambiar", entidad: "job_health", id: "bx-job-0003", parche: { status: "breached" } });
  await control(page, {
    accion: "cambiar",
    entidad: "alert_result",
    id: "bx-alert-0001",
    parche: { cleared_at: new Date().toISOString() },
  });
  await control(page, {
    accion: "poner",
    entidad: "alert_result",
    valor: {
      bzzzbx_alert_id: "bx-alert-0100",
      sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0003" },
      rule_id: "OPS-010",
      rule_version: "1",
      level: "red",
      reason_text: "Not started by 1:00 PM.",
      opened_at: new Date().toISOString(),
      cleared_at: null,
    },
  });
  await page.goto("/");
  const r3 = porNumero(page, "EX-00003");
  await expect(r3).toHaveAttribute("data-color", "sombreada");
  await expect(r3.getByTestId("estado")).toHaveText("Delayed");
  await expect(r3).toHaveAttribute("data-estado", "delayed");
  await expect(porRequest(page, R1)).toHaveAttribute("data-color", "sin_dueno");
  await expect(columna(page, "scheduled").getByTestId("alertas-columna")).toHaveAttribute("data-nivel", "red");
});

test("un cambio en el origen se ve en menos de 1 minuto, sin recargar", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(columna(page, "scheduled").locator('[data-numero="EX-00003"]')).toBeVisible();
  const inicio = Date.now();
  await control(page, {
    accion: "poner",
    entidad: "jobtracker_event",
    valor: { bzzzbx_event_id: "bx-evt-0100", bzzzbx_job_id: "bx-job-0003", kind: "checked_in", occurred_at: new Date().toISOString() },
  });
  await expect(columna(page, "in_progress").locator('[data-numero="EX-00003"]')).toBeVisible({ timeout: 60_000 });
  expect(Date.now() - inicio).toBeLessThan(60_000);
});

test("BzzzBX caído: lo último conocido con aviso", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("en-vivo")).toHaveText("Live");
  await control(page, { accion: "no_disponible", valor: true });
  await page.reload();
  await expect(page.getByTestId("en-vivo")).toHaveText(/^BzzzBX unavailable · last update /);
  await expect(porNumero(page, "EX-00003").getByTestId("nombre")).toHaveText("Demo Lofts 7C");
  await control(page, { accion: "no_disponible", valor: false });
});

test("lo que no entra en V1.1 beta se ve en gris y no corre", async ({ page }) => {
  await page.goto("/");
  for (const nombre of ["Alarms", "Anomalies", "Actions", "Observe", "Geo", "Incidents", "Activity", "Map"]) {
    const boton = page.getByRole("button", { name: nombre, exact: true });
    await expect(boton).toHaveAttribute("aria-disabled", "true");
    await expect(boton).toHaveAttribute("title", "Available in a later release");
  }
  // aria-disabled cuenta como deshabilitado para Playwright, que esperaría para
  // siempre: se fuerza el clic, como lo haría una persona, y no debe pasar nada.
  await page.getByRole("button", { name: "Observe", exact: true }).click({ force: true });
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("option", { name: /Only me/ })).toBeDisabled();
});
