/**
 * Servir la imagen de una foto del Job tracker (spec OPR-30 §4.2 y §7.3). La
 * ruta `GET /api/fotos/[id]?request=<uuid>` exige que la foto sea de un job
 * enlazado a una request de opsRUN: busca el job de esa request, lista sus fotos
 * en el puerto de BzzzBX y pide la imagen por su `ref`. La imagen no se guarda ni
 * se cachea (S-4, P-8) y el navegador nunca habla con BzzzBX. Esta función nunca
 * escribe en la base: solo lee el job de la request.
 *
 * Sin login todavía (OPR-21), como el resto de la ventana: con
 * `OPSRUN_SERVIDOR=1` pasará a exigir la sesión cuando llegue.
 */
import { esNoDisponible } from "../bzzzbx/errores";
import type { LecturaBzzzbx } from "../bzzzbx/puertos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Un crosswalk ID de foto razonable; lo que no, es 404 sin tocar nada. */
const ID_DE_FOTO = /^[A-Za-z0-9_.-]{1,120}$/;
/** Solo se sirven imágenes: BzzzBX no puede hacer que esta ruta entregue otra cosa. */
const TIPO_DE_IMAGEN = /^image\/(png|jpeg|webp|gif|svg\+xml)$/;

export type RespuestaDeFoto =
  | { estado: 200; contentType: string; bytes: Uint8Array }
  | { estado: 404 | 503 };

export type DependenciasDeFoto = {
  /** `request.bzzzbx_job_id` de la request; null si no existe o todavía no tiene job. Solo lee. */
  jobDeLaRequest: (requestId: string) => Promise<string | null>;
  lectura: LecturaBzzzbx;
};

export async function servirFoto(
  { fotoId, requestId }: { fotoId: string; requestId: string | null },
  deps: DependenciasDeFoto,
): Promise<RespuestaDeFoto> {
  if (!requestId || !UUID.test(requestId) || !ID_DE_FOTO.test(fotoId)) return { estado: 404 };

  const jobId = await deps.jobDeLaRequest(requestId);
  if (!jobId) return { estado: 404 };

  try {
    // La foto tiene que ser de ESE job: una foto de otro job o de una request ajena no se sirve.
    const fotos = await deps.lectura.listarPor("photo", { bzzzbx_job_id: jobId });
    const foto = fotos.find((f) => f.bzzzbx_photo_id === fotoId && f.bzzzbx_job_id === jobId);
    if (!foto) return { estado: 404 };
    const imagen = await deps.lectura.leerFoto(foto.ref);
    if (!imagen || imagen.bytes.length === 0 || !TIPO_DE_IMAGEN.test(imagen.contentType)) return { estado: 404 };
    return { estado: 200, contentType: imagen.contentType, bytes: imagen.bytes };
  } catch (e) {
    if (esNoDisponible(e)) return { estado: 503 };
    throw e;
  }
}
