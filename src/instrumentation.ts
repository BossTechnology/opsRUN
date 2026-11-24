/**
 * Corre una vez al arrancar el servidor de Next. En el servidor de PINCH
 * (OPSRUN_SERVIDOR=1) opsRUN no arranca con la configuración incompleta, con
 * una credencial que no debe tener o con un login privilegiado, y el proceso
 * sale para que el contenedor no quede "running". Fuera del servidor no hace
 * nada.
 *
 * Patrón de Next para código solo de Node: el import va dentro del chequeo de
 * NEXT_RUNTIME.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registrarNode } = await import("./instrumentacion-node");
    await registrarNode();
  }
}
