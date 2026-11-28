import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

/**
 * Scheduled (OPR-29, criterios F1 a F8 de docs/spec/opr-29-scheduled.md §11.3) contra el build de producción, la
 * seed y el stand-in de BzzzBX, con OPSRUN_ACTOR_DEMO=1 y OPSRUN_ZONA_HORARIA=America/New_York fijos en
 * playwright.config.mts.
 *
 * Corre en su propio proyecto, al final: F3 lleva R10 a In Progress en Audit (una vez por base) y F6 cambia el job de
 * R11 de bx-job-0111 a bx-job-0112 (también una vez). En una base ya usada F6 se salta limpio.
 *
 * El stand-in no imita a Signal Maker: "pone" y "cierra" la OPS-010 (bx-alert-0011) con `/api/falso`. El registrador de
 * alertas (OPR-34) y el observador de hechos de PINCH (OPR-30) anotan lo que ven en Audit desde el único ciclo de
 * fondo, cada 15 s: lo que depende de ellos espera una vuelta.
 *
 * Lo que este archivo no prueba y es de staging (OPR-40): E2E-3 completo, con la regla real de OPR-33 y la hora real de
 * OPR-4, y E2E-9 completo, con Reschedule y Cancel job desde opsRUN (Fase B).
 */
test.describe.configure({ mode: "serial" });

const R10 = "b0000000-0000-4000-8000-000000000a10";
const R11 = "b0000000-0000-4000-8000-000000000a11";
const OPS_UNO = "0a000000-0000-4000-8000-0000000000a1";
const MIN = 60_000;
const hace = (ms: number) => new Date(Date.now() - ms).toISOString();
const GUARDADO = { timeout: 20_000 };
const UNA_VUELTA = { timeout: 60_000 };
const FASE_B = "Available when actions are switched on";

/** Cuándo abrió la OPS-010 de R10: una sola vez para todo el archivo, así F2 y F3 hablan de la misma ocurrencia. */
const ABIERTA_HACE_10_MIN = hace(10 * MIN);

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
const contar = async (sql: string, parametros: unknown[] = []) => Number((await consultar<{ n: string }>(sql, parametros))[0]!.n);
const auditDe = (id: string) => contar("select count(*) as n from opsrun.audit_event where request_id = $1", [id]);
const instrucciones = () => contar("select count(*) as n from opsrun.instruction");
const trabajoDe = async (id: string) => (await consultar<{ bzzzbx_job_id: string }>("select bzzzbx_job_id from opsrun.request where id = $1", [id]))[0]!.bzzzbx_job_id;

const pestana = (page: Page, id: string) => page.locator(`[data-testid="pestana"][data-pestana="${id}"]`);
const columna = (page: Page, etapa: string) => page.locator(`[data-testid="columna"][data-etapa="${etapa}"]`);
const tarjeta = (page: Page, id: string) => page.locator(`[data-testid="tarjeta"][data-request="${id}"]`);
const audit = (page: Page) => page.locator('[data-ranura="audit"]');
const resultado = (page: Page) => page.getByTestId("resultado-accion");
const opcion = (page: Page, codigo: string) => page.locator(`[data-testid="accion"] option[value="${codigo}"]`);
const entradasDelHilo = (page: Page) => page.getByTestId("entrada");

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

async function abrir(page: Page, id: string, tab?: string) {
  await page.goto(`/job/${id}${tab ? `?tab=${tab}` : ""}`);
  await expect(page.getByTestId("encabezado")).toBeVisible();
  await expect(page.getByTestId("barra-acciones")).toBeVisible();
}

/** La OPS-010 de R10 que pondría Signal Maker (la regla real es de OPR-33). */
const ponerDelayed = (page: Page, parche: Record<string, unknown> = {}) =>
  control(page, {
    accion: "poner",
    entidad: "alert_result",
    valor: {
      bzzzbx_alert_id: "bx-alert-0011",
      sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0110" },
      rule_id: "OPS-010",
      rule_version: "1",
      level: "red",
      reason_text: "Not started by 1:00 PM.",
      opened_at: ABIERTA_HACE_10_MIN,
      cleared_at: null,
      ...parche,
    },
  });

/** Las filas de Audit, en el orden en que se ven, como "evento complemento". */
const lineasDeAudit = (page: Page) => audit(page).getByTestId("audit-fila").allInnerTexts();
const posicion = (lineas: string[], texto: string) => lineas.findIndex((l) => l.includes(texto));

test.beforeEach(async ({ page }) => {
  await control(page, { accion: "reiniciar" });
});

test("F1: la vista de Scheduled de R10: tarjeta con fecha y ventana, ventana con su fila Linked job y sus pestañas", async ({ page }) => {
  await page.goto("/");
  const t = tarjeta(page, R10);
  await expect(columna(page, "scheduled").locator(`[data-request="${R10}"]`)).toBeVisible();
  await expect(t.getByTestId("estado")).toHaveText(/^\w{3}, \w{3} \d{1,2} · 9:00 AM–12:00 PM$/);
  await expect(t.getByTestId("estado")).toHaveAttribute("data-tipo", "programada");

  await abrir(page, R10);
  await expect(page.getByTestId("stage")).toHaveText("Scheduled");
  await expect(page.getByTestId("job-numero")).toHaveText("EX-00110");
  await expect(page.getByTestId("job-fecha")).toHaveText(/^\w{3}, \w{3} \d{1,2} · 9:00 AM–12:00 PM$/);
  await expect(page.getByTestId("job-cleaner")).toHaveText("Team Alpha");
  await expect(page.getByTestId("chip-delayed")).toHaveCount(0);
  // La fila Linked job: el job number y quién lo enlazó (de request_scheduled en Audit).
  const campos = page.getByTestId("campos-propiedad");
  await expect(campos).toContainText("Linked job");
  await expect(campos).toContainText(/EX-00110 · Linked \w{3} \d{1,2} by Ops Uno/);
  // Pestañas: la propiedad, Audit, $ y People en gris y Alerts; sin Job tracker (llega con In Progress).
  await expect(pestana(page, "property")).toHaveAttribute("aria-selected", "true");
  await expect(pestana(page, "audit")).toBeVisible();
  await expect(pestana(page, "alerts")).toBeVisible();
  await expect(pestana(page, "dollar")).toHaveAttribute("aria-disabled", "true");
  await expect(pestana(page, "people")).toHaveAttribute("aria-disabled", "true");
  await expect(pestana(page, "tracker")).toHaveCount(0);
});

test("F2: Delayed se ve: parpadea en la tarjeta, chip gris en la ventana y ningún texto sale solo", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/");
  await expect(tarjeta(page, R10).getByTestId("estado")).toHaveAttribute("data-tipo", "programada");
  const barraAntes = Number((await page.getByTestId("alertas-operacion").innerText()).trim());
  const instruccionesAntes = await instrucciones();
  await abrir(page, R10);
  const mensajesAntes = await entradasDelHilo(page).count();
  await page.goto("/");

  // Signal Maker abre la OPS-010: en menos de 1 minuto, sin recargar, la tarjeta dice Delayed en lugar de la fecha.
  await ponerDelayed(page);
  const t = tarjeta(page, R10);
  await expect(t.getByTestId("estado")).toHaveText("Delayed", UNA_VUELTA);
  await expect(t.getByTestId("estado")).toHaveAttribute("data-tipo", "delayed");
  await expect(t).toHaveAttribute("data-color", "sombreada");
  await expect(t.getByTestId("estado")).toHaveCSS("animation-name", "parpadeo");
  await expect(columna(page, "scheduled").getByTestId("alertas-columna")).toHaveAttribute("data-nivel", "red");
  await expect(columna(page, "scheduled").getByTestId("alertas-columna")).toHaveText("1");
  await expect(page.getByTestId("alertas-operacion")).toContainText(String(barraAntes + 1), UNA_VUELTA);

  // La ventana abre en Alerts (OPS-010 pide acción) y el encabezado trae el chip gris, sin parpadeo.
  await abrir(page, R10);
  await expect(pestana(page, "alerts")).toHaveAttribute("aria-selected", "true");
  const chip = page.getByTestId("chip-delayed");
  await expect(chip).toHaveText("Delayed");
  await expect(chip).toHaveCSS("animation-name", "none");
  await expect(page.getByTestId("stage")).toHaveText("Scheduled");

  // Con prefers-reduced-motion la tarjeta no parpadea.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(tarjeta(page, R10).getByTestId("estado")).toHaveText("Delayed", UNA_VUELTA);
  await expect(tarjeta(page, R10).getByTestId("estado")).toHaveCSS("animation-name", "none");

  // Sin texto automático: el registrador anota la ocurrencia y no sale ninguna instrucción ni mensaje.
  await expect
    .poll(() => contar("select count(*) as n from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-0011'"), UNA_VUELTA)
    .toBe(1);
  expect(await instrucciones()).toBe(instruccionesAntes);
  await abrir(page, R10);
  await expect(entradasDelHilo(page)).toHaveCount(mensajesAntes);
});

test("F5: BzzzBX caído: la tarjeta y el chip muestran lo último leído con la franja, y Change linked job dice BzzzBX unavailable", async ({ page }) => {
  test.setTimeout(180_000);
  await ponerDelayed(page);
  // Con BzzzBX arriba, la memoria de la ventana y la del tablero guardan lo último leído.
  await abrir(page, R10);
  await expect(page.getByTestId("chip-delayed")).toBeVisible();
  await abrir(page, R11);
  await page.goto("/");
  await expect(tarjeta(page, R10).getByTestId("estado")).toHaveText("Delayed");

  await control(page, { accion: "no_disponible", valor: true });
  try {
    await page.reload();
    await expect(page.getByTestId("en-vivo")).toHaveText(/^BzzzBX unavailable · last update /);
    await expect(tarjeta(page, R10).getByTestId("estado")).toHaveText("Delayed");

    await abrir(page, R10);
    await expect(page.getByTestId("franja-bzzzbx")).toHaveText(/^BzzzBX unavailable · last update \d{1,2}:\d{2} (AM|PM)$/);
    await expect(page.getByTestId("chip-delayed")).toBeVisible();

    await abrir(page, R11);
    await expect(opcion(page, "relink_job")).toHaveText("Change linked job — BzzzBX unavailable");
    await expect(opcion(page, "relink_job")).toBeDisabled();
  } finally {
    await control(page, { accion: "no_disponible", valor: false });
  }
});

test("F3: Delayed se limpia con el check-in: In Progress sin chip, y Audit dice Delayed, Checked in · Observed y Started · Delayed cleared", async ({ page }) => {
  test.setTimeout(240_000);
  await ponerDelayed(page);
  await page.goto("/");
  await expect(tarjeta(page, R10).getByTestId("estado")).toHaveText("Delayed", UNA_VUELTA);
  // El registrador anota la apertura antes del check-in, para que Audit la ordene primero.
  await expect
    .poll(() => contar("select count(*) as n from opsrun.audit_event where request_id = $1 and event_type = 'alert_opened'", [R10]), UNA_VUELTA)
    .toBeGreaterThanOrEqual(1);

  // El job hace check-in y Signal Maker cierra la alerta.
  await control(page, {
    accion: "poner",
    entidad: "jobtracker_event",
    valor: { bzzzbx_event_id: "bx-evt-0110", bzzzbx_job_id: "bx-job-0110", kind: "checked_in", occurred_at: hace(MIN) },
  });
  await control(page, { accion: "cambiar", entidad: "alert_result", id: "bx-alert-0011", parche: { cleared_at: new Date().toISOString() } });

  await expect(columna(page, "in_progress").locator(`[data-request="${R10}"]`)).toBeVisible(UNA_VUELTA);
  await expect(columna(page, "scheduled").locator(`[data-request="${R10}"]`)).toHaveCount(0);
  await expect(tarjeta(page, R10).getByTestId("estado")).not.toHaveText("Delayed");

  await abrir(page, R10, "audit");
  await expect(page.getByTestId("stage")).toHaveText("In Progress");
  await expect(page.getByTestId("chip-delayed")).toHaveCount(0);
  // Audit, en orden. Las líneas de Delayed y del check-in las escriben el registrador y el observador: una vuelta.
  await expect(async () => {
    await page.reload();
    const lineas = await lineasDeAudit(page);
    const abre = posicion(lineas, "Delayed · Not started by 1:00 PM.");
    const checkIn = posicion(lineas, "Checked in");
    const cierra = posicion(lineas, "Started · Delayed cleared");
    expect(abre, lineas.join(" | ")).toBeGreaterThanOrEqual(0);
    expect(checkIn, lineas.join(" | ")).toBeGreaterThan(abre);
    expect(cierra, lineas.join(" | ")).toBeGreaterThan(checkIn);
    expect(lineas[checkIn]).toContain("Observed");
    expect(lineas[abre]).toContain("Observed");
    expect(lineas[cierra]).toContain("Observed");
  }).toPass({ timeout: 90_000 });
});

test("F4: Reschedule y Cancel job se ven en gris con el texto de la Fase B y no corren aunque se fuerce el botón", async ({ page }) => {
  await abrir(page, R11);
  await expect(opcion(page, "reschedule_job")).toHaveText(`Reschedule — ${FASE_B}`);
  await expect(opcion(page, "cancel_job")).toHaveText(`Cancel job — ${FASE_B}`);
  await expect(opcion(page, "reschedule_job")).toBeDisabled();
  await expect(opcion(page, "cancel_job")).toBeDisabled();
  const auditAntes = await auditDe(R11);
  const instruccionesAntes = await instrucciones();

  for (const codigo of ["reschedule_job", "cancel_job"]) {
    await page.goto(`/job/${R11}`); // limpio: el disabled quitado a mano en la vuelta anterior no vuelve solo
    await expect(page.getByTestId("barra-acciones")).toBeVisible();
    await elegirAunqueEsteDeshabilitada(page, codigo);
    await page.getByTestId("motivo").fill("Requester asked to move it.");
    await pulsarGoForzado(page);
    await expect(resultado(page)).toHaveText(FASE_B);
    await expect(resultado(page)).toHaveAttribute("data-tipo", "rechazada");
  }
  expect(await auditDe(R11)).toBe(auditAntes);
  expect(await instrucciones()).toBe(instruccionesAntes);
});

test("F6: Change linked job: ofrece bx-job-0112 y no el actual; con motivo cambia el job sin salir de Scheduled", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip((await trabajoDe(R11)) !== "bx-job-0111", "R11 ya se cambió a otro job en esta base");
  await abrir(page, R11);
  await actuarComo(page, OPS_UNO);
  await expect(page.getByTestId("job-numero")).toHaveText("EX-00111");
  await expect(opcion(page, "relink_job")).toHaveText("Change linked job");
  await expect(opcion(page, "relink_job")).toBeEnabled();

  await elegirAccion(page, "relink_job");
  const candidatos = page.getByTestId("candidato-cambio");
  await expect(candidatos).toHaveCount(1);
  await expect(candidatos.first()).toHaveAttribute("data-job", "bx-job-0112");
  await expect(page.locator('[data-testid="candidato-cambio"][data-job="bx-job-0111"]')).toHaveCount(0);
  // Go no se habilita sin job elegido ni sin motivo.
  await expect(page.getByTestId("go")).toBeDisabled();
  await page.getByRole("radio").first().check();
  await expect(page.getByTestId("go")).toBeDisabled();
  await page.getByTestId("motivo").fill("   ");
  await expect(page.getByTestId("go")).toBeDisabled();
  await page.getByTestId("motivo").fill("PINCH cancelled the job and created another.");
  await expect(page.getByTestId("go")).toBeEnabled();
  await page.getByTestId("go").click();
  await expect(resultado(page)).toHaveText("Saved", GUARDADO);

  await expect(page.getByTestId("job-numero")).toHaveText("EX-00112", GUARDADO);
  await expect(page.getByTestId("stage")).toHaveText("Scheduled");
  await pestana(page, "audit").click();
  const fila = audit(page).getByTestId("audit-fila").filter({ hasText: "Linked job changed" });
  await expect(fila).toHaveCount(1);
  await expect(fila).toContainText("from EX-00111 to EX-00112");
  await expect(fila.getByTestId("audit-persona")).toHaveText("Ops Uno");
  await expect(fila.getByTestId("audit-motivo")).toContainText("PINCH cancelled the job and created another.");
  expect(await trabajoDe(R11)).toBe("bx-job-0112");
  // Un enlace nuevo no es una instrucción: la Fase A no manda nada a BzzzBX.
  expect(await contar("select count(*) as n from opsrun.instruction where request_id = $1", [R11])).toBe(0);
});

test("F7: reprogramado en PINCH: la fecha nueva se ve sola en la tarjeta, el encabezado y la pestaña, y Audit no gana filas", async ({ page }) => {
  test.setTimeout(150_000);
  const nueva = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  await page.goto("/");
  await expect(tarjeta(page, R11)).toBeVisible();
  const antes = await tarjeta(page, R11).getByTestId("estado").innerText();
  const auditAntes = await auditDe(R11);

  await control(page, { accion: "cambiar", entidad: "job", id: await trabajoDe(R11), parche: { service_date: nueva, window_start: "14:00", window_end: "17:00" } });
  // En menos de 1 minuto, sin recargar.
  await expect(tarjeta(page, R11).getByTestId("estado")).toHaveText(/ · 2:00 PM–5:00 PM$/, UNA_VUELTA);
  expect(await tarjeta(page, R11).getByTestId("estado").innerText()).not.toBe(antes);

  await abrir(page, R11);
  await expect(page.getByTestId("job-fecha")).toHaveText(/ · 2:00 PM–5:00 PM$/);
  await expect(page.getByTestId("campos-propiedad")).toContainText(/Date and window\s*\w{3}, \w{3} \d{1,2} · 2:00 PM–5:00 PM/);
  // Audit no anota la reprogramación en la Fase A (P-4): da una vuelta del ciclo y comprueba que sigue igual.
  await page.waitForTimeout(20_000);
  expect(await auditDe(R11)).toBe(auditAntes);
});

test("F8: cancelado en PINCH: la tarjeta sale del tablero, la ventana dice Cancelled y Audit dice Job cancelled · Observed", async ({ page }) => {
  test.setTimeout(180_000);
  const jobId = await trabajoDe(R11);
  // Change linked job sigue disponible con el job cancelado si hay otro job al que cambiar: el que PINCH creó en su lugar.
  await control(page, {
    accion: "poner",
    entidad: "job",
    valor: {
      bzzzbx_job_id: "bx-job-0113",
      job_number: "EX-00113",
      bzzzbx_customer_id: "bx-cust-0002",
      bzzzbx_property_id: "bx-prop-0006",
      bzzzbx_space_id: null,
      bzzzbx_service_id: "bx-svc-0001",
      service_date: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
      window_start: "09:00",
      window_end: "12:00",
      status: "scheduled",
      bzzzbx_team_id: "bx-team-0002",
      po_number: null,
      price: { amount_cents: 17_000, currency: "USD" },
    },
  });
  await page.goto("/");
  await expect(tarjeta(page, R11)).toBeVisible();

  await control(page, { accion: "cambiar", entidad: "job", id: jobId, parche: { status: "cancelled" } });
  // La tarjeta sale del tablero en menos de 1 minuto, sin recargar.
  await expect(tarjeta(page, R11)).toHaveCount(0, UNA_VUELTA);

  await abrir(page, R11);
  await expect(page.getByTestId("stage")).toHaveText("Cancelled");
  await expect(page.getByTestId("razon-composer")).toHaveText("Job cancelled");
  // Change linked job sigue disponible: la salida de un job que PINCH canceló y reemplazó.
  await expect(opcion(page, "relink_job")).toBeEnabled();
  await expect(opcion(page, "reschedule_job")).toHaveCount(0);
  await expect(opcion(page, "cancel_job")).toHaveCount(0);

  // Tras una vuelta del observador, Audit lo anota con la marca Observed (una sola vez).
  await expect(async () => {
    await page.reload();
    await pestana(page, "audit").click();
    const fila = audit(page).getByTestId("audit-fila").filter({ hasText: "Job cancelled" });
    await expect(fila).toHaveCount(1, { timeout: 2000 });
    await expect(fila).toContainText("Observed");
  }).toPass({ timeout: 90_000 });
  expect(await contar("select count(*) as n from opsrun.audit_event where request_id = $1 and event_type = 'job_cancel_observed'", [R11])).toBe(1);
});
