# OPR-15 — Entrada de correo: un correo nuevo es una request

- **Tarjeta:** OPR-15 (C · Email intake, Gmail → BzzzBX → opsRUN requests). Depende de OPR-14 (acceso al buzón compartido, de PINCH IT), OPR-22 (read layer) y OPR-20 (modelo de datos). De esas, OPR-20 y la parte local de OPR-22 están en `main`; OPR-14 y el contrato real de BzzzBX (OPR-6) no existen.
- **Estado:** aprobado por Henry el 2026-11-27, con P-0 a P-7 según las recomendaciones, incluida la migración de P-0; P-8 decidida después: el más antiguo arriba (§12.1). No hay código ni migración escritos. Lo marcado **[S-n]** es un supuesto; lo marcado **P-n** es una pregunta para Henry, con su decisión (§12).
- **Construye sobre:** el puerto de lectura y su falso (`src/lib/bzzzbx/`, spec OPR-22, ADR 0005: `Message`, `cambiosDesde`, hilos `bx-thread-`), el modelo de datos (spec OPR-20 §3.2, §3.5, §3.11 y §4: `request`, `request_message`, `audit_event`, `require_system()`), la conversación (spec OPR-27: el hilo ya muestra los mensajes de los hilos de la request, P-7; despacho mínimo con actor de sistema) y el tablero (spec OPR-25: sondeo cada 15 s por `/api/tablero/cambios`, cuyo cursor incluye el último `audit_event.id`).
- **Tarjeta en Relevo:** leída (OPR-15 y OPR-36, 2026-11-27). De OPR-15 salen: los correos nuevos del buzón compartido son requests con R number "at the top of Requests"; las respuestas del cliente van a su request "by email conversation and R/job number"; los adjuntos se quedan con el mensaje; un correo duplicado no da dos requests; cada request nueva pasa enseguida al análisis de IA. De OPR-36: el análisis sale por BzzzBX al llegar el correo, y si la IA tarda o cae los campos quedan vacíos con "AI pending". **No se pudieron leer** el Release Definition §4.3 ni el User Guide §4.1 y §3.3 (no están en este repo, que es público) [S-1].
- **Fuera de alcance:** leer Gmail (lo hace BzzzBX con el acceso de OPR-14; opsRUN nunca), el análisis de IA y las sugerencias (OPR-36, OPR-37), enviar correo (OPR-16), textos entrantes del cleaner (OPR-17), la alerta Unassigned (OPS-001, la calcula Signal Maker, OPR-33), mover un mensaje a otra request a mano (`link_message` del operador) y cerrar una request sin programar (spam, duplicado: OPR-20 §11.6).

## 1. Para qué

Hoy las requests del tablero salen de la seed: nada crea una request nueva. Este trabajo cierra el primer paso de E2E-1:

1. llega un correo nuevo al buzón compartido de PINCH; BzzzBX lo ve (OPR-14) y lo publica en su proyección `Message`;
2. opsRUN se entera por el puerto de lectura, sin leer Gmail;
3. si el correo abre una conversación nueva, crea **una** request con su R number, sin dueño y con el borrador vacío ("AI pending"), y la deja en Requests;
4. si es una respuesta en una conversación que ya es de una request, la vincula a esa request;
5. todo con Audit en la misma transacción, idempotente ante reintentos y carreras.

Para la demo local: `/api/falso` deja caer un correo nuevo, y en menos de 1 minuto aparece su tarjeta en Requests; una respuesta en el mismo hilo no crea otra tarjeta y enciende el ícono de chat.

## 2. Principios que aplica

- **Un solo dueño.** El correo (remitente, destinatarios, asunto, cuerpo, adjuntos) es de PINCH y se lee de BzzzBX. opsRUN guarda solo la request, el vínculo mensaje → request con crosswalk IDs (`bzzzbx_message_id`, `bzzzbx_thread_id`) y la hora de llegada (§6).
- **Toda acción es una instrucción a BzzzBX.** La entrada no manda nada: solo lee el puerto y escribe en opsRUN. opsRUN nunca llama a Gmail.
- **Las IAs proponen, el operador confirma.** La entrada no llena el borrador: nace vacío. Llenarlo con sugerencias es de OPR-36 (§7).
- **Si la IA falla, se trabaja a mano.** Una request sin análisis se ve "AI pending" y se trabaja igual.
- **Todo queda en Audit.** `request_received` al crear y `email_received` al vincular una respuesta (P-4), en la misma transacción que el dato, con actor `system`.
- **Guards que descubren.** "Solo la entrada crea requests" se comprueba descubriendo en el catálogo las funciones que insertan en `opsrun.request`, y se ve fallar en cada corrida (§9.1).

## 3. Qué se construye ya y qué espera

| Pieza | Ahora, sobre el falso | Espera a |
|---|---|---|
| Proceso de entrada: sondeo con cursor, recuperación al arrancar y tras `CursorCaducado` | Sí | OPR-6: el aviso de cambios real y `buscarMensajes` (§4.3) |
| Correo nuevo → request con R number, borrador vacío y Audit | Sí | OPR-14 para que lleguen correos de verdad |
| Respuesta en el hilo → vínculo con la request y Audit | Sí | — |
| Deduplicación por mensaje y por hilo, también con dos procesos a la vez | Sí, en la base | — |
| Vínculo por R number o job number en el asunto | No (P-3) | Que OPR-16/OPR-18 fijen el asunto de los correos salientes |
| Adjuntos "kept with the message" | No se toca: son de PINCH y el puerto no los trae (OPR-27 S-5) | OPR-6 |
| Paso al análisis de IA "right away" | Un punto de enganche vacío (§7) | OPR-36, OPR-11 y la capa de IA de BzzzBX |
| Hecho cuando de la tarjeta (E2E-1 en staging, menos de 1 minuto) | Solo en local, E1 (§9.3) | OPR-14, OPR-6 y staging |

## 4. Origen del correo: cómo se entera opsRUN

### 4.1 Lo que ya existe

- El puerto de lectura tiene `cambiosDesde(cursor)`: devuelve qué entidades cambiaron (entidad, id, versión), sin datos, con un cursor opaco y `hay_mas` (OPR-22 §3.3). Un `Message` nuevo es un cambio con `entidad = "message"`.
- `obtenerVarios("message", ids)` lee los mensajes; `listarPor("message", { bzzzbx_thread_id })` los de un hilo.
- `cambiosDesde(null)` no devuelve cambios: da el cursor de "ahora". `CursorCaducado` llega si se reconstruyó una proyección (o, en local, si se reinició el falso).
- El falso ya deja poner un mensaje con `/api/falso` `{ accion: "poner", entidad: "message", valor }`, que genera su cambio.

No hay forma de **listar** los mensajes llegados desde una hora: si el proceso estuvo parado o el cursor caducó, lo que llegó mientras tanto no se ve por `cambiosDesde`. Por eso hace falta §4.3.

### 4.2 El sondeo

Cada vuelta (cada 15 s, §8):

1. Si no hay cursor (arranque o `CursorCaducado`), primero pide `cambiosDesde(null)` y guarda ese cursor, y **después** hace la recuperación de §4.3. En ese orden, un correo que llegue durante la recuperación sale en la siguiente vuelta; a lo sumo se ve dos veces, y la base lo deduplica.
2. Pide `cambiosDesde(cursor)` y sigue mientras `hay_mas`, hasta 10 lotes por vuelta [S-2].
3. Se queda con los cambios de `message` (ids únicos) y los lee con `obtenerVarios`.
4. Filtra: `channel = "email"` y `direction = "inbound"` (§5.1).
5. Los ordena por `sent_at` y, a igual hora, por `bzzzbx_message_id`, para que el original de un hilo se procese antes que sus respuestas cuando llegan en el mismo lote.
6. Llama a `opsrun.ingest_request_email` por cada uno, cada uno en su propia transacción, con actor de sistema `entrada_correo`.
7. Solo si todos salieron bien (o se saltaron por §8.3) avanza el cursor en memoria. Si uno falla, el cursor no avanza y la vuelta siguiente lo reintenta: la función es idempotente.

El cursor vive en memoria del proceso, como la memoria del tablero (P-2). Un cambio de versión de un mensaje ya vinculado (por ejemplo, su `delivery`) vuelve a pasar por la función y sale como `duplicate`, sin escribir nada.

### 4.3 Recuperación (cambio provisional del puerto)

Un método nuevo en `LecturaBzzzbx`, provisional hasta OPR-6, como `buscarJobs` en la Fase A:

```ts
buscarMensajes(filtro: {
  channel: "email";
  direction: "inbound";
  desde: string;          // ISO, inclusive
  despuesDe?: string;     // bzzzbx_message_id: para paginar a igual sent_at
}): Promise<{ mensajes: Leido<Message>[]; hay_mas: boolean }>;
```

Ordena por `(sent_at, bzzzbx_message_id)` y devuelve hasta 200 [S-3]. La recuperación pide desde la **marca de agua** y pagina hasta `hay_mas = false`:

- marca de agua = `max(request.received_at) − 24 h` [S-4]. Las respuestas que llegaron después de la última request nueva quedan dentro, y las 24 h cubren el desorden entre lotes;
- **sin ninguna request en la base** (el primer arranque en producción), no hay recuperación: la entrada empieza en "ahora" y no importa el buzón histórico (P-5).

Todo lo que trae pasa por la misma función: lo ya vinculado sale `duplicate`. Con BzzzBX caído, la recuperación se reintenta en la vuelta siguiente sin cursor (sigue sin cursor hasta completarla).

**Espera OPR-6:** que el equipo de BzzzBX confirme si la proyección `Message` admite esta consulta (o da otra forma de recorrer el buzón desde una hora), cuánto tiempo guarda los mensajes y si `cambiosDesde` incluye los mensajes nuevos dentro del minuto.

## 5. De mensaje a request

### 5.1 Qué mensajes mira la entrada

| Mensaje | Qué hace |
|---|---|
| Correo entrante (`email`, `inbound`) en un hilo sin request | **Crea** una request; el mensaje es su original |
| Correo entrante en un hilo que ya tiene request | **Vincula** el mensaje a esa request (no original) |
| Correo entrante sin hilo (`bzzzbx_thread_id = null`) | Crea una request; ese correo no tiene respuestas enhebrables [S-5] |
| Correo entrante ya vinculado (mismo `bzzzbx_message_id`) | Nada (`duplicate`) |
| Correo saliente (`outbound`) | Nada. Los que manda opsRUN los vincula `resolve_instruction` con su `instruction_id` (OPR-27 §7); si la entrada los vinculara antes, la burbuja de la instrucción se vería doble. Los que alguien mande desde Gmail ya aparecen en el hilo de la request (OPR-27 P-7) [S-6] |
| Texto (`text`) | Nada: los textos entrantes del cleaner son de OPR-17 |

Se asume que la proyección `Message` de correo es la del buzón compartido y nada más [S-7]; si BzzzBX publica otros buzones, el filtro necesita un campo del buzón (espera OPR-6). La entrada no filtra respuestas automáticas, rebotes ni spam: con OPR-20 §11.6 abierta, una request que no es trabajo no se puede cerrar, y esconderla sin decirlo sería peor (P-6).

### 5.2 "Un hilo, una request"

Una conversación de correo es de una sola request durante toda su vida (OPR-20 §3.5: `bzzzbx_thread_id` es la conversación). Una respuesta llega a la request del hilo esté en la etapa que esté, también Scheduled o después: es la "reply appears in its thread" de la tarjeta. Si el cliente pide un trabajo nuevo respondiendo un correo viejo, queda en la request vieja y el operador lo ve en la conversación; separarlo no entra en V1.1 beta [S-8].

### 5.3 Idempotencia y carreras

La base decide, no el servidor. `opsrun.ingest_request_email` hace todo bajo un candado del hilo:

1. `require_system()`;
2. `pg_advisory_xact_lock` sobre un hash de `'opsrun.entrada:' || coalesce(hilo, 'msg:' || mensaje)`. Dos llamadas del mismo hilo, de dos procesos o dos vueltas, se ordenan; las de hilos distintos no se esperan;
3. si el `bzzzbx_message_id` ya está en `request_message` → `duplicate`, sin escribir;
4. si el hilo ya tiene request → vincula (`linked`);
5. si no → crea (`created`).

Respaldo en la base, por si alguien escribe sin pasar por la función: el `unique` de `request_message.bzzzbx_message_id` (ya existe) y un índice único parcial nuevo, **un original por hilo** (§10). Con los dos, aunque el candado faltara, el segundo intento falla con `23505` en lugar de crear dos requests.

Lo que no se puede evitar: si una respuesta llega en un lote anterior a su original (el desorden es de BzzzBX), la respuesta abre la request y el original se vincula después como no original. Sigue siendo una sola request; el "Original request" de la conversación es el primer correo que vio opsRUN [S-9].

## 6. Datos de la request: qué guarda opsRUN y qué no

| Guarda (opsRUN) | No guarda (es de PINCH, se lee de BzzzBX) |
|---|---|
| `request`: `id`, `r_number` (secuencia), `status = 'open'`, `received_at` = `Message.sent_at` [S-10], sin dueño | Remitente, destinatarios, asunto, cuerpo, adjuntos |
| Borrador **vacío**: todas las columnas `:draft` en `null` | Quién es el cliente o el contacto: lo propone la IA (`sender`, OPR-36/37) y lo confirma el operador (OPR-28) |
| `request_message`: `bzzzbx_message_id`, `bzzzbx_thread_id`, `email`, `inbound`, `is_original`, actor `system` | El estado de entrega |
| Audit `request_received` con `details = {"bzzzbx_message_id", "bzzzbx_thread_id"}`, `occurred_at = received_at`; `email_received` igual al vincular | La dirección del buzón compartido |

La función recibe **solo** `p_bzzzbx_message_id`, `p_bzzzbx_thread_id` y `p_received_at`. Lo demás del mensaje lo lee el proceso para filtrar y ordenar, y no viaja a la base (prueba en §9.2).

"AI pending" no es un dato que guarde la entrada: una request sin `ai_analysis`, o con uno `pending`, `failed` o `timed_out` sin sugerencias, se ve AI pending (OPR-20 §3.9). Cómo y dónde se muestra es de OPR-36.

R number: lo da `opsrun.request_r_number_seq`. Una transacción que falla después de pedirlo deja un hueco; el perdedor de una carrera no lo pide, porque espera el candado y encuentra el hilo [S-11]. El formato y el número inicial siguen en OPR-20 §11.1.

La tarjeta nueva no necesita nada más: el tablero ya lee `request` y su original, muestra `R<r_number>`, "— —" en lo que falta, sin dueño, y el ícono de chat cuando el hilo tiene un entrante posterior al original (OPR-25 P-5).

## 7. Paso al análisis de IA (lo que hace OPR-36 después)

La tarjeta OPR-15 pide que cada request nueva pase "right away" al análisis, y OPR-36 que el correo salga por BzzzBX a Claude al llegar, con fallback "AI pending". OPR-22 P-3 decidió que la IA va por la capa de IA de BzzzBX, no por el outbox, y que los `ai_*` saldrán del catálogo de instrucciones. Por eso la entrada **no** crea `ai_analysis` ni una instrucción `ai_analyze_request` (P-7):

- la entrada devuelve, por cada mensaje, `{ request_id, outcome }`; tras confirmar la transacción de un `created`, llama a un enganche `alCrearRequest(request_id)` que en esta tarjeta no hace nada;
- OPR-36 lo llena: pide el análisis a la capa de IA y escribe su resultado con `record_ai_analysis` (sistema);
- como el enganche se pierde si el proceso cae justo después del commit, OPR-36 además barre las requests `open` sin `ai_analysis` (no hace falta cursor nuevo: es una consulta);
- mientras tanto, la request se ve AI pending y el operador trabaja a mano.

Así la meta "analizado en menos de 1 minuto" (OPR-36, OPR-39) cuenta desde `request.received_at`, que guarda la entrada.

## 8. El proceso del sistema

### 8.1 Quién lo corre

Una tarea del **ciclo de fondo** del servidor de Next (P-1, ADR 0006): el único de opsRUN, arrancado por `src/instrumentation-node.ts` (solo runtime `nodejs`, nunca en `next build`), en local, CI, staging y producción. El ciclo es una sola pieza que corre varias tareas, cada una con su cadencia y una vuelta a la vez; la entrada de correo es la primera y el registrador de alertas de OPR-34 (PR #26) corre en el mismo ciclo. Módulo nuevo `src/lib/entrada/`:

- `crearEntrada({ lectura, datos, reloj, alCrearRequest })` → `{ vuelta() }`: la lógica de §4 y §5, pura respecto a sus dependencias, que es lo que prueban los unitarios;
- `src/lib/entrada/datos-sql.ts`: la llamada a `opsrun.ingest_request_email` y la marca de agua, como `opsrun_app` con `escritura: true` y actor `{ tipo: "system", proceso: "entrada_correo" }`. El servidor fija `opsrun.system_actor`; nunca `opsrun.auth_user_id`;
- `src/lib/entrada/servidor.ts`: registra la tarea `entrada_correo` en el ciclo de fondo, cada 15 s. El ciclo garantiza una sola instancia por proceso (en `globalThis`, como el reconciliador de OPR-27) y una vuelta a la vez por tarea (si la anterior sigue, se salta). La entrada no abre su propio `setInterval`.

No es un operador: no pasa por `ejecutarAccion` ni por la action bar, y ninguna función del operador acepta su actor (G6, `require_operator()`).

Dos procesos a la vez (el cruce de un deploy, o `next dev` con recarga) no rompen nada: los dos leen, y la base deduplica (§5.3). No hace falta un candado global.

### 8.2 Cada cuánto, y la meta de 1 minuto

| Tramo | Tiempo |
|---|---|
| Gmail → BzzzBX → proyección `Message` | ≤ 1 min (frescura de OPR-22 §3.1; espera OPR-6 y OPR-14) |
| Proyección → request en opsRUN | ≤ 15 s (una vuelta) |
| Request → tarjeta en el tablero abierto | ≤ 15 s (sondeo de OPR-25: el `request_received` mueve el cursor) |

En local, con el falso, la tarjeta aparece en unos 30 s. En staging el total depende de la frescura real de `Message`, que es de BzzzBX.

### 8.3 Qué pasa si algo falla

| Caso | Qué hace |
|---|---|
| BzzzBX caído (`BzzzbxNoDisponible`) | La vuelta termina sin tocar el cursor; la siguiente reintenta. El tablero ya muestra "BzzzBX unavailable · last update HH:MM". Los correos esperan en BzzzBX y entran al volver. El log avisa una vez al caer y una al volver, no cada 15 s |
| `CursorCaducado` | El cursor pasa a `null`: la vuelta siguiente hace la recuperación de §4.3 |
| El real no existe (servidor, hasta OPR-6) | `lecturaOAusente` responde siempre no disponible: se comporta como BzzzBX caído |
| La base falla en un mensaje | No avanza el cursor; se reintenta en la vuelta siguiente |
| Un mensaje que la base rechaza siempre (`22023`, `OP030`) | Se registra en el log con su `bzzzbx_message_id` y se salta, para no frenar la entrada entera [S-12]. Queda visible en la conversación si su hilo es de una request (OPR-27 P-7) |
| Un mensaje que el puerto ya no conoce (`obtenerVarios` no lo trae) | Se ignora |
| El proceso se reinicia | Cursor perdido: recuperación desde la marca de agua (§4.3) |

## 9. Pruebas y criterios de aceptación

### 9.1 pgTAP (`supabase test db`)

Archivo nuevo `entrada_correo.test.sql`, con fixtures propios dentro de la transacción (no depende de la seed):

- sin actor, con actor operador y con los dos a la vez, `ingest_request_email` falla con `42501` y no escribe nada. **Se ve en rojo una vez** quitando `require_system()` en local, además de G6, que ya descubre la función nueva y se ve fallar en cada corrida. G5 y G7 la cubren sin tocarlos;
- `created`: una request `open`, sin dueño, con `received_at` igual al pedido; **todas las columnas `:draft` en `null`, descubiertas por su `COMMENT`** (como G11); un `request_message` original `email` `inbound` con actor `system`; un `request_received` con actor `system`, `occurred_at = received_at` y `details` con los dos crosswalk IDs;
- `duplicate`: el mismo `bzzzbx_message_id` dos veces da una request, un `request_message` y un `request_received`;
- `linked`: un segundo mensaje del mismo hilo se vincula a la misma request, no original, con `email_received`; también si la request está `scheduled`;
- sin hilo: dos mensajes sin hilo dan dos requests;
- `p_bzzzbx_message_id` vacío o `p_received_at` nulo → `22023`;
- un hilo con mensajes vinculados a dos requests distintas (fixture escrita como el dueño) → `OP030`, sin escribir;
- el índice nuevo: insertar a mano un segundo original en el mismo hilo falla con `23505`;
- el catálogo trae `email_received` con label (lo sigue comprobando `audit_catalogo.test.sql`).

**Guard nuevo G15** (G14 es del spec de las etapas, PR #24), en `guard_escrituras.test.sql`: la única función que inserta en `opsrun.request` es `opsrun.ingest_request_email`. Descubre en `pg_proc` las funciones de los esquemas de opsRUN cuyo `prosrc` contiene un `insert into opsrun.request` (sin contar `request_message`, `request_confirmation`, …) y compara con esa sola. **Se ve fallar en cada corrida:** crea dentro de la transacción una función de prueba que inserta una request, comprueba que el guard la detecta y hace rollback. Si una tarjeta futura necesita crear requests de otra forma, el guard falla a propósito y pide la decisión.

### 9.2 Vitest (TDD, cada una en rojo primero)

- `crearEntrada().vuelta()` con un puerto y unos datos de prueba:
  - un cambio de `message` entrante de correo llama a la función una vez; saliente, texto o de otra entidad, ninguna;
  - el orden por `sent_at` y `bzzzbx_message_id`;
  - el cursor avanza solo si todo salió bien; con un fallo de la base, la vuelta siguiente pide desde el mismo cursor;
  - `22023` y `OP030` se saltan y avanzan; cualquier otro error, no;
  - `BzzzbxNoDisponible` no toca el cursor y no llama a la base; el log avisa una vez por caída;
  - sin cursor: pide `cambiosDesde(null)` **antes** de `buscarMensajes`, desde la marca de agua menos 24 h, y pagina con `despuesDe`; sin requests en la base, no busca;
  - `CursorCaducado` deja el cursor en `null` y la vuelta siguiente recupera;
  - `alCrearRequest` se llama solo con `created` y después del commit;
  - **nada de PINCH viaja a la base:** los parámetros de cada llamada son exactamente mensaje, hilo y hora; ni `from`, ni `to`, ni `subject`, ni `body`;
  - el actor es de sistema (`entrada_correo`), nunca operador.
- La tarea `entrada_correo` en el ciclo de fondo: una instancia por proceso y una vuelta a la vez (reloj inyectable, sin esperas).
- Puerto: `buscarMensajes` entra a `probarContratoDeLectura` (orden, filtro, tope de 200, paginación, `hay_mas`) y corre contra el falso y, con `BZZZBX_CONTRATO_REAL=1`, contra el real.
- Falso: el control `correo_nuevo` (§10) genera un mensaje y su cambio, y su respuesta trae los ids.
- Integración contra la base (`OPSRUN_REQUIERE_BASE=1`, en CI): **la carrera**. Dos conexiones llaman a la vez a `ingest_request_email` con dos mensajes distintos de un hilo nuevo; queda una sola request, un original y el otro `linked`. Y con el mismo mensaje en las dos, un solo `request_received`. Cada transacción se deshace al final o usa ids únicos de la prueba.

### 9.3 Playwright (criterios de aceptación)

Contra el build de producción, la seed y el falso, con la entrada corriendo dentro del servidor (§8.1). Cada prueba usa un hilo y un mensaje con id propio (§10), así que no depende de cuántas veces se corrió en la misma base.

| # | Criterio | Cómo se prueba |
|---|---|---|
| E1 | **Llega un correo y aparece la request en el tablero en menos de 1 minuto.** | Con el tablero abierto, `/api/falso` `correo_nuevo`. Se toma la hora y se espera (timeout 60 s) una tarjeta nueva en la columna Requests con `R<n>`, sin dueño, "— —" en ciudad y servicio. Se comprueba que pasaron menos de 60 s. Es el primer paso de E2E-1 |
| E2 | Un correo, una request. | Se vuelve a poner el mismo mensaje (nueva versión, mismo id): tras dos ciclos de sondeo, el conteo de Requests no cambió |
| E3 | **La respuesta va a su hilo.** | `correo_nuevo` con `respuesta_a` el hilo de E1: no aparece otra tarjeta; la de E1 muestra el ícono de chat; en su Job window la conversación muestra la respuesta con "Received", y Audit muestra "Request received" y "Email received" con persona sistema |
| E4 | BzzzBX caído. | `no_disponible` en `true`, `correo_nuevo`, dos ciclos sin tarjeta nueva y el aviso "BzzzBX unavailable"; `no_disponible` en `false`: la tarjeta aparece en menos de 1 minuto |
| E5 | Recuperación. | `reiniciar` el falso (el cursor caduca) y `correo_nuevo`: la tarjeta aparece en menos de 1 minuto. Las requests de la seed no se duplican (el conteo de Requests sube en uno) |
| E6 | AI pending. | La Job window de la request de E1 abre sin sugerencias y sin marcas AI, y las acciones de Requests responden igual que en una request sin borrador (Confirm details en gris con "Complete the details first: …", si OPR-28 ya está). El texto "AI pending" lo verifica OPR-36 |

**Hecho cuando, en local:** E1 a E6 en verde, más `pnpm lint`, `pnpm typecheck`, `pnpm test` y `supabase test db`. El Hecho cuando de la tarjeta (un correo de prueba de verdad es una request en menos de 1 minuto, en staging) espera OPR-14, OPR-6 y staging.

## 10. Cambios propuestos

### 10.1 Migración nueva (pide OK, P-0)

`supabase/migrations/20261204120000_entrada_correo.sql` (va después de la de OPR-28, `2026120112xxxx`, y de la de las etapas de OPR-30/31/32, `20261203120000`), solo hacia adelante, como `opsrun_migrador`.

**No cambia tablas, columnas, tipos, triggers ni vistas `v1_*`.** Agrega:

1. **Función del sistema**, en `opsrun`, `security definer`, dueño `opsrun_migrador`, `set search_path = ''`, llama a `opsrun_private.require_system()` en su propio cuerpo (G6 lo busca en `prosrc`), `revoke all … from public` y `grant execute … to opsrun_app` y a nadie más:

   ```sql
   opsrun.ingest_request_email(
     p_bzzzbx_message_id text,
     p_bzzzbx_thread_id text,      -- null si el correo no tiene hilo
     p_received_at timestamptz
   ) returns table (request_id uuid, outcome text)   -- 'created' | 'linked' | 'duplicate'
   ```

   Hace §5.3 en una transacción: candado del hilo, deduplicación, y en `created` el insert en `request` (solo `received_at`; lo demás por defecto), en `request_message` (original) y el `request_received`; en `linked`, el `request_message` y el `email_received`. Si falla cualquier paso, no queda nada. `received_at` se guarda tal como llega; si viene más de 1 hora en el futuro, se guarda `now()` y `details.clock_skew = true` [S-10].

   Es la `ingest_request_email` de OPR-20 §4. **`link_message` no se crea aquí:** el vínculo de una respuesta lo hace la misma función bajo el mismo candado, que es lo que la hace segura ante carreras. `link_message` queda para mover un mensaje a mano (operador), fuera de alcance.

2. **Índices** en `opsrun.request_message`:
   - `request_message_original_thread_key`: único parcial `(bzzzbx_thread_id) where is_original and bzzzbx_thread_id is not null`, el respaldo de "un hilo, una request" (§5.3). La seed lo cumple: cada original tiene su hilo;
   - `request_message_thread_idx` `(bzzzbx_thread_id)`, para buscar la request de un hilo sin recorrer la tabla.

3. **Catálogo:** `audit_event_type` gana `('email_received', 'Email received', false, 'opsrun', 225)`, en el grupo de mensajes, justo antes de `email_sent` (230) (P-4). `sort_order` es único y 225 está libre. Audit lo muestra solo con su label (OPR-35). El write-back ya expone `event_type`.

4. Sin cambios en el write-back: `request`, `request_message` y `audit_event` ya salen por `v1_*`.

### 10.2 Códigos de error

A partir de `OP030` (OPR-28 usa hasta `OP018` y el spec de las etapas, OPR-30/31/32, PR #24, usa `OP019` a `OP027`; este spec se reserva `OP030` a `OP034`). Se documentan en la cabecera de la migración, como en `20261130120000_conversacion.sql`:

| Código | Cuándo | Lo lanza |
|---|---|---|
| `OP030` | El hilo ya tiene mensajes vinculados a más de una request: no se elige una al azar | `ingest_request_email` |
| `22023` | `p_bzzzbx_message_id` vacío o `p_received_at` nulo | `ingest_request_email` |
| `42501` | Sin actor de sistema o con operador (de `require_system()`) | `ingest_request_email` |

`OP030` no debería pasar con esta tarjeta (solo la entrada vincula correos entrantes); aparece si un día un operador mueve mensajes a mano (`link_message`) o si alguien escribe a mano en la base.

### 10.3 Fuera de la base

- **Puerto:** `buscarMensajes` (§4.3) en `LecturaBzzzbx`, en el falso y en las pruebas de contrato; `lecturaOAusente` lo agrega a su lista.
- **Falso y `/api/falso`:** control nuevo `{ accion: "correo_nuevo", respuesta_a?: string }`. Pone un `Message` entrante de correo inventado (`from: "new.requester@example.test"`, `to: ["requests@example.test"]`, asunto y cuerpo genéricos, `sent_at` = ahora) con ids `bx-msg-9NNN` y, sin `respuesta_a`, un hilo nuevo `bx-thread-9NNN`, con un contador del falso. Los ids `9NNN` no chocan con los de la seed ni con R8 de OPR-28. La respuesta de la ruta pasa a `{ ok: true, bzzzbx_message_id, bzzzbx_thread_id }`. `poner` sigue sirviendo para casos a mano.
- **Seed:** no cambia. Las requests de la seed ya tienen su original vinculado, así que la recuperación las ve como `duplicate`.
- **`src/instrumentation-node.ts`:** arranca el ciclo de fondo (ADR 0006), que corre la tarea `entrada_correo`. Hoy solo hace algo en el servidor; la entrada corre también en local y CI (las E2E la necesitan).
- **Tablero:** "at the top of Requests" (P-8, decidida: el más antiguo arriba, Henry 2026-11-27). No cambia: Requests sigue con la más vieja arriba (OPR-25 S-1); el orden es la constante `ORDEN_DE_REQUESTS`.
- **`CONTEXT.md`:** agregar "Entrada de correo" (el proceso de sistema `entrada_correo`), "Marca de agua" (desde dónde recupera) y "Email received".
- **ADR 0006:** el ciclo de fondo del servidor (P-1): una sola pieza, arrancada por `instrumentation`, que corre varias tareas; la entrada de correo es la primera y el registrador de alertas de OPR-34 (PR #26) corre en el mismo ciclo.

## 11. Supuestos

| # | Supuesto |
|---|---|
| S-1 | El Release Definition §4.3 y el User Guide §4.1 y §3.3 no se pudieron leer. Las reglas salen de las tarjetas OPR-15 y OPR-36, del glosario y de los specs en `main`, y se revisan contra esos documentos. |
| S-2 | Hasta 10 lotes de cambios por vuelta; lo que quede sale en la siguiente. |
| S-3 | `buscarMensajes` ordena por `(sent_at, bzzzbx_message_id)` y devuelve hasta 200 por página. Es provisional hasta OPR-6. |
| S-4 | La marca de agua es la última `received_at` menos 24 h, y la proyección guarda los mensajes al menos ese tiempo. |
| S-5 | Un correo sin hilo es su propia request. |
| S-6 | La entrada no vincula correos salientes. |
| S-7 | La proyección `Message` de correo es solo la del buzón compartido. |
| S-8 | Un hilo es de una sola request para siempre; no hay "separar" en V1.1 beta. |
| S-9 | Si una respuesta llega antes que su original, abre la request; sigue siendo una sola. |
| S-10 | `received_at` es `Message.sent_at`, la única hora que trae el puerto. Una hora más de 1 h en el futuro se guarda como `now()` con marca en `details`. |
| S-11 | El R number puede tener huecos por transacciones fallidas. |
| S-12 | Un mensaje que la base rechaza siempre se salta con log; no hay alerta para eso en V1.1 beta. |

## 12. Preguntas para Henry, con mi recomendación

- **P-0. Migración.** §10.1 agrega una función del sistema, dos índices y un tipo de Audit, sin cambiar tablas, columnas, tipos, triggers ni vistas `v1_*`. Sin ella no hay cómo crear una request. **Recomiendo sí.**
- **P-1. Quién corre la entrada.** Opciones: (a) un bucle cada 15 s dentro del servidor de Next, arrancado por `instrumentation`; (b) colgarla del sondeo del tablero (`/api/tablero/cambios`), como el despacho de OPR-27, sin trabajos de fondo; (c) un proceso o cron aparte. Con (b), un correo de las 3 AM no es request hasta que alguien abre el tablero, y ni OPS-001 ni el análisis "ahead of time" de OPR-36 corren sin request. **Recomiendo (a)**, con su ADR: es el primer trabajo de fondo, no necesita otra imagen ni otro contenedor, y la base deduplica si hay dos procesos.
  - **Decisión:** (a), y es el **único ciclo de fondo de opsRUN**: una sola pieza en el servidor, arrancada por `instrumentation`, que corre varias tareas, cada una con su cadencia y sin pisarse (una vuelta a la vez por tarea). La entrada de correo es la primera tarea; el registrador de alertas de OPR-34 (PR #26) corre en el mismo ciclo, no en otro. Ninguna tarjeta abre un ciclo propio. Va en la ADR 0006. §8.1 ya lo describe así.
- **P-2. Dónde vive el cursor.** (a) En memoria, con la recuperación de §4.3 al arrancar; (b) en una tabla nueva de opsRUN. La recuperación hace falta igual por `CursorCaducado`, así que la tabla solo ahorraría una relectura corta al arrancar, y sería una tabla más para G4 y G9. **Recomiendo (a).**
- **P-3. Vincular por R number o job number en el asunto.** La tarjeta lo pide ("by email conversation and R/job number"). Hoy los correos salientes no llevan el R number en el asunto (BzzzBX pone el asunto, OPR-27 P-2), y buscar "R12" en asuntos de clientes daría falsos positivos ("Room R2"). **Recomiendo solo por hilo en esta tarjeta**, y sumar el R number o el job number cuando OPR-16/OPR-18 fijen un marcador en el asunto (por ejemplo `[R123]`), buscando solo ese marcador y solo cuando el hilo no tenga request.
- **P-4. Audit al vincular una respuesta.** El catálogo no tiene un tipo para un correo entrante. **Recomiendo agregar `email_received` ("Email received")**: es una acción del sistema (el vínculo), da la línea de la respuesta en el Audit de E2E-1 y no copia nada de PINCH. Alternativa: no escribir Audit al vincular, porque el mensaje ya se ve en la conversación.
- **P-5. Corte al salir a producción.** Con la base de producción sin requests, la entrada empieza en "ahora": nada del buzón anterior entra. **Recomiendo así**, y que Operations cargue a mano lo que esté abierto ese día. Alternativa: una variable `OPSRUN_ENTRADA_DESDE` con la fecha de corte, que importaría los correos desde ahí (incluidos los ya atendidos fuera de opsRUN).
- **P-6. Respuestas automáticas, rebotes y spam.** Sin un campo de BzzzBX que los marque y sin forma de cerrar una request sin programarla (OPR-20 §11.6), cualquier filtro escondería correos sin dejar rastro. **Recomiendo no filtrar en esta tarjeta** y llevar a OPR-6 la pregunta de si BzzzBX marca auto-replies y rebotes, y a OPR-20 §11.6 la de cerrar una request.
- **P-7. Cómo pasa la request a la IA.** **Recomiendo que la entrada no cree `ai_analysis` ni instrucciones `ai_*`** (OPR-22 P-3), y deje el enganche `alCrearRequest` más el barrido de requests sin análisis para OPR-36 (§7). Alternativa: crear en la misma transacción un `ai_analysis` `pending`, que hoy exige una instrucción `ai_analyze_request` del catálogo que se va a quitar.
- **P-8. "At the top of Requests".** La tarjeta dice que la request nueva sale arriba; el tablero ordena Requests por `received_at` con la más vieja arriba (OPR-25 S-1, por revisar contra R23). Según `CLAUDE.md`, manda la tarjeta. Mi recomendación era la más nueva arriba; Henry decidió lo contrario (abajo). E1 no depende de la posición.
  - **Decidida (Henry, 2026-11-27):** el más antiguo arriba. Se mantiene el orden actual de Requests (OPR-25 S-1) y OPR-15 no lo cambia.

Con las recomendaciones, OPR-15 trae **una migración** (§10.1), un método nuevo en el puerto con su prueba de contrato, un control del falso, el proceso `src/lib/entrada/` arrancado desde `instrumentation`, un guard nuevo y una ADR.
### 12.1 Decisiones (2026-11-27)

Henry aprobó el spec ("Apruebo los tres specs, con un solo ciclo de fondo") con P-0 a P-7 según las recomendaciones. Quedó así:

- **P-0:** sí a la migración de §10.1: `opsrun.ingest_request_email` (del sistema), los dos índices de `request_message` y el tipo `email_received`, sin cambiar tablas, columnas, tipos, triggers ni vistas `v1_*`. Códigos `OP030` a `OP034`.
- **P-1:** la entrada corre en un ciclo de fondo dentro del servidor de Next, arrancado por `instrumentation`, y ese ciclo es el **único** de opsRUN: una sola pieza que corre varias tareas (la entrada de correo y el registrador de alertas de OPR-34, PR #26, y las que vengan). Se escribe la ADR 0006.
- **P-2:** el cursor vive en memoria, con la recuperación de §4.3 al arrancar y tras `CursorCaducado`. Sin tabla nueva.
- **P-3:** solo se vincula por hilo. El R number o el job number en el asunto esperan al marcador que fijen OPR-16/OPR-18.
- **P-4:** se agrega `email_received` ("Email received") al catálogo de Audit.
- **P-5:** sin importar el buzón anterior: con la base sin requests, la entrada empieza en "ahora".
- **P-6:** no se filtran auto-replies, rebotes ni spam; la pregunta va a OPR-6 y a OPR-20 §11.6.
- **P-7:** la entrada no crea `ai_analysis` ni instrucciones `ai_*`; deja el enganche `alCrearRequest` y el barrido para OPR-36.
- **P-8:** el más antiguo arriba, decidido por Henry 2026-11-27. Se mantiene el orden actual de Requests (OPR-25 S-1); OPR-15 no lo cambia.

OPR-15 trae una migración (P-0), un método nuevo en el puerto con su prueba de contrato, un control del falso, la tarea `entrada_correo` del ciclo de fondo (P-1), el guard G15 y la ADR 0006.

## 13. Lo que espera a otras tarjetas

| Tarjeta | Qué espera |
|---|---|
| **OPR-14** (PINCH IT) | Acceso de BzzzBX al buzón compartido. Sin él no llega ningún correo de verdad; todo lo de este spec corre sobre el falso. |
| **OPR-6** (equipo de BzzzBX) | Que `Message` exista como proyección real con frescura ≤ 1 min y entre en `cambiosDesde`; `buscarMensajes` o su equivalente y la retención de mensajes (§4.3); qué es `bzzzbx_thread_id` (la conversación de Gmail o la de BzzzBX); si `sent_at` es la hora de llegada; si la proyección es solo del buzón compartido (S-7); adjuntos; marca de auto-replies y rebotes (P-6). |
| **OPR-36** (y OPR-11) | Llenar `alCrearRequest` y el barrido; mostrar "AI pending"; proponer cliente y contacto (`sender`), incluida "the real person behind system or portal addresses". |
| OPR-16 / OPR-18 | El marcador en el asunto para vincular por R number (P-3). |
| OPR-20 §11.6 | Cerrar una request que no es trabajo (P-6). |
