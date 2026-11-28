/**
 * Qué plantillas se ofrecen y qué avisos se ven para un job (spec OPR-18 §5.1 y §8.1). Pura: recibe las filas activas
 * de `message_template`, la etapa, la disponibilidad de los modos y lo ya leído, y arma la vista. No lee ni escribe
 * nada, y ninguna plantilla es un envío: elegir una solo llena la caja del Composer.
 *
 * El catálogo (`catalogo.ts`) decide qué se ofrece; la base solo dice qué existe y su texto.
 */
import type { DisponibilidadDelModo } from "../conversacion/composer";
import type { ModoComposer } from "../conversacion/tipos";

import { CATALOGO, CLAVES, esClave, type CanalDePlantilla, type ClaveDePlantilla, type EntradaDeCatalogo, type ModoConPlantillas } from "./catalogo";
import { llenarPlantilla } from "./llenar";
import { valoresDelJob, type FuenteDeValores } from "./valores";

/** Una fila activa de `opsrun.message_template`. */
export type FilaDePlantilla = {
  key: string;
  version: number;
  channel: string;
  subject: string | null;
  body: string;
};

export type PlantillaOfrecida = {
  clave: ClaveDePlantilla;
  version: number;
  nombre: string;
  canal: CanalDePlantilla;
  /** El texto ya llenado con lo del job; los placeholders sin dato quedan literales. */
  texto: string;
  /** Los `{{…}}` que quedaron sin llenar. */
  faltan: string[];
};

export type AvisoDelJob = Omit<PlantillaOfrecida, "texto"> & {
  /** La vista previa; null si no se puede armar (`sinTexto` dice por qué). */
  texto: string | null;
  /** `bzzzbx`: sin lectura previa; `propiedad`: BzzzBX no conoce la propiedad ("Check the property"). */
  sinTexto: "bzzzbx" | "propiedad" | null;
};

export type PlantillasDelJob = {
  customer: PlantillaOfrecida[];
  cleaner: PlantillaOfrecida[];
  avisos: AvisoDelJob[];
};

export type EntradaDePlantillas = {
  filas: FilaDePlantilla[];
  /** La etapa de la Job window (`EtapaVentana`: las cinco y `cancelled`). */
  etapa: string;
  modos: Record<ModoComposer, DisponibilidadDelModo>;
  /** Lo leído para llenar; null si BzzzBX nunca respondió para esta request. */
  fuente: FuenteDeValores | null;
};

/** La fila activa de cada clave del catálogo, con el canal que el catálogo dice; la versión más alta si hubiera dos. */
function filasDelCatalogo(filas: FilaDePlantilla[]): Map<ClaveDePlantilla, FilaDePlantilla> {
  const por = new Map<ClaveDePlantilla, FilaDePlantilla>();
  for (const f of filas) {
    if (!esClave(f.key) || f.channel !== CATALOGO[f.key].canal) continue;
    const previa = por.get(f.key);
    if (!previa || f.version > previa.version) por.set(f.key, f);
  }
  return por;
}

export function plantillasDelJob({ filas, etapa, modos, fuente }: EntradaDePlantillas): PlantillasDelJob {
  const activas = filasDelCatalogo(filas);
  // Una de texto lleva la ventana con guion ASCII (S-11): se arman los valores por canal.
  const valoresPorCanal = fuente ? { email: valoresDelJob(fuente, "email"), text: valoresDelJob(fuente, "text") } : null;
  const salida: PlantillasDelJob = { customer: [], cleaner: [], avisos: [] };

  for (const clave of CLAVES) {
    const fila = activas.get(clave);
    if (!fila) continue;
    const c: EntradaDeCatalogo = CATALOGO[clave];
    const base = { clave, version: fila.version, nombre: c.nombre, canal: c.canal };
    const valores = valoresPorCanal ? valoresPorCanal[c.canal] : null;

    const enComposer = c.composer;
    if (enComposer && (enComposer.etapas as readonly string[]).includes(etapa) && modos[enComposer.modo].disponible && valores) {
      const modo: ModoConPlantillas = enComposer.modo;
      const llena = llenarPlantilla(fila.body, valores, c.aMano);
      salida[modo].push({ ...base, texto: llena.texto, faltan: llena.faltan });
    }

    if ((c.avisoEn as readonly string[]).includes(etapa)) {
      if (!valores) {
        salida.avisos.push({ ...base, texto: null, faltan: [], sinTexto: "bzzzbx" });
      } else {
        const llena = llenarPlantilla(fila.body, valores, c.aMano);
        // La vista previa dice "Check the property" en lugar de un texto con {{property}} sin llenar (§5.3).
        const sinPropiedad = llena.faltan.includes("{{property}}");
        salida.avisos.push({
          ...base,
          texto: sinPropiedad ? null : llena.texto,
          faltan: llena.faltan,
          sinTexto: sinPropiedad ? "propiedad" : null,
        });
      }
    }
  }
  return salida;
}
