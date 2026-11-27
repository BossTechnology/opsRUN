import { expect, test, type Page } from "@playwright/test";

/**
 * La conversación del job (OPR-27, criterios C1 a C12 del spec) contra el build
 * de producción, la seed y el stand-in de BzzzBX. R1 a R7 son las requests de la
 * seed. R2 es la que espera al cleaner: tiene el original (`bx-msg-0002`), el
 * texto al cleaner (`bx-msg-0102`) y una nota, y un borrador de IA sin decidir.
 *
 * Todo corre como "Ops Uno" (el "Acting as" de OPR-26, P-2). Cada prueba que
 * envía algo espera a que la instrucción cierre antes de terminar: el
 * `beforeEach` reinicia el falso y una instrucción abierta quedaría huérfana.
 * El orden importa dentro del archivo: C8 gasta el borrador de R2 antes de que
 * C4 le mande un correo.
 */
test.describe.configure({ mode: "serial" });

const R = (n: number) => `b0000000-0000-4000-8000-0000000000a${n}`;
const OPS_UNO = "0a000000-0000-4000-8000-0000000000a1";
const COOKIE_ACTOR = "opsrun_actor_demo";

async function control(page: Page, pedido: Record<string, unknown>) {
  const r = await page.request.post("/api/falso", { data: pedido });
  expect(r.ok(), await r.text()).toBe(true);
}

const conversacion = (page: Page) => page.locator('[data-ranura="conversacion"]');
const entradas = (page: Page) => conversacion(page).getByTestId("entrada");
const modo = (page: Page, id: string) => conversacion(page).locator(`[data-testid="modo"][data-modo="${id}"]`);
const caja = (page: Page) => conversacion(page).getByTestId("caja");
const enviar = (page: Page) => conversacion(page).getByTestId("enviar");

/** El cursor de `/api/tablero/cambios` ahora, y si algo cambió desde uno anterior. */
async function cursor(page: Page): Promise<string> {
  return ((await (await page.request.get("/api/tablero/cambios")).json()) as { cursor: string }).cursor;
}
async function huboCambio(page: Page, desde: string): Promise<boolean> {
  const r = await page.request.get(`/api/tablero/cambios?cursor=${encodeURIComponent(desde)}`);
  return ((await r.json()) as { cambio: boolean }).cambio;
}

/** Elige el modo del Composer. Se repite hasta que la página se hidrata y React atiende el clic. */
async function elegirModo(page: Page, id: "customer" | "cleaner" | "note") {
  await expect(async () => {
    await modo(page, id).click();
    await expect(modo(page, id)).toHaveAttribute("aria-checked", "true", { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** Escribe en la caja. Send se habilita solo cuando React ya tiene el texto: eso prueba la hidratación. */
async function escribir(page: Page, texto: string) {
  await expect(async () => {
    await caja(page).fill(texto);
    await expect(enviar(page)).toBeEnabled({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** La burbuja del hilo que contiene un texto. */
const burbuja = (page: Page, texto: string) => entradas(page).filter({ hasText: texto });

/** Deja que lo enviado cierre: la tarea del ciclo reconcilia (cada 5 s) y la ranura dice cuántos envíos siguen abiertos. */
async function esperarCierre(page: Page) {
  await expect
    .poll(
      async () => {
        await page.reload();
        return await conversacion(page).getAttribute("data-abiertas");
      },
      { timeout: 60_000, intervals: [2000] },
    )
    .toBe("0");
}

test.beforeEach(async ({ page, baseURL }) => {
  await control(page, { accion: "reiniciar" });
  await page.context().addCookies([{ name: COOKIE_ACTOR, value: OPS_UNO, url: baseURL! }]);
});

test("C1: el hilo de R2 se lee completo, en orden por hora", async ({ page }) => {
  await page.goto(`/job/${R(2)}`);
  await expect(entradas(page)).toHaveCount(3);
  const e = entradas(page);
  await expect(e.nth(0)).toHaveAttribute("data-tipo", "original");
  await expect(e.nth(0)).toContainText("Original request");
  await expect(e.nth(0)).toContainText("Clean for Sample Court unit 12");
  await expect(e.nth(1)).toHaveAttribute("data-tipo", "text");
  await expect(e.nth(1)).toHaveAttribute("data-direccion", "outbound");
  await expect(e.nth(1)).toContainText("Team Alpha");
  await expect(e.nth(1)).toContainText("Delivered");
  await expect(e.nth(2)).toHaveAttribute("data-tipo", "note");
  await expect(e.nth(2)).toContainText("Requester prefers mornings.");
  await expect(e.nth(2)).toContainText("Internal note");
  // El original y el texto son mensajes leídos de BzzzBX; la nota, de opsRUN.
  await expect(e.nth(0).getByTestId("estado-entrega")).toHaveText("Received");
  await expect(e.nth(2).getByTestId("estado-entrega")).toHaveText("Internal · not sent");
  const horas = await e.locator("time").evaluateAll((els) => els.map((t) => Date.parse((t as HTMLTimeElement).dateTime)));
  expect(horas.slice(1)).toEqual([...horas.slice(1)].sort((a, b) => a - b));
});

test("C2: el encabezado y la action bar no esperan al hilo (< 2 s desde la tarjeta de R2)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("columna")).toHaveCount(5);
  const tarjeta = page.locator(`[data-testid="tarjeta"][data-request="${R(2)}"]`);
  await expect(tarjeta).toBeVisible();
  const inicio = Date.now();
  await tarjeta.click();
  await expect(page.getByTestId("encabezado")).toBeVisible();
  await expect(page.getByTestId("barra-acciones")).toBeVisible();
  const ms = Date.now() - inicio;
  expect(ms, `la ventana de R2 tardó ${ms} ms`).toBeLessThan(2000);
  await expect(entradas(page).first()).toBeVisible();
});

test("C3: una nota queda con quien actúa y mueve el cursor de cambios; vacía o con espacios no se envía", async ({ page }) => {
  await page.goto(`/job/${R(2)}`);
  await expect(modo(page, "note")).toHaveAttribute("aria-checked", "true");
  await expect(enviar(page)).toBeDisabled();
  await escribir(page, "Gate code is on the back door.");
  await caja(page).fill("   ");
  await expect(enviar(page)).toBeDisabled();
  await caja(page).fill("");
  await expect(enviar(page)).toBeDisabled();

  const antes = await cursor(page);
  await escribir(page, "Gate code is on the back door.");
  await enviar(page).click();
  const nota = burbuja(page, "Gate code is on the back door.");
  await expect(nota).toHaveCount(1);
  await expect(nota).toHaveAttribute("data-tipo", "note");
  await expect(nota).toContainText("Ops Uno");
  await expect(nota).toContainText("Internal · not sent");
  await expect(caja(page)).toHaveValue("");
  expect(await huboCambio(page, antes)).toBe(true);
  // Sigue ahí al recargar: está en la base, no en el navegador.
  await page.reload();
  await expect(burbuja(page, "Gate code is on the back door.")).toHaveCount(1);
});

test("C8: el borrador de IA aparece marcado, no sale solo, y se envía solo con Send; Discard lo quita sin enviar", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/job/${R(2)}`);
  await elegirModo(page, "customer");
  const borrador = conversacion(page).getByTestId("borrador-ia");
  await expect(borrador).toBeVisible();
  await expect(borrador).toContainText("AI draft");
  await expect(caja(page)).toHaveValue(/We are confirming the cleaner/);
  const antes = await entradas(page).count();
  const marca = await cursor(page);

  // Un ciclo de sondeo (15 s): ninguna burbuja nueva y el cursor sin moverse.
  await page.waitForTimeout(16_000);
  await expect(entradas(page)).toHaveCount(antes);
  expect(await huboCambio(page, marca)).toBe(false);

  // Se edita y se envía: sale el texto editado y el borrador ya no aparece.
  await escribir(page, "Hello, we have you down for Friday morning.");
  await enviar(page).click();
  await expect(burbuja(page, "Hello, we have you down for Friday morning.")).toHaveCount(1);
  await expect(conversacion(page).getByTestId("borrador-ia")).toHaveCount(0);
  await esperarCierre(page);
  await elegirModo(page, "customer");
  await expect(conversacion(page).getByTestId("borrador-ia")).toHaveCount(0);
  await expect(caja(page)).toHaveValue("");

  // Con otro borrador (R1), Discard lo quita sin enviar nada.
  await page.goto(`/job/${R(1)}`);
  await elegirModo(page, "customer");
  await expect(conversacion(page).getByTestId("borrador-ia")).toContainText("AI draft");
  const burbujas = await entradas(page).count();
  const cursorR1 = await cursor(page);
  await conversacion(page).getByTestId("descartar-borrador").click();
  await expect(conversacion(page).getByTestId("borrador-ia")).toHaveCount(0);
  await expect(caja(page)).toHaveValue("");
  await expect(entradas(page)).toHaveCount(burbujas);
  expect(await huboCambio(page, cursorR1)).toBe(true); // Audit: ai_suggestion_rejected
  await page.reload();
  await elegirModo(page, "customer");
  await expect(conversacion(page).getByTestId("borrador-ia")).toHaveCount(0);
  await expect(entradas(page)).toHaveCount(burbujas);
  await expect(conversacion(page)).toHaveAttribute("data-abiertas", "0");
});

test("C4: correo al cliente: se ve 'Sending…' o 'Sent' y termina en una sola burbuja, el mensaje de BzzzBX", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/job/${R(2)}`);
  await elegirModo(page, "customer");
  await expect(conversacion(page).getByTestId("para-a")).toHaveText("contact.one@example.test");
  await expect(conversacion(page).getByTestId("para-cc")).toHaveText("— —");
  await expect(conversacion(page).getByTestId("para").locator("input, textarea")).toHaveCount(0);
  await expect(conversacion(page).getByTestId("borrador-ia")).toHaveCount(0);

  await escribir(page, "Friday at 9 works for us.");
  await enviar(page).click();
  const correo = burbuja(page, "Friday at 9 works for us.");
  await expect(correo).toHaveCount(1);
  await expect(correo).toHaveAttribute("data-tipo", "email");
  await expect(correo).toHaveAttribute("data-direccion", "outbound");
  await expect(correo.getByTestId("estado-entrega")).toHaveText(/Sending…|Sent/);

  // En menos de 1 minuto es el mensaje leído de BzzzBX: trae el asunto que puso BzzzBX, y sigue siendo una sola burbuja.
  await expect(correo).toContainText("Re: Clean for Sample Court unit 12", { timeout: 60_000 });
  await expect(correo.getByTestId("estado-entrega")).toHaveText("Sent");
  await expect(correo).toHaveCount(1);
  await esperarCierre(page);
  await expect(burbuja(page, "Friday at 9 works for us.")).toHaveCount(1);
});

test("C5: texto al cleaner: To es el equipo y termina en una sola burbuja, el mensaje de BzzzBX", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/job/${R(2)}`);
  await elegirModo(page, "cleaner");
  await expect(conversacion(page).getByTestId("para-a")).toContainText("Team Alpha");
  await escribir(page, "Can you take it Friday at 9?");
  await enviar(page).click();
  const texto = burbuja(page, "Can you take it Friday at 9?");
  await expect(texto).toHaveCount(1);
  await expect(texto).toHaveAttribute("data-tipo", "text");
  await expect(texto.getByTestId("estado-entrega")).toHaveText(/Sending…|Sent/);
  await expect(texto.getByTestId("estado-entrega")).toHaveText("Sent", { timeout: 60_000 });
  await expect(texto).toContainText("Team Alpha"); // el destinatario ya lo puso BzzzBX
  await expect(texto).toHaveCount(1);
  await esperarCierre(page);
  await expect(burbuja(page, "Can you take it Friday at 9?")).toHaveCount(1);
});

test("C6: un fallo se ve en rojo y se puede reenviar con Edit and resend", async ({ page }) => {
  test.setTimeout(120_000);
  await control(page, { accion: "forzar_error", tipo: "send_email", cuando: "al_ejecutar" });
  await page.goto(`/job/${R(2)}`);
  await elegirModo(page, "customer");
  await escribir(page, "This one will fail.");
  await enviar(page).click();
  const fallida = burbuja(page, "This one will fail.");
  await expect(fallida).toHaveCount(1);
  const estado = fallida.getByTestId("estado-entrega");
  await expect(estado).toHaveText("Failed · Forced error (stand-in).", { timeout: 60_000 });
  await expect(estado).toHaveAttribute("role", "status");
  await expect(estado).toHaveClass(/entrada-error/);
  await expect(estado).toHaveCSS("color", /rgb\(/);

  await elegirModo(page, "note");
  await expect(caja(page)).toHaveValue("");
  await fallida.getByTestId("reenviar").click();
  await expect(modo(page, "customer")).toHaveAttribute("aria-checked", "true");
  await expect(caja(page)).toHaveValue("This one will fail.");

  // Reenviar crea una instrucción nueva, no reintenta la vieja: esta vez sale.
  await enviar(page).click();
  await expect(burbuja(page, "This one will fail.")).toHaveCount(2);
  await esperarCierre(page);
  await expect(burbuja(page, "This one will fail.").filter({ hasText: "Failed" })).toHaveCount(1);
  await expect(burbuja(page, "This one will fail.").filter({ hasText: "Sent" })).toHaveCount(1);
});

test("C7: Edit To, Cc y Temporary number no corren, ni quitando el disabled", async ({ page }) => {
  await page.goto(`/job/${R(2)}`);
  await elegirModo(page, "customer");
  await expect(conversacion(page).locator('[data-testid="gris"]')).toHaveCount(2);
  await elegirModo(page, "cleaner");
  const controles = conversacion(page).getByTestId("gris");
  await expect(controles).toHaveCount(2);
  await expect(controles.nth(1)).toHaveAttribute("data-control", "temporary-number");
  await elegirModo(page, "customer");
  await expect(controles.nth(1)).toHaveAttribute("data-control", "cc");

  const antes = await cursor(page);
  const burbujas = await entradas(page).count();
  for (const modoId of ["customer", "cleaner"] as const) {
    await elegirModo(page, modoId);
    for (const g of await controles.all()) {
      await expect(g).toHaveAttribute("aria-disabled", "true");
      await expect(g).toHaveAttribute("title", "Available in a later release");
      await expect(g).toBeDisabled();
      // Un clic sobre un botón deshabilitado no hace nada.
      await g.dispatchEvent("click");
      // Se quita el disabled como lo haría alguien en la consola: no hay nada que llamar.
      await g.evaluate((b) => ((b as HTMLButtonElement).disabled = false));
      await g.dispatchEvent("click");
    }
  }
  await expect(caja(page)).toHaveValue("");
  await expect(entradas(page)).toHaveCount(burbujas);
  await page.waitForTimeout(1500);
  expect(await huboCambio(page, antes)).toBe(false);
});

test("C9: la respuesta del cliente que entra por el hilo se ve como Received en menos de 1 minuto", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/job/${R(2)}`);
  await expect(entradas(page).first()).toBeVisible();
  await control(page, {
    accion: "poner",
    entidad: "message",
    valor: {
      bzzzbx_message_id: "bx-msg-8101",
      bzzzbx_thread_id: "bx-thread-0002",
      channel: "email",
      direction: "inbound",
      from: "contact.one@example.test",
      to: ["requests@example.test"],
      subject: "Re: Clean for Sample Court unit 12",
      body: "Is Friday still good?",
      sent_at: new Date().toISOString(),
      delivery: "delivered",
    },
  });
  const respuesta = burbuja(page, "Is Friday still good?");
  await expect(respuesta).toHaveCount(1, { timeout: 60_000 });
  await expect(respuesta).toHaveAttribute("data-tipo", "email");
  await expect(respuesta).toHaveAttribute("data-direccion", "inbound");
  await expect(respuesta.getByTestId("estado-entrega")).toHaveText("Received");
});

test("C10: con BzzzBX caído el hilo conserva lo leído, Customer y Cleaner se apagan y una nota se guarda", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/job/${R(2)}`);
  await expect(entradas(page).first()).toBeVisible();
  await control(page, { accion: "no_disponible", valor: true });
  await expect(conversacion(page).getByTestId("conversacion-caida")).toContainText("BzzzBX unavailable · last update", { timeout: 60_000 });
  // Lo último leído sigue ahí: el original, el texto al cleaner de la seed y las notas.
  await expect(entradas(page).first()).toHaveAttribute("data-tipo", "original");
  await expect(entradas(page).first()).toContainText("Clean for Sample Court unit 12");
  await expect(burbuja(page, "New job: Sample Court Unit 12")).toHaveCount(1);
  await expect(burbuja(page, "Requester prefers mornings.")).toHaveCount(1);
  for (const id of ["customer", "cleaner"]) {
    await expect(modo(page, id)).toHaveAttribute("aria-disabled", "true");
    await expect(modo(page, id)).toContainText("BzzzBX unavailable");
  }
  await expect(modo(page, "note")).not.toHaveAttribute("aria-disabled", "true");

  await escribir(page, "Saved while BzzzBX was down.");
  await enviar(page).click();
  await expect(burbuja(page, "Saved while BzzzBX was down.")).toHaveCount(1);
  await expect(burbuja(page, "Saved while BzzzBX was down.")).toHaveAttribute("data-tipo", "note");
});

test("C11: sin cleaner, Cleaner en gris 'Choose a cleaner first' (R1)", async ({ page }) => {
  await page.goto(`/job/${R(1)}`);
  await expect(modo(page, "cleaner")).toHaveAttribute("aria-disabled", "true");
  await expect(modo(page, "cleaner")).toContainText("Choose a cleaner first");
  await expect(modo(page, "customer")).not.toHaveAttribute("aria-disabled", "true");
  await expect(modo(page, "note")).not.toHaveAttribute("aria-disabled", "true");
  await expect(modo(page, "cleaner")).toBeVisible();
  await modo(page, "cleaner").dispatchEvent("click");
  await expect(modo(page, "cleaner")).toHaveAttribute("aria-checked", "false");
  await expect(modo(page, "note")).toHaveAttribute("aria-checked", "true");
});

test("C12: con el job cancelado el hilo se ve y los tres modos están en gris 'Job cancelled'", async ({ page }) => {
  await control(page, { accion: "cambiar", entidad: "job", id: "bx-job-0003", parche: { status: "cancelled" } });
  await page.goto(`/job/${R(3)}`);
  await expect(page.getByTestId("stage")).toHaveText("Cancelled");
  await expect(entradas(page).first()).toHaveAttribute("data-tipo", "original");
  for (const id of ["customer", "cleaner", "note"]) {
    await expect(modo(page, id)).toHaveAttribute("aria-disabled", "true");
    await expect(modo(page, id)).toContainText("Job cancelled");
  }
  await expect(caja(page)).toBeDisabled();
  await expect(enviar(page)).toBeDisabled();
});
