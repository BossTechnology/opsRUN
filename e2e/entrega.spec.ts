import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

/**
 * El estado de entrega y la alerta Message not delivered (OPR-19, criterios D1 a D10 de
 * docs/spec/opr-19-estado-de-entrega.md §10.3) contra el build de producción, la seed y
 * el stand-in de BzzzBX, con OPSRUN_ACTOR_DEMO=1 y OPSRUN_ZONA_HORARIA=America/New_York
 * fijos en playwright.config.mts.
 *
 * Corre en su propio proyecto, después de los de la conversación y de Alerts, porque
 * cambia R2: sus hilos, el cleaner Team Alpha y las alertas de mensaje que el registrador
 * anota en la base. R2 tiene el hilo `bx-thread-0002` y a Team Alpha (spec OPR-27 §11.3).
 * Cada prueba arma su propio caso (no depende de las anteriores) con ids propios de la
 * serie `bx-msg-019x`; los mensajes que crea un envío de opsRUN llevan el id que les da
 * el falso (`bx-msg-9nnn`).
 *
 * El falso imita a Signal Maker solo para abrir Message not delivered cuando un saliente
 * pasa a `failed` o `bounced` (OPR-19, P-4): no la cierra. "Cierra Signal Maker" es
 * `/api/falso cambiar` del `cleared_at`. El registrador (la tarea `registrador_alertas`
 * del ciclo de fondo, cada 15 s) anota lo que cambia en una vuelta del ciclo.
 *
 * Fase A y Fase B (§3): D2 y D3 son lo que se acepta en la Fase A (un correo enviado desde
 * el buzón compartido, que BzzzBX observa); D6 y D7 envían desde opsRUN y solo corren
 * sobre el falso. El texto en staging espera a la Fase B.
 */
test.describe.configure({ mode: "serial" });

const R2 = "b0000000-0000-4000-8000-0000000000a2";
const OPS_UNO = "0a000000-0000-4000-8000-0000000000a1";
const COOKIE_ACTOR = "opsrun_actor_demo";
const HILO = "bx-thread-0002";
const UNA_VUELTA = { timeout: 60_000 };

async function control(page: Page, pedido: Record<string, unknown>) {
  const r = await page.request.post("/api/falso", { data: pedido });
  expect(r.ok(), await r.text()).toBe(true);
}

/** Consulta como opsrun_app, el mismo login del servidor: lo que la base guardó de verdad. */
async function consultar<T extends Record<string, unknown>>(sql: string, parametros: unknown[] = []): Promise<T[]> {
  const cliente = new pg.Client({ connectionString: process.env.OPSRUN_DATABASE_URL });
  await cliente.connect();
  try {
    return (await cliente.query<T>(sql, parametros)).rows;
  } finally {
    await cliente.end();
  }
}

const saliente = (id: string, delivery: string, cuerpo: string, extra: Record<string, unknown> = {}) => ({
  bzzzbx_message_id: id,
  bzzzbx_thread_id: HILO,
  channel: "email",
  direction: "outbound",
  from: "requests@example.test",
  to: ["contact.one@example.test"],
  subject: "Re: Clean for Sample Court unit 12",
  body: cuerpo,
  sent_at: new Date().toISOString(),
  delivery,
  ...extra,
});
const ponerSaliente = (page: Page, id: string, delivery: string, cuerpo: string, extra: Record<string, unknown> = {}) =>
  control(page, { accion: "poner", entidad: "message", valor: saliente(id, delivery, cuerpo, extra) });

const conversacion = (page: Page) => page.locator('[data-ranura="conversacion"]');
const entradas = (page: Page) => conversacion(page).getByTestId("entrada");
const entrada = (page: Page, id: string) => conversacion(page).locator(`[data-entrada="msg:${id}"]`);
const burbuja = (page: Page, texto: string) => entradas(page).filter({ hasText: texto });
const modo = (page: Page, id: string) => conversacion(page).locator(`[data-testid="modo"][data-modo="${id}"]`);
const caja = (page: Page) => conversacion(page).getByTestId("caja");
const enviar = (page: Page) => conversacion(page).getByTestId("enviar");
const needs = (page: Page) => page.getByTestId("alertas-needs-action");
const resueltas = (page: Page) => page.getByTestId("alertas-resolved");
const filaDeMensaje = (page: Page, id: string) => needs(page).locator(`[data-testid="alerta"][data-regla="MSG-001"][data-alerta="bx-alert-${id.replace(/^bx-msg-/, "msg-")}"]`);

async function abrir(page: Page, tab?: string) {
  await page.goto(`/job/${R2}${tab ? `?tab=${tab}` : ""}`);
  await expect(page.getByTestId("encabezado")).toBeVisible();
  await expect(page.getByTestId("barra-acciones")).toBeVisible();
}

/** Recarga hasta que lo que dice la función sea lo esperado: el sondeo de la ventana tarda hasta 15 s y el ciclo, una vuelta. */
async function recargarHasta<T>(page: Page, leer: () => Promise<T>, esperado: T, tiempo = 60_000) {
  await expect
    .poll(
      async () => {
        await page.reload();
        return await leer().catch(() => null);
      },
      { timeout: tiempo, intervals: [2000] },
    )
    .toEqual(esperado);
}

async function elegirModo(page: Page, id: "customer" | "cleaner" | "note") {
  await expect(async () => {
    await modo(page, id).click();
    await expect(modo(page, id)).toHaveAttribute("aria-checked", "true", { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

async function escribir(page: Page, texto: string) {
  await expect(async () => {
    await caja(page).fill(texto);
    await expect(enviar(page)).toBeEnabled({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** Envía desde el Composer y espera a que el envío se vea como el mensaje que dejó BzzzBX. Devuelve su id. */
async function enviarDesdeOpsrun(page: Page, canal: "customer" | "cleaner", cuerpo: string): Promise<string> {
  await elegirModo(page, canal);
  await escribir(page, cuerpo);
  await enviar(page).click();
  await expect(burbuja(page, cuerpo)).toHaveCount(1);
  await expect(burbuja(page, cuerpo).getByTestId("estado-entrega")).toHaveText(/Sending…|Sent/);
  let id = "";
  await expect
    .poll(
      async () => {
        await page.reload();
        const e = burbuja(page, cuerpo).first();
        id = ((await e.getAttribute("data-entrada")) ?? "").replace(/^msg:/, "");
        return /^bx-msg-9\d+$/.test(id);
      },
      { timeout: 60_000, intervals: [2000] },
    )
    .toBe(true);
  return id;
}

/** Deja que lo enviado cierre: la ranura dice cuántos envíos siguen abiertos. */
async function esperarCierre(page: Page) {
  await recargarHasta(page, () => conversacion(page).getAttribute("data-abiertas"), "0");
}

const ocurrencia = async (alerta: string) =>
  (await consultar<{ bzzzbx_message_id: string | null; resolution: string | null }>(
    "select bzzzbx_message_id, resolution::text from opsrun.alert_occurrence where bzzzbx_alert_id = $1",
    [alerta],
  ))[0];
const eventosDe = async (alerta: string) =>
  (
    await consultar<{ event_type: string }>(
      `select e.event_type from opsrun.audit_event as e join opsrun.alert_occurrence as a on a.id = e.alert_occurrence_id
        where a.bzzzbx_alert_id = $1 order by e.id`,
      [alerta],
    )
  ).map((r) => r.event_type);
const alertaDe = (id: string) => `bx-alert-${id.replace(/^bx-msg-/, "msg-")}`;

test.beforeEach(async ({ page, baseURL }) => {
  await control(page, { accion: "reiniciar" });
  await page.context().addCookies([{ name: COOKIE_ACTOR, value: OPS_UNO, url: baseURL! }]);
});

test("D1: los estados se ven, con su data-entrega", async ({ page }) => {
  await ponerSaliente(page, "bx-msg-0191", "queued", "Queued message for D1.");
  await ponerSaliente(page, "bx-msg-0192", "sent", "Sent message for D1.");
  await ponerSaliente(page, "bx-msg-0193", "delivered", "Delivered message for D1.");
  await abrir(page);
  for (const [id, entrega, texto] of [
    ["bx-msg-0191", "queued", "Queued"],
    ["bx-msg-0192", "sent", "Sent"],
    ["bx-msg-0193", "delivered", "Delivered"],
  ] as const) {
    await expect(entrada(page, id)).toHaveAttribute("data-entrega", entrega);
    await expect(entrada(page, id).getByTestId("estado-entrega")).toHaveText(texto);
    await expect(entrada(page, id).getByTestId("reenviar")).toHaveCount(0);
  }
  // El original (entrante) no lleva data-entrega.
  await expect(entradas(page).first()).not.toHaveAttribute("data-entrega", /.+/);
});

test("D2 (Fase A): un correo enviado desde el buzón que rebota se ve 'Bounced · motivo' en rojo", async ({ page }) => {
  await ponerSaliente(page, "bx-msg-0194", "sent", "Sent from the shared mailbox.");
  await abrir(page);
  await expect(entrada(page, "bx-msg-0194").getByTestId("estado-entrega")).toHaveText("Sent");
  await control(page, { accion: "cambiar", entidad: "message", id: "bx-msg-0194", parche: { delivery: "bounced", delivery_detail: "Mailbox does not exist." } });
  const estado = entrada(page, "bx-msg-0194").getByTestId("estado-entrega");
  await recargarHasta(page, () => estado.textContent(), "Bounced · Mailbox does not exist.");
  await expect(entrada(page, "bx-msg-0194")).toHaveAttribute("data-entrega", "bounced");
  await expect(estado).toHaveAttribute("role", "status");
  await expect(estado).toHaveClass(/entrada-error/);
  await expect(estado).toHaveCSS("color", /rgb\(/);
});

test("D3 (Fase A): la alerta abre en Needs action con el destinatario y el arreglo, la barra la cuenta y el panel la lleva a R2", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/");
  const antes = Number((await page.getByTestId("alertas-operacion").innerText()).trim());
  await ponerSaliente(page, "bx-msg-0195", "sent", "Sent from the shared mailbox (D3).");
  await control(page, { accion: "cambiar", entidad: "message", id: "bx-msg-0195", parche: { delivery: "bounced", delivery_detail: "Mailbox does not exist." } });

  await abrir(page, "alerts");
  const fila = filaDeMensaje(page, "bx-msg-0195");
  await expect(fila).toBeVisible();
  await expect(fila).toContainText("MSG-001 Message not delivered");
  await expect(fila.getByTestId("alerta-destinatario")).toHaveText("To: contact.one@example.test");
  await expect(fila.getByTestId("alerta-arreglo")).toHaveText("Check the address or number and resend.");
  await expect(fila.getByTestId("alerta-destinatario").locator("input, textarea, button, a")).toHaveCount(0);
  await expect(page.getByTestId("conteo-alertas")).toBeVisible();

  // La barra y el panel la cuentan en cuanto el registrador la anota (una vuelta del ciclo).
  await page.goto("/");
  await expect(page.getByTestId("alertas-operacion")).toContainText(String(antes + 1), UNA_VUELTA);
  await page.getByTestId("alertas-operacion").click();
  const panel = page.getByRole("dialog", { name: "Alerts" });
  const enElPanel = panel.locator(`[data-testid="panel-alerta"][data-request="${R2}"][data-regla="MSG-001"]`);
  await expect(enElPanel).toBeVisible();
  // El panel no lleva el destinatario ni el arreglo: son de la pestaña.
  await expect(enElPanel).not.toContainText("contact.one@example.test");
  await enElPanel.click();
  await expect(page).toHaveURL(new RegExp(`/job/${R2}`));
});

test("D4: con todo cerrado, el registrador anota la alerta y su alert_opened en una vuelta del ciclo", async ({ page }) => {
  test.setTimeout(120_000);
  await ponerSaliente(page, "bx-msg-0196", "sent", "Sent from the shared mailbox (D4).");
  await control(page, { accion: "cambiar", entidad: "message", id: "bx-msg-0196", parche: { delivery: "bounced", delivery_detail: "Mailbox does not exist." } });
  // Sin páginas abiertas: solo se consulta la base.
  await expect.poll(async () => (await ocurrencia(alertaDe("bx-msg-0196")))?.bzzzbx_message_id ?? null, UNA_VUELTA).toBe("bx-msg-0196");
  expect(await eventosDe(alertaDe("bx-msg-0196"))).toEqual(["alert_opened"]);
});

test("D5 (Fase A): se resuelve sola al cerrarla Signal Maker, sin reenvío de opsRUN: Cleared automatically", async ({ page }) => {
  test.setTimeout(150_000);
  await ponerSaliente(page, "bx-msg-0197", "sent", "Sent from the shared mailbox (D5).");
  await control(page, { accion: "cambiar", entidad: "message", id: "bx-msg-0197", parche: { delivery: "bounced", delivery_detail: "Mailbox does not exist." } });
  await expect.poll(async () => (await ocurrencia(alertaDe("bx-msg-0197")))?.bzzzbx_message_id ?? null, UNA_VUELTA).toBe("bx-msg-0197");

  // El reenvío se hizo en las herramientas de PINCH: un saliente nuevo, entregado; y Signal Maker cierra la alerta.
  await ponerSaliente(page, "bx-msg-0198", "delivered", "Resent from the shared mailbox (D5).");
  await control(page, { accion: "cambiar", entidad: "alert_result", id: alertaDe("bx-msg-0197"), parche: { cleared_at: new Date().toISOString() } });

  await expect.poll(async () => (await ocurrencia(alertaDe("bx-msg-0197")))?.resolution ?? null, UNA_VUELTA).toBe("auto_cleared");
  await abrir(page, "alerts");
  const resuelta = resueltas(page).locator(`[data-testid="alerta"][data-regla="MSG-001"][data-alerta="${alertaDe("bx-msg-0197")}"]`);
  await expect(resuelta.getByTestId("alerta-quien")).toHaveText("Cleared automatically");
  // R2 está en Requests y su pestaña Audit llega con Scheduled: el Audit se lee de la base.
  expect(await eventosDe(alertaDe("bx-msg-0197"))).toEqual(["alert_opened", "alert_resolved"]);
});

test("D6 (local): un texto desde opsRUN a un número inválido sale 'Sent' y después 'Failed · motivo', y abre la alerta", async ({ page }) => {
  test.setTimeout(180_000);
  await control(page, { accion: "forzar_entrega", tipo: "send_text", delivery: "failed", delivery_detail: "Invalid number." });
  await abrir(page);
  const id = await enviarDesdeOpsrun(page, "cleaner", "Can you take it Friday at 9? (D6)");
  const estado = entrada(page, id).getByTestId("estado-entrega");
  await recargarHasta(page, () => estado.textContent(), "Failed · Invalid number.");
  await expect(entrada(page, id)).toHaveAttribute("data-entrega", "failed");
  await expect(estado).toHaveAttribute("role", "status");
  await esperarCierre(page);

  await abrir(page, "alerts");
  const fila = filaDeMensaje(page, id);
  await expect(fila).toBeVisible(UNA_VUELTA);
  await expect(fila.getByTestId("alerta-destinatario")).toContainText("To: Team Alpha");
  await expect(fila.getByTestId("alerta-motivo")).toContainText("Invalid number.");
  await expect.poll(async () => (await ocurrencia(alertaDe(id)))?.bzzzbx_message_id ?? null, UNA_VUELTA).toBe(id);
});

test("D7 (local): un correo desde opsRUN a una dirección inválida sale 'Sent' y después 'Bounced · motivo', y abre la alerta", async ({ page }) => {
  test.setTimeout(180_000);
  await control(page, { accion: "forzar_entrega", tipo: "send_email", delivery: "bounced", delivery_detail: "Mailbox does not exist." });
  await abrir(page);
  const id = await enviarDesdeOpsrun(page, "customer", "Friday at 9 works for us. (D7)");
  const estado = entrada(page, id).getByTestId("estado-entrega");
  await recargarHasta(page, () => estado.textContent(), "Bounced · Mailbox does not exist.");
  await expect(entrada(page, id)).toHaveAttribute("data-entrega", "bounced");
  await esperarCierre(page);

  await abrir(page, "alerts");
  await expect(filaDeMensaje(page, id)).toBeVisible(UNA_VUELTA);
  await expect(filaDeMensaje(page, id).getByTestId("alerta-destinatario")).toHaveText("To: contact.one@example.test");
});

test("D8: el arreglo desde la alerta: Edit and resend lleva el foco al mensaje y copia el cuerpo al Composer; nada sale solo; al enviar y cerrar, Fixed by Ops Uno", async ({ page }) => {
  test.setTimeout(240_000);
  await control(page, { accion: "forzar_entrega", tipo: "send_text", delivery: "failed", delivery_detail: "Invalid number." });
  await abrir(page);
  const id = await enviarDesdeOpsrun(page, "cleaner", "Can you take it Friday at 9? (D8)");
  await recargarHasta(page, () => entrada(page, id).getByTestId("estado-entrega").textContent(), "Failed · Invalid number.");
  await esperarCierre(page);
  await expect.poll(async () => (await ocurrencia(alertaDe(id)))?.bzzzbx_message_id ?? null, UNA_VUELTA).toBe(id);

  await abrir(page, "alerts");
  const fila = filaDeMensaje(page, id);
  await expect(fila).toBeVisible();
  await expect(fila.getByTestId("alerta-boton")).toBeEnabled();
  await fila.getByTestId("alerta-boton").click();
  await expect(entrada(page, id).getByTestId("reenviar")).toBeFocused();
  await entrada(page, id).getByTestId("reenviar").click();
  await expect(modo(page, "cleaner")).toHaveAttribute("aria-checked", "true");
  await expect(caja(page)).toHaveValue("Can you take it Friday at 9? (D8)");

  // Nada sale solo: pasa un ciclo de sondeo sin burbujas nuevas ni cambios.
  const cuantas = await entradas(page).count();
  const cursor = async () => ((await (await page.request.get("/api/tablero/cambios")).json()) as { cursor: string }).cursor;
  const antes = await cursor();
  await page.waitForTimeout(17_000);
  await expect(entradas(page)).toHaveCount(cuantas);
  expect(await cursor()).toBe(antes);

  // Send crea una instrucción nueva; la alerta la cierra Signal Maker y queda Fixed by Ops Uno · Text sent.
  await enviar(page).click();
  await expect(burbuja(page, "Can you take it Friday at 9? (D8)")).toHaveCount(2);
  await esperarCierre(page);
  await control(page, { accion: "cambiar", entidad: "alert_result", id: alertaDe(id), parche: { cleared_at: new Date().toISOString() } });
  await expect.poll(async () => (await ocurrencia(alertaDe(id)))?.resolution ?? null, UNA_VUELTA).toBe("fixed_by_action");
  await abrir(page, "alerts");
  await expect(resueltas(page).locator(`[data-alerta="${alertaDe(id)}"]`).getByTestId("alerta-quien")).toHaveText("Fixed by Ops Uno · Text sent");
});

test("D9: un envío que BzzzBX rechaza se ve 'Failed · …' con Edit and resend, y no abre ninguna alerta", async ({ page }) => {
  test.setTimeout(150_000);
  const antes = await consultar<{ n: string }>("select count(*)::text as n from opsrun.alert_occurrence where rule_id = 'MSG-001'");
  await control(page, { accion: "forzar_error", tipo: "send_text", cuando: "al_entregar" });
  await abrir(page);
  await elegirModo(page, "cleaner");
  await escribir(page, "This one is rejected. (D9)");
  await enviar(page).click();
  const fallida = burbuja(page, "This one is rejected. (D9)");
  await expect(fallida).toHaveCount(1);
  await recargarHasta(page, () => fallida.getByTestId("estado-entrega").textContent().then((t) => (t ?? "").startsWith("Failed · ")), true);
  await expect(fallida.getByTestId("reenviar")).toBeEnabled();
  // Sin mensaje no hay alerta (S-4): ni en la pestaña ni en la base, ni después de una vuelta del ciclo.
  await abrir(page, "alerts");
  await expect(needs(page).locator('[data-regla="MSG-001"]')).toHaveCount(0);
  await page.waitForTimeout(20_000);
  const despues = await consultar<{ n: string }>("select count(*)::text as n from opsrun.alert_occurrence where rule_id = 'MSG-001'");
  expect(despues[0]!.n).toBe(antes[0]!.n);
});

test("D10: con BzzzBX caído la burbuja conserva 'Failed', la fila conserva lo último leído y Edit and resend queda en gris", async ({ page }) => {
  test.setTimeout(240_000);
  await control(page, { accion: "forzar_entrega", tipo: "send_text", delivery: "failed", delivery_detail: "Invalid number." });
  await abrir(page);
  const id = await enviarDesdeOpsrun(page, "cleaner", "Can you take it Friday at 9? (D10)");
  await recargarHasta(page, () => entrada(page, id).getByTestId("estado-entrega").textContent(), "Failed · Invalid number.");
  await esperarCierre(page);
  // La pestaña Alerts lee la conversación una vez con BzzzBX arriba: lo último leído.
  await abrir(page, "alerts");
  await expect(filaDeMensaje(page, id)).toBeVisible();

  await control(page, { accion: "no_disponible", valor: true });
  try {
    await abrir(page, "alerts");
    await expect(entrada(page, id).getByTestId("estado-entrega")).toHaveText("Failed · Invalid number.");
    await expect(entrada(page, id).getByTestId("reenviar")).toBeDisabled();
    await expect(entrada(page, id).getByTestId("reenviar-razon")).toHaveText("BzzzBX unavailable");
    const fila = filaDeMensaje(page, id);
    await expect(fila).toBeVisible();
    await expect(fila.getByTestId("alerta-destinatario")).toContainText("To: Team Alpha");
    await expect(fila.getByTestId("alerta-boton")).toBeDisabled();
    await expect(fila.getByTestId("alerta-boton-nota")).toHaveText("BzzzBX unavailable");
  } finally {
    await control(page, { accion: "no_disponible", valor: false });
  }
});
