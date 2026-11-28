/**
 * Llenar una plantilla (spec OPR-18 §4.3 y §8.1). Pura: una sola pasada sobre el texto de la plantilla (un valor que
 * contiene `{{date}}` no se vuelve a expandir), los valores entran como texto plano (nunca como patrón de reemplazo),
 * y lo que no tiene valor queda literal y se reporta en `faltan`. La usarán también Ask cleaner, Reschedule, Cancel
 * job y los avisos de la Fase B.
 */
import type { Placeholder } from "./catalogo";

export type ValoresDePlantilla = Partial<Record<Placeholder, string | undefined>>;

export type PlantillaLlena = {
  texto: string;
  /** Los placeholders que quedaron sin llenar, tal cual se ven (`{{date}}`), en orden y sin repetir. */
  faltan: string[];
};

/**
 * Los `{{nombre}}` que quedan en un texto, en orden y sin repetir: lo que el Composer pide llenar antes de enviar.
 * El mismo patrón que la base rechaza con OP056 (`\{\{[a-z_]+\}\}`).
 */
export function placeholdersSinLlenar(texto: string): string[] {
  return [...new Set(texto.match(/\{\{[a-z_]+\}\}/g) ?? [])];
}

/** Un `{{nombre}}` con el espacio que lo precede, por si el valor es vacío y hay que colapsarlo. */
const PLACEHOLDER = /(\s?)\{\{([a-z_]+)\}\}/g;

/**
 * @param aMano placeholders que no se llenan aunque haya valor (los que el operador escribe).
 */
export function llenarPlantilla(cuerpo: string, valores: ValoresDePlantilla, aMano: readonly Placeholder[] = []): PlantillaLlena {
  const faltan: string[] = [];
  const texto = cuerpo.replace(PLACEHOLDER, (completo: string, espacio: string, nombre: string) => {
    const valor = Object.hasOwn(valores, nombre) ? valores[nombre as Placeholder] : undefined;
    if (typeof valor !== "string" || (aMano as readonly string[]).includes(nombre)) {
      const literal = `{{${nombre}}}`;
      if (!faltan.includes(literal)) faltan.push(literal);
      return completo;
    }
    // Vacío: se va también el espacio que lo precedía, para no dejar uno doble.
    return valor === "" ? "" : `${espacio}${valor}`;
  });
  return { texto, faltan };
}
