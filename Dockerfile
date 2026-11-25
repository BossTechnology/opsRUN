# syntax=docker/dockerfile:1
#
# Imagen de producción de opsRUN (OPR-1). La misma imagen sirve en staging y en
# producción: todo lo del servidor se lee en tiempo de ejecución.
#
# - Next en modo standalone (next.config.ts): solo lo que el build trazó.
# - Node 22, usuario sin privilegios (opsrun, uid 10001), sin shell de login.
# - Sin secretos en la imagen ni en sus capas: no hay ARG ni ENV con
#   credenciales, y .dockerignore deja fuera .env*, llaves y .git. El login de
#   opsrun_app llega en un archivo montado (/run/secrets/opsrun/app.env, ver
#   src/lib/db/entorno.ts) y la conexión del migrador, en otro montado solo en
#   el contenedor que aplica migraciones.
# - Trae scripts/migrar.mjs y supabase/migrations: el deploy aplica las
#   migraciones de esta misma imagen, así que código y esquema van juntos.
#
# Construir: scripts/servidor/opsrun.sh construir (etiqueta opsrun:<sha>).

ARG NODE_IMAGEN=node:22.23.5-alpine3.24

# ── Dependencias y build ────────────────────────────────────────────────────
FROM ${NODE_IMAGEN} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# La versión de pnpm sale de packageManager en package.json.
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ── Ejecución ───────────────────────────────────────────────────────────────
FROM ${NODE_IMAGEN} AS app
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    OPSRUN_SERVIDOR=1 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

RUN addgroup -S -g 10001 opsrun \
 && adduser -S -D -H -u 10001 -G opsrun -s /sbin/nologin opsrun

# Todo de root y de solo lectura para el proceso; la app no escribe en /app.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Para el deploy: migraciones, prueba de humo y revisión del entorno.
COPY --from=build /app/scripts/migrar.mjs /app/scripts/humo.mjs /app/scripts/verificar-entorno.mjs ./scripts/
COPY --from=build /app/src/lib/db/entorno.ts ./src/lib/db/entorno.ts
COPY --from=build /app/supabase/migrations ./supabase/migrations
# Node carga entorno.ts quitándole los tipos; sin esto lo lee primero como
# CommonJS (el package.json de standalone no dice "type") y avisa en cada uso.
RUN printf '{ "type": "module" }\n' > ./src/package.json

ARG OPSRUN_REVISION=desconocida
LABEL org.opencontainers.image.title="opsRUN" \
      org.opencontainers.image.source="https://github.com/BossTechnology/opsRUN" \
      org.opencontainers.image.revision="${OPSRUN_REVISION}"

USER opsrun:opsrun
EXPOSE 3000

# opsrun.opsrun_health() por GET /api/salud, como opsrun_app.
HEALTHCHECK --interval=30s --timeout=8s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["node", "scripts/humo.mjs"]

CMD ["node", "server.js"]
