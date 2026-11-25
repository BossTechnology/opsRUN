// @vitest-environment node
/**
 * scripts/migrar.mjs abre y cierra la transacción de cada migración, así que
 * una migración no puede traer la suya. Lo que haya dentro del cuerpo de una
 * función o de un DO (entre $$) o en un comentario no cuenta: el `end;` de un
 * bloque plpgsql no cierra ninguna transacción.
 */
import { describe, expect, it } from "vitest";

import { controlaLaTransaccion } from "../../../scripts/migrar.mjs";

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
