# ESTADO.md

> Actualizar al cerrar cada sesión. Es lo primero que lee la siguiente.

## Tarea actual
- Base de documentos del repo. Sin código todavía.

## Hecho
- 2026-11-24: base de documentos creada a partir de las 43 tarjetas del proyecto OPR en Relevo: `CLAUDE.md`, `PLAN.md`, `CONTEXT.md`, `ESTADO.md`, `CHANGELOG.md`, `README.md`, `.gitignore` y `docs/adr/`. Sin commit.

## Pendiente
- `.env.example`: lo crea Henry. Los permisos del agente bloquean cualquier archivo `.env*`. Los nombres de las variables están en `PLAN.md` §3.
- Primer commit en `main` (el repo está vacío) y protección de rama.
- Leer el Release Definition, el User Guide y el prototipo R23 cuando estén en Relevo; ninguna tarjeta los tiene adjuntos todavía.
- Confirmar con Federico las dependencias de `PLAN.md` §5.
- Confirmar el stack de tests (Vitest, pgTAP, Playwright) en OPR-1.

## Bloqueado
- OPR-6 (contrato de BzzzBX): bloquea casi todo P1, incluido el despliegue de OPR-1.
- OPR-2 (método de login): bloquea OPR-21 y, por ella, OPR-23.

## Siguiente paso
- OPR-1, parte local: proyecto Next.js, Supabase local, lint, typecheck, tests y CI, en la rama `opr-1-repo-y-servidor`. Después, OPR-20 (modelo de datos) en local.
