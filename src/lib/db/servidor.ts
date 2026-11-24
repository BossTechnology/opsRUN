import "server-only";

/**
 * Lo que el código de la app usa para llegar a la base. `server-only` impide
 * importarlo desde un componente de cliente: la conexión y su login viven solo
 * en el servidor de Next.
 */
export { comoOpsrunApp } from "./pool";
