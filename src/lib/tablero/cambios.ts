/**
 * ¿Cambió algo del tablero? (spec OPR-25 §4). Junta el aviso de cambios del
 * puerto de BzzzBX (`cambiosDesde`) con una marca de opsRUN (el último Audit:
 * toda escritura de opsRUN deja uno). Solo dice si hubo cambio; nunca datos.
 */
import { BzzzbxNoDisponible, CursorCaducado } from "../bzzzbx/errores";
import type { LecturaBzzzbx } from "../bzzzbx/puertos";
import type { Cursor } from "../bzzzbx/tipos";

/** Lo que guarda el cursor del tablero: el del puerto, la marca de opsRUN y si BzzzBX respondía. */
type Estado = { b: Cursor | null; o: string; d: boolean };

export type Revision = { cambio: boolean; cursor: string; disponible: boolean };

const codificar = (e: Estado) => Buffer.from(JSON.stringify(e)).toString("base64url");

function decodificar(cursor: string): Estado | null {
  try {
    const e = JSON.parse(Buffer.from(cursor, "base64url").toString()) as Partial<Estado>;
    if (typeof e.o !== "string" || typeof e.d !== "boolean" || !(e.b === null || typeof e.b === "string")) return null;
    return { b: e.b as Cursor | null, o: e.o, d: e.d };
  } catch {
    return null;
  }
}

export async function revisarCambios({
  cursor,
  lectura,
  marcaOpsrun,
}: {
  cursor: string | null;
  lectura: LecturaBzzzbx;
  marcaOpsrun: () => Promise<string>;
}): Promise<Revision> {
  const marca = await marcaOpsrun();
  const previo = cursor === null ? null : decodificar(cursor);
  // Un cursor ajeno o roto vale como caducado: se relee todo.
  const forzado = cursor !== null && previo === null;

  try {
    let cambioBzzzbx = false;
    let b: Cursor;
    if (!previo?.b) {
      b = (await lectura.cambiosDesde(null)).cursor;
      cambioBzzzbx = previo !== null; // venía sin cursor del puerto porque estaba caído
    } else {
      try {
        let lote = await lectura.cambiosDesde(previo.b);
        cambioBzzzbx = lote.cambios.length > 0;
        while (lote.hay_mas) {
          lote = await lectura.cambiosDesde(lote.cursor);
          cambioBzzzbx ||= lote.cambios.length > 0;
        }
        b = lote.cursor;
      } catch (e) {
        if (!(e instanceof CursorCaducado)) throw e;
        b = (await lectura.cambiosDesde(null)).cursor;
        cambioBzzzbx = true;
      }
    }
    const cambio = forzado || cambioBzzzbx || (previo !== null && (previo.o !== marca || !previo.d));
    return { cambio, disponible: true, cursor: codificar({ b, o: marca, d: true }) };
  } catch (e) {
    if (!(e instanceof BzzzbxNoDisponible)) throw e;
    const cambio = forzado || (previo !== null && (previo.o !== marca || previo.d));
    return { cambio, disponible: false, cursor: codificar({ b: previo?.b ?? null, o: marca, d: false }) };
  }
}
