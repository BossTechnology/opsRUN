# Runbook: deploy y vuelta atrás de opsRUN en el servidor

Para Henry, que es quien corre esto en staging y producción. El agente solo lo corre en local y en CI (`pnpm test:deploy`).

Este repo es público: aquí no van hosts, IPs, rutas reales ni nombres internos de BzzzBX. Donde dice `<carpeta-del-entorno>` va la ruta que elijas en el servidor; los valores de ejemplo terminan en `.test`.

## Qué es y qué no es

- opsRUN corre en el mismo servidor que BzzzBX, **al lado de la caja y no dentro** ([ADR 0002](adr/0002-opsrun-al-lado-de-la-caja.md)). No lo instala ni lo actualiza el actualizador de BzzzBX: se despliega con `scripts/servidor/opsrun.sh`, desde este repo.
- Usa el Supabase de la caja ([ADR 0003](adr/0003-supabase-de-la-caja.md)): conexión directa a Postgres como `opsrun_app` y migraciones como `opsrun_migrador`. Sin service role y sin PostgREST.
- La imagen es la misma para staging y producción. Todo lo del entorno se lee al arrancar.

## Requisitos en el servidor

- Docker 25 o posterior (el healthcheck usa `--start-interval`), bash y git.
- El contenedor de opsRUN tiene que llegar al Postgres de la caja y a su GoTrue. Esa red es de OPR-6; mientras no esté, no hay deploy.
- Los esquemas `opsrun`, `opsrun_private` y `opsrun_writeback`, y los roles `opsrun_migrador`, `opsrun_app` y `bzzz_writeback_opsrun`, ya creados por el alta de opsRUN en Bzzz. El deploy no crea esquemas ni roles.

## Preparar un entorno (una vez)

Una carpeta por entorno, por ejemplo una para staging y otra para producción, con dueño root:

```
<carpeta-del-entorno>/
  deploy.conf             cómo correr el contenedor (sin credenciales)
  entorno.conf            variables del contenedor (sin credenciales)
  secretos/app.conf       login de opsrun_app
  secretos/migrador.conf  conexión de opsrun_migrador
  deploys.log             la escribe el deploy
```

### `deploy.conf`

Solo estas claves; el script rechaza cualquier otra.

```
OPSRUN_ENTORNO=staging        # staging o produccion: da nombre al contenedor y a las etiquetas
OPSRUN_PUERTO=3101            # puerto del host; uno distinto por entorno
OPSRUN_ESCUCHA=127.0.0.1      # opcional; por defecto solo local, detrás del proxy con TLS
OPSRUN_RED=                   # opcional; red de Docker desde la que se ve el Postgres de la caja
OPSRUN_MEMORIA=512m           # opcional; techo de memoria, para no quitarle a la caja
OPSRUN_CPUS=1                 # opcional
OPSRUN_ESPERA_HUMO=90         # opcional; segundos para que pase la prueba de humo
OPSRUN_IMAGEN=opsrun          # opcional; nombre de la imagen
```

### `entorno.conf`

Va al contenedor con `--env-file`. **Sin credenciales**: el servidor no arranca si encuentra alguna de `PROHIBIDAS_EN_SERVIDOR` (`src/lib/db/entorno.ts`), y el deploy lo revisa antes de tocar la base.

```
OPSRUN_DB_HOST=db.caja.ejemplo.test
OPSRUN_DB_PORT=5432
OPSRUN_DB_NAME=postgres
OPSRUN_GOTRUE_URL=https://auth.caja.ejemplo.test
```

`OPSRUN_SERVIDOR=1` ya viene en la imagen. `OPSRUN_SECRETS_FILE` no hace falta: el deploy monta el secreto en la ruta por defecto, `/run/secrets/opsrun/app.env`.

### Secretos

Las credenciales las entrega el alta de opsRUN en Bzzz. Cada una va en su archivo y nunca en `entorno.conf` ni en la línea de comandos.

`secretos/app.conf`, que el contenedor de la app ve en `/run/secrets/opsrun/app.env`:

```
OPSRUN_APP_USUARIO=opsrun_app
OPSRUN_APP_CLAVE=<la clave de opsrun_app>
```

`secretos/migrador.conf`, que solo ve el contenedor de un solo uso que aplica las migraciones:

```
OPSRUN_MIGRADOR_URL=postgres://opsrun_migrador:<clave>@db.caja.ejemplo.test:5432/postgres
```

Permisos: que "otros" no puedan leerlos. El contenedor corre como el usuario `opsrun` (uid 10001) y los lee con el grupo del archivo, que el deploy le agrega con `--group-add`. Con un grupo propio para opsRUN:

```bash
sudo chown root:<grupo-opsrun> secretos/app.conf secretos/migrador.conf
```

```bash
sudo chmod 0640 secretos/app.conf secretos/migrador.conf
```

El deploy no arranca si alguno es legible por otros.

## Deploy

Desde un clon de este repo en el servidor, con el commit que se quiere desplegar:

```bash
git fetch origin && git checkout <sha>
```

```bash
scripts/servidor/opsrun.sh deploy --config <carpeta-del-entorno>
```

Qué hace, en orden; si un paso falla, para:

1. Construye `opsrun:<sha>` (12 caracteres) del commit actual. Exige el árbol limpio; si la imagen ya existe, la usa.
2. Revisa el entorno dentro de la imagen nueva, sin red, con las mismas reglas con las que el servidor se niega a arrancar. Una variable prohibida o un secreto que falta paran aquí, sin tocar la base.
3. Aplica las migraciones de esa imagen con `scripts/migrar.mjs` como `opsrun_migrador`, en un contenedor aparte. Cada migración entra entera o no entra.
4. Para la versión actual y arranca la nueva con el mismo nombre (`opsrun-<entorno>`) y el mismo puerto. El corte dura lo que tarda la nueva en pasar la prueba de humo, normalmente unos segundos.
5. Prueba de humo: `scripts/humo.mjs` dentro del contenedor llama a `GET /api/salud`, que corre `opsrun.opsrun_health()` como `opsrun_app`. Pasa si la base responde `ok` y su última migración es la de la imagen o una posterior.
6. Si pasa, la versión que corría queda etiquetada `opsrun:<entorno>-anterior` y la nueva `opsrun:<entorno>-actual`. Si no pasa, el deploy muestra el log de la nueva, la borra y **vuelve a arrancar la anterior solo**, con su propia prueba de humo.

Para llevar a producción la misma imagen que pasó en staging, sin construir de nuevo:

```bash
scripts/servidor/opsrun.sh deploy --config <carpeta-de-produccion> --imagen opsrun:<sha>
```

El contenedor corre con el sistema de archivos de solo lectura, sin capacidades, con `no-new-privileges`, techo de memoria y de procesos, y `--restart unless-stopped`.

## Vuelta atrás

```bash
scripts/servidor/opsrun.sh vuelta-atras --config <carpeta-del-entorno>
```

Arranca `opsrun:<entorno>-anterior` con la misma prueba de humo. Si falla, sigue la que corría. Si pasa, las etiquetas se cruzan: otra vuelta atrás regresa a la versión que se quitó.

**Las migraciones no se deshacen.** Son solo hacia adelante: la vuelta atrás cambia la imagen, no la base. La versión anterior corre contra un esquema más nuevo, y por eso:

- cada migración tiene que dejar funcionando la versión anterior. Agregar tablas, columnas con valor por defecto, funciones o vistas, sí. Borrar o renombrar algo que la versión anterior usa va en un deploy posterior, cuando ya ninguna versión desplegable lo usa;
- si una migración rompe la versión anterior, la vuelta atrás no sirve: se arregla hacia adelante, con una migración nueva y un deploy;
- `deploy --imagen` con una imagen más vieja que la base falla en el paso de migraciones (`scripts/migrar.mjs` rechaza una base con migraciones que la imagen no trae). Para volver a una versión anterior se usa `vuelta-atras`.

## Estado y bitácora

```bash
scripts/servidor/opsrun.sh estado --config <carpeta-del-entorno>
```

Muestra el contenedor y su salud, la revisión de `-actual` y de `-anterior`, y los últimos deploys. Cada deploy y cada vuelta atrás quedan en `deploys.log`: fecha (UTC), usuario, acción, imagen, revisión y resultado.

## Si algo sale mal

- **Sale con código 1**: el deploy o la vuelta atrás no se hicieron y sigue la versión que corría. El mensaje dice en qué paso paró.
- **Sale con código 2**: la nueva falló y la anterior tampoco pasó la prueba de humo. opsRUN está caído en ese entorno. Mira `docker logs opsrun-<entorno>` y la salud de la base de la caja.
- **"existe opsrun-<entorno>-saliente"**: un deploy se cortó a mitad. Con `estado`, decide cuál de los dos contenedores queda y borra el otro con `docker rm`.
- **"hay otro deploy en curso"**: si no lo hay, borra la carpeta `.bloqueo` del entorno.

## Por acordar antes del primer deploy

- Con el equipo de BzzzBX (OPR-6): la red desde el contenedor hasta el Postgres y el GoTrue de la caja (`OPSRUN_RED` u otra), y cómo llegan las claves de `opsrun_app` y `opsrun_migrador`.
- Si staging y producción usan bases distintas en la caja o la misma con otro nombre de base: el deploy de staging aplica migraciones en la base que diga su `migrador.conf`.
- El límite de conexiones de `opsrun_app` (el pool abre hasta 4 por contenedor).
- La entrada desde fuera: TLS y proxy delante de `OPSRUN_ESCUCHA:OPSRUN_PUERTO`. Es de opsRUN (ADR 0002) y no está en este script.
