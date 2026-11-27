// @vitest-environment node
import { describe, expect, it } from "vitest";

import { BzzzbxNoDisponible } from "../bzzzbx/errores";
import { crearFalso } from "../bzzzbx/falso";

import { lecturaVigente } from "./servidor";

describe("lecturaVigente", () => {
  it("lee del puerto vigente en cada llamada: tras reiniciar el falso no se queda con el anterior", async () => {
    let falso = crearFalso();
    const lectura = lecturaVigente(() => falso.lectura);
    falso.lectura.poner("message", {
      bzzzbx_message_id: "bx-msg-v-1",
      bzzzbx_thread_id: "bx-thread-v-1",
      channel: "email",
      direction: "inbound",
      from: "a@example.test",
      to: ["b@example.test"],
      subject: null,
      body: "x",
      sent_at: "2030-01-01T00:00:00.000Z",
      delivery: "delivered",
    });
    expect(await lectura.obtener("message", "bx-msg-v-1")).not.toBeNull();
    falso = crearFalso();
    expect(await lectura.obtener("message", "bx-msg-v-1")).toBeNull();
  });

  it("si BzzzBX no se puede crear, responde no disponible", async () => {
    const lectura = lecturaVigente(() => {
      throw new Error("el real no existe todavía");
    });
    await expect(lectura.cambiosDesde(null)).rejects.toBeInstanceOf(BzzzbxNoDisponible);
    await expect(lectura.buscarMensajes({ channel: "email", direction: "inbound", desde: "2030-01-01T00:00:00Z" })).rejects.toBeInstanceOf(
      BzzzbxNoDisponible,
    );
  });
});
