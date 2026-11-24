import type { Salud } from "@/lib/salud";

/**
 * Muestra la salud de la base. Recibe la salud ya leída.
 * El detalle del error no se muestra: puede nombrar hosts internos. Va al log.
 */
export function TarjetaSalud({ salud }: { salud: Salud }) {
  return (
    <section className="salud" aria-label="Database status">
      <dl>
        <dt>Database</dt>
        <dd data-testid="estado-base" className={salud.conectada ? "ok" : "error"}>
          {salud.conectada ? "Connected" : "Not connected"}
        </dd>
        {salud.conectada ? (
          <>
            <dt>Schema version</dt>
            <dd data-testid="version-esquema">{salud.versionEsquema ?? "No migrations"}</dd>
          </>
        ) : (
          <>
            <dt>Details</dt>
            <dd>See the server logs.</dd>
          </>
        )}
      </dl>
    </section>
  );
}
