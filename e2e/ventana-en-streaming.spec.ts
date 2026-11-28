import http from "node:http";
import type { AddressInfo } from "node:net";

import { expect, test } from "@playwright/test";

import { actuarComo } from "./ventana";

/**
 * Regresión de la sección Needs action dos veces en el DOM (alertas.spec.ts L7, L11 en CI).
 *
 * En CI la ranura de Alerts llegaba tarde en el HTML en streaming. React la deja oculta
 * (`<div hidden id="S:n">`) hasta revelarla en lote; si "Acting as" vuelve a pintar la
 * ventana antes, React pinta la ranura en el cliente y la oculta sigue en el DOM. Aquí un
 * proxy retiene el trozo del HTML que trae la ranura de Alerts hasta que pasa una Server
 * Action (o 4 s), y un MutationObserver cuenta las copias a lo largo de toda la carga:
 * sin la espera de `actuarComo` hay dos copias siempre; con ella, una.
 */
const R1 = "b0000000-0000-4000-8000-0000000000a1";
const OPS_UNO = "0a000000-0000-4000-8000-0000000000a1";
const RETENCION_MAXIMA_MS = 4000;

test("Acting as no deja la ranura de Alerts dos veces en el DOM aunque llegue tarde en el streaming", async ({ page, baseURL }) => {
  const destino = new URL(baseURL!);
  let soltar: (() => void) | null = null;
  const proxy = http.createServer((req, res) => {
    const salida = http.request(
      // Sin compresión: el proxy busca la ranura en el texto del HTML.
      { host: destino.hostname, port: destino.port, path: req.url, method: req.method, headers: { ...req.headers, "accept-encoding": "identity" } },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        const esDocumento = req.method === "GET" && req.url?.startsWith("/job/") && !req.headers["rsc"];
        if (!esDocumento) {
          r.pipe(res);
          // Una Server Action que terminó suelta el HTML retenido.
          if (req.method === "POST") res.on("finish", () => soltar?.());
          return;
        }
        const cola: Buffer[] = [];
        let reteniendo = false;
        let termino = false;
        r.on("data", (trozo: Buffer) => {
          if (!reteniendo && soltar === null && trozo.toString("utf8").includes('data-testid="alertas-needs-action"')) {
            reteniendo = true;
            const temporizador = setTimeout(() => soltar?.(), RETENCION_MAXIMA_MS);
            soltar = () => {
              clearTimeout(temporizador);
              soltar = () => {};
              reteniendo = false;
              for (const c of cola.splice(0)) res.write(c);
              if (termino) res.end();
            };
          }
          if (reteniendo) cola.push(trozo);
          else res.write(trozo);
        });
        r.on("end", () => {
          termino = true;
          if (!reteniendo) res.end();
        });
      },
    );
    req.pipe(salida);
  });
  await new Promise<void>((listo) => proxy.listen(0, "127.0.0.1", listo));
  try {
    const puerto = (proxy.address() as AddressInfo).port;
    await page.addInitScript(() => {
      const w = window as unknown as { __copias: number };
      w.__copias = 0;
      new MutationObserver(() => {
        w.__copias = Math.max(w.__copias, document.querySelectorAll('[data-testid="alertas-needs-action"]').length);
      }).observe(document, { childList: true, subtree: true });
    });

    // Sin esperar a `load`: con la ranura retenida, `load` no llega hasta soltarla. En CI pasaba lo mismo
    // en los 300 ms después de `load` en que React aún no revela lo que llegó; `actuarComo` tiene que
    // esperar por su cuenta, llegue la ventana como llegue.
    await page.goto(`http://127.0.0.1:${puerto}/job/${R1}?tab=alerts`, { waitUntil: "commit" });
    await actuarComo(page, OPS_UNO);
    await expect(page.getByTestId("alertas-needs-action")).toBeVisible();
    // El lote de React y la nueva pintura ya pasaron.
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => (window as unknown as { __copias: number }).__copias)).toBe(1);
  } finally {
    proxy.closeAllConnections();
    await new Promise((listo) => proxy.close(listo));
  }
});
