import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";

/**
 * La pestaña Alerts y el panel de Alerts de la barra (OPR-34, criterios L1 a L13 de
 * docs/spec/opr-34-alerts.md §10.3) contra el build de producción, la seed y el
 * stand-in de BzzzBX, con OPSRUN_ACTOR_DEMO=1 y OPSRUN_ZONA_HORARIA=America/New_York
 * fijos en playwright.config.mts.
 *
 * Corre en su propio proyecto, después de los de Audit, Assign y las etapas, porque L5
 * a L9 resuelven alertas de R1, R3, R4 y R9 una vez por base: una alerta resuelta en
 * opsRUN no se reabre, así que esas pruebas se saltan limpio en una base ya usada.
 * Ninguna prueba de antes cierra las alertas de R1, R4 ni R9 (las de R8 las cierran las etapas): el
 * registrador de alertas las anotaría y dejarían de contar aquí.
 *
 * El stand-in no imita a Signal Maker: no cierra una alerta cuando el operador la
 * arregla. "Cierra Signal Maker" es `/api/falso cambiar` del `cleared_at`. El registrador
 * (la tarea `registrador_alertas` del ciclo de fondo, cada 15 s) anota lo que cambia:
 * Resolved, "Alert opened" y "Alert resolved" aparecen en una vuelta del ciclo.
 *
 * Supuesto P-10: el reparto de E2E-2 a E2E-7 (L5 a L9) es el de §9.1 del spec hasta que
 * se pasen los casos del Release Definition. Dos criterios se adaptan a lo ya construido:
 * L10 (Confirm cleaner está construido, así que el botón de OPS-020 no sale en gris) y
 * L11 (ninguna acción de las alertas está `sin_construir`: se prueba con Schedule, que
 * sale bloqueada con su motivo).
 */
test.describe.configure({ mode: "serial" });

const R = (n: number) => `b0000000-0000-4000-8000-0000000000a${n}`;
const OPS_UNO = "0a000000-0000-4000-8000-0000000000a1";
const FINANCE_UNO = "0a000000-0000-4000-8000-0000000000b1";
const MIN = 60_000;
const hace = (ms: number) => new Date(Date.now() - ms).toISOString();
const GUARDADO = { timeout: 20_000 };
const UNA_VUELTA = { timeout: 60_000 };
/** Id de alerta (o evento) propio de cada intento: lo que el registrador ya vio y resolvió no se reabre, y el reintento del grupo serial lo reusaría. */
const unico = (base: string, intento: number) => `${base}-${intento}`;

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
const contar = async (sql: string, parametros: unknown[] = []) => Number((await consultar<{ n: string }>(sql, parametros))[0]!.n);
const ocurrencia = async (id: string) =>
  (await consultar<{ resolution: string | null; level: string }>("select resolution::text, level::text from opsrun.alert_occurrence where bzzzbx_alert_id = $1", [id]))[0];

type Sujeto = { tipo: "request"; request_id: string } | { tipo: "job"; bzzzbx_job_id: string } | { tipo: "message"; bzzzbx_message_id: string };
const poner = (page: Page, id: string, sujeto: Sujeto, regla: string, nivel: "amber" | "red", razon: string, antes = 5 * MIN) =>
  control(page, {
    accion: "poner",
    entidad: "alert_result",
    valor: { bzzzbx_alert_id: id, sujeto, rule_id: regla, rule_version: "1", level: nivel, reason_text: razon, opened_at: hace(antes), cleared_at: null },
  });
/** "Cierra Signal Maker": BzzzBX da la alerta por cerrada. */
const cerrar = (page: Page, id: string) =>
  control(page, { accion: "cambiar", entidad: "alert_result", id, parche: { cleared_at: new Date().toISOString() } });

const pestana = (page: Page, id: string) => page.locator(`[data-testid="pestana"][data-pestana="${id}"]`);
const insignia = (page: Page) => page.getByTestId("conteo-alertas");
// Solo cuenta la copia que se ve: con el servidor lento, el HTML en streaming deja un instante la sección dos veces en el DOM
// (la oculta que React aún no movió y la ya puesta), y un clic o un texto sobre las dos falla por "resolved to 2 elements".
const needs = (page: Page) => page.getByTestId("alertas-needs-action").filter({ visible: true });
const waiting = (page: Page) => page.getByTestId("alertas-waiting").filter({ visible: true });
const resueltas = (page: Page) => page.getByTestId("alertas-resolved").filter({ visible: true });
const deRegla = (seccion: Locator, regla: string) => seccion.locator(`[data-testid="alerta"][data-regla="${regla}"]`);
const deAlerta = (seccion: Locator, id: string) => seccion.locator(`[data-testid="alerta"][data-alerta="${id}"]`);
const resultado = (page: Page) => page.getByTestId("resultado-accion");
// Next conserva oculta la ventana que se cerró (`display: none`): solo cuenta la que se ve.
const modal = (page: Page) => page.getByTestId("modal").filter({ visible: true });
const opcion = (page: Page, codigo: string) => page.locator(`[data-testid="accion"] option[value="${codigo}"]`);
const tarjeta = (page: Page, id: string) => page.locator(`[data-testid="tarjeta"][data-request="${id}"]`);
const columna = (page: Page, etapa: string) => page.locator(`[data-testid="columna"][data-etapa="${etapa}"]`);
const filaDeAudit = (page: Page, evento: string, indice = 0) =>
  page
    .locator('[data-ranura="audit"]')
    .getByTestId("audit-fila")
    .filter({ has: page.getByTestId("audit-evento").getByText(evento, { exact: true }) })
    .nth(indice);

async function abrir(page: Page, id: string, tab?: string) {
  await page.goto(`/job/${id}${tab ? `?tab=${tab}` : ""}`);
  await expect(page.getByTestId("encabezado")).toBeVisible();
  await expect(page.getByTestId("barra-acciones")).toBeVisible();
}

async function actuarComo(page: Page, operadorId: string) {
  const selector = page.getByLabel("Acting as");
  await expect(async () => {
    await selector.selectOption(operadorId);
    await expect(selector).toHaveValue(operadorId, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

/** El conteo del ícono de la barra superior. */
async function totalDeLaBarra(page: Page): Promise<number> {
  return Number((await page.getByTestId("alertas-operacion").innerText()).trim());
}

test.beforeEach(async ({ page }) => {
  await control(page, { accion: "reiniciar" });
});

test("L1: las secciones de la pestaña: Needs action, Waiting y Resolved con quién y cómo", async ({ page }) => {
  // R1: Needs action con OPS-001, su motivo, "Open …" y el botón Assign / Reassign.
  await abrir(page, R(1), "alerts");
  const r1 = deRegla(needs(page), "OPS-001");
  await expect(r1).toHaveCount(1);
  await expect(r1).toContainText("OPS-001 Unassigned request");
  await expect(r1.getByTestId("alerta-motivo")).toHaveText("Unassigned for 15 min.");
  await expect(r1.getByTestId("alerta-duracion")).toHaveText(/^Open \d+ min$/);
  await expect(r1.getByTestId("alerta-boton")).toHaveText("Assign / Reassign");
  await expect(waiting(page)).toContainText("None");

  // R2: Waiting con "Cleaner confirmation", el cleaner y "Asked".
  await abrir(page, R(2), "alerts");
  const espera = waiting(page).getByTestId("alerta");
  await expect(espera).toHaveCount(1);
  await expect(espera.getByTestId("espera-que")).toHaveText("Cleaner confirmation");
  await expect(espera.getByTestId("espera-cleaner")).toHaveText("Team Alpha");
  await expect(espera.getByTestId("espera-estado")).toHaveText("Asked");
  await expect(needs(page).getByTestId("sin-alertas")).toHaveText("No alerts need action");

  // R4: Resolved con OPS-010 "Cleared automatically" y "Repeats on this job: 2".
  await abrir(page, R(4), "alerts");
  const delayed = deRegla(resueltas(page), "OPS-010");
  await expect(delayed).toHaveCount(2);
  for (const fila of await delayed.all()) {
    await expect(fila.getByTestId("alerta-quien")).toHaveText("Cleared automatically");
    await expect(fila.getByTestId("alerta-repeticiones")).toHaveText("Repeats on this job: 2");
    await expect(fila.getByTestId("alerta-abierta-y-resuelta")).toHaveText(/^Opened .* · Resolved /);
  }

  // R5: MEC-003 "Cleared by Ops Dos" con su motivo.
  await abrir(page, R(5), "alerts");
  const limpiada = deRegla(resueltas(page), "MEC-003");
  await expect(limpiada.getByTestId("alerta-quien")).toHaveText("Cleared by Ops Dos");
  await expect(limpiada.getByTestId("alerta-razon")).toHaveText("Reason: Large unit, cleaner called ahead.");

  // R6: TRN-005 "Fixed by Finance Uno · PO entered".
  await abrir(page, R(6), "alerts");
  await expect(deRegla(resueltas(page), "TRN-005").getByTestId("alerta-quien")).toHaveText("Fixed by Finance Uno · PO entered");
});

test("L2: la insignia: ámbar con 1, gris con Waiting, sin insignia, y una roja nueva la hace latir", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await abrir(page, R(1));
  await expect(insignia(page)).toHaveText("1");
  await expect(insignia(page)).toHaveAttribute("data-nivel", "amber");
  await expect(insignia(page)).toHaveAttribute("data-pulso", "no");
  await expect(page.getByRole("tab", { name: "Alerts, 1 need action, amber" })).toBeVisible();

  await abrir(page, R(2));
  await expect(insignia(page)).toHaveText("1");
  await expect(insignia(page)).toHaveAttribute("data-nivel", "gray");
  await expect(page.getByRole("tab", { name: "Alerts, 1 waiting" })).toBeVisible();
  // Waiting no abre la ventana en Alerts (P-5).
  await expect(pestana(page, "alerts")).toHaveAttribute("aria-selected", "false");

  await abrir(page, R(3));
  await expect(insignia(page)).toHaveCount(0);

  // R1 con la ventana abierta y una roja nueva: roja con 2 y latiendo, con la animación de 3 ciclos.
  await abrir(page, R(1));
  await poner(page, unico("bx-alert-0201", testInfo.retry), { tipo: "request", request_id: R(1) }, "OPS-002", "red", "Open for 2 days.");
  await expect(insignia(page)).toHaveText("2", UNA_VUELTA);
  await expect(insignia(page)).toHaveAttribute("data-nivel", "red");
  await expect(insignia(page)).toHaveAttribute("data-pulso", "si");
  await expect(insignia(page)).toHaveCSS("animation-iteration-count", "3");
  await expect(page.getByRole("tab", { name: "Alerts, 2 need action, red" })).toBeVisible();
});

test("L2: con prefers-reduced-motion el color cambia y no hay animación", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await abrir(page, R(1));
  await expect(insignia(page)).toHaveText("1");
  await poner(page, unico("bx-alert-0202", testInfo.retry), { tipo: "request", request_id: R(1) }, "OPS-002", "red", "Open for 2 days.");
  await expect(insignia(page)).toHaveAttribute("data-nivel", "red", UNA_VUELTA);
  await expect(insignia(page)).toHaveAttribute("data-pulso", "si");
  await expect(insignia(page)).toHaveCSS("animation-name", "none");
});

test("L3: abre en Alerts con algo en Needs action, vuelve a la propiedad al resolverse, y Waiting solo no la abre", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  // Una alerta que el registrador vio y resolvió no se reabre: con el mismo id, el reintento del grupo (serial) no vería nada.
  const a1 = `bx-alert-0301-${testInfo.retry}`;
  const a2 = `bx-alert-0302-${testInfo.retry}`;
  // R1 abre en Alerts; R2 (solo Waiting) abre en la propiedad.
  await page.goto(`/job/${R(1)}`);
  await expect(pestana(page, "alerts")).toHaveAttribute("aria-selected", "true");
  await page.goto(`/job/${R(2)}`);
  await expect(pestana(page, "property")).toHaveAttribute("aria-selected", "true");
  await expect(waiting(page)).toBeHidden(); // la pestaña Alerts no es la elegida

  // Una alerta propia en R3 (las de la seed las usan otras pruebas): abre en Alerts y, al cerrarla, vuelve sola en menos de 1 minuto.
  await poner(page, a1, { tipo: "job", bzzzbx_job_id: "bx-job-0003" }, "OPS-002", "amber", "Open for 2 days.");
  await page.goto(`/job/${R(3)}`);
  await expect(pestana(page, "alerts")).toHaveAttribute("aria-selected", "true");
  await expect(deAlerta(needs(page), a1)).toBeVisible();
  await cerrar(page, a1);
  await expect(pestana(page, "property")).toHaveAttribute("aria-selected", "true", UNA_VUELTA);

  // Elegida a mano con ?tab=alerts, se queda aunque ya no haya nada (OPR-26 A6).
  await control(page, { accion: "reiniciar" });
  await poner(page, a2, { tipo: "job", bzzzbx_job_id: "bx-job-0003" }, "OPS-002", "amber", "Open for 2 days.");
  await page.goto(`/job/${R(3)}?tab=alerts`);
  await expect(insignia(page)).toHaveText("1");
  await cerrar(page, a2);
  await expect(insignia(page)).toHaveCount(0, UNA_VUELTA);
  await expect(pestana(page, "alerts")).toHaveAttribute("aria-selected", "true");
  await expect(needs(page).getByTestId("sin-alertas")).toBeVisible();
});

test("L4: el panel de la barra: total, filtros con sus conteos, Esc y el camino a la Job window", async ({ page }) => {
  await page.goto("/");
  const icono = page.getByTestId("alertas-operacion");
  await expect(icono).toBeVisible();
  const total = await totalDeLaBarra(page);
  expect(total).toBeGreaterThanOrEqual(2);
  await expect(icono).toHaveAttribute("aria-haspopup", "dialog");
  await expect(icono).toHaveAttribute("aria-expanded", "false");

  await icono.click();
  await expect(icono).toHaveAttribute("aria-expanded", "true");
  const panel = page.getByRole("dialog", { name: "Alerts" });
  await expect(panel).toBeVisible();
  const filas = panel.getByTestId("panel-alerta");
  await expect(filas).toHaveCount(total);
  // Las abiertas de la seed: la OPS-001 de R1 y la TRN-005 de R9.
  await expect(panel.locator(`[data-testid="panel-alerta"][data-request="${R(1)}"][data-regla="OPS-001"]`)).toBeVisible();
  await expect(panel.locator(`[data-testid="panel-alerta"][data-request="${R(9)}"][data-regla="TRN-005"]`)).toBeVisible();
  // Waiting, cerrada por defecto, con la pregunta de R2.
  await expect(panel.getByTestId("panel-waiting")).toContainText(/Waiting \(\d+\)/);
  await expect(panel.getByTestId("panel-waiting")).not.toHaveAttribute("open", "");
  await panel.getByTestId("panel-waiting").locator("summary").click();
  await expect(panel.locator(`[data-testid="panel-espera"][data-request="${R(2)}"]`)).toBeVisible();

  // Cada filtro reduce la lista a lo que dice el conteo de su opción.
  for (const nombre of ["Level", "Rule", "Stage", "Assigned to"]) {
    const filtro = panel.getByRole("combobox", { name: nombre });
    const textos = await filtro.locator("option").allTextContents();
    expect(textos[0], nombre).toMatch(new RegExp(`^All \\(${total}\\)$`));
    for (let i = 1; i < textos.length; i++) {
      const conteo = Number(/\((\d+)\)$/.exec(textos[i]!)![1]);
      await filtro.selectOption({ index: i });
      await expect(filas, `${nombre}: ${textos[i]}`).toHaveCount(conteo);
    }
    await filtro.selectOption({ index: 0 });
    await expect(filas).toHaveCount(total);
  }
  // Sin resultados: lo dice, y Clear filters los quita.
  await panel.getByRole("combobox", { name: "Level" }).selectOption("red");
  await panel.getByRole("combobox", { name: "Stage" }).selectOption("complete");
  await expect(panel.getByTestId("panel-alertas-sin-coincidencias")).toContainText("No alerts match these filters");
  await panel.getByTestId("panel-alertas-limpiar").click();
  await expect(filas).toHaveCount(total);

  // Esc cierra y el foco vuelve al ícono.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(icono).toBeFocused();

  // Clic en la fila de R1: la Job window se abre encima del tablero, en Alerts, sin ?tab en la URL.
  await icono.click();
  await panel.locator(`[data-testid="panel-alerta"][data-request="${R(1)}"]`).click();
  await expect(modal(page)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/job/${R(1)}$`));
  await expect(panel).toBeHidden();
  await expect(pestana(page, "alerts")).toHaveAttribute("aria-selected", "true");
  await expect(columna(page, "requests")).toBeAttached(); // el tablero sigue debajo
  // Esc vuelve al tablero (cuando la ventana ya se hidrató: el modal toma el foco al montarse).
  await expect(modal(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(modal(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test("L10: Message not delivered cuenta en la tarjeta, la columna y la barra, y su botón lleva al mensaje; OPS-020 abre Confirm cleaner", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/");
  const antes = await totalDeLaBarra(page);
  const conAlertaAntes = await tarjeta(page, R(2)).locator(".alerta-mini").count();

  await control(page, {
    accion: "poner",
    entidad: "message",
    valor: {
      bzzzbx_message_id: "bx-msg-1001",
      bzzzbx_thread_id: "bx-thread-0002",
      channel: "text",
      direction: "outbound",
      from: "opsrun",
      to: ["+1 555 0111"],
      subject: null,
      body: "Please confirm the unit.",
      sent_at: hace(10 * MIN),
      delivery: "failed",
    },
  });
  await poner(page, "bx-alert-1001", { tipo: "message", bzzzbx_message_id: "bx-msg-1001" }, "MSG-001", "red", "Text not delivered.");

  // La ventana la ve en cuanto la lee; la barra y la columna, en cuanto el registrador la anota (una vuelta del ciclo).
  await abrir(page, R(2), "alerts");
  const fila = deAlerta(needs(page), "bx-alert-1001");
  await expect(fila).toBeVisible();
  await expect(fila).toContainText("MSG-001 Message not delivered");
  await expect.poll(() => contar("select count(*)::text as n from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-1001' and bzzzbx_message_id = 'bx-msg-1001'"), UNA_VUELTA).toBe(1);
  await page.goto("/");
  await expect(page.getByTestId("alertas-operacion")).toContainText(String(antes + 1), UNA_VUELTA);
  await expect(tarjeta(page, R(2)).locator(".alerta-mini")).toHaveText(String(conAlertaAntes === 0 ? 1 : 2));
  await expect(columna(page, "requests").getByTestId("alertas-columna")).toBeVisible();

  // Edit and resend lleva el foco al mensaje en la conversación.
  await abrir(page, R(2), "alerts");
  await deAlerta(needs(page), "bx-alert-1001").getByTestId("alerta-boton").click();
  await expect(page.locator('[data-entrada="msg:bx-msg-1001"]')).toBeFocused();

  // OPS-020: Confirm cleaner (ya construido) se abre desde la alerta con su panel.
  await poner(page, "bx-alert-1002", { tipo: "request", request_id: R(2) }, "OPS-020", "red", "The cleaner declined.");
  await abrir(page, R(2), "alerts");
  const declinada = deRegla(needs(page), "OPS-020");
  await expect(declinada.getByTestId("alerta-boton")).toHaveText("Confirm cleaner");
  await expect(declinada.getByTestId("alerta-boton")).toBeEnabled();
  await declinada.getByTestId("alerta-boton").click();
  await expect(page.getByTestId("panel-accion")).toHaveAttribute("data-accion", "confirm_cleaner");
  await expect(page.getByTestId("panel-confirm-cleaner")).toBeVisible();
});

test("L11: el botón no corre lo que no está disponible: Go lo rechaza el servidor, con su motivo y sin escribir nada", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await poner(page, unico("bx-alert-1101", testInfo.retry), { tipo: "request", request_id: R(1) }, "OPS-002", "amber", "Open for 2 days.");
  await abrir(page, R(1), "alerts");
  await actuarComo(page, OPS_UNO);
  const boton = deRegla(needs(page), "OPS-002").getByTestId("alerta-boton");
  await expect(boton).toHaveText("Schedule");
  await expect(boton).toBeDisabled();
  await expect(deRegla(needs(page), "OPS-002").getByTestId("alerta-boton-nota")).toHaveText("Confirm who it is from first");

  // Lo que la base tiene de R1 que no son las alertas del registrador (esas llegan solas).
  const propias = () =>
    contar("select count(*)::text as n from opsrun.audit_event where request_id = $1 and event_type not like 'alert\\_%'", [R(1)]);
  const antes = await propias();
  const instrucciones = () => contar("select count(*)::text as n from opsrun.instruction where request_id = $1", [R(1)]);
  const instruccionesAntes = await instrucciones();

  // Se le quita el disabled, como lo haría una persona, y se pulsa: abre el panel con su motivo.
  // Se repite hasta que la página termina de hidratarse y React atiende el clic.
  await expect(async () => {
    // React no atiende el clic de un botón cuyo prop es `disabled`, aunque se le quite el atributo: se entrega al manejador.
    await boton.evaluate((b: HTMLButtonElement) => {
      b.removeAttribute("disabled");
      const clave = Object.keys(b).find((k) => k.startsWith("__reactProps"))!;
      (b as unknown as Record<string, { onClick: () => void }>)[clave].onClick();
    });
    await expect(page.getByTestId("panel-accion")).toHaveAttribute("data-accion", "schedule", { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByTestId("nota-accion")).toHaveText("Confirm who it is from first");
  // Y se fuerza Go: el servidor recalcula la disponibilidad y lo rechaza.
  await page.getByTestId("go").evaluate((b: HTMLButtonElement) => {
    b.removeAttribute("disabled");
    const clave = Object.keys(b).find((k) => k.startsWith("__reactProps"))!;
    (b as unknown as Record<string, { onClick: () => void }>)[clave].onClick();
  });
  await expect(resultado(page)).toHaveText("Confirm who it is from first");
  await expect(resultado(page)).toHaveAttribute("data-tipo", "rechazada");
  expect(await propias()).toBe(antes);
  expect(await instrucciones()).toBe(instruccionesAntes);
});

test("L12: con BzzzBX caído: Needs action con lo último leído y la franja, Waiting y Resolved completos, Clear alert en gris, y el panel con su aviso", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await poner(page, unico("bx-alert-1201", testInfo.retry), { tipo: "job", bzzzbx_job_id: "bx-job-0004" }, "MEC-003", "amber", "Running 45 min over the window.");
  // Se leen con BzzzBX arriba: lo último leído queda en memoria.
  await abrir(page, R(1), "alerts");
  await expect(deRegla(needs(page), "OPS-001")).toBeVisible();
  await abrir(page, R(4), "alerts");
  await expect(deAlerta(needs(page), unico("bx-alert-1201", testInfo.retry))).toBeVisible();
  await page.goto("/");
  const total = await totalDeLaBarra(page);

  await control(page, { accion: "no_disponible", valor: true });
  try {
    // R1: Needs action con lo último leído y la franja.
    await abrir(page, R(1), "alerts");
    await expect(page.getByTestId("alertas-franja")).toHaveText(/^BzzzBX unavailable · last update /);
    await expect(deRegla(needs(page), "OPS-001")).toBeVisible();
    // R2: Waiting es de opsRUN y se ve completo; el cleaner sin leer, — —.
    await abrir(page, R(2), "alerts");
    await expect(waiting(page).getByTestId("espera-que")).toHaveText("Cleaner confirmation");
    await expect(waiting(page).getByTestId("espera-cleaner")).toHaveText("— —");
    // R4: Resolved completo, y Clear alert en gris con "BzzzBX unavailable".
    await abrir(page, R(4), "alerts");
    await expect(deRegla(resueltas(page), "OPS-010")).toHaveCount(2);
    const limpiar = deAlerta(needs(page), unico("bx-alert-1201", testInfo.retry)).getByTestId("alerta-boton");
    await expect(limpiar).toHaveText("Clear alert");
    await expect(limpiar).toBeDisabled();
    await expect(deAlerta(needs(page), unico("bx-alert-1201", testInfo.retry)).getByTestId("alerta-boton-nota")).toHaveText("BzzzBX unavailable");
    // El panel de la barra: lo último conocido, con su aviso.
    await page.goto("/");
    await page.getByTestId("alertas-operacion").click();
    const panel = page.getByRole("dialog", { name: "Alerts" });
    await expect(panel.getByTestId("panel-alertas-franja")).toHaveText(/^BzzzBX unavailable · last update /);
    await expect(panel.getByTestId("panel-alerta")).toHaveCount(total);
  } finally {
    await control(page, { accion: "no_disponible", valor: false });
  }
  // Al volver, todo se va.
  await page.goto("/");
  await expect(page.getByTestId("en-vivo")).toHaveText("Live");
  await page.getByTestId("alertas-operacion").click();
  await expect(page.getByRole("dialog", { name: "Alerts" }).getByTestId("panel-alertas-franja")).toHaveCount(0);
  await abrir(page, R(4), "alerts");
  await expect(page.getByTestId("alertas-franja")).toHaveCount(0);
  await expect(deAlerta(needs(page), unico("bx-alert-1201", testInfo.retry)).getByTestId("alerta-boton")).toBeEnabled();
});

test("L13: registra con el tablero cerrado: la alerta queda en alert_occurrence y en Audit sin que nadie mire", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  // Sin ninguna página abierta: solo el stand-in cambia y la base se consulta, no la interfaz.
  await poner(page, unico("bx-alert-1301", testInfo.retry), { tipo: "job", bzzzbx_job_id: "bx-job-0003" }, "OPS-002", "amber", "Open for 2 days.");
  await expect
    .poll(() => contar("select count(*)::text as n from opsrun.alert_occurrence where bzzzbx_alert_id = $1 and request_id = $2", [unico("bx-alert-1301", testInfo.retry), R(3)]), UNA_VUELTA)
    .toBe(1);
  expect(
    await contar(
      `select count(*)::text as n from opsrun.audit_event as e join opsrun.alert_occurrence as a on a.id = e.alert_occurrence_id
        where a.bzzzbx_alert_id = $1 and e.event_type = 'alert_opened' and e.actor_kind = 'bzzzbx'`,
      [unico("bx-alert-1301", testInfo.retry)],
    ),
  ).toBe(1);
  // Después se abre la ventana de R3: la alerta ya está en Needs action y en Audit.
  await abrir(page, R(3), "alerts");
  await expect(deAlerta(needs(page), unico("bx-alert-1301", testInfo.retry))).toBeVisible();
  await abrir(page, R(3), "audit");
  await expect(filaDeAudit(page, "Alert opened", 0)).toBeVisible();
  await expect(page.locator('[data-ranura="audit"]').getByText("OPS-002 Request open too long").first()).toBeVisible();
});

test("L6 (E2E-3): OPS-010 Delayed: sin botón, 'Clears at check-in', y con el check-in queda Cleared automatically", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  test.skip((await ocurrencia(unico("bx-alert-0600", 0))) !== undefined && testInfo.retry === 0, "La OPS-010 de R3 ya se resolvió en esta base: se necesita una base nueva");
  const checkIn = () =>
    control(page, {
      accion: "poner",
      entidad: "jobtracker_event",
      valor: { bzzzbx_event_id: unico("bx-evt-0601", testInfo.retry), bzzzbx_job_id: "bx-job-0003", kind: "checked_in", occurred_at: hace(MIN) },
    });

  await poner(page, unico("bx-alert-0600", testInfo.retry), { tipo: "job", bzzzbx_job_id: "bx-job-0003" }, "OPS-010", "red", "Not started by 1:00 PM.", 20 * MIN);
  // La tarjeta dice Delayed, y la barra y la columna Scheduled cuentan una roja.
  await page.goto("/");
  const r3 = tarjeta(page, R(3));
  await expect(r3.getByTestId("estado")).toHaveText("Delayed");
  await expect(columna(page, "scheduled").getByTestId("alertas-columna")).toHaveAttribute("data-nivel", "red");
  await expect(page.getByTestId("alertas-operacion")).toHaveAttribute("data-nivel", "red");
  // La pestaña la muestra sin botón y con "Clears at check-in".
  await abrir(page, R(3), "alerts");
  const fila = deAlerta(needs(page), unico("bx-alert-0600", testInfo.retry));
  await expect(fila).toContainText("OPS-010 Delayed");
  await expect(fila.getByTestId("alerta-boton")).toHaveCount(0);
  await expect(fila.getByTestId("alerta-sin-boton")).toHaveText("Clears at check-in");

  // El check-in llega y Signal Maker la cierra: Resolved, "Cleared automatically".
  await checkIn();
  await cerrar(page, unico("bx-alert-0600", testInfo.retry));
  await expect(deAlerta(resueltas(page), unico("bx-alert-0600", testInfo.retry))).toBeVisible(UNA_VUELTA);
  await expect(deAlerta(resueltas(page), unico("bx-alert-0600", testInfo.retry)).getByTestId("alerta-quien")).toHaveText("Cleared automatically");
  expect((await ocurrencia(unico("bx-alert-0600", testInfo.retry)))?.resolution).toBe("auto_cleared");
  // Audit: Alert opened y Alert resolved, con Observed donde toca (el check-in lo observa el ciclo).
  await abrir(page, R(3), "audit");
  await expect(filaDeAudit(page, "Alert opened")).toBeVisible();
  await expect(filaDeAudit(page, "Alert resolved")).toBeVisible();
  await expect(filaDeAudit(page, "Checked in")).toContainText("Observed", UNA_VUELTA);
});

test("L7 (E2E-4): MEC-003 Running long: Clear alert desde la alerta, con motivo, y deja de contar aunque el falso la dé abierta", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  test.skip((await ocurrencia(unico("bx-alert-0008", 0))) !== undefined && testInfo.retry === 0, "La MEC-003 nueva de R4 ya se limpió en esta base: se necesita una base nueva");
  await poner(page, unico("bx-alert-0008", testInfo.retry), { tipo: "job", bzzzbx_job_id: "bx-job-0004" }, "MEC-003", "amber", "Running 50 min over the window.", 10 * MIN);

  await page.goto("/");
  const antesBarra = await totalDeLaBarra(page);
  const antesColumna = Number((await columna(page, "in_progress").getByTestId("alertas-columna").textContent()) ?? "0");
  expect(antesColumna).toBeGreaterThanOrEqual(1);

  await abrir(page, R(4));
  await actuarComo(page, OPS_UNO);
  await expect(pestana(page, "alerts")).toHaveAttribute("aria-selected", "true");
  // El botón abre Clear alert con esa alerta elegida; sin motivo, Go está deshabilitado.
  await deAlerta(needs(page), unico("bx-alert-0008", testInfo.retry)).getByTestId("alerta-boton").click();
  await expect(page.getByTestId("panel-accion")).toHaveAttribute("data-accion", "clear_alert");
  await expect(page.locator(`[data-testid="alerta-limpiable"][data-alerta="${unico("bx-alert-0008", testInfo.retry)}"]`)).toBeVisible();
  await expect(page.getByTestId("go")).toBeDisabled();
  await page.getByTestId("motivo").fill("   ");
  await expect(page.getByTestId("go")).toBeDisabled();
  await page.getByTestId("motivo").fill("Large unit, called ahead.");
  await expect(page.getByTestId("go")).toBeEnabled();
  await page.getByTestId("go").click();
  await expect(resultado(page)).toHaveText("Saved", GUARDADO);

  // Resolved "Cleared by Ops Uno" con su motivo, aunque el falso la siga dando abierta.
  await abrir(page, R(4), "alerts");
  await expect(deAlerta(needs(page), unico("bx-alert-0008", testInfo.retry))).toHaveCount(0);
  const resuelta = deAlerta(resueltas(page), unico("bx-alert-0008", testInfo.retry));
  await expect(resuelta.getByTestId("alerta-quien")).toHaveText("Cleared by Ops Uno");
  await expect(resuelta.getByTestId("alerta-razon")).toHaveText("Reason: Large unit, called ahead.");
  // Deja de contar en la tarjeta, la columna y la barra.
  await page.goto("/");
  await expect(page.getByTestId("alertas-operacion")).toContainText(String(antesBarra - 1));
  const despuesColumna = (await columna(page, "in_progress").getByTestId("alertas-columna").count())
    ? Number((await columna(page, "in_progress").getByTestId("alertas-columna").textContent()) ?? "0")
    : 0;
  expect(despuesColumna).toBe(antesColumna - 1);
});

test("L8 (E2E-5 y E2E-6): fotos: Mark as OSS desde la alerta queda Fixed by action; las fotos que llegan la dejan Cleared automatically", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  test.skip((await ocurrencia(unico("bx-alert-0801", 0))) !== undefined && testInfo.retry === 0, "Las alertas de fotos de R4 ya se resolvieron en esta base: se necesita una base nueva");
  // R4 termina: Complete (R5 ya está aprobada y no admite Mark as OSS).
  await control(page, {
    accion: "poner",
    entidad: "jobtracker_event",
    valor: { bzzzbx_event_id: unico("bx-evt-0801", testInfo.retry), bzzzbx_job_id: "bx-job-0004", kind: "completed", occurred_at: hace(2 * MIN) },
  });
  await poner(page, unico("bx-alert-0801", testInfo.retry), { tipo: "job", bzzzbx_job_id: "bx-job-0004" }, "ORG-002", "amber", "No photos after the job.", 5 * MIN);

  await abrir(page, R(4));
  await actuarComo(page, OPS_UNO);
  await expect(page.getByTestId("stage")).toHaveText("Complete");
  await expect(pestana(page, "alerts")).toHaveAttribute("aria-selected", "true");
  const fila = deAlerta(needs(page), unico("bx-alert-0801", testInfo.retry));
  await expect(fila).toContainText("ORG-002 No photos");
  await fila.getByTestId("alerta-boton").click();
  await expect(page.getByTestId("panel-accion")).toHaveAttribute("data-accion", "mark_oss");
  await page.getByRole("radio", { name: "OSS", exact: true }).check();
  await expect(page.getByTestId("go")).toBeEnabled();
  await page.getByTestId("go").click();
  await expect(resultado(page)).toHaveText("Saved", GUARDADO);

  // Signal Maker la cierra: "Fixed by Ops Uno · Marked as OSS".
  await cerrar(page, unico("bx-alert-0801", testInfo.retry));
  await expect(deAlerta(resueltas(page), unico("bx-alert-0801", testInfo.retry)).getByTestId("alerta-quien")).toContainText("Fixed by Ops Uno · Marked as OSS", UNA_VUELTA);
  expect((await ocurrencia(unico("bx-alert-0801", testInfo.retry)))?.resolution).toBe("fixed_by_action");

  // E2E-6: ORG-003 Partial photos; llega la foto After y Signal Maker la cierra: Cleared automatically.
  await poner(page, unico("bx-alert-0802", testInfo.retry), { tipo: "job", bzzzbx_job_id: "bx-job-0004" }, "ORG-003", "amber", "Only the before photo.", 0);
  await abrir(page, R(4), "alerts");
  await expect(deAlerta(needs(page), unico("bx-alert-0802", testInfo.retry))).toContainText("ORG-003 Partial photos");
  await control(page, {
    accion: "poner",
    entidad: "photo",
    valor: { bzzzbx_photo_id: unico("bx-photo-0802", testInfo.retry), bzzzbx_job_id: "bx-job-0004", phase: "after", taken_at: hace(MIN / 2), ref: "stand-in:photo/bx-photo-0802" },
  });
  await cerrar(page, unico("bx-alert-0802", testInfo.retry));
  await expect(deAlerta(resueltas(page), unico("bx-alert-0802", testInfo.retry)).getByTestId("alerta-quien")).toHaveText("Cleared automatically", UNA_VUELTA);
  expect((await ocurrencia(unico("bx-alert-0802", testInfo.retry)))?.resolution).toBe("auto_cleared");
});

test("L9 (E2E-7): TRN-005 PO missing: sube a roja, Enter PO desde la alerta y queda Fixed by action; Validate deja de estar en gris", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  test.skip(((await ocurrencia("bx-alert-0007"))?.resolution ?? null) !== null && testInfo.retry === 0, "La TRN-005 de R9 ya se resolvió en esta base: se necesita una base nueva");
  await abrir(page, R(9));
  await actuarComo(page, FINANCE_UNO);
  await expect(page.getByTestId("stage")).toHaveText("Validation");
  await expect(pestana(page, "alerts")).toHaveAttribute("aria-selected", "true");
  const fila = deAlerta(needs(page), "bx-alert-0007");
  await expect(fila).toContainText("TRN-005 PO missing");
  await expect(fila).toHaveAttribute("data-nivel", "amber");
  await expect(opcion(page, "record_validation")).toHaveText("Validate — Add PO");

  // El nivel sube a rojo: la insignia pasa a roja y Audit dice "Alert level changed".
  await control(page, { accion: "cambiar", entidad: "alert_result", id: "bx-alert-0007", parche: { level: "red" } });
  await expect(insignia(page)).toHaveAttribute("data-nivel", "red", UNA_VUELTA);
  await expect.poll(() => contar("select count(*)::text as n from opsrun.audit_event as e join opsrun.alert_occurrence as a on a.id = e.alert_occurrence_id where a.bzzzbx_alert_id = 'bx-alert-0007' and e.event_type = 'alert_level_changed'"), UNA_VUELTA).toBe(1);
  await abrir(page, R(9), "audit");
  await expect(filaDeAudit(page, "Alert level changed")).toBeVisible();

  // Enter PO desde la alerta, y Signal Maker la cierra.
  await abrir(page, R(9), "alerts");
  await actuarComo(page, FINANCE_UNO);
  await deAlerta(needs(page), "bx-alert-0007").getByTestId("alerta-boton").click();
  await expect(page.getByTestId("panel-accion")).toHaveAttribute("data-accion", "write_po");
  await page.getByTestId("panel-po-input").fill("PO-EX-0109");
  await expect(page.getByTestId("go")).toBeEnabled();
  await page.getByTestId("go").click();
  await expect(resultado(page)).toHaveText("Saved", GUARDADO);
  await cerrar(page, "bx-alert-0007");
  await expect(deAlerta(resueltas(page), "bx-alert-0007").getByTestId("alerta-quien")).toHaveText("Fixed by Finance Uno · PO entered", UNA_VUELTA);
  // Validate deja de estar en gris con "Add PO".
  await abrir(page, R(9));
  await expect(opcion(page, "record_validation")).toBeEnabled();
  await expect(opcion(page, "record_validation")).not.toContainText("Add PO");
});

test("L5 (E2E-2): OPS-001 Unassigned request: Assign desde la alerta, 'Assign to me' elegido, y queda Fixed by action; la ventana vuelve sola a la propiedad", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  test.skip(((await ocurrencia("bx-alert-0001"))?.resolution ?? null) !== null && testInfo.retry === 0, "La OPS-001 de R1 ya se resolvió en esta base: se necesita una base nueva");
  await page.goto("/");
  const antes = await totalDeLaBarra(page);

  await abrir(page, R(1));
  await actuarComo(page, OPS_UNO);
  await expect(pestana(page, "alerts")).toHaveAttribute("aria-selected", "true");
  await deRegla(needs(page), "OPS-001").getByTestId("alerta-boton").click();
  // La acción se abre elegida, con "Assign to me" ya elegido: Go corre sin tocar nada más.
  await expect(page.getByTestId("panel-accion")).toHaveAttribute("data-accion", "assign");
  await expect(page.getByTestId("go")).toBeEnabled();
  await page.getByTestId("go").click();
  await expect(resultado(page)).toHaveText("Saved", GUARDADO);
  await expect(page.getByTestId("asignado")).toHaveText("Ops Uno");

  // Cierra Signal Maker: la ventana, que se abrió en Alerts por la regla, vuelve sola a la propiedad en menos de 1 minuto.
  await cerrar(page, "bx-alert-0001");
  await expect(pestana(page, "property")).toHaveAttribute("aria-selected", "true", UNA_VUELTA);
  await pestana(page, "alerts").click();
  const resuelta = deAlerta(resueltas(page), "bx-alert-0001");
  await expect(resuelta.getByTestId("alerta-quien")).toHaveText("Fixed by Ops Uno · Assigned", UNA_VUELTA);
  expect((await ocurrencia("bx-alert-0001"))?.resolution).toBe("fixed_by_action");
  // El conteo de la barra baja, y Audit muestra "Alert resolved".
  await page.goto("/");
  await expect(page.getByTestId("alertas-operacion")).toContainText(String(antes - 1));
  // Audit muestra "Alert resolved" con quien la arregló. La pestaña Audit empieza en Scheduled y R1 sigue en Requests: se lee de la base.
  const resuelta2 = await consultar<{ actor_kind: string; operador: string | null }>(
    `select e.actor_kind::text, o.display_name as operador
       from opsrun.audit_event as e
       join opsrun.alert_occurrence as a on a.id = e.alert_occurrence_id
       left join opsrun.operator as o on o.id = e.actor_operator_id
      where a.bzzzbx_alert_id = 'bx-alert-0001' and e.event_type = 'alert_resolved'`,
  );
  expect(resuelta2).toEqual([{ actor_kind: "operator", operador: "Ops Uno" }]);
});
