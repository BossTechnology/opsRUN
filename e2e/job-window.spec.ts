import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { esperarVentanaLista } from "./ventana";

/**
 * La Job window (OPR-26, criterios A1 a A16 del spec) contra el build de
 * producción, la seed y el stand-in de BzzzBX. Los estados que la seed no trae
 * y los cambios en el origen se piden a `/api/falso`, que solo existe fuera del
 * servidor. R1 a R7 son las requests de la seed; EX-0000N es el job de RN.
 */
test.describe.configure({ mode: "serial" });

const R = (n: number) => `b0000000-0000-4000-8000-0000000000a${n}`;

async function control(page: Page, pedido: Record<string, unknown>) {
  const r = await page.request.post("/api/falso", { data: pedido });
  expect(r.ok(), await r.text()).toBe(true);
}

const porNumero = (page: Page, numero: string) => page.locator(`[data-testid="tarjeta"][data-numero="${numero}"]`);
const porRequest = (page: Page, id: string) => page.locator(`[data-testid="tarjeta"][data-request="${id}"]`);
// Con Cache Components, Next deja oculta (no desmontada) la ventana que se cerró: solo cuenta la visible.
const ventana = (page: Page) => page.getByTestId("ventana").filter({ visible: true });
const modal = (page: Page) => page.getByTestId("modal").filter({ visible: true });
const pestana = (page: Page, id: string) => page.locator(`[data-testid="pestana"][data-pestana="${id}"]`);
const nombresDePestanas = (page: Page) =>
  page.getByTestId("pestana").evaluateAll((els) =>
    els.map((e) => {
      const copia = e.cloneNode(true) as HTMLElement;
      copia.querySelector('[data-testid="conteo-alertas"]')?.remove();
      return (copia.textContent ?? "").trim();
    }),
  );

/** Las acciones de la action bar, sin la nota en gris. */
const etiquetasDeAcciones = (page: Page) =>
  page
    .locator('[data-testid="accion"] option:not([value=""])')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? "").split(" — ")[0]));

/** La tarjeta de una request en el tablero; EX-00006 está paid, en la fila colapsada de Validation. */
async function tarjetaDelTablero(page: Page, id: string) {
  await page.goto("/");
  await expect(page.getByTestId("columna")).toHaveCount(5);
  const tarjeta = porRequest(page, id);
  if (!(await tarjeta.isVisible())) await page.getByTestId("fila-paid").locator("summary").click();
  await expect(tarjeta).toBeVisible();
  return tarjeta;
}

async function abrirDesdeElTablero(page: Page, id: string) {
  await (await tarjetaDelTablero(page, id)).click();
  await expect(page.getByTestId("encabezado")).toBeVisible();
}

/** Elige una acción como lo haría la interfaz, pero saltándose el `disabled` de la opción. */
async function elegirAunqueEsteDeshabilitada(page: Page, codigo: string) {
  // Se repite hasta que la página termina de hidratarse y React atiende el evento.
  await expect(async () => {
    await page.getByTestId("accion").evaluate((select: HTMLSelectElement, valor) => {
      for (const o of select.options) o.disabled = false;
      select.value = valor;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, codigo);
    await expect(page.getByTestId("panel-accion")).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

test.beforeEach(async ({ page }) => {
  await control(page, { accion: "reiniciar" });
});

test("A1: abre en menos de 2 s, desde la tarjeta de EX-00003, R1 y EX-00006", async ({ page }) => {
  for (const id of [R(3), R(1), R(6)]) {
    const tarjeta = await tarjetaDelTablero(page, id);
    const inicio = Date.now();
    await tarjeta.click();
    await expect(page.getByTestId("encabezado")).toBeVisible();
    await expect(page.getByTestId("barra-acciones")).toBeVisible();
    const ms = Date.now() - inicio;
    expect(ms, `la ventana de ${id} tardó ${ms} ms`).toBeLessThan(2000);
  }
});

test("A2: se abre encima del tablero, se cierra con Esc sin perderlo, y la URL directa es página completa", async ({ page }) => {
  await abrirDesdeElTablero(page, R(3));
  await expect(page).toHaveURL(new RegExp(`/job/${R(3)}$`));
  await expect(modal(page)).toBeVisible();
  await expect(ventana(page)).toHaveAttribute("data-modo", "overlay");
  // El tablero sigue en el DOM debajo.
  await expect(page.getByTestId("columna")).toHaveCount(5);
  expect(await page.getByTestId("tarjeta").count()).toBeGreaterThan(5);
  // Marca en el DOM del tablero: si se recargara, la marca desaparece.
  await page.evaluate(() => document.querySelector('[data-testid="columna"]')?.setAttribute("data-marca", "sin-recargar"));

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/$/);
  await expect(modal(page)).toHaveCount(0);
  await expect(porNumero(page, "EX-00003")).toBeVisible();
  await expect(page.locator('[data-testid="columna"][data-marca="sin-recargar"]')).toHaveCount(1);

  // ✕ y atrás del navegador también cierran.
  await porRequest(page, R(3)).click();
  await page.getByTestId("cerrar").filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(modal(page)).toHaveCount(0);
  await porRequest(page, R(3)).click();
  await expect(modal(page)).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(modal(page)).toHaveCount(0);

  // URL directa: la misma ventana como página completa, con "Board".
  await page.goto(`/job/${R(3)}`);
  await expect(ventana(page)).toHaveAttribute("data-modo", "pagina");
  await expect(page.getByTestId("modal")).toHaveCount(0);
  await expect(page.getByTestId("columna")).toHaveCount(0);
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(porNumero(page, "EX-00003")).toBeVisible();

  // La recarga con la ventana abierta la abre como página completa.
  await porRequest(page, R(3)).click();
  await expect(modal(page)).toBeVisible();
  await page.reload();
  await expect(ventana(page)).toHaveAttribute("data-modo", "pagina");
});

test("A3: encabezado completo en EX-00003 y — — en R1", async ({ page }) => {
  await page.goto(`/job/${R(3)}`);
  await expect(page.getByTestId("stage")).toHaveText("Scheduled");
  await expect(page.getByTestId("nombre-job")).toHaveText("Demo Lofts 7C");
  await expect(page.getByTestId("job-numero")).toHaveText("EX-00003");
  await expect(page.getByTestId("job-fecha")).toHaveText(/^\w{3}, \w{3} \d{1,2} · 10:00 AM–2:00 PM$/);
  await expect(page.getByTestId("job-servicio")).toHaveText("Standard clean");
  await expect(page.getByTestId("job-cleaner")).toHaveText("Team Beta");
  await expect(page.getByTestId("asignado")).toHaveText("Ops Uno");
  await expect(page.getByTestId("precio")).toHaveText("$185.00");
  // Una barra por operador activo (la seed trae cuatro).
  await expect(page.getByTestId("carga")).toHaveCount(4);

  await page.goto(`/job/${R(1)}`);
  await expect(page.getByTestId("stage")).toHaveText("Requests");
  await expect(page.getByTestId("job-numero")).toHaveText("R1");
  await expect(page.getByTestId("job-fecha")).toHaveText("Not scheduled");
  await expect(page.getByTestId("job-servicio")).toHaveText("— —");
  await expect(page.getByTestId("job-cleaner")).toHaveText("— —");
  await expect(page.getByTestId("precio")).toHaveText("— —");
  await expect(page.getByTestId("asignado")).toHaveText("Unassigned");
});

test("A4: pestañas por etapa, con $ y People que no se seleccionan, y Alerts al final", async ({ page }) => {
  const casos: [string, string[]][] = [
    [R(2), ["Unit 12", "$", "People", "Alerts"]],
    [R(3), ["7C", "Audit", "$", "People", "Alerts"]],
    [R(4), ["Placeholder House", "Audit", "Job tracker", "$", "People", "Alerts"]],
    [R(6), ["Test Terrace", "Audit", "Job tracker", "Billing", "$", "People", "Alerts"]],
  ];
  for (const [id, esperadas] of casos) {
    await page.goto(`/job/${id}`);
    await expect(page.getByRole("tablist")).toBeVisible();
    expect(await nombresDePestanas(page), id).toEqual(esperadas);
    for (const gris of ["dollar", "people"]) {
      const p = pestana(page, gris);
      await expect(p).toHaveAttribute("aria-disabled", "true");
      await expect(p).toHaveAttribute("title", "Not available in this release");
    }
    // Nombre accesible "$" y "People"; la nota es la descripción, no el nombre.
    for (const [nombre, gris] of [["$", "dollar"], ["People", "people"]]) {
      const p = page.getByRole("tab", { name: nombre, exact: true });
      await expect(p, `${id} ${nombre}`).toHaveAttribute("data-pestana", gris);
      await expect(p).toHaveAccessibleDescription("Not available in this release");
    }
  }

  // Ni el clic ni el teclado las seleccionan, ni cambian la URL.
  await page.goto(`/job/${R(3)}`);
  await expect(page.getByRole("tablist")).toBeVisible();
  const antes = page.url();
  for (const gris of ["dollar", "people"]) {
    const p = pestana(page, gris);
    await p.click({ force: true });
    await p.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await expect(p).toHaveAttribute("aria-selected", "false");
    expect(page.url()).toBe(antes);
  }
  await expect(pestana(page, "property")).toHaveAttribute("aria-selected", "true");

  // Las flechas se mueven solo entre las disponibles y la URL lleva ?tab=.
  await pestana(page, "property").focus();
  await page.keyboard.press("ArrowRight");
  await expect(pestana(page, "audit")).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\?tab=audit$/);
  await page.keyboard.press("ArrowRight");
  await expect(pestana(page, "alerts")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { selected: true })).toHaveCount(1);

  // Un ?tab= de una pestaña que no toca cae a la regla.
  await page.goto(`/job/${R(2)}?tab=audit`);
  await expect(pestana(page, "property")).toHaveAttribute("aria-selected", "true");
});

test("A5: el nombre de la pestaña de la propiedad", async ({ page }) => {
  await page.goto(`/job/${R(2)}`);
  await expect(pestana(page, "property")).toHaveText("Unit 12");
  await page.goto(`/job/${R(3)}`);
  await expect(pestana(page, "property")).toHaveText("7C");
  // R1 tiene la unidad 4B y ninguna etiqueta de espacio: manda la unidad (§4.1).
  await page.goto(`/job/${R(1)}?tab=property`);
  await expect(pestana(page, "property")).toHaveText("4B");
  // Un job sin unidad ni espacio: el nombre de la propiedad.
  await page.goto(`/job/${R(4)}`);
  await expect(pestana(page, "property")).toHaveText("Placeholder House");
});

test("A6: abre en Alerts si una alerta pide acción, y vuelve a la propiedad al resolverse", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  // Una alerta que el registrador vio y resolvió no se reabre: con el mismo id, el reintento del grupo (serial) no vería nada.
  const a1 = `bx-alert-a601-${testInfo.retry}`;
  const a2 = `bx-alert-a602-${testInfo.retry}`;
  // Una alerta propia de la prueba, en R3: las de la seed (R1, R4, R8, R9) las necesita la pestaña Alerts de OPR-34 y, una
  // vez resueltas en opsRUN por el registrador, no se reabren.
  const alertaPropia = (id: string) =>
    control(page, {
      accion: "poner",
      entidad: "alert_result",
      valor: {
        bzzzbx_alert_id: id,
        sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0003" },
        rule_id: "OPS-002",
        rule_version: "1",
        level: "amber",
        reason_text: "Open for 2 days.",
        opened_at: new Date().toISOString(),
        cleared_at: null,
      },
    });
  const filas = () => page.getByTestId("alertas-needs-action").getByTestId("alerta");

  await alertaPropia(a1);
  await page.goto(`/job/${R(3)}`);
  await expect(pestana(page, "alerts")).toHaveAttribute("aria-selected", "true");
  await expect(filas()).toHaveCount(1);
  await expect(filas()).toContainText("Open for 2 days.");

  await control(page, { accion: "cambiar", entidad: "alert_result", id: a1, parche: { cleared_at: new Date().toISOString() } });
  await expect(pestana(page, "property")).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });

  // Elegida a mano con ?tab=alerts, se queda aunque ya no haya alertas.
  await control(page, { accion: "reiniciar" });
  await alertaPropia(a2);
  await page.goto(`/job/${R(3)}?tab=alerts`);
  await expect(pestana(page, "alerts")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("conteo-alertas")).toHaveText("1");
  await control(page, { accion: "cambiar", entidad: "alert_result", id: a2, parche: { cleared_at: new Date().toISOString() } });
  // La ventana se refrescó (el conteo se fue) y sigue en Alerts.
  await expect(page.getByTestId("conteo-alertas")).toHaveCount(0, { timeout: 60_000 });
  await expect(pestana(page, "alerts")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("sin-alertas")).toBeVisible();
});

test("A7: las acciones que no corren no corren, ni forzando el disabled", async ({ page }) => {
  await page.goto(`/job/${R(5)}`);
  await expect(page.getByTestId("stage")).toHaveText("Complete");

  const reject = page.locator('[data-testid="accion"] option[value="reject_reclean"]');
  await expect(reject).toBeDisabled();
  await expect(reject).toHaveText("Reject · re-clean — Not available in this release");
  await expect(page.getByTestId("go")).toBeDisabled();

  const cursor = async () => (await (await page.request.get("/api/tablero/cambios")).json()) as { cursor: string };
  const antes = await cursor();

  for (const [id, codigo, texto] of [
    [R(5), "reject_reclean", "Not available in this release"],
    // Fase B (OPR-30, P-10): se hace en las herramientas de PINCH y opsRUN lo observa.
    [R(3), "reschedule_job", "Available when actions are switched on"],
    [R(3), "cancel_job", "Available when actions are switched on"],
    [R(4), "end_job_manually", "Available when actions are switched on"],
  ] as const) {
    await page.goto(`/job/${id}`); // limpio: el disabled quitado a mano en la vuelta anterior no vuelve solo
    await expect(page.getByTestId("barra-acciones")).toBeVisible();
    await elegirAunqueEsteDeshabilitada(page, codigo);
    const go = page.getByTestId("go");
    await expect(go).toBeDisabled();
    // Se quita el disabled como lo haría quien manipula la página. React además ignora los
    // clics sobre un botón cuya prop es disabled, así que el clic se entrega directo al
    // manejador de React: lo que llega al servidor es lo mismo. El servidor decide.
    await go.evaluate((boton: HTMLButtonElement) => {
      boton.removeAttribute("disabled");
      const clave = Object.keys(boton).find((k) => k.startsWith("__reactProps"))!;
      (boton as unknown as Record<string, { onClick: () => void }>)[clave].onClick();
    });
    await expect(page.getByTestId("resultado-accion")).toHaveText(texto);
    await expect(page.getByTestId("resultado-accion")).toHaveAttribute("data-tipo", "rechazada");
  }
  // No se escribió nada: ni un Audit nuevo ni un cambio en el origen.
  expect(await cursor()).toEqual(antes);
});

test("A8: en cada etapa aparecen las acciones de esa etapa y ninguna de otra", async ({ page }) => {
  const casos: [string, string[]][] = [
    [R(2), ["Assign / Reassign", "Confirm details", "Confirm sender", "Confirm cleaner", "Ask cleaner", "Schedule"]],
    [R(3), ["Reschedule", "Cancel job"]],
    [R(4), ["Clear alert", "End manually"]],
    [R(5), ["Approve & confirm", "Mark as OSS / Not OSS", "Reject · re-clean"]],
    [R(6), ["Enter PO", "Validate"]],
  ];
  for (const [id, esperadas] of casos) {
    await page.goto(`/job/${id}`);
    await expect(page.getByTestId("barra-acciones")).toBeVisible();
    expect(await etiquetasDeAcciones(page), id).toEqual(esperadas);
  }
  // Solo corren las que ya tienen ejecutor y nada las bloquea (OPR-28): en R2, Assign, Confirm cleaner (sus details y
  // sender ya están confirmados) y Schedule. El rechazo del enlace es interno y no sale en la barra.
  await page.goto(`/job/${R(2)}`);
  expect(await page.locator('[data-testid="accion"] option:not([value=""]):not([disabled])').evaluateAll((os) => os.map((o) => o.getAttribute("value")))).toEqual([
    "assign",
    "confirm_cleaner",
    "schedule",
  ]);
  await expect(page.locator('[data-testid="accion"] option[value="reject_job_link"]')).toHaveCount(0);
  // R5 (Complete): Approve & confirm y Mark as OSS corren (OPR-31); Reject · re-clean no entra en el release.
  await page.goto(`/job/${R(5)}`);
  expect(await page.locator('[data-testid="accion"] option:not([value=""]):not([disabled])').evaluateAll((os) => os.map((o) => o.getAttribute("value")))).toEqual([
    "approve_confirm",
    "mark_oss",
  ]);
});

test("A9: el panel pide Reason obligatorio y Go no se habilita con vacío ni con espacios", async ({ page }) => {
  await page.goto(`/job/${R(3)}`);
  await elegirAunqueEsteDeshabilitada(page, "reschedule_job");
  const panel = page.getByTestId("panel-accion");
  await expect(panel.getByRole("heading", { name: "Reschedule" })).toBeVisible();
  const motivo = page.getByTestId("motivo");
  await expect(motivo).toBeVisible();
  await expect(motivo).toHaveAttribute("aria-required", "true");
  await expect(page.getByTestId("contador-motivo")).toHaveText("0/500");
  await expect(page.getByTestId("go")).toBeDisabled();
  await motivo.fill("   ");
  await expect(page.getByTestId("go")).toBeDisabled();
  await motivo.fill("Requester asked.");
  await expect(page.getByTestId("contador-motivo")).toHaveText("16/500");
  // Cancel cierra el panel.
  await page.getByTestId("cancelar-accion").click();
  await expect(page.getByTestId("panel-accion")).toHaveCount(0);
});

test("A10: BzzzBX caído con la ventana abierta: franja, lo último leído y acciones en gris", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto(`/job/${R(3)}`);
  await expect(page.getByTestId("franja-bzzzbx")).toHaveCount(0);
  await expect(page.getByTestId("nombre-job")).toHaveText("Demo Lofts 7C");

  await control(page, { accion: "no_disponible", valor: true });
  await expect(page.getByTestId("franja-bzzzbx")).toHaveText(/^BzzzBX unavailable · last update \d{1,2}:\d{2} (AM|PM)$/, { timeout: 60_000 });
  await expect(page.getByTestId("franja-bzzzbx")).toHaveAttribute("role", "status");
  // Conserva lo último leído.
  await expect(page.getByTestId("nombre-job")).toHaveText("Demo Lofts 7C");
  await expect(page.getByTestId("precio")).toHaveText("$185.00");
  // Reschedule y Cancel job son de la Fase B: eso manda sobre "BzzzBX unavailable" (OPR-30, P-10).
  for (const etiqueta of ["Reschedule", "Cancel job"]) {
    const opcion = page.locator('[data-testid="accion"] option', { hasText: etiqueta });
    await expect(opcion).toHaveText(`${etiqueta} — Available when actions are switched on`);
    await expect(opcion).toBeDisabled();
  }

  await control(page, { accion: "no_disponible", valor: false });
  await expect(page.getByTestId("franja-bzzzbx")).toHaveCount(0, { timeout: 60_000 });
});

test("A11: BzzzBX caído desde el primer momento: abre en menos de 2 s con lo de opsRUN y 'no data yet'", async ({ page }) => {
  await control(page, { accion: "no_disponible", valor: true });
  const tarjeta = await tarjetaDelTablero(page, R(3));
  const inicio = Date.now();
  await tarjeta.click();
  await expect(page.getByTestId("encabezado")).toBeVisible();
  await expect(page.getByTestId("barra-acciones")).toBeVisible();
  expect(Date.now() - inicio).toBeLessThan(2000);

  await expect(page.getByTestId("franja-bzzzbx")).toHaveText("BzzzBX unavailable · no data yet");
  await expect(page.getByTestId("job-numero")).toHaveText("EX-00003");
  await expect(page.getByTestId("asignado")).toHaveText("Ops Uno");
  await expect(page.getByTestId("job-servicio")).toHaveText("— —");
  await expect(page.getByTestId("job-cleaner")).toHaveText("— —");
  await expect(page.getByTestId("precio")).toHaveText("— —");
  await expect(page.getByTestId("nombre-job")).toHaveText("— —");
  await control(page, { accion: "no_disponible", valor: false });
});

test("A12: una request sin datos (R1) no lanza excepciones", async ({ page }) => {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errores.push(m.text());
  });
  await abrirDesdeElTablero(page, R(1));
  await expect(page.getByTestId("stage")).toHaveText("Requests");
  await expect(page.getByTestId("asignado")).toHaveText("Unassigned");
  await expect(page.getByTestId("job-fecha")).toHaveText("Not scheduled");
  await expect(page.getByTestId("job-servicio")).toHaveText("— —");
  // R1 no tiene cliente confirmado: Schedule dice qué falta.
  await expect(page.locator('[data-testid="accion"] option[value="schedule"]')).toHaveText(
    "Schedule — Confirm who it is from first",
  );
  await page.waitForTimeout(500);
  expect(errores).toEqual([]);
});

test("A13: un id que no es uuid o no existe, y un job cancelado", async ({ page }) => {
  for (const id of ["no-es-uuid", "b0000000-0000-4000-8000-0000000000ff"]) {
    await page.goto(`/job/${id}`);
    await expect(page.getByRole("heading", { name: "Job not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Board", exact: true })).toBeVisible();
  }

  await control(page, { accion: "cambiar", entidad: "job", id: "bx-job-0003", parche: { status: "cancelled" } });
  await page.goto(`/job/${R(3)}`);
  await expect(page.getByTestId("stage")).toHaveText("Cancelled");
  await expect(page.getByTestId("accion")).toBeDisabled();
  await expect(page.locator('[data-testid="accion"] option:not([value=""])')).toHaveCount(0);
  await expect(page.getByTestId("go")).toBeDisabled();
});

test("A14: las ranuras en su lugar", async ({ page }) => {
  await page.goto(`/job/${R(2)}?tab=property`);
  const conversacion = page.locator('[data-ranura="conversacion"]');
  await expect(conversacion).toBeVisible();
  await expect(conversacion).toContainText("Conversation"); // OPR-27: la conversación ya está en su ranura
  await expect(conversacion).not.toContainText("Coming in a later build");
  const enlace = page.locator('[data-testid="panel"][data-panel="property"] [data-ranura="enlace"]');
  await expect(enlace).toBeVisible();
  const [izquierda, derecha] = await Promise.all([conversacion.boundingBox(), enlace.boundingBox()]);
  expect(izquierda!.x + izquierda!.width).toBeLessThanOrEqual(derecha!.x);

  await page.goto(`/job/${R(3)}`);
  await expect(page.locator('[data-ranura="enlace"]')).toHaveCount(0); // solo en Requests
  await pestana(page, "audit").click();
  // Mientras llega la lista, el marcador "Loading audit…" lleva el mismo `data-ranura`: se espera la sección ya llena (`data-testid`).
  await expect(page.locator('[data-ranura="audit"][data-testid="audit"]')).toBeVisible();
  // OPR-35 la llenó: ya no es el marcador, es la lista de Audit.
  await expect(page.locator('[data-ranura="audit"][data-testid="audit"]').getByRole("list", { name: "Audit" })).toBeVisible();

  // OPR-30 y OPR-32 las llenaron: ya no es el marcador, es la sección con su contenido (el marcador "Loading…" del Suspense lleva el mismo `data-ranura`).
  await page.goto(`/job/${R(4)}?tab=tracker`);
  await expect(page.locator('section[data-ranura="tracker"]')).toBeVisible();
  await page.goto(`/job/${R(6)}?tab=billing`);
  await expect(page.locator('section[data-ranura="billing"]')).toBeVisible();
});

test("A15: aviso de truncado con 50 jobs de la propiedad de R2", async ({ page }) => {
  for (let i = 0; i < 50; i++) {
    await control(page, {
      accion: "poner",
      entidad: "job",
      valor: {
        bzzzbx_job_id: `bx-job-9${String(i).padStart(3, "0")}`,
        job_number: `EX-09${String(i).padStart(3, "0")}`,
        bzzzbx_customer_id: "bx-cust-0001",
        bzzzbx_property_id: "bx-prop-0002",
        bzzzbx_space_id: null,
        bzzzbx_service_id: "bx-svc-0001",
        service_date: new Date().toISOString().slice(0, 10),
        window_start: "09:00",
        window_end: "12:00",
        status: "scheduled",
        bzzzbx_team_id: "bx-team-0001",
        po_number: null,
      },
    });
  }
  await page.goto(`/job/${R(2)}?tab=property`);
  await expect(page.getByRole("status").filter({ hasText: "Showing the first 50 jobs." })).toBeVisible();
});

test("A16: un cambio en el origen con la ventana abierta se ve en menos de 1 minuto", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/job/${R(3)}`);
  await expect(page.getByTestId("stage")).toHaveText("Scheduled");
  await expect(pestana(page, "tracker")).toHaveCount(0);
  const inicio = Date.now();
  await control(page, {
    accion: "poner",
    entidad: "jobtracker_event",
    valor: { bzzzbx_event_id: "bx-evt-0100", bzzzbx_job_id: "bx-job-0003", kind: "checked_in", occurred_at: new Date().toISOString() },
  });
  await expect(page.getByTestId("stage")).toHaveText("In Progress", { timeout: 60_000 });
  await expect(pestana(page, "tracker")).toHaveCount(1);
  expect(Date.now() - inicio).toBeLessThan(60_000);
});

test("Acting as: solo con la demo activa, y se puede elegir un operador de la seed", async ({ page }) => {
  await page.goto(`/job/${R(3)}`);
  const selector = page.getByLabel("Acting as");
  await expect(selector).toBeVisible();
  await expect(selector.locator("option")).toHaveText(["Nobody (read only)", "Finance Dos", "Finance Uno", "Ops Dos", "Ops Uno"]);
  await selector.selectOption({ label: "Ops Uno" });
  await expect(selector).toHaveValue("0a000000-0000-4000-8000-0000000000a1");
  await page.reload();
  await expect(page.getByLabel("Acting as")).toHaveValue("0a000000-0000-4000-8000-0000000000a1");
  await page.getByLabel("Acting as").selectOption({ label: "Nobody (read only)" });
  await expect(page.getByLabel("Acting as")).toHaveValue("");
});

// ── Enlace de la Fase A (OPR-28) ────────────────────────────────────────────
// R7 es la request de la demo: con dueño y las tres confirmaciones, y bx-job-0107
// del falso encaja con su borrador. Confirmar la enlaza (no se deshace: queda
// Scheduled), así que la prueba que la enlaza va al final y cada corrida pide una
// base nueva (en la CI siempre lo es; en local, `pnpm db:reset`).

/** Consulta como opsrun_app, el mismo login del servidor: lo que el Audit y la request guardaron de verdad. */
async function consultar<T extends Record<string, unknown>>(sql: string, parametros: unknown[]): Promise<T[]> {
  const cliente = new pg.Client({
    // playwright.config.mts la pone para los workers.
    connectionString: process.env.OPSRUN_DATABASE_URL,
  });
  await cliente.connect();
  try {
    return (await cliente.query<T>(sql, parametros)).rows;
  } finally {
    await cliente.end();
  }
}

const estadoDeR7 = async () =>
  (
    await consultar<{ status: string; bzzzbx_job_id: string | null; job_number: string | null }>(
      "select status::text as status, bzzzbx_job_id, job_number from opsrun.request where id = $1",
      [R(7)],
    )
  )[0]!;

const ENLACE = '[data-ranura="enlace"]';
const OPERADOR_A1 = "0a000000-0000-4000-8000-0000000000a1";

test("OPR-28: sin actor elegido, confirmar se rechaza y no escribe nada", async ({ page }) => {
  test.skip((await estadoDeR7()).status !== "open", "R7 ya está enlazada: esta prueba pide una base nueva");
  await page.goto(`/job/${R(7)}?tab=property`);
  const fila = page.locator(`${ENLACE} [data-testid="candidato-enlace"][data-job="bx-job-0107"]`);
  await expect(fila).toBeVisible();
  await expect(fila.getByTestId("sugerido")).toHaveText("Suggested");
  await expect(page.locator(ENLACE)).toHaveAttribute("data-gate", "ODSC");
  // Se repite hasta que la página termina de hidratarse y React atiende el clic.
  await expect(async () => {
    await fila.getByRole("button", { name: "Confirm EX-00107" }).click();
    await expect(page.getByTestId("resultado-enlace")).toHaveText("Choose who is acting first.", { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  expect((await estadoDeR7()).status).toBe("open");
});

test("OPR-28: rechazar un candidato con motivo lo saca de la lista y queda en Audit", async ({ page }) => {
  test.skip((await estadoDeR7()).status !== "open", "R7 ya está enlazada: esta prueba pide una base nueva");
  // bx-job-0105 pasa a encajar con R7. Es el mismo rechazo (job, motivo y actor) que espera B5 de Audit
  // (e2e/audit.spec.ts): R7 solo se enlaza una vez por base, y esta prueba y B1 dejan la misma historia.
  const jobId = "bx-job-0105";
  await control(page, {
    accion: "cambiar",
    entidad: "job",
    id: jobId,
    parche: {
      bzzzbx_customer_id: "bx-cust-0002",
      bzzzbx_property_id: "bx-prop-0004",
      service_date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
      window_start: "13:00",
      window_end: "16:00",
    },
  });

  await page.goto(`/job/${R(7)}?tab=property`);
  await esperarVentanaLista(page);
  await page.getByLabel("Acting as").selectOption(OPERADOR_A1);
  await expect(page.getByLabel("Acting as")).toHaveValue(OPERADOR_A1);
  const fila = page.locator(`${ENLACE} [data-testid="candidato-enlace"][data-job="${jobId}"]`);
  await expect(fila).toBeVisible();
  await fila.getByRole("button", { name: "Reject EX-00105" }).click();
  await fila.getByTestId("motivo-rechazo").fill("Different customer.");
  await fila.getByTestId("enviar-rechazo").click();
  await expect(fila).toHaveCount(0);
  await expect(page.locator(`${ENLACE} [data-job="bx-job-0107"]`)).toBeVisible();

  const eventos = await consultar<{ reason: string | null; actor: string | null }>(
    `select a.reason, a.actor_operator_id::text as actor from opsrun.audit_event as a
      where a.request_id = $1 and a.event_type = 'job_link_rejected' and a.details ->> 'bzzzbx_job_id' = $2`,
    [R(7), jobId],
  );
  expect(eventos).toEqual([{ reason: "Different customer.", actor: OPERADOR_A1 }]);
  expect((await estadoDeR7()).status).toBe("open");

  // Ya no se vuelve a proponer, ni recargando la ventana.
  await page.reload();
  await expect(page.locator(`${ENLACE} [data-job="bx-job-0107"]`)).toBeVisible();
  await expect(page.locator(`${ENLACE} [data-job="${jobId}"]`)).toHaveCount(0);
});

test("OPR-28: de punta a punta, elegir actor, abrir R7 y confirmar bx-job-0107: pasa a Scheduled y su Audit tiene request_scheduled", async ({
  page,
}, testInfo) => {
  // R7 se enlaza una sola vez por base: si otra prueba (Audit, OPR-35) ya la enlazó, esta se salta limpio.
  // Solo un reintento propio (testInfo.retry > 0) comprueba el resultado de su corrida anterior.
  test.skip((await estadoDeR7()).status !== "open" && testInfo.retry === 0, "R7 ya está enlazada: esta prueba pide una base nueva");
  if ((await estadoDeR7()).status === "open") {
    await (await tarjetaDelTablero(page, R(7))).click();
    await expect(page.getByTestId("encabezado")).toBeVisible();
    await expect(page.getByTestId("stage")).toHaveText("Requests");
    await esperarVentanaLista(page);
    await page.getByLabel("Acting as").selectOption(OPERADOR_A1);
    await expect(page.getByLabel("Acting as")).toHaveValue(OPERADOR_A1);
    // La propuesta está en la pestaña de la propiedad, que es la inicial de R7.
    const fila = page.locator(`${ENLACE} [data-testid="candidato-enlace"][data-job="bx-job-0107"]`);
    await expect(fila).toBeVisible();
    await expect(fila.getByTestId("sugerido")).toHaveText("Suggested");
    await expect(fila).toContainText("EX-00107");
    await expect(page.getByTestId("gate-enlace")).toHaveCount(0);
    await expect(async () => {
      await fila.getByRole("button", { name: "Confirm EX-00107" }).click();
      await expect(page.getByTestId("stage")).toHaveText("Scheduled", { timeout: 2000 });
    }).toPass({ timeout: 15_000 });
  } else {
    await page.goto(`/job/${R(7)}`);
  }

  await expect(page.getByTestId("stage")).toHaveText("Scheduled");
  // Ya no es de Requests: la ranura se va y aparece la pestaña Audit.
  await expect(page.locator(ENLACE)).toHaveCount(0);
  await expect(pestana(page, "audit")).toHaveCount(1);

  expect(await estadoDeR7()).toEqual({ status: "scheduled", bzzzbx_job_id: "bx-job-0107", job_number: "EX-00107" });
  const eventos = await consultar<{ details: Record<string, unknown>; actor: string | null }>(
    `select a.details, a.actor_operator_id::text as actor from opsrun.audit_event as a
      where a.request_id = $1 and a.event_type = 'request_scheduled'`,
    [R(7)],
  );
  expect(eventos).toEqual([
    { details: { mode: "linked", bzzzbx_job_id: "bx-job-0107", job_number: "EX-00107" }, actor: OPERADOR_A1 },
  ]);
  // Fase A: el enlace no manda instrucciones a BzzzBX.
  const instrucciones = await consultar<{ n: string }>("select count(*)::text as n from opsrun.instruction where request_id = $1", [R(7)]);
  expect(instrucciones[0]!.n).toBe("0");
});
