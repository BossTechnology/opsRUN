/**
 * Qué implementación de BzzzBX usa el proceso (spec OPR-22 §5.1). La regla
 * vive en `src/lib/db/entorno.ts`, junto con el resto de la configuración del
 * servidor, para que el deploy (`scripts/verificar-entorno.mjs`) la aplique
 * igual que el arranque.
 */
export { modoBzzzbx, problemasBzzzbx, type ModoBzzzbx } from "../db/entorno";
