# OPR-19 — Estado de entrega y alerta "Message not delivered"

- **Tarjeta:** OPR-19 (C · Delivery status and "Message not delivered" alert). Leída en Relevo el 2026-11-27. Depende, según la tarjeta, de C · Email sending (OPR-16), C · Texting both ways (OPR-17) y P4 · Alerts tab (OPR-34). `PLAN.md` §5 ya anota que no lista la regla que calcula la alerta (OPR-33). La tarjeta es información; este spec manda sobre la construcción.
- **Estado:** borrador para Henry. **No hay código ni migración escritos.** Lo marcado **[S-n]** es un supuesto; lo marcado **P-n** es una pregunta para Henry, con mi recomendación primero (§13).
- **Hecho cuando (tarjeta):** un texto a un número inválido y un correo a una dirección inválida salen como "failed" y abren la alerta. Qué parte se acepta en la Fase A y qué parte espera la Fase B está en §3.
- **Construye sobre (en `main`):** el puerto de BzzzBX y su falso (`src/lib/bzzzbx/`, ADR 0005, spec OPR-22), la conversación con su estado de entrega y Edit and resend (`docs/spec/opr-27-conversacion.md` §4.3 y S-6, `src/lib/conversacion/armar-hilo.ts`), el despacho y la reconciliación de envíos como tarea del ciclo de fondo (`src/lib/instrucciones/`, spec OPR-27 §7, ADR 0006) y el modelo de datos (`request_message`, `instruction`, `alert_occurrence`, `audit_event`, spec OPR-20).
- **Depende de un spec aprobado y sin fusionar, sin redefinirlo:** `docs/spec/opr-34-alerts.md` (aprobado el 2026-11-27, en construcción en otro PR). Este spec usa sus conceptos (las secciones Needs action, Waiting y Resolved, el criterio único "qué alertas son de una request", el registrador de alertas del ciclo, el reparto regla → acción que la arregla, la constante provisional de la regla Message not delivered de su P-12 y el reparto de §4.1 que da "Fixed by action") y **no supone nombres de archivo** del código que esa implementación todavía no fusionó.
- **Referencias sin acceso [S-1]:** el Release Definition §4.10 y §5 (donde se agrega la alerta) y el prototipo R23 no están en este repo, que es público, y no se pudieron leer. Lo que sigue sale de la tarjeta, de `CONTEXT.md`, de los specs y del código en `main`.

## 1. Para qué

Cada mensaje saliente del hilo dice si llegó: **Sent**, **Delivered**, **Failed** o **Bounced**. Cuando un texto falla o un correo rebota, se abre la alerta estándar **Message not delivered** (la novena), que aparece en la pestaña Alerts del job y en el panel de Alerts de la barra superior, con su arreglo: revisar la dirección o el número y volver a enviar.

### 1.1 Fuera de alcance

- **Enviar de verdad.** El envío real de correos (OPR-16, sobre OPR-14) y de textos (OPR-17, sobre OPR-5 y OPR-13) es de la Fase B (§3). Este spec no lo enciende ni decide cuándo se enciende.
- **Calcular la alerta.** Si un mensaje abre o cierra Message not delivered lo decide Signal Maker en BzzzBX (OPR-33). opsRUN nunca decide que una alerta abre o cierra: la lee (spec OPR-34 §1.1).
- **Construir la pestaña Alerts, el panel o el registrador.** Son de OPR-34. Aquí solo se especifica cómo encaja esta regla en ellos (§7).
- **Corregir la dirección o el número.** La dirección del contacto y el teléfono del equipo son de PINCH. Editar To y Cc o usar un número temporal sigue en gris con "Available in a later release" (OPR-27 P-4). El operador los corrige en las herramientas de PINCH.
- **Reintentar solo.** Ningún envío fallido se reintenta sin un operador (OPR-27 §7 y S-6). La alerta no envía nada.
- **Avisarle a BzzzBX que la alerta se arregló** (`acknowledge_alert`): Fase B, como en OPR-34 §1.1.

## 2. Principios que aplica

- **Un solo dueño.** El estado de entrega de un mensaje es de PINCH (del proveedor de correo o de SMS) y se lee por BzzzBX en `Message.delivery`, al pintar, sin guardarlo. La alerta abierta es de Signal Maker. Lo único que opsRUN guarda es lo que ya guarda OPR-34: el historial de la ocurrencia y su Audit.
- **Toda acción es una instrucción a BzzzBX.** Volver a enviar es un `send_email` o `send_text` nuevo por el Composer (OPR-27 §5.3). La alerta no tiene camino propio para enviar.
- **Las personas firman.** El botón de la alerta solo lleva el foco al mensaje y su Edit and resend solo copia el cuerpo al Composer. Sale algo únicamente si el operador pulsa Send (OPR-27 §5.5, "nada sale solo").
- **El trabajo de fondo, solo en el ciclo único (ADR 0006).** OPR-19 no suma tareas ni temporizadores. La alerta la descubre y la registra el registrador de OPR-34, que ya es una tarea del ciclo. **Una lectura nunca escribe:** el estado de entrega se lee al pintar y ninguna lectura llama al registrador ni a la reconciliación.
- **Todo queda en Audit.** La apertura y la resolución de la alerta quedan como `alert_opened` y `alert_resolved` (las escribe el registrador de OPR-34). El reenvío queda como `email_sent` o `text_sent` (OPR-27).
- **Guards que descubren y se ven fallar.** Las pruebas de §10 que cuidan "nada sale solo" y "una lectura nunca escribe" descubren en el disco y se ven fallar una vez.

## 3. Fase A y Fase B

Regla oficial de Henry: **el envío real de correos y textos desde opsRUN es de la Fase B.** En la Fase A el operador envía desde las herramientas de PINCH y opsRUN observa (spec OPR-30 a OPR-32 §1.1).

### 3.1 Qué entrega OPR-19 en la Fase A

| Pieza | Fase A | Cómo |
|---|---|---|
| Estado de entrega de **cada mensaje saliente del hilo** | Sí | Se lee de `Message.delivery` al pintar. Cubre los correos que el operador envió desde el buzón compartido, en un hilo de la request, que BzzzBX observa (OPR-14), y los mensajes que opsRUN ya tiene vinculados en `request_message` |
| Los cinco estados, con **Bounced** y el detalle del proveedor | Sí | `Message.delivery` gana `bounced` y un detalle opcional, provisionales hasta OPR-6 (§4.2) |
| La alerta Message not delivered en la pestaña Alerts y en el panel de la barra | Sí | La calcula Signal Maker (OPR-33). La muestra y la registra OPR-34. OPR-19 aporta la fila de esta regla y su arreglo (§6) |
| El arreglo: "Check the address or number and resend" | Sí, como guía | El destinatario se muestra de solo lectura. En la Fase A se reenvía desde las herramientas de PINCH, y la alerta se resuelve como "Cleared automatically" cuando Signal Maker la cierra |
| Edit and resend desde la alerta | Se ve | Sigue la disponibilidad del modo Customer o Cleaner del Composer. Si el modo está apagado (envíos de la Fase B en el servidor), el botón queda en gris con el motivo de ese modo (§6.3) |
| Textos enviados desde las herramientas de PINCH | **No** | Un texto no tiene hilo, y nadie lo vincula a una request hasta OPR-17 (spec OPR-27 §4.1). No aparece en el hilo y su alerta no lleva a ninguna request (spec OPR-34 S-3) |

### 3.2 Qué espera la Fase B

| Pieza | Espera a |
|---|---|
| Que un envío **desde opsRUN** llegue de verdad, y su estado de entrega real | OPR-16 sobre OPR-14 (correo) y OPR-17 sobre OPR-5 y OPR-13 (texto), con el contrato de OPR-6 y el encendido de la Fase B (OPR-42) |
| Edit and resend que envía de verdad, y la alerta resuelta como "Fixed by action · Email sent / Text sent" | Lo anterior. El reparto de OPR-34 §4.1 ya cuenta `email_sent` y `text_sent` como arreglo de esta regla |
| Hecho cuando de la tarjeta para el **texto** en staging | La Fase B, o que OPR-17 vincule los textos enviados desde las herramientas de PINCH |

En local, sobre el falso, todo esto se construye y se prueba completo, también los envíos desde opsRUN (§9, §10.3).

### 3.3 Hecho cuando, repartido

| Parte | Dónde y cuándo se acepta |
|---|---|
| Correo a una dirección inválida: "Bounced" (o "Failed") en el hilo y la alerta abierta | **Fase A en staging**, con un correo enviado desde el buzón compartido en el hilo de una request, cuando estén OPR-14, OPR-33 y OPR-34 (P-8) |
| Texto a un número inválido: "Failed" en el hilo y la alerta abierta | **Fase B en staging** (OPR-40), o antes si OPR-17 vincula los textos de las herramientas de PINCH |
| Los dos casos de punta a punta | En local sobre el falso: D1 a D10 (§10.3) |

## 4. Lectura

### 4.1 De dónde sale cada cosa

| Qué | Dueño | Fuente | Cuándo se lee |
|---|---|---|---|
| Estado de entrega de un mensaje | PINCH (proveedor), vía BzzzBX | `Message.delivery` y el detalle nuevo (§4.2) | Al pintar el hilo (spec OPR-27 §4.1), con el sondeo de la Job window (≤ 15 s) |
| Destinatario del mensaje | PINCH | `Message.to` | Al pintar; nunca se guarda (spec OPR-27 §5.2) |
| Estado de un envío de opsRUN que todavía no es un mensaje | opsRUN | `instruction.status` y `error_message` | Al pintar (spec OPR-27 §4.3) |
| Si Message not delivered está abierta, su nivel y su motivo | Signal Maker | `AlertResult` con sujeto `message` | Como toda alerta de mensaje en OPR-34 (§7.2) |
| Historial de la alerta | opsRUN | `alert_occurrence` y `audit_event` | Como en OPR-34 |

Nada de esto se escribe al leer. La lectura del hilo y de las alertas no llama a ninguna función de escritura.

### 4.2 El estado de entrega

`Message.delivery` hoy es `queued | sent | delivered | failed` (`src/lib/bzzzbx/tipos.ts`). La tarjeta pide también **bounced**. Cambio provisional hasta OPR-6, como el `price` de OPR-26 P-6:

- `delivery` gana `"bounced"`: el proveedor de correo devolvió el mensaje (dirección inválida, buzón inexistente). Solo tiene sentido en `channel = "email"` [S-2].
- `failed` sigue siendo "el proveedor no lo entregó": en un texto, número inválido o rechazado por la operadora; en un correo, un fallo que no es rebote.
- Campo opcional nuevo `delivery_detail?: string | null`: el motivo del proveedor en palabras ("Invalid number.", "Mailbox does not exist."), solo para mostrar. Ausente o null: no viene. Nunca se guarda.

Al operador se le muestra así (cambia la fila "BzzzBX lo observó en el origen" del §4.3 de OPR-27, P-2):

| Fuente | Valor | Se ve | Tono |
|---|---|---|---|
| `Message`, entrante | — | "Received" | normal |
| `Message.delivery` | `queued` | "Queued" | normal |
| | `sent` | "Sent" | normal |
| | `delivered` | "Delivered" | normal |
| | `failed` | "Failed", o "Failed · `delivery_detail`" | error |
| | `bounced` | "Bounced", o "Bounced · `delivery_detail`" | error |
| `instruction.status` (sin mensaje todavía) | `pending`, `sent`, `failed`, `timed_out` | Sin cambios: "Sending…", "Sent", "Failed · `error_message`", "Couldn't confirm" | Como hoy |

"Failed" de un mensaje y "Failed" de una instrucción se ven igual: para el operador es lo mismo, no llegó. La diferencia es de dónde viene y si abre la alerta (§5.2).

## 5. La alerta Message not delivered

### 5.1 Quién la abre y quién la cierra

- **La abre Signal Maker** cuando un mensaje saliente queda `failed` o `bounced`. El sujeto es `{ tipo: "message", bzzzbx_message_id }` (`SujetoAlerta`). El `rule_id` es el de OPR-33; hasta entonces, la constante provisional de OPR-34 P-12.
- **La cierra Signal Maker.** Con qué condición (un mensaje posterior entregado al mismo destinatario, un plazo, otra) es de OPR-33. opsRUN no supone ninguna [S-3].
- **El nivel y el motivo** (`level`, `reason_text`) son de Signal Maker. opsRUN muestra el motivo vivo, como en OPR-34 §3.4.

### 5.2 Un envío que BzzzBX rechaza

Un `send_*` puede fallar de dos maneras:

1. **BzzzBX lo acepta, el proveedor lo intenta y no llega.** Existe el `Message`, con `delivery` `failed` o `bounced`. Signal Maker abre la alerta sobre ese mensaje.
2. **BzzzBX lo rechaza o falla al ejecutarlo** (`InstruccionRechazada`, o `fallida` en la reconciliación). La instrucción queda `failed`, **no existe `Message`**, y Signal Maker no tiene sujeto sobre el que abrir la alerta.

La tarjeta pide que "un texto a un número inválido" abra la alerta. Si el proveedor rechaza el número al momento, BzzzBX puede reportarlo de cualquiera de las dos maneras. **Recomiendo (P-3)** pedirle a BzzzBX en OPR-6 que un destino inválido siempre deje un `Message` saliente con `failed` o `bounced`, y reservar `fallida` para cuando no se intentó nada (payload inválido, sin permiso, BzzzBX sin el canal). Así hay un solo camino para la alerta y un solo dueño. Mientras tanto, el caso 2 se ve "Failed · …" con Edit and resend (OPR-27) y **no abre la alerta** [S-4].

### 5.3 Cómo se resuelve

Por el reparto que ya aprobó OPR-34 (§4.1): si entre la apertura y el cierre hay en Audit un `email_sent` o `text_sent` de un operador en esa request, "Fixed by action" con ese operador; si no, "Cleared automatically". En la Fase A el reenvío se hace en las herramientas de PINCH y la resolución será "Cleared automatically" [S-5]. OPR-19 no cambia ese reparto.

## 6. UI

### 6.1 El hilo

- La burbuja de un mensaje saliente lleva `data-entrega="queued|sent|delivered|failed|bounced"`, además de su `data-tipo` y `data-direccion` (spec OPR-27 §4.2), para que los E2E no dependan del texto ni del color.
- "Failed" y "Bounced" en rojo, con `role="status"`, como hoy "Not delivered".
- **Edit and resend** aparece también en un mensaje **saliente** `failed` o `bounced`, no solo en una instrucción fallida. Copia su cuerpo al Composer en el modo del canal: Customer para un correo y Cleaner para un texto. Enviar crea una instrucción nueva (OPR-27 S-6). Con el modo apagado, el botón queda en gris con el motivo de ese modo (§6.3).
- Cada burbuja de mensaje tiene un ancla estable por su `bzzzbx_message_id`, que puede recibir el foco (`tabindex="-1"`). La usa el botón de la alerta (§6.2).
- Un rebote no duplica la burbuja: el estado cambia en la del mensaje original. Si BzzzBX además proyecta el aviso de rebote del servidor de correo como un correo entrante del hilo, se vería como "Received" (P-7, S-6).

### 6.2 La fila en Alerts

En la pestaña Alerts (Needs action y Resolved) y en el panel de la barra, la fila de esta regla es la de OPR-34 §5.1 y §6.2, con dos datos más **solo en la pestaña**:

| Campo | Qué se ve | De dónde |
|---|---|---|
| Destinatario | "To: contact.one@example.test" o "To: Team Alpha · +1 555 0111", de solo lectura | `Message.to` y el equipo por teléfono, leídos al pintar (como `equiposPorTelefono` en `armarHilo`). Si BzzzBX está caído, `— —` |
| Arreglo | "Check the address or number and resend." | Texto fijo de la regla. Provisional hasta leer el Release Definition §5 [S-1] |

El destinatario ayuda a revisar la dirección o el número; corregirlos se hace en PINCH (§1.1). No se guarda.

### 6.3 El botón

Es el de OPR-34 §5.3: **Edit and resend** no corre ninguna acción de la action bar. Lleva al operador a la conversación y pone el foco en el ancla del mensaje (§6.1), con su Edit and resend visible.

| Caso | El botón |
|---|---|
| El modo del canal está disponible | Habilitado; lleva al mensaje |
| El modo está apagado ("BzzzBX unavailable", "Job cancelled", "No email thread for this request", "Choose a cleaner first", o el apagado de los envíos en la Fase A) | En gris con el mismo motivo que el modo del Composer. El foco al mensaje sigue funcionando desde la conversación |
| El mensaje no está en el hilo (BzzzBX ya no lo conoce) | En gris con "Message not found in BzzzBX" (`MENSAJE_NO_ENCONTRADO`) |

El apagado de los envíos en la Fase A en el servidor **no lo construye OPR-19**: lo decide y lo construye quien encienda los envíos (OPR-16 y OPR-17, OPR-27 P-5). OPR-19 solo hereda la disponibilidad del modo. Si cuando se construya todavía no existe ese apagado, en el servidor el botón se ve como en local [S-7].

### 6.4 El tablero

No cambia. La alerta cuenta en la tarjeta, en su columna y en la barra por el criterio único de OPR-34 §3.2, como cualquier alerta de sujeto `message`.

### 6.5 BzzzBX caído

- El hilo muestra lo último leído, con su aviso (spec OPR-27 §6). El estado de entrega es el último leído.
- La fila de la alerta muestra lo último leído (spec OPR-34 §5.5). El destinatario se ve `— —` si no se leyó antes.
- Edit and resend en gris con "BzzzBX unavailable", como el modo.

## 7. Encaje en el código

### 7.1 Lo que ya está en `main`

| Pieza | Dónde | Qué cambia |
|---|---|---|
| Tipo del puerto | `src/lib/bzzzbx/tipos.ts` | `Message.delivery` gana `"bounced"`; `Message` gana `delivery_detail?: string \| null` (§4.2). Provisional hasta OPR-6 |
| Pruebas de contrato | `src/lib/bzzzbx/contrato/lectura.contrato.ts` | Un mensaje con `bounced` y con detalle se lee igual por `obtener`, `obtenerVarios` y `listarPor`; un cambio de `delivery` aparece en `cambiosDesde` |
| Hilo | `src/lib/conversacion/armar-hilo.ts` y `tipos.ts` | El estado de §4.2; `EntradaDeHilo` gana el valor crudo de la entrega (para `data-entrega`) y `reenviar` también en un saliente `failed` o `bounced` |
| Componentes de la conversación | La ranura de la conversación de la Job window | `data-entrega`, el ancla con foco y el Edit and resend del mensaje (§6.1) |
| Falso | `src/lib/bzzzbx/falso/` y `/api/falso` | §9 |
| Despacho y reconciliación | `src/lib/instrucciones/` | **No cambian.** Siguen cerrando la instrucción. El estado de entrega posterior no es de la instrucción: es del `Message` |
| Ciclo de fondo | ADR 0006 | **No cambia.** Ninguna tarea nueva |

### 7.2 Lo que se apoya en OPR-34 (sin fusionar)

Se describe por concepto del spec de OPR-34. Si OPR-34 se fusiona antes, OPR-19 lo extiende. Si no, OPR-19 espera a que se fusione: no construye una segunda pestaña ni un segundo registrador.

- **El nombre de la regla.** La constante provisional de OPR-34 P-12, con el nombre "Message not delivered" en el catálogo de nombres de reglas que usan Alerts y Audit. OPR-19 no inventa otro id.
- **Qué alertas son de una request.** El criterio único de OPR-34 §3.2 ya incluye el sujeto `message`: por `request_message.bzzzbx_message_id` (un texto o un correo vinculado) o por un hilo de la request (un correo). OPR-19 no lo cambia y suma pruebas con esta regla (§10.2).
- **El registrador** (OPR-34 §4) descubre la alerta por `cambiosDesde` y la escribe con `upsert_alert_occurrence`, en su vuelta del ciclo. OPR-19 le pide dos cosas (P-5):
  1. **Una alerta de mensaje que todavía no lleva a ninguna request no se pierde.** Puede pasar con un texto que falla antes de que la reconciliación cree su `request_message` (el vínculo se escribe cuando la instrucción se confirma, spec OPR-27 §8). Hoy el registrador la saltaría con log y no la volvería a ver (OPR-34 S-3). Se guarda en la memoria del registrador y se reintenta en las vueltas siguientes durante un tiempo acotado (propongo 10 minutos) [S-8].
  2. **La pasada completa** (arranque o `CursorCaducado`) también mira las alertas de los mensajes salientes `failed` o `bounced` de las requests activas, por sujeto `message`. Sin esto, una alerta de mensaje que abrió con opsRUN parado no se ve nunca: la pasada de OPR-34 solo mira por sujeto request y job y por id las ocurrencias que opsRUN ya tiene.
- **La fila y el botón.** El reparto regla → arreglo de OPR-34 §5.3 ya dice que esta regla lleva al mensaje. OPR-19 aporta el destino del foco (§6.1), la disponibilidad heredada del modo (§6.3) y los dos datos de la fila (§6.2).
- **"Fixed by action".** El reparto de OPR-34 §4.1 ya cuenta `email_sent` y `text_sent`. No cambia.

## 8. Escrituras y migración (pide OK, P-0)

**Recomiendo no hacer migración.** OPR-19 no escribe nada nuevo en la base:

- El estado de entrega no se guarda: es de PINCH (§2).
- La ocurrencia de la alerta y su `alert_opened` y `alert_resolved` las escribe `upsert_alert_occurrence` de OPR-34, que ya contempla el sujeto `message` (`bzzzbx_message_id`).
- El reenvío lo escriben `send_email` y `send_text` de OPR-27, con su `email_sent` o `text_sent`.
- El vínculo del texto saliente con la request lo crea `resolve_instruction` (OPR-27 §8) al confirmar.

**Alternativa, si Henry quiere el fallo en Audit aunque Signal Maker no abra la alerta** (por ejemplo, si OPR-33 tarda): una migración `supabase/migrations/20261208120000_estado_de_entrega.sql`, solo hacia adelante, como `opsrun_migrador`, después de la de Alerts de OPR-34. Agregaría:

- un tipo de Audit observado `message_not_delivered` ("Message not delivered", `source = 'bzzzbx_observed'`) en `audit_event_type`;
- que `record_observed_event` (spec OPR-30 a OPR-32 P-9) lo acepte, con `details = {"bzzzbx_message_id", "delivery"}` y deduplicado por `bzzzbx_message_id`;
- el observador del ciclo (`observador_etapas`) lo escribe cuando ve un saliente vinculado pasar a `failed` o `bounced`.

Y usaría los códigos reservados para OPR-19:

| Código | Cuándo | Lo lanzaría |
|---|---|---|
| `OP050` | El mensaje observado no es de esa request (no está en `request_message` ni en sus hilos) | `record_observed_event` con `message_not_delivered` |
| `OP051` a `OP054` | Reservados, sin uso | — |

Con la recomendación (sin migración), `OP050` a `OP054` quedan reservados para OPR-19 y no se usa ninguno. No se escribe nada de esto hasta que Henry apruebe.

## 9. El falso

Todo inventado (repo público): correos `@example.test`, teléfonos de la serie 555-01xx y nombres genéricos. Los ids nuevos de los E2E van en una serie propia (`bx-msg-019x`, `bx-alert-019x`) para no chocar con los de OPR-34.

- **Los estados nuevos.** El falso acepta `bounced` y `delivery_detail` en un `Message`. `/api/falso cambiar` ya cambia `delivery` de un mensaje existente y deja el cambio en `cambiosDesde`, así que un correo "enviado desde el buzón" se simula con `poner` y su rebote con `cambiar`.
- **Entrega forzada de un envío de opsRUN.** Los E2E no conocen el id del mensaje que crea el falso al observar un `send_*` (`bx-msg-9xxx`). Control nuevo `/api/falso forzar_entrega` (`{ tipo: "send_email" | "send_text", delivery: "failed" | "bounced", delivery_detail? }`): el próximo envío de ese tipo se observa como hoy, con `delivery: "sent"`, y un paso del reloj del falso después pasa a la entrega pedida. La instrucción se confirma igual: el envío salió y fue el proveedor quien no lo entregó (§5.2, caso 1).
- **El falso imita a Signal Maker solo en esta regla (P-4).** Cuando un saliente del falso pasa a `failed` o `bounced`, el falso pone una `AlertResult` abierta de esta regla sobre ese mensaje (roja, con un `reason_text` inventado como "Text to Team Alpha failed: Invalid number.") [S-9]. Todo lo que necesita está dentro de BzzzBX (no lee opsRUN), a diferencia de las reglas que OPR-34 S-13 deja a los E2E. **No la cierra:** la condición de cierre es de OPR-33, y los E2E la cierran con `/api/falso cambiar` (`cleared_at`), como en OPR-34.
- **Seed.** Sin cambios (P-6). `seed-y-falso.test.ts` sigue pasando: ninguna alerta nueva en el arranque del falso.

## 10. Pruebas

### 10.1 pgTAP (`supabase test db`)

Con la recomendación de P-0 no hay funciones nuevas. Se agrega a la prueba de la conversación (o se confirma que ya está) lo que la alerta necesita de la base:

- `resolve_instruction` confirmada de un `send_text` crea su `request_message` con `channel = 'text'` y `direction = 'outbound'`: así el sujeto `message` de la alerta lleva a la request.
- `upsert_alert_occurrence` (OPR-34) con `p_bzzzbx_message_id` y la regla Message not delivered: guarda el mensaje en la ocurrencia y escribe `alert_opened`; con un `text_sent` de un operador entre la apertura y el cierre resuelve `fixed_by_action`; sin él, `auto_cleared`. Si OPR-34 ya trae estos casos para la regla, no se duplican.
- Los guards de OPR-20 y G16 de OPR-34 siguen en verde sin tocarlos.

Con la alternativa de P-0: el tipo nuevo existe en el catálogo como observado; `record_observed_event` lo acepta solo como sistema (se ve en rojo una vez quitando `require_system()`), deduplica por `bzzzbx_message_id` y lanza `OP050` con un mensaje de otra request.

### 10.2 Vitest (TDD, cada una en rojo primero)

- **`armarHilo`:** cada fila de §4.2 con su texto, su tono y su valor de entrega; "Bounced · detalle" y "Failed" sin detalle; Edit and resend en un saliente `failed` y `bounced`, en el modo del canal, y nunca en un entrante, en uno `delivered` ni en el original; la instrucción fallida sigue como hoy.
- **Tipo y contrato:** el contrato de lectura acepta `bounced` y `delivery_detail`, y un cambio de `delivery` aparece en `cambiosDesde`. Corre contra el falso y, cuando exista, contra el real.
- **Falso:** `forzar_entrega` por `aplicarControl` (bien formado y mal formado); el envío pasa de `sent` a la entrega pedida un paso después y la instrucción se confirma; la alerta de esta regla aparece abierta sobre ese mensaje, una sola vez, y se ve en `cambiosDesde`; un mensaje que pasa a `delivered` no abre nada; una instrucción rechazada no crea mensaje ni alerta.
- **Qué alertas son de una request** (el criterio de OPR-34): la alerta de un texto vinculado por `request_message` entra; la de un correo por su hilo entra; la de un texto sin vínculo no entra.
- **Registrador** (las dos cosas de §7.2): una alerta de mensaje sin request se reintenta y se escribe una sola vez cuando aparece el vínculo; pasado el plazo, se suelta con log; la pasada completa encuentra la alerta de un saliente fallido de una request activa. Se ve fallar quitando el reintento.
- **Fila y botón:** destinatario y arreglo en la fila de esta regla, y no en otras; `— —` sin lectura; el botón hereda cada motivo del modo; "Message not found in BzzzBX" si el mensaje no está.
- **Nada sale solo (se ve fallar una vez):** el botón de la alerta y Edit and resend no llaman a `ejecutarAccion` ni a ninguna función de envío. La prueba de disco de OPR-27 §11.1 (c), que descubre las llamadas con `send_*`, sigue encontrando solo el Composer y su ejecutor.
- **Una lectura nunca escribe:** el guard G16 de la ADR 0006 sigue en verde; ninguna lectura del hilo ni de Alerts importa el registrador ni la reconciliación.
- **Componentes (Testing Library):** `data-entrega`, `role="status"` en Failed y Bounced, el ancla recibe el foco desde el botón de la alerta.

### 10.3 Playwright (criterios de aceptación)

Contra el build de producción, la seed y el falso, con `OPSRUN_ACTOR_DEMO=1` y `OPSRUN_ZONA_HORARIA=America/New_York`. `entrega.spec.ts` va en un proyecto aparte que corre después de los de la conversación y de Alerts, porque cambia R2. R2 tiene el hilo `bx-thread-0002` y el cleaner Team Alpha (spec OPR-27 §11.3).

| # | Criterio | Cómo se prueba |
|---|---|---|
| D1 | **Los estados se ven.** | `poner` en `bx-thread-0002` salientes con `queued`, `sent` y `delivered`: cada burbuja con su texto y su `data-entrega`. |
| D2 | **Fase A: correo enviado desde el buzón que rebota.** | `poner` un saliente `sent` en `bx-thread-0002` (como enviado desde las herramientas de PINCH), después `cambiar` a `bounced` con "Mailbox does not exist.": en menos de 1 minuto la burbuja dice "Bounced · Mailbox does not exist." en rojo. |
| D3 | **Fase A: la alerta abre.** | Después de D2: Needs action de R2 con "Message not delivered", el destinatario y "Check the address or number and resend."; la insignia y el conteo de la barra la cuentan; el panel de la barra tiene su fila y abre la ventana de R2 en Alerts. |
| D4 | **Registra con todo cerrado.** | Sin páginas abiertas, se repite D2 con otro mensaje y se espera una vuelta del ciclo (consultando la base): están su `alert_occurrence` con el `bzzzbx_message_id` y su `alert_opened`. |
| D5 | **Fase A: se resuelve sola.** | `poner` un saliente nuevo `delivered` (el reenvío hecho en PINCH) y cerrar la alerta con `cambiar` `cleared_at`: Resolved "Cleared automatically"; Audit "Alert opened" y "Alert resolved". |
| D6 | **Texto desde opsRUN a un número inválido (local).** | `forzar_entrega` (`send_text`, `failed`, "Invalid number."). Modo Cleaner, Send: "Sending…", "Sent" y, en menos de 1 minuto, "Failed · Invalid number."; la alerta abre en Needs action. |
| D7 | **Correo desde opsRUN a una dirección inválida (local).** | Igual que D6 con `send_email` y `bounced`: "Bounced · …" y la alerta. |
| D8 | **Arreglo desde la alerta.** | Desde la alerta de D6, Edit and resend lleva el foco al mensaje; su Edit and resend deja el cuerpo en el modo Cleaner. Se espera un ciclo de sondeo: ninguna burbuja nueva y el cursor de cambios sin moverse. Se envía, se cierra la alerta con `cambiar`: Resolved "Fixed by Ops Uno · Text sent". |
| D9 | **Rechazo de BzzzBX sin alerta.** | `forzar_error` (`send_text`, `al_entregar`): "Failed · …" con Edit and resend, y ninguna alerta nueva (S-4). |
| D10 | **BzzzBX caído.** | Con R2 abierta después de D6, `no_disponible`: la burbuja conserva "Failed"; la fila de la alerta muestra lo último leído; Edit and resend en gris con "BzzzBX unavailable". |

**Hecho cuando, en local:** D1 a D10 en verde, más `pnpm lint`, `pnpm typecheck`, `pnpm test` y `supabase test db`. En staging, según §3.3.

## 11. Dependencias

| Dependencia | Qué toca aquí | Mientras tanto |
|---|---|---|
| **OPR-34** (Alerts, aprobado, en construcción) | La pestaña, el panel, el registrador, la constante de la regla y "Fixed by action" | OPR-19 se construye después de que se fusione (§7.2) |
| **OPR-33** (las 9 reglas en BzzzBX) | Que Signal Maker abra y cierre Message not delivered, su id, su nivel y su motivo | El falso la abre (P-4); los E2E la cierran |
| **OPR-6** (contrato de BzzzBX) | `bounced`, `delivery_detail`, cuándo cambia `delivery`, si un destino inválido da `Message` o `fallida` (P-3), los avisos de rebote (P-7) | Tipos provisionales y supuestos del falso |
| **OPR-14** (buzón compartido) | Que BzzzBX observe los correos enviados desde el buzón y sus rebotes: la parte de la Fase A | Solo en local |
| **OPR-16** (envío de correo) | Envío real desde opsRUN y el apagado o encendido del modo Customer en el servidor | El envío al falso de OPR-27 |
| **OPR-17** (textos de ida y vuelta), **OPR-5** (proveedor de SMS, decisión pendiente), **OPR-13** (número de envío y registro con operadoras) | Envío real de textos y su estado; vincular los textos enviados desde PINCH | El envío al falso de OPR-27 |
| **OPR-15** (entrada de correo) | Que un aviso de rebote no cree una request ni cuente como respuesta del cliente (P-7) | Supuesto S-6 |
| **OPR-42** (Fase A y Fase B) | Cuándo se encienden los envíos | Regla de Henry: envíos en la Fase B |

## 12. Supuestos

| # | Supuesto |
|---|---|
| S-1 | El Release Definition §4.10 y §5 y el prototipo R23 no se pudieron leer: textos ("Failed", "Bounced", "Check the address or number and resend.") y distribución se revisan contra ellos. |
| S-2 | `bounced` solo aparece en correos; un texto que no llega es `failed`. |
| S-3 | La condición con que Signal Maker cierra Message not delivered es de OPR-33; opsRUN no supone ninguna. |
| S-4 | Mientras OPR-6 no diga otra cosa, un envío que BzzzBX rechaza (sin `Message`) se ve "Failed · …" y no abre la alerta. |
| S-5 | En la Fase A el reenvío se hace en las herramientas de PINCH, así que la alerta se resuelve como "Cleared automatically". |
| S-6 | BzzzBX informa el rebote en el `delivery` del mensaje original, y no proyecta el aviso del servidor de correo como un correo entrante del hilo (o lo marca para que la entrada lo ignore). |
| S-7 | El apagado de los envíos en el servidor en la Fase A lo construyen OPR-16 y OPR-17; OPR-19 solo hereda la disponibilidad del modo. |
| S-8 | Una alerta de mensaje sin request se reintenta durante 10 minutos; después se suelta con log. |
| S-9 | En el falso, Message not delivered abre roja. El nivel real es de Signal Maker. |
| S-10 | "Fixed by action" para esta regla cuenta cualquier `email_sent` o `text_sent` de un operador en la request entre la apertura y el cierre (OPR-34 §4.1), aunque vaya a otro destinatario. |

## 13. Preguntas para Henry (mi recomendación primero)

- **P-0. ¿Migración?** **Recomiendo no hacerla:** OPR-19 lee el estado de entrega sin guardarlo, y la alerta y su Audit ya los escribe el registrador de OPR-34. Alternativa: la migración `20261208120000` de §8, con un evento observado `message_not_delivered` en Audit y `OP050`, para ver el fallo en Audit aunque Signal Maker no abra la alerta. Pide tu OK.
- **P-1. ¿Qué entrega OPR-19 en la Fase A?** **Recomiendo lo de §3.1:** el estado de entrega de los mensajes salientes que BzzzBX observa (incluidos los correos enviados desde el buzón en el hilo de la request), la alerta en la pestaña y en el panel, y el arreglo como guía, con Edit and resend heredando el modo del Composer. Los envíos desde opsRUN y el texto en staging esperan la Fase B (§3.2). Alternativa: OPR-19 entera en la Fase B, que deja sin ver en la Fase A los rebotes de los correos que el operador ya manda desde el buzón.
- **P-2. ¿Cómo se llaman los estados?** **Recomiendo "Failed" y "Bounced"**, con el detalle del proveedor cuando venga, en lugar del "Not delivered" de OPR-27 §4.3, porque la tarjeta pide "sent, delivered, failed or bounced" y el Hecho cuando dice "failed". El glosario (`CONTEXT.md`, Estado de entrega) se actualiza con la implementación. Alternativa: dejar "Not delivered" para los dos y usar el nombre solo en la alerta.
- **P-3. ¿Quién abre la alerta cuando BzzzBX rechaza el envío?** **Recomiendo pedirle a BzzzBX en OPR-6** que un destino inválido deje siempre un `Message` con `failed` o `bounced` (Signal Maker abre la alerta sobre él) y reservar la instrucción `fallida` para cuando no se intentó nada. Mientras tanto, el rechazo se ve "Failed" sin alerta (S-4). Alternativa: que opsRUN abra su propia alerta con la instrucción fallida, que rompe "opsRUN no decide si una alerta abre" y pide tabla o columna nueva.
- **P-4. ¿El falso imita a Signal Maker en esta regla?** **Recomiendo sí, solo para abrirla:** cuando un saliente del falso pasa a `failed` o `bounced`, el falso pone la alerta; no la cierra. Su entrada está toda en BzzzBX, y así D4 prueba el registro sin nadie mirando con el mismo camino que en staging. Alternativa: que los E2E pongan la alerta a mano con `poner`, igual que las demás reglas en OPR-34 S-13.
- **P-5. ¿Cambios al registrador de OPR-34?** **Recomiendo los dos de §7.2:** reintentar por un tiempo acotado una alerta de mensaje que todavía no lleva a una request, y que la pasada completa mire las alertas de los salientes fallidos de las requests activas. Sin eso, la alerta de un texto que falla antes de que se confirme su envío, o que abre con opsRUN parado, no se ve nunca. Alternativa: confiar en que BzzzBX confirma el envío antes de reportar el fallo, y pedirlo en OPR-6.
- **P-6. ¿Cambia la seed?** **Recomiendo no:** los E2E arman sus casos con `/api/falso` y la seed de OPR-34 no se toca. Alternativa: un correo rebotado con su alerta abierta en una request de la seed, para la demo de la Fase A, que obliga a coordinar ids y conteos con las pruebas de OPR-34.
- **P-7. ¿Y el aviso de rebote que llega como correo?** **Recomiendo pedirle a BzzzBX en OPR-6** que informe el rebote en el `delivery` del mensaje original y que no proyecte el aviso del servidor de correo como correo entrante del hilo (o que lo marque), para que la entrada de correo (OPR-15) no lo vincule como respuesta del cliente ni abra una request con él. Alternativa: filtrarlo en opsRUN por remitente, que adivina formatos de un proveedor.
- **P-8. ¿Cómo se acepta el Hecho cuando?** **Recomiendo partirlo (§3.3):** el correo se acepta en la Fase A en staging con un correo enviado desde el buzón compartido, y el texto en la Fase B (OPR-40), o antes si OPR-17 vincula los textos enviados desde las herramientas de PINCH. Alternativa: aceptar los dos juntos en la Fase B.
