/**
 * Errores del puerto de BzzzBX (spec OPR-22 §3.2 y §4.2). Las capas de arriba
 * deciden qué hacer con cada uno; el puerto solo los distingue.
 */

/** BzzzBX no respondió o tardó más que el límite. Nada se entregó ni se leyó. */
export class BzzzbxNoDisponible extends Error {
  constructor(mensaje = "BzzzBX no está disponible") {
    super(mensaje);
    this.name = "BzzzbxNoDisponible";
  }
}

/** El cursor ya no sirve (por ejemplo, se reconstruyó una proyección). Se relee todo. */
export class CursorCaducado extends Error {
  constructor(mensaje = "El cursor ya no es válido; vuelve a leer y pide uno nuevo") {
    super(mensaje);
    this.name = "CursorCaducado";
  }
}

/** BzzzBX rechazó la instrucción al recibirla. Es definitivo para esa clave. */
export class InstruccionRechazada extends Error {
  constructor(
    readonly error_code: string,
    readonly error_message: string,
  ) {
    super(`${error_code}: ${error_message}`);
    this.name = "InstruccionRechazada";
  }
}

/** El filtro de una búsqueda no es válido (por ejemplo, `buscarJobs` sin cliente ni propiedad). No se leyó nada. */
export class FiltroInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "FiltroInvalido";
  }
}

/**
 * Next empaqueta por separado rutas y páginas, y el falso es una sola
 * instancia por proceso: puede lanzar la clase de otra copia de este módulo y
 * `instanceof` falla. Por eso se reconocen por el nombre.
 */
const conNombre = (e: unknown, nombre: string) => e instanceof Error && e.name === nombre;

export const esNoDisponible = (e: unknown): boolean => conNombre(e, "BzzzbxNoDisponible");
export const esCursorCaducado = (e: unknown): boolean => conNombre(e, "CursorCaducado");
export const esInstruccionRechazada = (e: unknown): boolean => conNombre(e, "InstruccionRechazada");
