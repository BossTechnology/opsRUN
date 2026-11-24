# opsRUN

Consola de operaciones para los equipos de Operations y Finance de PINCH (V1.1 beta). Next.js sobre el Supabase de la caja, con conexión directa a Postgres; toda lectura y toda acción del negocio pasan por BzzzBX.

- [`PLAN.md`](PLAN.md): principios, stack, entornos y el orden de las tarjetas.
- [`CONTEXT.md`](CONTEXT.md): glosario del dominio.
- [`ESTADO.md`](ESTADO.md): en qué va el trabajo.
- [`docs/adr/`](docs/adr/): decisiones de arquitectura.

El detalle de cada entrega vive en el proyecto OPR de Relevo.

## Levantar todo en local

Requisitos: Node 22 (`.nvmrc`), pnpm (la versión exacta está en `package.json`, `packageManager`) y Docker corriendo, con unos 10 GB libres para las imágenes de Supabase.

```bash
pnpm install
```

```bash
pnpm local
```

`pnpm local` hace cuatro cosas:
1. levanta Supabase local en Docker;
2. imita el alta de opsRUN en Bzzz (`supabase/alta-local.sql`);
3. aplica las migraciones pendientes como `opsrun_migrador`;
4. levanta la app en http://localhost:3000.

La página de inicio muestra si la app llega a su base y qué migración tiene aplicada.

No hace falta ningún archivo `.env`: el script lee la URL de la base del Supabase local con `supabase status` y le pasa a Next la conexión como `opsrun_app` en memoria. Las claves de `opsrun_app` y `opsrun_migrador` son locales y están en `supabase/alta-local.sql`. La CLI de Supabase viene como dependencia del proyecto, no hay que instalarla aparte.

Supabase local usa los puertos 58320 a 58329 (API en 58321, Postgres en 58322, Studio en 58323), para no chocar con otros proyectos de Supabase en la misma máquina.

### Otros comandos

| Comando | Qué hace |
|---|---|
| `pnpm db:start` / `pnpm db:stop` | Levanta (con el alta local y las migraciones) o apaga solo Supabase local |
| `pnpm db:prepare` | Corre el alta local y aplica las migraciones pendientes sobre el Supabase local que ya está arriba |
| `pnpm db:reset` | Borra la base local y la vuelve a crear: alta local y migraciones |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Tipos de rutas de Next y `tsc --noEmit` |
| `pnpm test` | Tests con Vitest (`src/**/*.test.ts(x)`). Las pruebas del pool contra Postgres corren si Supabase local está arriba |
| `pnpm test:db` | Alta local, migraciones y tests de base con pgTAP (`supabase test db`, `supabase/tests/`) |
| `pnpm test:e2e` | E2E con Playwright contra el build de producción y el Supabase local (necesita `pnpm db:start`) |

La primera vez que corras los E2E, instala el navegador:

```bash
pnpm exec playwright install chromium
```

## Base de datos

opsRUN vive en el Supabase de la caja, en sus esquemas `opsrun`, `opsrun_private` y `opsrun_writeback` ([ADR 0003](docs/adr/0003-supabase-de-la-caja.md)). Nada en `public`. Usa tres roles:

| Rol | Qué es |
|---|---|
| `opsrun_migrador` | Dueño de los esquemas de opsRUN. Aplica las migraciones; una conexión a la vez |
| `opsrun_app` | El servidor de Next (`src/lib/db/`). Solo entra a `opsrun` |
| `bzzz_writeback_opsrun` | La caja leyendo el write-back. Lo que puede leer lo concede OPR-20 |

Los esquemas y los roles los crea el alta de opsRUN en Bzzz, no las migraciones. En local y en CI los crea `supabase/alta-local.sql`, que solo existe para imitar ese alta.

Todo cambio va en una migración nueva en `supabase/migrations/`, con nombre `<AAAAMMDDhhmmss>_<nombre>.sql`. Las migraciones:
- corren como `opsrun_migrador` (`scripts/migrar.mjs`), cada una en su transacción;
- llevan la cuenta en `opsrun.schema_migration`;
- solo crean objetos dentro de los esquemas de opsRUN y conceden sobre ellos.

La CLI de Supabase no las aplica (`supabase/config.toml`). Nunca se editan tablas desde el Studio. Si existe `supabase/seed.sql` (solo datos inventados), `pnpm db:reset` lo carga como `opsrun_migrador` después de las migraciones.

Si tu base local es de antes de la conexión directa (tiene `public.opsrun_health()`), `pnpm local` te pide `pnpm db:reset` una vez.

Los guards de `supabase/tests/database/` descubren en vez de enumerar: "de opsRUN" es todo esquema `opsrun` u `opsrun_*` y todo rol `opsrun_*`, y el dueño es el del esquema `opsrun`. Cada uno rompe su regla a propósito en cada corrida y comprueba que la detecta.

| Archivo | Qué comprueba |
|---|---|
| `rls.test.sql` | Toda tabla de opsRUN tiene RLS (G1). Todos los esquemas son del mismo dueño. `anon`, `authenticated` y `service_role` no entran. Ningún rol de opsRUN es dueño de nada fuera de sus esquemas |
| `roles.test.sql` | Ningún rol de opsRUN es superusuario, salta RLS, crea roles o bases, ni pertenece a otro rol. No tiene CREATE en la base ni alcanza nada fuera de sus esquemas que PUBLIC no alcance (`public`, `auth`, `storage`, las demás vecinas). `opsrun_app` entra solo a `opsrun` |
| `salud.test.sql` | `opsrun.opsrun_health()` responde y solo la ejecuta `opsrun_app` |

## CI

GitHub Actions (`.github/workflows/ci.yml`) corre en cada PR y en `main`:
- lint, typecheck y Vitest;
- `pnpm test:db`: alta local, migraciones y pgTAP;
- contra un Supabase local con Postgres y GoTrue: el alta local y las migraciones, Vitest con las pruebas del pool contra Postgres (fallan si la base no responde) y Playwright.

## Despliegue

Staging y producción corren en el servidor de PINCH y todavía no están montados (OPR-1, espera el acceso de red de OPR-6). Producción la ejecuta Henry.
