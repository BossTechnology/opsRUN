// @vitest-environment node
/**
 * Los mismos contratos que pasa el falso, contra la implementación real
 * (spec OPR-22 §7). Se encienden con BZZZBX_CONTRATO_REAL=1 en el laboratorio
 * o en staging, nunca en CI. Hasta que exista OPR-6, encenderlas falla a
 * propósito: así nadie cree que el real está probado.
 *
 * Al llegar OPR-6: `entornoReal` arma los puertos con `crearBzzzbx` en modo
 * real y toma los IDs conocidos y la instrucción de prueba de los datos de
 * prueba del laboratorio (por variables de entorno, nunca en el repo).
 */
import { describe } from "vitest";

import { probarContratoDeIa, type EntornoDeIa } from "./contrato/ia.contrato";
import { probarContratoDeInstrucciones, type EntornoDeInstrucciones } from "./contrato/instrucciones.contrato";
import { probarContratoDeLectura, type EntornoDeLectura } from "./contrato/lectura.contrato";

const activo = process.env.BZZZBX_CONTRATO_REAL === "1";

function entornoReal(): never {
  throw new Error("El contrato real de BzzzBX (OPR-6) no existe todavía: no hay contra qué correr estas pruebas.");
}

describe.skipIf(!activo)("BzzzBX real", () => {
  probarContratoDeLectura("real", async (): Promise<EntornoDeLectura> => entornoReal());
  probarContratoDeInstrucciones("real", async (): Promise<EntornoDeInstrucciones> => entornoReal());
  probarContratoDeIa("real", async (): Promise<EntornoDeIa> => entornoReal());
});
