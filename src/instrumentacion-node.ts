import { asegurarEntorno, enServidor } from "@/lib/db/entorno";
import { comprobarLoginAlArrancar } from "@/lib/db/pool";

export async function registrarNode(): Promise<void> {
  if (!enServidor()) return;
  try {
    asegurarEntorno();
    await comprobarLoginAlArrancar();
  } catch (e) {
    console.error("[opsRUN]", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
