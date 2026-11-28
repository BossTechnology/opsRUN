/**
 * Configuración de la conexión a la base y a GoTrue, leída en tiempo de
 * ejecución (ADR 0003). Sigue el patrón de bob-web.
 *
 * Con OPSRUN_SERVIDOR=1 (staging y producción, al lado de la caja):
 * - el host de Postgres y la URL de GoTrue salen de variables sin NEXT_PUBLIC_;
 * - el login de opsrun_app sale de un archivo montado, nunca del entorno: una
 *   credencial en el entorno se lee desde la API de Docker;
 * - la service role, los secretos de JWT, la clave de Postgres y la URL con
 *   credencial no pueden estar. asegurarEntorno() no deja arrancar si están.
 *
 * Sin OPSRUN_SERVIDOR (local, CI), OPSRUN_DATABASE_URL es la conexión, como
 * opsrun_app. `pnpm local` y Playwright la arman desde `supabase status`.
 */
import { readFileSync } from "node:fs";


export class ErrorDeConfiguracion extends Error {}

type Entorno = Record<string, string | undefined>;
type Lector = (ruta: string) => string;

const leerArchivo: Lector = (ruta) => readFileSync(ruta, "utf8");

export const enServidor = (env: Entorno = process.env) => env.OPSRUN_SERVIDOR === "1";

export const ARCHIVO_SECRETOS = "/run/secrets/opsrun/app.env";

/** Solo nombres: lo que el servidor de opsRUN nunca debe tener. */
export const PROHIBIDAS_EN_SERVIDOR = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "JWT_SECRET",
  "GOTRUE_JWT_SECRET",
  "POSTGRES_PASSWORD",
  // Credenciales en el entorno: van en el archivo de secretos.
  "OPSRUN_DATABASE_URL",
  "OPSRUN_APP_CLAVE",
  // El dueño de los esquemas aplica migraciones; el servidor nunca lo es.
  "OPSRUN_MIGRADOR_URL",
  // Selector "Acting as" de la demo local (OPR-26, P-2): declara un actor sin
  // login. Solo existe en local; en el servidor ni siquiera puede estar definida.
  "OPSRUN_ACTOR_DEMO",
] as const;

/** Líneas CLAVE=VALOR; ignora vacías y comentarios; comillas opcionales. */
export function leerArchivoEnv(texto: string): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea || linea.startsWith("#")) continue;
    const igual = linea.indexOf("=");
    if (igual <= 0) continue;
    const clave = linea.slice(0, igual).replace(/^export\s+/, "").trim();
    let valor = linea.slice(igual + 1).trim();
    if (valor.length >= 2 && (valor[0] === '"' || valor[0] === "'") && valor.at(-1) === valor[0]) {
      valor = valor.slice(1, -1);
    }
    salida[clave] = valor;
  }
  return salida;
}

export function leerSecretos(env: Entorno = process.env, leer: Lector = leerArchivo) {
  const ruta = env.OPSRUN_SECRETS_FILE || ARCHIVO_SECRETOS;
  let texto: string;
  try {
    texto = leer(ruta);
  } catch {
    throw new ErrorDeConfiguracion(`no se pudo leer el archivo de secretos ${ruta}`);
  }
  const s = leerArchivoEnv(texto);
  if (!s.OPSRUN_APP_USUARIO || !s.OPSRUN_APP_CLAVE) {
    throw new ErrorDeConfiguracion(`${ruta} no trae OPSRUN_APP_USUARIO y OPSRUN_APP_CLAVE`);
  }
  return { usuario: s.OPSRUN_APP_USUARIO, clave: s.OPSRUN_APP_CLAVE };
}

export type DestinoBase =
  | { tipo: "url"; url: string }
  | { tipo: "parametros"; host: string; puerto: number; base: string; usuario: string; clave: string };

export function destinoBase(env: Entorno = process.env, leer: Lector = leerArchivo): DestinoBase {
  if (!enServidor(env)) {
    const url = env.OPSRUN_DATABASE_URL?.trim();
    if (!url) {
      throw new ErrorDeConfiguracion(
        "OPSRUN_DATABASE_URL no está definida. En local, levanta todo con `pnpm local`.",
      );
    }
    return { tipo: "url", url };
  }
  const host = env.OPSRUN_DB_HOST?.trim();
  if (!host) throw new ErrorDeConfiguracion("OPSRUN_DB_HOST no está definida");
  const textoPuerto = env.OPSRUN_DB_PORT?.trim() || "5432";
  const puerto = Number(textoPuerto);
  if (!/^\d+$/.test(textoPuerto) || puerto <= 0 || puerto > 65535) {
    throw new ErrorDeConfiguracion("OPSRUN_DB_PORT no es un puerto");
  }
  const { usuario, clave } = leerSecretos(env, leer);
  return { tipo: "parametros", host, puerto, base: env.OPSRUN_DB_NAME?.trim() || "postgres", usuario, clave };
}

/**
 * URL del GoTrue de la caja. Solo se lee y se valida: el login es de OPR-2 y
 * OPR-21. En la caja GoTrue sirve en su raíz; en local, detrás de Kong, en
 * /auth/v1. Obligatoria en el servidor; fuera, opcional.
 */
export function urlGoTrue(env: Entorno = process.env): string | null {
  const url = env.OPSRUN_GOTRUE_URL?.trim();
  if (!url) {
    if (enServidor(env)) throw new ErrorDeConfiguracion("OPSRUN_GOTRUE_URL no está definida");
    return null;
  }
  let valida: URL;
  try {
    valida = new URL(url);
  } catch {
    throw new ErrorDeConfiguracion("OPSRUN_GOTRUE_URL no es una URL");
  }
  if (valida.protocol !== "http:" && valida.protocol !== "https:") {
    throw new ErrorDeConfiguracion("OPSRUN_GOTRUE_URL no es http ni https");
  }
  if (valida.username || valida.password || valida.search || valida.hash) {
    throw new ErrorDeConfiguracion("OPSRUN_GOTRUE_URL no debe llevar credenciales, query ni fragmento");
  }
  return url.replace(/\/+$/, "");
}

/**
 * Qué implementación de BzzzBX usa el proceso (OPR-22, spec §5.1, supuesto
 * S-12). `BZZZBX_MODO` = `falso` | `real`: fuera del servidor el valor por
 * defecto es `falso`; en el servidor es `real`, y `falso` no deja arrancar.
 * Vive aquí, sin imports de otros archivos del proyecto: `scripts/verificar-entorno.mjs` carga este
 * archivo tal cual en el deploy.
 */
export type ModoBzzzbx = "falso" | "real";

export function modoBzzzbx(env: Entorno = process.env): ModoBzzzbx {
  const valor = env.BZZZBX_MODO?.trim();
  if (!valor) return enServidor(env) ? "real" : "falso";
  if (valor !== "falso" && valor !== "real") {
    throw new ErrorDeConfiguracion("BZZZBX_MODO debe ser falso o real");
  }
  return valor;
}

/** Problemas de configuración de BzzzBX, por nombre. Vacío: puede arrancar. */
export function problemasBzzzbx(env: Entorno = process.env): string[] {
  let modo: ModoBzzzbx;
  try {
    modo = modoBzzzbx(env);
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
  }
  if (modo === "falso" && enServidor(env)) return ["BZZZBX_MODO=falso no se permite en el servidor"];
  return [];
}

/**
 * La zona de la operación (OPR-29, P-6). Las horas que ve el operador y la hora
 * límite de Delayed ("1:00 PM") se leen en esa zona; con UTC en silencio el
 * "1:00 PM" engaña. En el servidor es obligatoria y tiene que ser una zona IANA
 * válida; fuera del servidor sigue cayendo a UTC con un aviso (`zonaDeLaOperacion`).
 */
export function problemasDeZona(env: Entorno = process.env): string[] {
  if (!enServidor(env)) return [];
  const zona = env.OPSRUN_ZONA_HORARIA?.trim();
  if (!zona) return ["OPSRUN_ZONA_HORARIA no está definida"];
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zona });
  } catch {
    return ["OPSRUN_ZONA_HORARIA no es una zona válida"];
  }
  return [];
}

/** Todos los problemas a la vez, por nombre y nunca por valor. Vacío: puede arrancar. */
export function problemasDeEntorno(env: Entorno = process.env, leer: Lector = leerArchivo): string[] {
  const problemas: string[] = [];
  if (enServidor(env)) {
    for (const nombre of PROHIBIDAS_EN_SERVIDOR) {
      if (env[nombre]) problemas.push(`${nombre} no debe estar en el servidor`);
    }
  }
  for (const revisar of [() => destinoBase(env, leer), () => urlGoTrue(env)]) {
    try {
      revisar();
    } catch (e) {
      problemas.push(e instanceof Error ? e.message : String(e));
    }
  }
  // OPR-22: el stand-in de BzzzBX no corre en el servidor.
  problemas.push(...problemasBzzzbx(env));
  // OPR-29 (P-6): la zona de la operación es obligatoria en el servidor.
  problemas.push(...problemasDeZona(env));
  return problemas;
}

/** En el servidor, no arranca con la configuración incompleta o con algo prohibido. */
export function asegurarEntorno(env: Entorno = process.env, leer: Lector = leerArchivo): void {
  if (!enServidor(env)) return;
  const problemas = problemasDeEntorno(env, leer);
  if (problemas.length > 0) {
    throw new ErrorDeConfiguracion(`opsRUN no arranca: ${problemas.join("; ")}`);
  }
}
