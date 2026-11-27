# OPR-27 — Conversation: hilo del job y Composer

- **Tarjeta:** OPR-27 (P2 · Conversation screen). Depende de C · Email sending y C · Texting both ways (los dos sobre el contrato de OPR-6) y de OPR-26 (Job window, spec aprobado el 2026-11-27, en construcción y fuera de `main`).
- **Estado:** borrador para revisión de Henry. Lo marcado **[S-n]** es un supuesto; lo marcado **P-n** es una pregunta para Henry, con mi recomendación (§12).
- **Construye sobre:** el puerto de BzzzBX y su falso (`src/lib/bzzzbx/`, ADR 0005, spec OPR-22), el modelo de datos (OPR-20: `request_message`, `note`, `instruction`, `ai_suggestion`, `audit_event`) y la ranura de la conversación de la Job window (spec OPR-26 §7.1).
- **Referencias que no se pudieron leer:** prototipo R23, User Guide §3.3 y Release Definition §4.10 no están en el repo, que es público, ni se pudieron abrir desde esta cuenta [S-1]. Todo lo visual y los textos de pantalla salen de la tarjeta, del glosario y de los specs de OPR-25 y OPR-26, y se revisan contra esos documentos cuando se puedan ver.
- **Fuera de alcance:** la intake de correos y su enhebrado (OPR-15), los avisos Scheduled y Done (OPR-16, OPR-18), la pregunta al cleaner y su lectura (OPR-17), la alerta Message not delivered (OPR-19, OPR-33, OPR-34), el análisis de IA que produce los borradores (OPR-36, OPR-37), la pestaña Audit (OPR-35) y la instruction layer completa (OPR-23). De OPR-23 este spec toma solo lo mínimo para enviar un correo o un texto en local (§7, P-1).

## 1. Para qué

En la columna izquierda de la Job window el operador ve **un solo hilo por job**: la request original, los correos con el cliente, los textos con el cleaner y las notas internas, cada uno con su color y su estado de entrega. Debajo, el **Composer**, con tres modos: **Customer** (correo), **Cleaner** (texto) y **Note**. Los borradores de la IA aparecen en el Composer para revisarlos, y nunca salen sin que el operador pulse Send. Editar To y Cc y el número temporal se ven, pero no corren.

Para la demo local del lunes (Fase A sobre el stand-in): tablero → Job window → enlace → **conversación** → Audit. En la conversación, el operador lee el hilo de una request de la seed, deja una nota y manda un correo o un texto que el falso acepta, y ve cómo cambia su estado. Lo que necesita envío real o IA queda construido detrás del puerto y se enciende cuando llegue (§3).

## 2. Principios que aplica

- **Un solo dueño.** El cuerpo, el remitente, los destinatarios y la entrega de cada mensaje son de PINCH y se leen por BzzzBX, sin guardarlos. opsRUN guarda solo el vínculo mensaje → request (`request_message`), sus notas (`note`), sus envíos (`instruction`) y las decisiones sobre los borradores de IA (`ai_suggestion`).
- **Toda acción es una instrucción a BzzzBX.** Un correo o un texto sale como `send_email` o `send_text` por el puerto de instrucciones. opsRUN nunca llama directo a Gmail ni al proveedor de SMS. La instrucción lleva lo que escribió el operador y crosswalk IDs, nunca una dirección o un teléfono leídos de PINCH (P-2).
- **Las IAs proponen, el operador confirma.** Un borrador de IA se ve marcado "AI draft" en el Composer. Solo sale si el operador pulsa Send, y entonces queda registrado como aceptado o corregido. No hay ningún camino de código que envíe un borrador sin esa acción (§5.5, prueba en §11).
- **Si la IA falla, se trabaja a mano.** Sin borrador, el Composer está vacío y funciona igual.
- **Todo queda en Audit.** Nota, envío, fallo y decisión sobre un borrador escriben su `audit_event` en la misma transacción que el dato.
- **Lo que no está en V1.1 beta se ve pero no corre.** Edit To, Cc y Temporary number: en gris, y el servidor los rechaza aunque alguien quite el `disabled` (§5.2).

## 3. Qué se construye ya y qué espera

| Pieza | Demo local sobre el falso | Espera |
|---|---|---|
| Leer el hilo (original, correos, textos, notas, con color y estado) | Sí, con los mensajes del falso (`bx-msg-`, `bx-thread-`) y la seed | Nada. Los mensajes reales llegan cuando el puerto real lea la proyección `Message` (OPR-6) |
| Respuesta del cliente que entra al hilo | Sí, si llega por un hilo de la request (`/api/falso` la pone) | La intake y su enhebrado (OPR-15) para vincularla en `request_message` |
| Respuesta del cleaner por texto | No: un texto entrante no tiene hilo y nadie lo vincula todavía | C · Texting both ways y OPR-17 (vínculo del texto entrante con la request) |
| Note | Sí, completa | Nada |
| Customer: componer y enviar correo | Sí, por el puerto de instrucciones al falso | Envío real: C · Email sending sobre OPR-6 |
| Cleaner: componer y enviar texto | Sí, por el puerto de instrucciones al falso | Envío real: C · Texting both ways sobre OPR-6 |
| Estado de un envío (Sending…, Sent, Delivered, Failed, Couldn't confirm) | Sí, con el despacho mínimo de §7 | La instruction layer completa (OPR-23) lo reemplaza o lo extiende |
| Borrador de IA en el Composer, Send = aceptar o corregir, Discard = rechazar | Sí, con un borrador inventado en la seed (P-3) | Que la IA produzca borradores: capa de IA de BzzzBX y OPR-36/OPR-37 |
| Edit To, Cc y Temporary number | Se ven en gris | Un release posterior |
| Hecho cuando de la tarjeta (E2E-1 en staging) | No | OPR-6, el envío real y staging (OPR-40) |

## 4. El hilo

### 4.1 Qué entra

La ranura arma el hilo en su propio server component, con su `Suspense` (OPR-26 §7.1), uniendo cuatro fuentes:

| Fuente | De dónde | Qué aporta |
|---|---|---|
| Mensajes vinculados | `request_message` de la request → `obtenerVarios("message", ids)` del puerto | Original, correos y textos que la intake o un envío vincularon |
| Mensajes de los hilos de la request | `listarPor("message", { bzzzbx_thread_id })` por cada hilo de `hilos` | Respuestas de correo que aún nadie vinculó [S-2] |
| Envíos en curso o fallidos | `instruction` de la request con tipo `send_email` o `send_text` y sin `request_message` | El cuerpo que escribió el operador (`payload.body`) mientras el mensaje no existe en PINCH |
| Notas | `note` de la request | Notas internas |

Reglas de la unión:

- Un mensaje aparece una sola vez (por `bzzzbx_message_id`).
- Un envío con `request_message` se ve como el mensaje leído de BzzzBX, no como la instrucción.
- **Duplicado breve:** el falso, como el real, crea el `Message` en cuanto lo observa, y la instrucción se cierra un poco después. Mientras tanto, un mensaje saliente sin vincular de un hilo de la request se oculta si hay una instrucción `send_email` abierta (`pending` o `sent`) de esa request, en ese hilo y con el mismo cuerpo [S-3]. Así no se ven dos burbujas.
- Orden: por hora, la más vieja arriba (`sent_at` del mensaje, `created_at` de la nota o de la instrucción). El original va primero aunque otra hora sea anterior.
- Un texto entrante sin hilo y sin `request_message` no aparece: no hay cómo saber de qué request es (espera C · Texting both ways).

Todo esto lo arma una función pura `armarHilo({ vinculos, mensajes, instrucciones, notas, operadores, ahora, zona })` en `src/lib/conversacion/`. Es lo que prueban los unitarios.

### 4.2 Cada entrada

| Tipo | Cómo se reconoce | Etiqueta | Color [S-4] | Lado |
|---|---|---|---|---|
| Original request | `request_message.is_original` | "Original request" | Neutro | Izquierda |
| Customer email | `channel = email` | "Email" + remitente o destinatario | Azul | Entrante a la izquierda, saliente a la derecha |
| Cleaner text | `channel = text` | "Text" + equipo o teléfono | Verde | Entrante a la izquierda, saliente a la derecha |
| Internal note | `note` | "Internal note" + autor | Ámbar | Derecha |

Cada entrada lleva `data-tipo="original|email|text|note"` y `data-direccion`, para que los E2E no dependan del color. Muestra: etiqueta, hora en la zona de la operación (`zona`, OPR-25 S-6), asunto si es un correo, cuerpo como texto plano (nunca HTML del correo [S-5]) y el estado de §4.3. Los adjuntos no se muestran en V1.1 beta: el puerto no los trae (OPR-22 S-1) [S-5].

### 4.3 Estado de entrega

| Situación | Fuente | Se ve |
|---|---|---|
| Entrante | `Message.direction = inbound` | "Received" |
| Envío guardado, sin entregar a BzzzBX | `instruction.status = pending` | "Sending…" |
| BzzzBX lo aceptó | `instruction.status = sent` | "Sent" |
| BzzzBX lo observó en el origen | `Message.delivery`: `queued` → "Queued", `sent` → "Sent", `delivered` → "Delivered", `failed` → "Not delivered" | Ese texto |
| Falló | `instruction.status = failed` | "Failed · `error_message`" en rojo, y **Edit and resend** |
| No se pudo confirmar | `instruction.status = timed_out` | "Couldn't confirm" |
| Nota | `note` | "Internal · not sent" |

"Not delivered" y "Failed" se ven en rojo, con `role="status"`. **Edit and resend** copia el cuerpo al Composer en el mismo modo; enviar crea una instrucción nueva, no reintenta la vieja [S-6]. La alerta Message not delivered es de OPR-19 y OPR-34.

### 4.4 Refresco

El mismo sondeo de la Job window (OPR-26 §8.3, cada 15 s con `router.refresh()`). Una nota o un envío propio se ven enseguida porque la acción pide el refresco (OPR-26 §5.4, paso 5). Un cambio de estado o una respuesta se ven en menos de 1 minuto.

## 5. Composer

### 5.1 Modos

Tres pestañas sobre la caja de texto: **Customer**, **Cleaner**, **Note**. El modo inicial es Note [S-7]. Cada modo tiene su borrador en el navegador mientras la ventana está abierta; cambiar de modo no borra lo escrito.

| Modo | Disponible cuando | Si no, en gris con |
|---|---|---|
| Customer | `puedeEnviar` y la request tiene un hilo de correo (`hilos` no vacío) | "BzzzBX unavailable", "Job cancelled" o "No email thread for this request" |
| Cleaner | `puedeEnviar` y hay cleaner: el del job (`Job.bzzzbx_team_id`) desde Scheduled, el del borrador (`request.bzzzbx_team_id`) en Requests | "BzzzBX unavailable", "Job cancelled" o "Choose a cleaner first" |
| Note | La etapa no es `cancelled` | "Job cancelled" [S-8] |

Con BzzzBX caído, Note sigue disponible: solo escribe en opsRUN (OPR-26 S-13).

Límites [S-9]: Note hasta 4 000 caracteres, correo hasta 10 000, texto hasta 1 600. Contador visible. **Send** queda deshabilitado con el cuerpo vacío o solo espacios, o pasado el límite.

### 5.2 Destinatarios y lo que no corre

| Control | Qué muestra | Corre |
|---|---|---|
| To (Customer) | El remitente del original del hilo, leído del puerto (`Message.from`), solo lectura | No se edita |
| Cc (Customer) | `— —`: el puerto no trae Cc [S-10] | No |
| To (Cleaner) | Nombre y teléfono del equipo (`CleanerTeam`), solo lectura | No se edita |
| **Edit To**, **Cc**, **Temporary number** | En gris, `aria-disabled="true"`, título "Available in a later release" (P-4) | No |

Lo que se muestra en To no viaja en la instrucción: BzzzBX resuelve el destinatario con el crosswalk ID (P-2). Así no se copia ninguna dirección de PINCH a opsRUN.

Los controles en gris no tienen Server Action. Si alguien quita el `disabled`, no hay nada que llamar; y `ejecutarAccion` rechaza cualquier `datos` con `to`, `cc` o `from_number` con `no_disponible` (prueba en §11).

### 5.3 Enviar un correo o un texto

Customer y Cleaner pasan por `ejecutarAccion` (OPR-26 §5.4) como acciones internas `send_email` y `send_text`, igual que `reject_job_link` en OPR-28. Heredan la disponibilidad calculada en el servidor, el actor de la transacción (en la demo, el "Acting as" de OPR-26 P-2) y el refresco.

1. El navegador llama a `ejecutarAccion({ codigo: "send_email", motivo: null, datos: { body, ai_suggestion_id? }, version })`.
2. `ejecutarAccion` recalcula la disponibilidad del modo (§5.1) con los datos del momento. Sin `concurrencia` (P-6): un cambio en la request no rechaza un mensaje.
3. El ejecutor llama a `opsrun.send_email(...)` (§8) como operador. En una sola transacción la función crea la `instruction` (`pending`, con la clave de idempotencia del formulario, S-12), su Audit `email_sent` y, si vino un borrador, su decisión (§5.5).
4. Ya confirmada la transacción, el despacho (§7) llama a `entregar` del puerto. La respuesta al navegador no espera el resultado: `{ tipo: "instruccion", idempotency_key }`.
5. La burbuja aparece con "Sending…" y avanza con el sondeo (§4.3).

Payload (P-2):

| Tipo | Payload |
|---|---|
| `send_email` | `{ bzzzbx_thread_id, body }`. El hilo es el del original de la request [S-11]; BzzzBX responde en él y pone asunto y destinatarios |
| `send_text` | `{ bzzzbx_team_id, body }`. BzzzBX resuelve el teléfono del equipo |

Una acción `send_*` con instrucción abierta no bloquea la siguiente: el operador puede mandar dos mensajes seguidos. Cada Send es una instrucción con su clave, y un doble clic no duplica: el botón se deshabilita hasta que vuelve `ejecutarAccion`, y el formulario lleva una clave de envío que el ejecutor usa como `idempotency_key` [S-12].

### 5.4 Note

`ejecutarAccion({ codigo: "add_note", datos: { body } })` → `opsrun.add_note(request_id, body)`: escribe la nota y su Audit `note_added` (`details.note_id`). No sale nada a BzzzBX. Las notas no se editan ni se borran (OPR-20 §11.8, append-only) [S-13].

### 5.5 Borradores de IA

- Un borrador es una fila de `ai_suggestion` **sin decidir**, con `field = draft_customer_reply` (Customer) o `draft_cleaner_text` (Cleaner) y `value = { "body": "…" }` [S-14]. Si hay varios sin decidir del mismo campo, manda el más reciente con `rank = 1`.
- Al abrir el modo, el Composer trae el cuerpo del borrador con la marca **AI draft**, su `reason` y un botón **Discard**. Si el operador ya escribió en ese modo, el borrador no pisa su texto: aparece un aviso "AI draft available · Use it".
- El operador edita libremente. **Send** manda lo que está en la caja, no el borrador, y pasa `ai_suggestion_id`. La función de envío decide el borrador en la misma transacción: `accepted` si el cuerpo es igual al propuesto, `corrected` con `final_value = { body }` si no, con su Audit `ai_suggestion_accepted` o `ai_suggestion_corrected`.
- **Discard** → `opsrun.discard_ai_draft(ai_suggestion_id)`: `rejected` y Audit `ai_suggestion_rejected`. El borrador no vuelve a aparecer.
- **Nada sale solo.** Las únicas funciones que crean un `send_*` son `opsrun.send_email` y `opsrun.send_text`, que llaman a `require_operator()`: un proceso del sistema o de la IA no puede llamarlas. El despacho (§7) solo entrega instrucciones que ya existen en la base; no crea ninguna. Ninguna ruta, trabajo de fondo ni ejecutor de IA llama a `ejecutarAccion` con `send_*`. Las pruebas de §11 lo fijan y se ven fallar una vez.
- Pedir un borrador ("Draft with AI") no está en OPR-27: los borradores llegan con el análisis de la IA (OPR-36, OPR-37) por la capa de IA de BzzzBX (OPR-22 P-3). Sin borrador no se muestra nada de IA.

## 6. Encaje en la ranura de OPR-26 §7.1

No cambia el contrato de props:

```ts
type PropsRanuraConversacion = PropsRanuraBase & {
  hilos: string[];      // request_message.bzzzbx_thread_id, el original primero
  puedeEnviar: boolean; // false con BzzzBX caído o job cancelado
};
```

Cómo lo usa OPR-27:

- `hilos`: para `listarPor("message")` (§4.1) y para el hilo de la respuesta (`hilos[0]`, S-11).
- `puedeEnviar`: habilita Customer y Cleaner. Note no depende de él, sino de `etapa !== "cancelled"` (§5.1).
- `bzzzbx.disponible = false`: el hilo muestra lo último leído de esa request (como OPR-26 §6.1) con "BzzzBX unavailable · last update HH:MM" encima. Si nunca se leyó, las notas y los envíos se ven igual (son de opsRUN) y en lugar de los mensajes, "Messages unavailable".
- Lo demás (request, `request_message`, `note`, `instruction`, `ai_suggestion` y el equipo) lo lee la ranura en su server component, con `opsrun_app` y el puerto, para no frenar el encabezado.
- Las Server Actions no viajan por props: el Composer importa `ejecutarAccion`, el único camino.

**Un cambio chico al registro de acciones de OPR-26 §5.4 (P-6):** `DefinicionAccion` gana `concurrencia: "request" | "ninguna"` (por defecto `"request"`), y `ejecutarAccion` salta el chequeo de `change_seq` cuando es `"ninguna"`. Lo usan `add_note`, `send_email`, `send_text` y `discard_ai_draft`. Si OPR-26 se fusiona antes, este cambio entra con OPR-27.

## 7. Despacho mínimo de instrucciones (provisional hasta OPR-23)

OPR-23 está bloqueada por OPR-2 y sin spec. Para que un Send llegue al falso hace falta entregar la instrucción y escribir su resultado. Este spec propone lo mínimo, genérico por tipo para que OPR-23 lo extienda y no lo tire (P-1). Vive en `src/lib/instrucciones/` y solo actúa sobre `send_email` y `send_text`.

- **Entregar.** Después de confirmar la transacción del operador, `entregar` con la `idempotency_key`, el `tipo`, el `payload` y el actor operador. Si acusa, `opsrun.record_instruction_delivery(key, bzzzbx_reference)` como sistema (`sent`, `sent_at`, `attempts + 1`). Si lanza `BzzzbxNoDisponible`, la instrucción queda `pending` y se reintenta con la misma clave. Si lanza `InstruccionRechazada`, `opsrun.resolve_instruction(key, 'failed', …)`.
- **Reconciliar.** `reconciliarInstrucciones()` toma las `send_*` abiertas (`pending` o `sent`) y, por cada una, pide `estado(key)` (o vuelve a `entregar` si sigue `pending`) y escribe el cierre con `opsrun.resolve_instruction` como sistema (`opsrun.system_actor = 'reconciliador'`). Traducción de OPR-22 §4.3: `confirmada` → `confirmed` (con `datos.bzzzbx_message_id`, la función crea el `request_message` saliente con su `instruction_id`), `fallida` → `failed`, `sin_confirmar` → `timed_out`, `en_curso` con paso `dispatched` o posterior → `sent`.
- **Cuándo corre.** Al final del ejecutor de `send_*` y en cada llamada a `/api/tablero/cambios`, a lo sumo una vez cada 5 s por proceso [S-15]. Sin trabajos de fondo nuevos. Es sin estado: lee las abiertas de la base y pregunta por clave, así que un reinicio no pierde nada.
- No hay reintento automático de una `failed`: el operador usa Edit and resend.

## 8. Migración (sí hace falta)

Hoy no existe ninguna función de escritura para notas, envíos ni resultados de instrucciones, y `opsrun_app` no puede escribir tablas. OPR-27 necesita **una migración nueva** (P-0), tentativamente `supabase/migrations/20261130120000_conversacion.sql`, que corre como `opsrun_migrador` después de `20261125120000_fase_a_enlace.sql`, solo hacia adelante. **No cambia tablas, tipos, triggers, catálogos ni vistas del write-back**: los tipos de Audit que usa (`note_added`, `email_sent`, `text_sent`, `instruction_failed`, `ai_suggestion_*`) y las columnas ya están en OPR-20.

Funciones, todas `security definer`, `set search_path = ''`, dueño `opsrun_migrador`, con `grant execute` a `opsrun_app`, con los nombres de OPR-20 §4 donde existen:

| Función | Actor | Qué hace |
|---|---|---|
| `opsrun.add_note(p_request_id uuid, p_body text) returns uuid` | operador | Valida cuerpo (recortado, 1–4 000). Escribe `note` y Audit `note_added` con `details.note_id`. |
| `opsrun.send_email(p_request_id uuid, p_bzzzbx_thread_id text, p_body text, p_idempotency_key text, p_ai_suggestion_id uuid default null) returns uuid` | operador | Valida cuerpo (1–10 000) y que el hilo sea de la request (`request_message`). Crea `instruction` (`send_email`, `pending`, payload `{ bzzzbx_thread_id, body }`) y Audit `email_sent` con `instruction_id`. Decide el borrador si viene. |
| `opsrun.send_text(p_request_id uuid, p_bzzzbx_team_id text, p_body text, p_idempotency_key text, p_ai_suggestion_id uuid default null) returns uuid` | operador | Igual, con `send_text`, payload `{ bzzzbx_team_id, body }`, límite 1 600 y Audit `text_sent`. Que el equipo sea el del job lo valida el servidor con el puerto; la base no lee BzzzBX. |
| `opsrun.discard_ai_draft(p_ai_suggestion_id uuid)` | operador | Solo `draft_customer_reply` o `draft_cleaner_text` sin decidir. `rejected` y Audit `ai_suggestion_rejected`. |
| `opsrun.record_instruction_delivery(p_idempotency_key text, p_bzzzbx_reference text)` | sistema | `pending` → `sent`, `sent_at`, `attempts + 1`, `bzzzbx_reference`. Repetirla no cambia nada. |
| `opsrun.resolve_instruction(p_idempotency_key text, p_status opsrun.instruction_status, p_bzzzbx_reference text, p_error_code text, p_error_message text, p_bzzzbx_message_id text default null)` | sistema | Avanza el estado (el trigger de OPR-20 impide volver atrás), `resolved_at`. Con `failed`, Audit `instruction_failed`. Con `confirmed` y un `send_*`, crea el `request_message` saliente (`instruction_id`, actor `system`). Repetirla con el mismo cierre no cambia nada. |

La decisión del borrador dentro de `send_*`: el borrador debe ser de la request, del campo del canal y estar sin decidir; si no, error y no se crea la instrucción. `accepted` si `trim(body)` es igual a `trim(value->>'body')`; si no, `corrected` con `final_value = jsonb_build_object('body', body)`.

`record_instruction_delivery` y `resolve_instruction` las usarán también OPR-23 y las tarjetas de etapa. Si OPR-23 decide otra forma, se cambia en su migración.

Seed (no es migración): el borrador inventado de P-3 y lo que ya pide OPR-26 (P-2, P-3).

## 9. Cambios en el puerto y el falso

Provisionales hasta OPR-6, como el `price` de OPR-26 P-6:

- **Payload con crosswalk IDs (P-2).** El falso acepta `send_email` con `bzzzbx_thread_id` y `body`, y `send_text` con `bzzzbx_team_id` y `body`. Resuelve él los destinatarios: el `from` del primer mensaje entrante del hilo y el `phone` del equipo. Rechaza con `invalid_payload` un hilo o un equipo que no conoce. Deja de exigir `to` (hoy lo exige, y el `send_text` de la seed de R2 ya no lo trae). La prueba de contrato de instrucciones se actualiza.
- **Error forzado por HTTP.** `/api/falso` gana la acción `forzar_error` (`{ tipo, cuando, error_message? }`), que llama a `falso.instrucciones.forzarError`. Los E2E no pueden poner `__forzar_error` en un payload que escribe el servidor.
- **Mensaje nuevo de prueba.** Ya existe: `/api/falso` con `poner` y `entidad: "message"` deja una respuesta entrante en un hilo.

## 10. Estados no disponibles

| Caso | Hilo | Composer |
|---|---|---|
| BzzzBX caído | Lo último leído con aviso; notas y envíos de opsRUN visibles | Customer y Cleaner en gris "BzzzBX unavailable"; Note disponible. Un envío ya guardado queda "Sending…" y sale cuando BzzzBX vuelve (§7) |
| Job `cancelled` | Solo lectura | Todo en gris "Job cancelled" (OPR-26 S-3) |
| Request sin hilo de correo | Lo que haya | Customer en gris "No email thread for this request" |
| Sin cleaner | — | Cleaner en gris "Choose a cleaner first" |
| Un mensaje vinculado que BzzzBX no conoce | "Message not found in BzzzBX" en su lugar | — |
| Error de la acción (`rechazada`) | — | El mensaje bajo la caja; el texto escrito no se borra |

## 11. Pruebas

### 11.1 Vitest (TDD, cada una en rojo primero)

- `armarHilo`: las cuatro fuentes, sin duplicados, el original primero, el orden por hora, `data-tipo` y lado, cada fila de §4.3, el duplicado breve de S-3 (oculto con instrucción abierta, visible sin ella), mensaje vinculado desconocido.
- Disponibilidad del Composer por modo (§5.1), con BzzzBX caído, job cancelado, sin hilo y sin cleaner.
- Ejecutores `send_email` y `send_text`: el payload tiene solo `bzzzbx_thread_id` o `bzzzbx_team_id` y `body`, nunca una dirección ni un teléfono; `datos` con `to`, `cc` o `from_number` → `rechazada: no_disponible` sin tocar la base ni el puerto.
- **Guard "nada sale solo":** (a) `ejecutarAccion` con `send_*` y actor sistema → rechazada sin llamar a la base ni al puerto; (b) el despacho no crea instrucciones: con una base sin `send_*` abiertas, `reconciliarInstrucciones()` no llama a `entregar`; (c) una prueba que descubre en el disco (`src/**`) todas las llamadas a `ejecutarAccion` con un código `send_*` y a `opsrun.send_email` / `opsrun.send_text`, y falla si alguna está fuera del Composer o de su ejecutor. Cada una se ve fallar una vez (principio 8).
- Despacho: acuse → `record_instruction_delivery`; `BzzzbxNoDisponible` → sigue `pending` y el reintento usa la misma clave; `InstruccionRechazada` → `failed`; cada `Resultado` → su estado; repetir la reconciliación no escribe dos veces.
- Falso: payload con hilo y con equipo, resolución de destinatarios, rechazo de hilo o equipo desconocido; contrato de instrucciones actualizado; `forzar_error` por `aplicarControl`.
- Componentes (Testing Library): pestañas de modo, Send deshabilitado vacío, con espacios y pasado el límite, controles en gris no enfocables como acción, marca AI draft, aviso "AI draft available" sin pisar lo escrito, Edit and resend.

### 11.2 pgTAP (`supabase test db`)

Archivo nuevo `conversacion.test.sql`:

- Cada función de operador falla con actor sistema y sin actor; cada función de sistema falla con actor operador. G6 (o su equivalente por descubrimiento) las encuentra solas, y la prueba se ve fallar una vez quitando `require_operator()` de `add_note`.
- `add_note`: cuerpo vacío o con solo espacios → error; nota y `note_added` en la misma transacción.
- `send_email`: hilo de otra request → error; crea `instruction` `pending` con payload sin direcciones y `email_sent` con su `instruction_id`.
- Borrador: de otra request, de otro campo o ya decidido → error y sin instrucción; igual → `accepted`; distinto → `corrected` con `final_value`.
- `resolve_instruction`: `confirmed` con mensaje crea un solo `request_message` saliente; repetirla no duplica; `failed` escribe `instruction_failed`; no se puede volver de `confirmed` a `sent`.
- Los guards de OPR-20 siguen en verde (funciones nuevas con `search_path` vacío, dueño `opsrun_migrador`, sin privilegios de más).

### 11.3 Playwright (criterios de aceptación)

Contra el build de producción, la seed (con P-3 y lo de OPR-26) y el falso, con el actor "Acting as" de OPR-26 P-2. R2 es la request de la seed que espera al cleaner: tiene original (`bx-msg-0002`), texto al cleaner (`bx-msg-0102`) y una nota.

| # | Criterio | Cómo se prueba |
|---|---|---|
| C1 | **El hilo de R2 se lee completo.** | En `data-ranura="conversacion"`: primero el original con "Original request"; después el texto a Team Alpha con "Delivered"; la nota "Requester prefers mornings." con "Internal note". Cada uno con su `data-tipo`, en orden por hora. |
| C2 | El encabezado no espera al hilo. | Se repite A1 de OPR-26 en R2: encabezado y action bar en < 2 s. |
| C3 | **Note.** | Modo Note, se escribe y se pulsa Send: la nota aparece abajo con el operador de "Acting as"; el cursor de `/api/tablero/cambios` cambia (Audit `note_added`). Vacía o con espacios, Send deshabilitado. |
| C4 | **Correo al cliente.** | Modo Customer: To muestra `contact.one@example.test`, solo lectura. Se envía: la burbuja sale "Sending…" y, en menos de 1 minuto, "Sent" con el `data-tipo="email"` del mensaje leído del falso, una sola burbuja. |
| C5 | **Texto al cleaner.** | Modo Cleaner: To muestra Team Alpha. Se envía y pasa a "Sent" como en C4, con `data-tipo="text"`. |
| C6 | Fallo visible y reenviable. | `/api/falso` `forzar_error` (`send_email`, `al_ejecutar`). Se envía: en menos de 1 minuto "Failed · Forced error (stand-in)." en rojo. Edit and resend deja el cuerpo en el Composer. |
| C7 | **Lo de un release posterior no corre.** | Edit To, Cc y Temporary number con `aria-disabled` y "Available in a later release"; un clic no cambia nada. Se quita el `disabled` con `page.evaluate` y nada se envía: el cursor de cambios no se mueve. |
| C8 | **Borrador de IA, sin envío solo.** | R2, modo Customer: el borrador inventado de la seed con "AI draft". Se espera un ciclo de sondeo: ninguna burbuja nueva y el cursor de cambios sin moverse. Se edita y se envía: sale el texto editado, y el borrador ya no aparece. Con otro borrador, Discard lo quita sin enviar nada. |
| C9 | Respuesta del cliente. | `/api/falso` pone un correo entrante en `bx-thread-0002`; en menos de 1 minuto aparece con "Received". |
| C10 | BzzzBX caído. | Con la ventana abierta, `/api/falso` pone `no_disponible`: el hilo conserva lo leído con el aviso; Customer y Cleaner en gris "BzzzBX unavailable"; una nota se guarda y se ve. |
| C11 | Sin cleaner y sin hilo. | En R1, Cleaner en gris "Choose a cleaner first". Una request sin hilo de correo (por `/api/falso` o la seed de OPR-26), Customer en gris. |
| C12 | Job cancelado. | Un job cancelado por `/api/falso`: el hilo se ve, los tres modos en gris "Job cancelled". |

**Hecho cuando, en local:** C1 a C12 en verde, más `pnpm lint`, `pnpm typecheck`, `pnpm test` y `supabase test db`. El Hecho cuando de la tarjeta (los pasos de conversación de E2E-1 en staging) espera OPR-6, el envío real y staging (OPR-40).

## 12. Supuestos y preguntas

### 12.1 Supuestos

| # | Supuesto |
|---|---|
| S-1 | **R23, User Guide §3.3 y Release Definition §4.10 no están disponibles.** Distribución, colores, textos y modos salen de la tarjeta, del glosario y de OPR-25/OPR-26. Se revisan contra esos documentos. |
| S-2 | El hilo muestra los mensajes de los hilos de la request aunque nadie los haya vinculado todavía (P-7). Vincularlos (Audit, alertas) es de la intake (OPR-15). |
| S-3 | El duplicado breve entre el mensaje observado y la instrucción abierta se resuelve por request, hilo y cuerpo igual. |
| S-4 | Colores: neutro el original, azul el correo, verde el texto, ámbar la nota. |
| S-5 | Los cuerpos se muestran como texto plano y sin adjuntos: el puerto trae `body` como texto y no trae adjuntos. |
| S-6 | Edit and resend crea una instrucción nueva; no hay reintento de la fallida. |
| S-7 | El Composer abre en Note. |
| S-8 | Con el job cancelado tampoco se escriben notas, como el resto de la ventana (OPR-26 S-3). |
| S-9 | Límites: nota 4 000, correo 10 000, texto 1 600 caracteres. |
| S-10 | El puerto no trae Cc; se ve `— —`. |
| S-11 | Una respuesta al cliente va en el hilo del original (`hilos[0]`). No se abre un hilo nuevo desde opsRUN. |
| S-12 | La clave de idempotencia de un Send la genera el formulario y es la `idempotency_key` de la instrucción (OPR-22 S-7 pide que coincida con el id; se puede usar el mismo valor como `id`). |
| S-13 | Las notas son append-only (OPR-20 §11.8 sigue abierta). |
| S-14 | El valor de un borrador de IA es `{ "body": "…" }`. |
| S-15 | La reconciliación corre al enviar y en el sondeo del tablero, a lo sumo cada 5 s por proceso. |
| S-16 | El Audit de un envío (`email_sent`, `text_sent`) se escribe cuando el operador envía, con su `instruction_id`; el resultado se ve en la instrucción y, si falla, en `instruction_failed`. |

### 12.2 Preguntas para Henry

- **P-0. ¿Migración?** Sí hace falta: §8 agrega seis funciones y ningún cambio de tablas. Sin ellas no se puede escribir una nota ni un envío. Recomiendo **aprobarla** con ese alcance. Pide tu OK.
- **P-1. ¿Despacho mínimo en OPR-27 o esperar a OPR-23?** OPR-23 está bloqueada por OPR-2. Recomiendo **el despacho mínimo de §7** en `src/lib/instrucciones/`, genérico por tipo, sin estado y limitado a `send_*`, para que la demo envíe al falso y OPR-23 lo extienda. Alternativa: en la demo, Customer y Cleaner solo guardan la instrucción y se quedan en "Sending…".
- **P-2. ¿Payload con crosswalk IDs?** El falso hoy exige `to` con direcciones, y eso copiaría datos de PINCH a `instruction.payload`, que según OPR-20 no lleva nada leído de PINCH. Recomiendo **hilo o equipo por crosswalk ID** y que BzzzBX resuelva el destinatario; cambia el falso y la prueba de contrato, provisional hasta OPR-6, y se confirma con el equipo de BzzzBX en OPR-6.
- **P-3. ¿Borrador inventado en la seed?** Sin IA no hay borradores, y la demo no podría mostrar "las IAs proponen, las personas firman". Recomiendo **agregar a R2 un `draft_customer_reply` sin decidir**, inventado (cambio de seed, no de migración).
- **P-4. ¿Qué texto llevan Edit To, Cc y Temporary number?** La tarjeta dice "shown as later"; el tablero usa "Available in a later release" y la Job window "Not available in this release" para $ y People. Recomiendo **"Available in a later release"**, como dice la tarjeta, y anotarlo en `CONTEXT.md`.
- **P-5. ¿En la Fase A, el Composer envía en staging y producción?** La Fase A casi no manda instrucciones (Runbook §6.1, OPR-22 P-4), pero sin envío la conversación no está en un solo lugar. Recomiendo **construir el envío ahora sobre el falso** y decidir si se enciende en la Fase A cuando OPR-6 confirme `send_email` y `send_text`; mientras, Note y la lectura del hilo valen para la Fase A.
- **P-6. ¿Saltar el chequeo de concurrencia en el Composer?** Con el `change_seq` de OPR-26 §5.4, una nota se rechazaría porque alguien asignó la request. Recomiendo **`concurrencia: "ninguna"`** para `add_note`, `send_*` y `discard_ai_draft`: no dependen del estado de la request. Es un campo nuevo en el registro de OPR-26.
- **P-7. ¿Mostrar mensajes de los hilos que nadie vinculó?** Recomiendo **sí** (S-2): sin intake (OPR-15), es la única forma de ver una respuesta del cliente en la demo, y no guarda nada. Alternativa: solo lo vinculado en `request_message`, y las respuestas esperan a OPR-15.

Con las recomendaciones, OPR-27 trae **una migración** (§8, solo funciones), cambia la seed (P-3), el falso y su prueba de contrato (P-2, §9), y agrega un campo al registro de acciones de OPR-26 (P-6).
