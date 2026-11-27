/**
 * Un cliente falso de `pg` para las pruebas, que hace fallar lo que `pg` solo
 * avisa: una consulta que llega mientras otra del mismo cliente sigue en curso
 * (`client.query() when the client is already executing a query is deprecated`).
 * Con un `Promise.all` de consultas sobre el mismo cliente o transacción, la
 * segunda consulta lanza al instante.
 */
import type { Tx } from "./pool";

export type ClienteSecuencial = {
  db: Tx;
  /** La primera línea de cada consulta que llegó, en orden. */
  consultas: string[];
};

export function crearClienteSecuencial(
  responder: (sql: string, valores: unknown[]) => unknown[] = () => [],
): ClienteSecuencial {
  let enCurso: string | null = null;
  const consultas: string[] = [];
  const db = {
    async query(sql: string, valores: unknown[] = []) {
      const primeraLinea = sql.trim().split("\n")[0];
      if (enCurso !== null) {
        throw new Error(
          `consulta concurrente sobre el mismo cliente: llegó «${primeraLinea}» mientras seguía en curso «${enCurso}»`,
        );
      }
      enCurso = primeraLinea;
      consultas.push(primeraLinea);
      try {
        // Cede el turno como lo haría la red: una consulta concurrente llega aquí.
        await new Promise((resolver) => setImmediate(resolver));
        return { rows: responder(sql, valores) };
      } finally {
        enCurso = null;
      }
    },
  };
  return { db: db as unknown as Tx, consultas };
}
