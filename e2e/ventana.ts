import { expect, type Page } from "@playwright/test";

/**
 * Espera a que la Job window termine de llegar: ningún `aria-busy="true"` en la página,
 * es decir, ningún `Suspense` mostrando todavía su "Loading…".
 *
 * `page.goto` vuelve con el evento `load`, y eso no basta. Desde React 19.2, el HTML en
 * streaming no revela un `Suspense` en cuanto llega su contenido: lo deja en un
 * `<div hidden id="S:n">` al final del `<body>` y lo revela en lote hasta 300 ms después
 * (y, si llega entre los 2000 y los 2300 ms, a los 2300). Si en ese rato llega una
 * actualización del servidor (elegir "Acting as" es una Server Action que vuelve a pintar
 * la ventana), React pinta esa ranura en el cliente sin hidratarla y, hasta que corre el
 * lote, la ranura está dos veces en el DOM: la visible dentro de la ventana y la oculta
 * del streaming fuera de ella. Un localizador estricto falla con "resolved to 2 elements".
 */
export async function esperarVentanaLista(page: Page) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
}

/** Elige quién actúa en el selector "Acting as", cuando la ventana ya terminó de llegar. */
export async function actuarComo(page: Page, operadorId: string) {
  await esperarVentanaLista(page);
  const selector = page.getByLabel("Acting as");
  await expect(async () => {
    await selector.selectOption(operadorId);
    await expect(selector).toHaveValue(operadorId, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}
