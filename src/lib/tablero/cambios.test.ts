// @vitest-environment node
import { describe, expect, it } from "vitest";

import { crearFalso, RelojManual } from "../bzzzbx/falso";

import { revisarCambios } from "./cambios";

function preparar() {
  const falso = crearFalso({ reloj: new RelojManual(new Date("2026-11-24T18:00:00Z")), tamanoDeLote: 2 });
  let marca = "10";
  const revisar = (cursor: string | null) =>
    revisarCambios({ cursor, lectura: falso.lectura, marcaOpsrun: async () => marca });
  return { falso, revisar, setMarca: (m: string) => (marca = m) };
}

describe("revisarCambios", () => {
  it("sin cursor: da uno y no hay cambio", async () => {
    const { revisar } = preparar();
    const r = await revisar(null);
    expect(r.cambio).toBe(false);
    expect(r.disponible).toBe(true);
    expect(r.cursor).toEqual(expect.any(String));
  });

  it("sin nada nuevo, no hay cambio", async () => {
    const { revisar } = preparar();
    const { cursor } = await revisar(null);
    expect((await revisar(cursor)).cambio).toBe(false);
  });

  it("un cambio en BzzzBX es cambio, aunque venga en varios lotes", async () => {
    const { falso, revisar } = preparar();
    const { cursor } = await revisar(null);
    for (const id of ["bx-job-0003", "bx-job-0004", "bx-job-0005"]) falso.lectura.cambiar("job", id, { po_number: "PO-X" });
    const r = await revisar(cursor);
    expect(r.cambio).toBe(true);
    expect((await revisar(r.cursor)).cambio).toBe(false);
  });

  it("una escritura en opsRUN es cambio", async () => {
    const { revisar, setMarca } = preparar();
    const { cursor } = await revisar(null);
    setMarca("11");
    const r = await revisar(cursor);
    expect(r.cambio).toBe(true);
    expect((await revisar(r.cursor)).cambio).toBe(false);
  });

  it("cursor caducado por reconstrucción: cambio y cursor nuevo", async () => {
    const { falso, revisar } = preparar();
    const { cursor } = await revisar(null);
    falso.lectura.reconstruir();
    const r = await revisar(cursor);
    expect(r.cambio).toBe(true);
    expect((await revisar(r.cursor)).cambio).toBe(false);
  });

  it("BzzzBX caído: no disponible, y cambio cuando cae y cuando vuelve", async () => {
    const { falso, revisar } = preparar();
    const inicial = await revisar(null);
    falso.lectura.noDisponible(true);
    const cae = await revisar(inicial.cursor);
    expect(cae).toMatchObject({ disponible: false, cambio: true });
    const sigue = await revisar(cae.cursor);
    expect(sigue).toMatchObject({ disponible: false, cambio: false });
    falso.lectura.noDisponible(false);
    const vuelve = await revisar(sigue.cursor);
    expect(vuelve).toMatchObject({ disponible: true, cambio: true });
  });

  it("un cursor que no es nuestro se trata como uno caducado", async () => {
    const { revisar } = preparar();
    const r = await revisar("no-es-un-cursor");
    expect(r.cambio).toBe(true);
    expect((await revisar(r.cursor)).cambio).toBe(false);
  });
});
