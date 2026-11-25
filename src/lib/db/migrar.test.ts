// @vitest-environment node
/**
 * scripts/migrar.mjs abre y cierra la transacción de cada migración, así que
 * una migración no puede traer la suya. Lo que haya dentro del cuerpo de una
 * función o de un DO (entre $$) o en un comentario no cuenta: el `end;` de un
 * bloque plpgsql no cierra ninguna transacción.
 */
import { describe, expect, it } from "vitest";

import { controlaLaTransaccion, urlDelMigrador } from "../../../scripts/migrar.mjs";

describe("controlaLaTransaccion", () => {
  it("detecta una migración que abre o cierra su transacción", () => {
    expect(controlaLaTransaccion("begin;\ncreate table t (id int);\ncommit;")).toBe(true);
    expect(controlaLaTransaccion("create table t (id int);\n  COMMIT ;")).toBe(true);
    expect(controlaLaTransaccion("start transaction;\nselect 1;")).toBe(true);
    expect(controlaLaTransaccion("select 1;\nend;")).toBe(true);
    expect(controlaLaTransaccion("select 1;\nrollback;")).toBe(true);
  });

  it("no cuenta el begin y el end de un cuerpo plpgsql", () => {
    const sql = `
create function f() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    begin
      perform 1;
    end;
  end if;
  return new;
end;
$$;

do $cuerpo$
begin
  perform 1;
end;
$cuerpo$;
`;
    expect(controlaLaTransaccion(sql)).toBe(false);
  });

  it("no cuenta lo que está en un comentario", () => {
    expect(controlaLaTransaccion("-- commit;\nselect 1;\n/* begin;\nend; */")).toBe(false);
  });

  it("sí cuenta un commit después de un cuerpo plpgsql", () => {
    expect(controlaLaTransaccion("create function f() returns int language sql as $$ select 1 $$;\ncommit;")).toBe(
      true,
    );
  });
});

describe("urlDelMigrador", () => {
  const nuncaLee = async () => {
    throw new Error("no debía leer");
  };

  it("prefiere OPSRUN_MIGRADOR_URL", async () => {
    expect(await urlDelMigrador({ OPSRUN_MIGRADOR_URL: "postgres://m@db.test/postgres" }, nuncaLee)).toBe(
      "postgres://m@db.test/postgres",
    );
  });

  it("lee la conexión del archivo de secretos del migrador", async () => {
    const leer = async (ruta: string) => {
      expect(ruta).toBe("/run/secrets/opsrun/migrador.env");
      return "# solo el deploy\nOPSRUN_MIGRADOR_URL=postgres://m:x@db.test:5432/postgres\n";
    };
    expect(await urlDelMigrador({ OPSRUN_MIGRADOR_SECRETS_FILE: "/run/secrets/opsrun/migrador.env" }, leer)).toBe(
      "postgres://m:x@db.test:5432/postgres",
    );
  });

  it("falla sin conexión, sin archivo o con un archivo sin la línea", async () => {
    await expect(urlDelMigrador({}, nuncaLee)).rejects.toThrow(/OPSRUN_MIGRADOR_SECRETS_FILE/);
    await expect(urlDelMigrador({ OPSRUN_MIGRADOR_SECRETS_FILE: "/no/existe" }, nuncaLee)).rejects.toThrow(
      /No se pudo leer/,
    );
    await expect(
      urlDelMigrador({ OPSRUN_MIGRADOR_SECRETS_FILE: "/m.env" }, async () => "OTRA=1\n"),
    ).rejects.toThrow(/no trae OPSRUN_MIGRADOR_URL/);
  });
});
