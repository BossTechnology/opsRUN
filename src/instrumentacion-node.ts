import { iniciarCicloDeFondo } from "@/lib/ciclo/arranque";
import { asegurarEntorno, enServidor } from "@/lib/db/entorno";
import { comprobarLoginAlArrancar } from "@/lib/db/pool";

export async function registrarNode(): Promise<void> {
  if (enServidor()) {
    try {
      asegurarEntorno();
      await comprobarLoginAlArrancar();
    } catch (e) {
      console.error("[opsRUN]", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  }
  // El ciclo de fondo único (ADR 0006): también en local y CI, donde las E2E
  // lo necesitan. Después del chequeo de arranque: con el servidor mal
  // configurado el proceso ya salió.
  iniciarCicloDeFondo();
}
