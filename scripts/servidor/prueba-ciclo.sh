#!/usr/bin/env bash
# SOLO LOCAL Y CI. Prueba el ciclo completo de scripts/servidor/opsrun.sh
# contra el Supabase local, con el alta imitada (supabase/alta-local.sql) y
# datos inventados:
#
#   1. deploy de la imagen del commit actual (opsrun-prueba:<sha>): revisa el
#      entorno, aplica las migraciones como opsrun_migrador, arranca y pasa la
#      prueba de humo; la imagen no trae secretos y corre sin root;
#   2. deploy de una versión B, que deja la primera como anterior;
#   3. deploy de una versión rota (no llega a la base): falla la prueba de humo
#      y vuelve sola a B;
#   4. deploy con una variable prohibida en el entorno: para antes de migrar y
#      B sigue corriendo sin reiniciarse;
#   5. vuelta atrás a la primera.
#
# Requisitos: Docker y el Postgres del Supabase local arriba
# (`pnpm exec supabase db start` o `pnpm local`). La primera imagen se
# construye del commit actual, así que el árbol debe estar limpio; para probar
# con una imagen ya construida: PRUEBA_IMAGEN=opsrun:algo pnpm test:deploy.
#
# Las claves que usa son las locales y públicas de supabase/alta-local.sql.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OPSRUN="$RAIZ/scripts/servidor/opsrun.sh"
PUERTO="${PRUEBA_PUERTO:-58330}"
REPO=opsrun-prueba
NOMBRE=opsrun-prueba
DB=supabase_db_opsrun
URL="http://127.0.0.1:$PUERTO"

paso() { printf '\n── %s\n' "$*"; }
falla() { printf 'prueba-ciclo: FALLA: %s\n' "$*" >&2; exit 1; }

docker container inspect "$DB" >/dev/null 2>&1 ||
  falla "no está el Postgres del Supabase local ($DB): pnpm exec supabase db start"
RED="$(docker container inspect "$DB" --format '{{range $red, $_ := .NetworkSettings.Networks}}{{$red}}{{end}}')"

CONFIG="$(mktemp -d "${TMPDIR:-/tmp}/opsrun-prueba-ciclo.XXXXXX")"
limpiar() {
  docker rm -f "$NOMBRE" "$NOMBRE-saliente" >/dev/null 2>&1 || true
  docker rmi "$REPO:b" "$REPO:rota" "$REPO:prueba-actual" "$REPO:prueba-anterior" >/dev/null 2>&1 || true
  if [[ -n "${IMAGEN_A:-}" && -z "${PRUEBA_IMAGEN:-}" ]]; then docker rmi "$IMAGEN_A" >/dev/null 2>&1 || true; fi
  rm -rf "$CONFIG"
}
trap limpiar EXIT

ultima_migracion() {
  ls "$RAIZ/supabase/migrations" | sed -n 's/^\([0-9]\{14\}\)_.*\.sql$/\1/p' | sort | tail -n 1
}
salud() { curl -fsS --max-time 5 "$URL/api/salud"; }
campo() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s)[process.argv[1]];process.stdout.write(v==null?"":String(v))})' "$1"; }
revision_corriendo() {
  docker image inspect "$(docker container inspect "$NOMBRE" --format '{{.Image}}')" \
    --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
}
revision_de() { docker image inspect "$1" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'; }

comprobar_sirve() {
  local cuerpo
  cuerpo="$(salud)" || falla "/api/salud no responde"
  [[ "$(campo status <<<"$cuerpo")" == ok ]] || falla "/api/salud no da ok: $cuerpo"
  [[ "$(campo schema_version <<<"$cuerpo")" == "$(ultima_migracion)" ]] ||
    falla "la base no va en la última migración del repo: $cuerpo"
  # Primero el cuerpo entero y después grep: con `curl | grep -q`, grep corta
  # al primer acierto y curl falla al escribir el resto (pipefail).
  local inicio
  inicio="$(curl -fsS --max-time 10 "$URL/")" || falla "la página de inicio no responde"
  grep -q "opsRUN" <<<"$inicio" || falla "la página de inicio no sirve"
}

paso "Alta local (sin migraciones: las aplica el deploy)"
(cd "$RAIZ" && node scripts/base-local.mjs --solo-alta)

paso "Carpeta del entorno de prueba en $CONFIG"
mkdir -p "$CONFIG/secretos"
cat >"$CONFIG/deploy.conf" <<EOF
OPSRUN_IMAGEN=$REPO
OPSRUN_ENTORNO=prueba
OPSRUN_PUERTO=$PUERTO
OPSRUN_RED=$RED
OPSRUN_ESPERA_HUMO=40
EOF
cat >"$CONFIG/entorno.conf" <<EOF
OPSRUN_DB_HOST=$DB
OPSRUN_GOTRUE_URL=http://auth.opsrun.test
EOF
printf 'OPSRUN_APP_USUARIO=opsrun_app\nOPSRUN_APP_CLAVE=opsrun_app_local\n' >"$CONFIG/secretos/app.conf"
printf 'OPSRUN_MIGRADOR_URL=postgres://opsrun_migrador:opsrun_migrador_local@%s:5432/postgres\n' "$DB" \
  >"$CONFIG/secretos/migrador.conf"
chmod 0640 "$CONFIG/secretos/app.conf" "$CONFIG/secretos/migrador.conf"

paso "Un secreto legible por otros para el deploy"
chmod 0644 "$CONFIG/secretos/app.conf"
if "$OPSRUN" deploy --config "$CONFIG" --imagen "${PRUEBA_IMAGEN:-no-importa}" >"$CONFIG/salida" 2>&1; then
  falla "aceptó un secreto legible por otros"
fi
grep -q "legible por otros" "$CONFIG/salida" || { cat "$CONFIG/salida"; falla "no dijo que el secreto es legible por otros"; }
echo "ok: rechazado"
chmod 0640 "$CONFIG/secretos/app.conf"

paso "1. Deploy de la primera versión"
if [[ -n "${PRUEBA_IMAGEN:-}" ]]; then
  IMAGEN_A="$PRUEBA_IMAGEN"
  "$OPSRUN" deploy --config "$CONFIG" --imagen "$IMAGEN_A"
else
  IMAGEN_A="$REPO:$(git -C "$RAIZ" rev-parse --short=12 HEAD)"
  "$OPSRUN" deploy --config "$CONFIG"
fi
comprobar_sirve
REVISION_A="$(revision_de "$IMAGEN_A")"
[[ "$(revision_corriendo)" == "$REVISION_A" ]] || falla "no corre la primera versión"
docker image inspect "$REPO:prueba-anterior" >/dev/null 2>&1 && falla "en el primer deploy no debía haber anterior"
[[ "$(docker exec "$NOMBRE" id -u)" == 10001 ]] || falla "el contenedor no corre como el usuario opsrun (10001)"
echo "ok: sirve, esquema $(ultima_migracion), usuario $(docker exec "$NOMBRE" id -un)"

paso "La imagen no trae secretos"
entorno_imagen="$(docker image inspect "$IMAGEN_A" --format '{{range .Config.Env}}{{println .}}{{end}}')"
for prohibida in SERVICE_ROLE SECRET_KEY JWT_SECRET POSTGRES_PASSWORD OPSRUN_DATABASE_URL OPSRUN_APP_CLAVE OPSRUN_MIGRADOR_URL; do
  if grep -q "$prohibida" <<<"$entorno_imagen"; then falla "la imagen trae $prohibida en su entorno"; fi
done
if docker history --no-trunc --format '{{.CreatedBy}}' "$IMAGEN_A" | grep -Eq 'opsrun_app_local|opsrun_migrador_local|CLAVE=|_URL=postgres'; then
  falla "una capa de la imagen menciona una credencial"
fi
encontrados="$(docker run --rm --entrypoint sh "$IMAGEN_A" -c 'find /app -name ".env*" -o -name "*.pem" -o -name "*.key" | head')"
[[ -z "$encontrados" ]] || falla "la imagen trae archivos de secretos: $encontrados"
echo "ok: sin credenciales en el entorno, las capas ni /app"

paso "2. Deploy de una versión B"
printf 'FROM %s\nLABEL org.opencontainers.image.revision=prueba-b\n' "$IMAGEN_A" | docker build -q -t "$REPO:b" - >/dev/null
"$OPSRUN" deploy --config "$CONFIG" --imagen "$REPO:b"
comprobar_sirve
[[ "$(revision_corriendo)" == prueba-b ]] || falla "no corre B"
[[ "$(revision_de "$REPO:prueba-anterior")" == "$REVISION_A" ]] || falla "la anterior no es la primera versión"
echo "ok: corre B y la anterior es la primera"

paso "3. Deploy de una versión rota: vuelve sola a B"
printf 'FROM %s\nENV OPSRUN_DB_PORT=1\nLABEL org.opencontainers.image.revision=prueba-rota\n' "$IMAGEN_A" |
  docker build -q -t "$REPO:rota" - >/dev/null
if "$OPSRUN" deploy --config "$CONFIG" --imagen "$REPO:rota"; then falla "el deploy roto terminó bien"; fi
comprobar_sirve
[[ "$(revision_corriendo)" == prueba-b ]] || falla "tras el deploy roto no corre B"
[[ "$(revision_de "$REPO:prueba-actual")" == prueba-b ]] || falla "la etiqueta actual no es B"
[[ "$(revision_de "$REPO:prueba-anterior")" == "$REVISION_A" ]] || falla "la etiqueta anterior cambió"
echo "ok: volvió a B y pasa la prueba de humo"

paso "4. Deploy con una variable prohibida: para antes de migrar"
inicio_b="$(docker container inspect "$NOMBRE" --format '{{.State.StartedAt}}')"
cp "$CONFIG/entorno.conf" "$CONFIG/entorno.conf.bueno"
echo "SUPABASE_SERVICE_ROLE_KEY=valor-de-prueba" >>"$CONFIG/entorno.conf"
if "$OPSRUN" deploy --config "$CONFIG" --imagen "$IMAGEN_A" 2>&1 | tee "$CONFIG/salida"; then
  falla "aceptó un entorno con SUPABASE_SERVICE_ROLE_KEY"
fi
grep -q "SUPABASE_SERVICE_ROLE_KEY no debe estar en el servidor" "$CONFIG/salida" || falla "no dijo qué variable sobra"
grep -q "valor-de-prueba" "$CONFIG/salida" && falla "mostró el valor de la variable prohibida"
grep -q "aplicando migraciones" "$CONFIG/salida" && falla "llegó a las migraciones"
mv "$CONFIG/entorno.conf.bueno" "$CONFIG/entorno.conf"
[[ "$(docker container inspect "$NOMBRE" --format '{{.State.StartedAt}}')" == "$inicio_b" ]] || falla "B se reinició"
comprobar_sirve
echo "ok: rechazado por nombre, sin tocar la base ni B"

paso "5. Vuelta atrás a la primera versión"
"$OPSRUN" vuelta-atras --config "$CONFIG"
comprobar_sirve
[[ "$(revision_corriendo)" == "$REVISION_A" ]] || falla "la vuelta atrás no dejó la primera versión"
[[ "$(revision_de "$REPO:prueba-actual")" == "$REVISION_A" ]] || falla "la etiqueta actual no es la primera"
[[ "$(revision_de "$REPO:prueba-anterior")" == prueba-b ]] || falla "la etiqueta anterior no es B"
echo "ok: corre la primera versión y B queda como anterior"

paso "Bitácora"
"$OPSRUN" estado --config "$CONFIG"
[[ "$(wc -l <"$CONFIG/deploys.log")" -ge 4 ]] || falla "la bitácora no tiene los 4 deploys"

printf '\nprueba-ciclo: el ciclo completo pasa.\n'
