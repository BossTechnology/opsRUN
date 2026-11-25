#!/usr/bin/env bash
# Deploy y vuelta atrás de opsRUN en un servidor con Docker (OPR-1).
#
# opsRUN corre al lado de la caja, no dentro (ADR 0002): este script es suyo y
# no lo usa el actualizador de BzzzBX. Solo necesita bash, Docker y, para
# construir, git. Producción la ejecuta Henry; el agente solo lo corre en local.
#
# Uso:
#   scripts/servidor/opsrun.sh construir
#   scripts/servidor/opsrun.sh deploy       --config DIR [--imagen REF]
#   scripts/servidor/opsrun.sh vuelta-atras --config DIR
#   scripts/servidor/opsrun.sh estado       --config DIR
#
# DIR es la carpeta de un entorno (staging, producción) en el servidor:
#   deploy.conf             cómo correr el contenedor (sin credenciales)
#   entorno.conf            variables del contenedor (sin credenciales)
#   secretos/app.conf       OPSRUN_APP_USUARIO y OPSRUN_APP_CLAVE (opsrun_app)
#   secretos/migrador.conf  OPSRUN_MIGRADOR_URL (opsrun_migrador)
#   deploys.log             lo escribe este script: quién, cuándo, qué y cómo terminó
# Los secretos no pueden ser legibles por "otros" (chmod 0640 o 0440); el
# contenedor los lee con el grupo del archivo (--group-add). Ver el runbook,
# docs/runbook-servidor.md.
#
# deploy:
#   1. construye opsrun:<sha> del commit actual (o toma --imagen);
#   2. revisa el entorno dentro de la imagen nueva, con las reglas del servidor
#      (src/lib/db/entorno.ts): una variable prohibida para aquí;
#   3. aplica las migraciones de esa imagen con scripts/migrar.mjs como
#      opsrun_migrador, en un contenedor aparte que es el único que ve
#      secretos/migrador.conf;
#   4. para la versión actual y arranca la nueva con el mismo nombre y puerto;
#   5. prueba de humo: opsrun_health() por /api/salud (scripts/humo.mjs);
#   6. si pasa, la anterior queda etiquetada <entorno>-anterior; si no, borra
#      la nueva y vuelve a arrancar la anterior, sola.
#
# vuelta-atras: arranca la imagen <entorno>-anterior con la misma prueba de
# humo. No toca la base: las migraciones son solo hacia adelante.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SECRETO_APP_EN_CONTENEDOR=/run/secrets/opsrun/app.env
SECRETO_MIGRADOR_EN_CONTENEDOR=/run/secrets/opsrun/migrador.env

aviso() { printf 'opsrun: %s\n' "$*"; }
fallo() { printf 'opsrun: ERROR: %s\n' "$*" >&2; exit 1; }

uso() {
  sed -n '8,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-1}"
}

# ── Configuración ───────────────────────────────────────────────────────────

OPSRUN_IMAGEN=opsrun
OPSRUN_ENTORNO=
OPSRUN_PUERTO=
OPSRUN_ESCUCHA=127.0.0.1
OPSRUN_RED=
OPSRUN_MEMORIA=512m
OPSRUN_CPUS=1
OPSRUN_ESPERA_HUMO=90

# Lee deploy.conf como datos, no como código: solo claves conocidas.
leer_deploy_conf() {
  local archivo="$1" linea clave valor
  [[ -f "$archivo" ]] || fallo "falta $archivo"
  while IFS= read -r linea || [[ -n "$linea" ]]; do
    linea="${linea#"${linea%%[![:space:]]*}"}"
    [[ -z "$linea" || "$linea" == \#* ]] && continue
    [[ "$linea" == *=* ]] || fallo "deploy.conf: línea sin '=': $linea"
    clave="${linea%%=*}"
    valor="${linea#*=}"
    case "$clave" in
      OPSRUN_IMAGEN | OPSRUN_ENTORNO | OPSRUN_PUERTO | OPSRUN_ESCUCHA | OPSRUN_RED | OPSRUN_MEMORIA | OPSRUN_CPUS | OPSRUN_ESPERA_HUMO)
        printf -v "$clave" '%s' "$valor" ;;
      *) fallo "deploy.conf: clave desconocida: $clave" ;;
    esac
  done <"$archivo"

  [[ "$OPSRUN_ENTORNO" =~ ^[a-z][a-z0-9-]{0,30}$ ]] || fallo "deploy.conf: OPSRUN_ENTORNO falta o no es un nombre (minúsculas, números y guiones)"
  [[ "$OPSRUN_PUERTO" =~ ^[0-9]+$ ]] && ((OPSRUN_PUERTO > 0 && OPSRUN_PUERTO < 65536)) || fallo "deploy.conf: OPSRUN_PUERTO falta o no es un puerto"
  [[ "$OPSRUN_ESPERA_HUMO" =~ ^[0-9]+$ ]] || fallo "deploy.conf: OPSRUN_ESPERA_HUMO no es un número de segundos"
  [[ "$OPSRUN_IMAGEN" =~ ^[a-z0-9][a-z0-9._/:-]*$ ]] || fallo "deploy.conf: OPSRUN_IMAGEN no es un nombre de imagen"
}

# Un secreto: existe, es un archivo y "otros" no lo pueden leer.
revisar_secreto() {
  local archivo="$1" permisos
  [[ -f "$archivo" ]] || fallo "falta $archivo"
  permisos="$(ls -ln "$archivo" | cut -c1-10)"
  [[ "${permisos:7:1}" == "-" ]] || fallo "$archivo es legible por otros: chmod o-rwx (0640 o 0440)"
}

grupo_de() { ls -ln "$1" | awk '{print $4}'; }

cargar_config() {
  [[ -n "${CONFIG:-}" ]] || fallo "falta --config DIR (la carpeta del entorno)"
  [[ -d "$CONFIG" ]] || fallo "no existe la carpeta $CONFIG"
  CONFIG="$(cd "$CONFIG" && pwd)"
  leer_deploy_conf "$CONFIG/deploy.conf"
  [[ -f "$CONFIG/entorno.conf" ]] || fallo "falta $CONFIG/entorno.conf"
  SECRETO_APP="$CONFIG/secretos/app.conf"
  SECRETO_MIGRADOR="$CONFIG/secretos/migrador.conf"
  NOMBRE="opsrun-$OPSRUN_ENTORNO"
  SALIENTE="$NOMBRE-saliente"
  TAG_ACTUAL="$OPSRUN_IMAGEN:$OPSRUN_ENTORNO-actual"
  TAG_ANTERIOR="$OPSRUN_IMAGEN:$OPSRUN_ENTORNO-anterior"
  BITACORA="$CONFIG/deploys.log"
}

# Un deploy a la vez por entorno.
bloquear() {
  BLOQUEO="$CONFIG/.bloqueo"
  mkdir "$BLOQUEO" 2>/dev/null || fallo "hay otro deploy en curso en $CONFIG (si no, borra $BLOQUEO)"
  trap 'rmdir "$BLOQUEO" 2>/dev/null || true' EXIT
}

anotar() {
  local accion="$1" imagen="$2" resultado="$3"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SUDO_USER:-$(id -un)}" "$accion" "$imagen" "$(revision_de "$imagen")" "$resultado" >>"$BITACORA"
}

# ── Docker ──────────────────────────────────────────────────────────────────

existe_imagen() { docker image inspect "$1" >/dev/null 2>&1; }
existe_contenedor() { docker container inspect "$1" >/dev/null 2>&1; }
revision_de() { docker image inspect "$1" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || echo "?"; }
imagen_de_contenedor() { docker container inspect "$1" --format '{{.Image}}'; }

red_args() { if [[ -n "$OPSRUN_RED" ]]; then printf '%s\n' --network "$OPSRUN_RED"; fi; }

# Construye opsrun:<sha> del commit actual. Árbol limpio: la etiqueta dice
# exactamente qué código lleva la imagen.
construir() {
  command -v git >/dev/null || fallo "construir necesita git"
  local sha corto
  sha="$(git -C "$RAIZ" rev-parse HEAD)"
  corto="${sha:0:12}"
  IMAGEN_CONSTRUIDA="$OPSRUN_IMAGEN:$corto"
  if [[ -n "$(git -C "$RAIZ" status --porcelain)" ]]; then
    fallo "hay cambios sin commit en $RAIZ: la imagen $IMAGEN_CONSTRUIDA no diría qué lleva"
  fi
  if existe_imagen "$IMAGEN_CONSTRUIDA"; then
    aviso "la imagen $IMAGEN_CONSTRUIDA ya existe: se usa tal cual"
    return
  fi
  aviso "construyendo $IMAGEN_CONSTRUIDA"
  docker build --build-arg "OPSRUN_REVISION=$sha" -t "$IMAGEN_CONSTRUIDA" "$RAIZ"
}

# Las reglas de arranque del servidor, dentro de la imagen y sin red.
verificar_entorno() {
  local imagen="$1"
  aviso "revisando el entorno con $imagen"
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
    --env-file "$CONFIG/entorno.conf" \
    -v "$SECRETO_APP:$SECRETO_APP_EN_CONTENEDOR:ro" --group-add "$(grupo_de "$SECRETO_APP")" \
    "$imagen" node scripts/verificar-entorno.mjs ||
    fallo "el entorno de $CONFIG no sirve para el servidor; no se tocó nada"
}

migrar() {
  local imagen="$1"
  aviso "aplicando migraciones de $imagen como opsrun_migrador"
  # shellcheck disable=SC2046
  docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges $(red_args) \
    -e "OPSRUN_MIGRADOR_SECRETS_FILE=$SECRETO_MIGRADOR_EN_CONTENEDOR" \
    -v "$SECRETO_MIGRADOR:$SECRETO_MIGRADOR_EN_CONTENEDOR:ro" --group-add "$(grupo_de "$SECRETO_MIGRADOR")" \
    "$imagen" node scripts/migrar.mjs ||
    fallo "fallaron las migraciones; la versión actual sigue corriendo (cada migración entra entera o no entra)"
}

arrancar() {
  local imagen="$1"
  # shellcheck disable=SC2046
  docker run -d --name "$NOMBRE" --restart unless-stopped \
    --env-file "$CONFIG/entorno.conf" \
    -v "$SECRETO_APP:$SECRETO_APP_EN_CONTENEDOR:ro" --group-add "$(grupo_de "$SECRETO_APP")" \
    -p "$OPSRUN_ESCUCHA:$OPSRUN_PUERTO:3000" $(red_args) \
    --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    --cap-drop ALL --security-opt no-new-privileges \
    --memory "$OPSRUN_MEMORIA" --cpus "$OPSRUN_CPUS" --pids-limit 256 \
    --label "opsrun.entorno=$OPSRUN_ENTORNO" \
    "$imagen" >/dev/null
}

# Espera a que la prueba de humo pase dentro del contenedor.
esperar_humo() {
  local limite=$((SECONDS + OPSRUN_ESPERA_HUMO)) salida=""
  while ((SECONDS < limite)); do
    if [[ "$(docker container inspect "$NOMBRE" --format '{{.State.Running}}' 2>/dev/null)" != "true" ]]; then
      aviso "el contenedor $NOMBRE se detuvo (código $(docker container inspect "$NOMBRE" --format '{{.State.ExitCode}}' 2>/dev/null || echo '?'))"
      return 1
    fi
    if salida="$(docker exec "$NOMBRE" node scripts/humo.mjs 2>&1)"; then
      aviso "$salida"
      return 0
    fi
    sleep 2
  done
  aviso "${salida:-humo: sin respuesta} (tras ${OPSRUN_ESPERA_HUMO} s)"
  return 1
}

# Para la versión que corre, arranca $1 en su lugar y la prueba. Si falla,
# vuelve a la que corría. Devuelve 0 si $1 quedó corriendo.
cambiar_a() {
  local imagen="$1"
  if existe_contenedor "$SALIENTE"; then
    fallo "existe $SALIENTE de un deploy que no terminó: revisa con 'estado' y bórralo a mano"
  fi
  local habia_anterior=0
  if existe_contenedor "$NOMBRE"; then
    habia_anterior=1
    aviso "parando la versión actual"
    docker stop -t 20 "$NOMBRE" >/dev/null
    docker rename "$NOMBRE" "$SALIENTE"
  fi

  aviso "arrancando $imagen"
  if arrancar "$imagen" && esperar_humo; then
    if ((habia_anterior)); then docker rm "$SALIENTE" >/dev/null; fi
    return 0
  fi

  aviso "la versión nueva no pasó la prueba de humo; últimas líneas de su log:"
  docker logs --tail 30 "$NOMBRE" 2>&1 | sed 's/^/  | /' || true
  docker rm -f "$NOMBRE" >/dev/null 2>&1 || true
  if ((habia_anterior)); then
    aviso "volviendo a la versión anterior"
    docker rename "$SALIENTE" "$NOMBRE"
    docker start "$NOMBRE" >/dev/null
    if ! esperar_humo; then
      printf 'opsrun: ERROR: la versión anterior tampoco pasa la prueba de humo. opsRUN está caído en %s.\n' "$OPSRUN_ENTORNO" >&2
      exit 2
    fi
    aviso "la versión anterior volvió y pasa la prueba de humo"
  fi
  return 1
}

# ── Comandos ────────────────────────────────────────────────────────────────

cmd_construir() {
  if [[ -n "${CONFIG:-}" ]]; then cargar_config; fi
  construir
  aviso "lista: $IMAGEN_CONSTRUIDA"
}

cmd_deploy() {
  cargar_config
  revisar_secreto "$SECRETO_APP"
  revisar_secreto "$SECRETO_MIGRADOR"
  bloquear

  local imagen
  if [[ -n "${IMAGEN_PEDIDA:-}" ]]; then
    existe_imagen "$IMAGEN_PEDIDA" || fallo "no existe la imagen $IMAGEN_PEDIDA"
    imagen="$IMAGEN_PEDIDA"
  else
    construir
    imagen="$IMAGEN_CONSTRUIDA"
  fi
  local id_nueva actual=""
  id_nueva="$(docker image inspect "$imagen" --format '{{.Id}}')"
  if existe_contenedor "$NOMBRE"; then actual="$(imagen_de_contenedor "$NOMBRE")"; fi

  verificar_entorno "$imagen"
  migrar "$imagen"

  if cambiar_a "$imagen"; then
    if [[ -n "$actual" && "$actual" != "$id_nueva" ]]; then docker tag "$actual" "$TAG_ANTERIOR"; fi
    docker tag "$imagen" "$TAG_ACTUAL"
    anotar deploy "$imagen" ok
    aviso "deploy listo en $OPSRUN_ENTORNO: $imagen ($(revision_de "$imagen"))"
  else
    anotar deploy "$imagen" "falló; volvió a la anterior"
    fallo "deploy de $imagen falló; $OPSRUN_ENTORNO sigue con la versión anterior"
  fi
}

cmd_vuelta_atras() {
  cargar_config
  revisar_secreto "$SECRETO_APP"
  bloquear
  existe_imagen "$TAG_ANTERIOR" || fallo "no hay versión anterior ($TAG_ANTERIOR)"
  local anterior actual=""
  anterior="$(docker image inspect "$TAG_ANTERIOR" --format '{{.Id}}')"
  if existe_contenedor "$NOMBRE"; then actual="$(imagen_de_contenedor "$NOMBRE")"; fi
  [[ "$actual" != "$anterior" ]] || fallo "$OPSRUN_ENTORNO ya corre la versión anterior"

  aviso "volviendo a $TAG_ANTERIOR ($(revision_de "$TAG_ANTERIOR")); las migraciones no se deshacen"
  verificar_entorno "$anterior"
  if cambiar_a "$anterior"; then
    # Las etiquetas se cruzan: otra vuelta atrás regresa a la que se quitó.
    if [[ -n "$actual" ]]; then docker tag "$actual" "$TAG_ANTERIOR"; fi
    docker tag "$anterior" "$TAG_ACTUAL"
    anotar vuelta-atras "$anterior" ok
    aviso "vuelta atrás lista en $OPSRUN_ENTORNO: $(revision_de "$anterior")"
  else
    anotar vuelta-atras "$anterior" "falló; sigue la que corría"
    fallo "la vuelta atrás falló; $OPSRUN_ENTORNO sigue con la versión que corría"
  fi
}

cmd_estado() {
  cargar_config
  local etiqueta
  if existe_contenedor "$NOMBRE"; then
    aviso "$NOMBRE: $(docker container inspect "$NOMBRE" --format '{{.State.Status}}, salud {{if .State.Health}}{{.State.Health.Status}}{{else}}sin healthcheck{{end}}'), revisión $(revision_de "$(imagen_de_contenedor "$NOMBRE")")"
  else
    aviso "$NOMBRE: no existe"
  fi
  if existe_contenedor "$SALIENTE"; then aviso "OJO: existe $SALIENTE, de un deploy que no terminó"; fi
  for etiqueta in "$TAG_ACTUAL" "$TAG_ANTERIOR"; do
    if existe_imagen "$etiqueta"; then aviso "$etiqueta: revisión $(revision_de "$etiqueta")"; else aviso "$etiqueta: no existe"; fi
  done
  if [[ -f "$BITACORA" ]]; then
    aviso "últimos deploys:"
    tail -n 5 "$BITACORA" | sed 's/^/  /'
  fi
}

# ── Argumentos ──────────────────────────────────────────────────────────────

[[ $# -ge 1 ]] || uso
COMANDO="$1"
shift
CONFIG="${OPSRUN_CONFIG:-}"
IMAGEN_PEDIDA=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG="${2:?--config necesita una carpeta}"; shift 2 ;;
    --imagen) IMAGEN_PEDIDA="${2:?--imagen necesita una imagen}"; shift 2 ;;
    -h | --help) uso 0 ;;
    *) fallo "argumento desconocido: $1" ;;
  esac
done

command -v docker >/dev/null || fallo "no está docker"

case "$COMANDO" in
  construir) cmd_construir ;;
  deploy) cmd_deploy ;;
  vuelta-atras) cmd_vuelta_atras ;;
  estado) cmd_estado ;;
  -h | --help | ayuda) uso 0 ;;
  *) fallo "comando desconocido: $COMANDO" ;;
esac
