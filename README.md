# opsRUN

Consola de operaciones para los equipos de Operations y Finance de PINCH (V1.1 beta). Next.js con Supabase autohospedado; toda lectura y toda acción pasan por BzzzBX.

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

`pnpm local` levanta Supabase local (Postgres, API y Studio en Docker, con las migraciones de `supabase/migrations/` aplicadas) y la app en http://localhost:3000. La página de inicio muestra si la app llega a su base y qué migración tiene aplicada.

No hace falta ningún archivo `.env`: el script lee las URLs y llaves del Supabase local con `supabase status` y se las pasa a Next en memoria. La CLI de Supabase viene como dependencia del proyecto, no hay que instalarla aparte.

Supabase local usa los puertos 58320 a 58329 (API en 58321, Postgres en 58322, Studio en 58323), para no chocar con otros proyectos de Supabase en la misma máquina.

### Otros comandos

| Comando | Qué hace |
|---|---|
| `pnpm db:start` / `pnpm db:stop` | Levanta o apaga solo Supabase local |
| `pnpm db:reset` | Borra la base local y la vuelve a crear desde las migraciones y el seed |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Tipos de rutas de Next y `tsc --noEmit` |
| `pnpm test` | Tests unitarios con Vitest (`src/**/*.test.ts(x)`) |
| `pnpm test:db` | Tests de base con pgTAP (`supabase test db`, `supabase/tests/`) |
| `pnpm test:e2e` | E2E con Playwright contra el build de producción y el Supabase local (necesita `pnpm db:start`) |

La primera vez que corras los E2E, instala el navegador:

```bash
pnpm exec playwright install chromium
```

## Base de datos

Todo cambio va en una migración nueva en `supabase/migrations/` (`pnpm exec supabase migration new <nombre>`). Nunca se editan tablas desde el Studio.

`supabase/tests/database/rls.test.sql` falla si una tabla a la que llegan `anon` o `authenticated` no tiene RLS activo. Descubre las tablas solas: no hay que registrarlas.

## CI

GitHub Actions (`.github/workflows/ci.yml`) corre en cada PR y en `main`: lint, typecheck y Vitest; `supabase test db`; y Playwright contra un Supabase local.

## Despliegue

Staging y producción corren en el servidor de PINCH y todavía no están montados (OPR-1, espera el acceso de red de OPR-6). Producción la ejecuta Henry.
