// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  ARCHIVO_SECRETOS,
  asegurarEntorno,
  destinoBase,
  leerArchivoEnv,
  problemasDeEntorno,
  PROHIBIDAS_EN_SERVIDOR,
  urlGoTrue,
} from "./entorno";

const SECRETOS = "OPSRUN_APP_USUARIO=opsrun_app\nOPSRUN_APP_CLAVE=clave-de-prueba\n";
const lectorCon = (texto: string) => (ruta: string) => {
  if (ruta !== ARCHIVO_SECRETOS) throw new Error(`ruta inesperada: ${ruta}`);
  return texto;
};
const sinArchivo = () => {
  throw new Error("ENOENT");
};

const SERVIDOR_COMPLETO = {
  OPSRUN_SERVIDOR: "1",
  OPSRUN_DB_HOST: "db.ejemplo.test",
  OPSRUN_GOTRUE_URL: "http://auth.ejemplo.test:9999/",
};

describe("destinoBase fuera del servidor", () => {
  it("usa OPSRUN_DATABASE_URL", () => {
    expect(destinoBase({ OPSRUN_DATABASE_URL: " postgresql://opsrun_app:x@127.0.0.1:58322/postgres " })).toEqual({
      tipo: "url",
      url: "postgresql://opsrun_app:x@127.0.0.1:58322/postgres",
    });
  });

  it("dice cómo levantar todo si falta", () => {
    expect(() => destinoBase({})).toThrow("pnpm local");
  });
});

describe("destinoBase en el servidor", () => {
  it("toma host, puerto y base del entorno y el login del archivo de secretos", () => {
    expect(
      destinoBase({ ...SERVIDOR_COMPLETO, OPSRUN_DB_PORT: "6543", OPSRUN_DB_NAME: "opsrun" }, lectorCon(SECRETOS)),
    ).toEqual({
      tipo: "parametros",
      host: "db.ejemplo.test",
      puerto: 6543,
      base: "opsrun",
      usuario: "opsrun_app",
      clave: "clave-de-prueba",
    });
  });

  it("usa 5432 y postgres por defecto", () => {
    expect(destinoBase(SERVIDOR_COMPLETO, lectorCon(SECRETOS))).toMatchObject({ puerto: 5432, base: "postgres" });
  });

  it("ignora OPSRUN_DATABASE_URL", () => {
    expect(
      destinoBase({ ...SERVIDOR_COMPLETO, OPSRUN_DATABASE_URL: "postgresql://otro" }, lectorCon(SECRETOS)).tipo,
    ).toBe("parametros");
  });

  it("rechaza un puerto que no es puerto", () => {
    for (const puerto of ["abc", "0", "70000", "54.3"]) {
      expect(() =>
        destinoBase({ ...SERVIDOR_COMPLETO, OPSRUN_DB_PORT: puerto }, lectorCon(SECRETOS)),
      ).toThrow("OPSRUN_DB_PORT no es un puerto");
    }
  });

  it("falla si no puede leer el archivo de secretos, sin mostrar su contenido", () => {
    expect(() => destinoBase(SERVIDOR_COMPLETO, sinArchivo)).toThrow(
      `no se pudo leer el archivo de secretos ${ARCHIVO_SECRETOS}`,
    );
  });

  it("falla si el archivo no trae usuario y clave", () => {
    expect(() => destinoBase(SERVIDOR_COMPLETO, lectorCon("OPSRUN_APP_USUARIO=opsrun_app"))).toThrow(
      "no trae OPSRUN_APP_USUARIO y OPSRUN_APP_CLAVE",
    );
  });

  it("lee el archivo de secretos de OPSRUN_SECRETS_FILE si está", () => {
    const leidas: string[] = [];
    destinoBase({ ...SERVIDOR_COMPLETO, OPSRUN_SECRETS_FILE: "/otra/ruta.env" }, (ruta) => {
      leidas.push(ruta);
      return SECRETOS;
    });
    expect(leidas).toEqual(["/otra/ruta.env"]);
  });
});

describe("leerArchivoEnv", () => {
  it("ignora comentarios y líneas vacías, quita comillas y export", () => {
    expect(leerArchivoEnv('# comentario\n\nexport A=1\nB="dos"\nC=\'tres\'\nsin_igual\n=vacia\n')).toEqual({
      A: "1",
      B: "dos",
      C: "tres",
    });
  });
});

describe("urlGoTrue", () => {
  it("es opcional fuera del servidor", () => {
    expect(urlGoTrue({})).toBeNull();
  });

  it("es obligatoria en el servidor", () => {
    expect(() => urlGoTrue({ OPSRUN_SERVIDOR: "1" })).toThrow("OPSRUN_GOTRUE_URL no está definida");
  });

  it("quita la barra final", () => {
    expect(urlGoTrue({ OPSRUN_GOTRUE_URL: "http://127.0.0.1:58321/auth/v1/" })).toBe(
      "http://127.0.0.1:58321/auth/v1",
    );
  });

  it("rechaza lo que no es una URL http(s) limpia", () => {
    for (const url of ["no es url", "ftp://auth.ejemplo.test", "http://user:clave@auth.ejemplo.test", "http://auth.ejemplo.test/?a=1"]) {
      expect(() => urlGoTrue({ OPSRUN_GOTRUE_URL: url })).toThrow("OPSRUN_GOTRUE_URL");
    }
  });
});

describe("asegurarEntorno", () => {
  it("no revisa nada fuera del servidor", () => {
    expect(() => asegurarEntorno({})).not.toThrow();
  });

  it("deja arrancar con todo en orden", () => {
    expect(problemasDeEntorno(SERVIDOR_COMPLETO, lectorCon(SECRETOS))).toEqual([]);
    expect(() => asegurarEntorno(SERVIDOR_COMPLETO, lectorCon(SECRETOS))).not.toThrow();
  });

  it("nombra cada variable prohibida, nunca su valor", () => {
    const env: Record<string, string> = { ...SERVIDOR_COMPLETO };
    for (const nombre of PROHIBIDAS_EN_SERVIDOR) env[nombre] = `valor-secreto-${nombre}`;
    const problemas = problemasDeEntorno(env, lectorCon(SECRETOS));
    for (const nombre of PROHIBIDAS_EN_SERVIDOR) {
      expect(problemas).toContain(`${nombre} no debe estar en el servidor`);
    }
    expect(problemas.join(" ")).not.toContain("valor-secreto");
  });

  it("OPSRUN_ACTOR_DEMO es una variable prohibida y con ella el servidor no arranca (OPR-26, P-2)", () => {
    expect(PROHIBIDAS_EN_SERVIDOR).toContain("OPSRUN_ACTOR_DEMO");
    const env = { ...SERVIDOR_COMPLETO, OPSRUN_ACTOR_DEMO: "1" };
    expect(problemasDeEntorno(env, lectorCon(SECRETOS))).toEqual(["OPSRUN_ACTOR_DEMO no debe estar en el servidor"]);
    expect(() => asegurarEntorno(env, lectorCon(SECRETOS))).toThrow("OPSRUN_ACTOR_DEMO no debe estar en el servidor");
  });

  it("no deja arrancar con el stand-in de BzzzBX (OPR-22)", () => {
    const problemas = problemasDeEntorno({ ...SERVIDOR_COMPLETO, BZZZBX_MODO: "falso" }, lectorCon(SECRETOS));
    expect(problemas).toEqual(["BZZZBX_MODO=falso no se permite en el servidor"]);
  });

  it("junta todos los problemas en un solo error", () => {
    expect(() => asegurarEntorno({ OPSRUN_SERVIDOR: "1" }, sinArchivo)).toThrow(
      /OPSRUN_DB_HOST no está definida; OPSRUN_GOTRUE_URL no está definida/,
    );
  });
});
