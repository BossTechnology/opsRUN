# OPR-18 — Plantillas de mensajes y avisos

- **Tarjeta:** OPR-18 (C · Message templates and notices). Leída en Relevo el 2026-11-27. Depende, según la tarjeta, de C · Email sending (OPR-16) y C · Texting both ways (OPR-17); `PLAN.md` §5 ya anota que OPR-16 y OPR-18 se piden entre sí. La tarjeta es información; este spec manda sobre la construcción cuando Henry lo apruebe.
- **Estado:** aprobado por Henry el 2026-11-27, con P-0 a P-10 según las recomendaciones (§14). En construcción en la rama `opr-18-plantillas` (Fase A). Lo marcado **[S-n]** es un supuesto; lo marcado **P-n** es una pregunta para Henry, con mi recomendación primero (§13).
- **Hecho cuando (tarjeta):** cada plantilla se usa en E2E-1 y E2E-9 con el contenido correcto. Qué parte se acepta en la Fase A y qué parte espera la Fase B está en §3.3.
- **Construye sobre (en `main`):** el modelo de datos, que ya trae la tabla `message_template` y las seis claves de la tarjeta (`docs/spec/opr-20-modelo-de-datos.md` §3.10; migración `20261124130000_modelo_de_datos.sql`), la conversación y su Composer (`docs/spec/opr-27-conversacion.md`, `src/lib/conversacion/`, `src/app/_conversacion/`), el despacho de envíos como tarea del ciclo de fondo (`src/lib/instrucciones/`, ADR 0006), el registro de acciones (`src/lib/acciones/registro.ts`) y los avisos que las etapas dejaron esperando (`docs/spec/opr-30-31-32-etapas.md` S-9, `docs/spec/opr-28-assign-confirm.md`).
- **Specs abiertos que tocan lo mismo, sin redefinirlos:** #33 (OPR-19, estado de entrega: cambia las burbujas y el Edit and resend del hilo, no el Composer) y #35 (OPR-36, análisis de IA: no produce borradores de respuesta; esos son de OPR-37). #34 (OPR-29) ya reserva las plantillas `reschedule_request`, `cancellation_cleaner` y `cancellation_requester` para la Fase B y no las cambia.
- **Referencias sin acceso [S-1]:** Release Definition §4.3 a §4.6 y §7.1, User Guide §5.1 y el prototipo R23 no están en este repo, que es público, y no se pudieron leer. El contenido de las plantillas es **texto neutro inventado**; el texto real se revisa contra esos documentos y entra por la vía de P-2.
- **Fuera de alcance:**
  - **Enviar de verdad** correos y textos (OPR-16 sobre OPR-14; OPR-17 sobre OPR-5 y OPR-13): Fase B (§3).
  - **Preguntar al cleaner y leer su respuesta** (Ask cleaner, `cleaner_confirmation`, OPR-17): este spec solo trae el texto que esa acción usará.
  - **Reschedule y Cancel job** (OPR-29, Fase B): idem, solo el texto.
  - **Los borradores que escribe la IA** (`draft_customer_reply`, `draft_cleaner_text`): son de OPR-37. Aquí solo queda el punto de apoyo: una función que llena una plantilla (§8.1) y un campo para registrar la plantilla usada (§6).
  - **Editar plantillas desde la interfaz.** En V1.1 beta se cambian por migración (OPR-20 §3.10; pregunta abierta §11.9 de OPR-20).
  - **Más placeholders** que los cuatro de la tarjeta (`property`, `space`, `date`, `window`) [S-4].

## 1. Para qué

Los mensajes de rutina de una operación de limpieza se repiten: pedirle al cleaner que confirme un trabajo, pedirle un cambio de fecha, avisar una cancelación, avisar al requester que quedó programado o terminado. Este trabajo entrega **seis plantillas estándar** con sus datos del job ya puestos, para que el operador no los teclee ni cambie sin querer una fecha:

| Clave | Canal | Para qué |
|---|---|---|
| `cleaner_confirmation_request` | Texto | Pedir al cleaner que confirme el job |
| `reschedule_request` | Texto | Pedir al cleaner un cambio de fecha y ventana |
| `cancellation_cleaner` | Texto | Avisar al cleaner que el job se canceló |
| `cancellation_requester` | Correo | Avisar al requester que el job se canceló |
| `requester_scheduled` | Correo | Aviso **Scheduled** al requester |
| `requester_done` | Correo | Aviso **Done** al requester |

Una plantilla **nunca sale sola**. Es un punto de partida: el operador la elige en el Composer, la ve llena como borrador, la edita y pulsa Send. Los avisos al requester (Scheduled y Done) son los únicos que la tarjeta llama automáticos; qué significa "automático" sin romper "las personas firman" es P-3 y es de la Fase B.

## 2. Principios que aplica

- **Un solo dueño.** El texto de la plantilla es de opsRUN (`message_template`). La propiedad, el espacio, la fecha y la ventana que la llenan son de PINCH y se leen por BzzzBX al pintar; el borrador llenado no se guarda. Lo que se guarda es lo que ya guarda OPR-27 (el cuerpo que el operador envió, en la instrucción) más la clave y la versión de la plantilla usada (§6).
- **Las IAs proponen, las personas firman.** Una plantilla no es una sugerencia ni un envío: elegirla solo llena la caja de texto del Composer. Ningún camino de código crea un `send_*` desde una plantilla (§10, guard "nada sale solo", que se amplía). Lo que la IA escriba dentro de una plantilla (OPR-37) entra por el mismo camino de borrador de OPR-27 §5.5.
- **Toda acción es una instrucción a BzzzBX.** Un envío con plantilla es un `send_email` o `send_text` igual a los de OPR-27: mismo payload (crosswalk ID y cuerpo), mismo despacho. La plantilla no viaja a BzzzBX.
- **El trabajo de fondo, solo en el ciclo único (ADR 0006).** OPR-18 **no agrega tareas ni temporizadores**. La reconciliación de envíos que ya corre en el ciclo cierra los envíos con plantilla como los demás.
- **Una lectura nunca escribe.** Armar el picker y el panel de avisos es una lectura de `message_template` y de BzzzBX. No llama a ninguna función de escritura, ni al despacho, ni al ciclo (G16 sigue en verde).
- **Todo queda en Audit.** El envío con plantilla escribe `email_sent` o `text_sent` con `template_key` y `template_version` en `details` (§6). En la Fase A no hay ningún aviso automático que registrar.
- **Si BzzzBX falla, se trabaja a mano.** Sin lectura, los placeholders quedan sin llenar y el operador escribe el texto; nada se bloquea por eso (§5.3).
- **Guards que descubren y se ven fallar.** Las pruebas de §10 que cuidan el catálogo (claves, placeholders, largo de los textos) y "nada sale solo" descubren en la base y en el disco, y se ven fallar una vez.

## 3. Fase A y Fase B

Regla oficial de Henry: **el envío real de correos y textos desde opsRUN es de la Fase B.** En la Fase A el operador envía desde las herramientas de PINCH y opsRUN observa (spec OPR-30 a OPR-32 §1.1, OPR-27 P-5).

### 3.1 Qué entrega OPR-18 en la Fase A

| Pieza | Fase A | Cómo |
|---|---|---|
| Las seis plantillas **en la base de staging y producción** | Sí | Migración nueva (§6). Hoy solo existen en la seed, que no corre en el servidor |
| **Elegir una plantilla en el Composer** (modos Customer y Cleaner) | Sí | Picker "Templates": llena la caja con el texto del job y la deja editable (§7.1). Qué plantilla aparece en qué modo y etapa: §4.2 |
| Llenar propiedad, espacio, fecha y ventana desde opsRUN y BzzzBX | Sí | Lectura al pintar (§5); formato del tablero |
| **Copy** el texto del Composer | Sí | Botón solo del navegador: copia al portapapeles lo que hay en la caja. En la Fase A es lo que se usa para pegarlo en la herramienta de PINCH (P-5) |
| **Panel Notices** en la conversación: el aviso Scheduled, el aviso Done y los dos de cancelación, como vista previa de solo lectura | Sí | "Not sent · Available when actions are switched on", con Copy (§7.2) |
| Contador de mensajes SMS en modo Cleaner | Sí | "1 SMS" o "2 SMS", solo informativo (§4.4) |
| Registrar qué plantilla se usó en un envío | Sí, en local sobre el falso | `template_key` y `template_version` en el Audit del envío (§6). En staging y producción de la Fase A el Send está apagado (lo apaga quien encienda los envíos, OPR-16 y OPR-17, OPR-27 P-5), así que no habrá envíos con plantilla hasta la Fase B |
| Que **Approve & confirm** o el enlace avisen al requester | **No** | Siguen sin avisar (OPR-30 a OPR-32 S-9, `CONTEXT.md`). El aviso es la vista previa del panel |

### 3.2 Qué espera la Fase B

| Pieza | Espera a |
|---|---|
| Que un envío con plantilla desde opsRUN llegue de verdad | OPR-16 y OPR-17 sobre OPR-14, OPR-5 y OPR-13, con el contrato de OPR-6 y el encendido de la Fase B (OPR-42) |
| **Aviso Scheduled** como consecuencia de programar, y **aviso Done** como consecuencia de Approve & confirm | La Fase B y P-3. Sale como instrucción dentro de la transacción de la acción del operador, con `requester_notified` en Audit (tipo que ya existe en el catálogo). Nunca desde el ciclo ni desde un observador |
| Ask cleaner con `cleaner_confirmation_request`; Reschedule con `reschedule_request`; Cancel job con `cancellation_cleaner` y `cancellation_requester` | OPR-17 y OPR-29 (Fase B). Usan la misma función de llenado (§8.1) |
| Que la IA llene los huecos dentro de una plantilla | OPR-37 |
| Editar plantillas desde opsRUN | Un release posterior (P-2) |

En local, sobre el falso, el envío con plantilla se construye y se prueba completo (§10.3), igual que el Composer de OPR-27.

### 3.3 Hecho cuando, repartido

| Parte | Dónde y cuándo se acepta |
|---|---|
| Las seis plantillas existen en staging con su texto, y las cuatro que se ven en el Composer o en Notices salen llenas con datos reales de un job | **Fase A en staging**, con OPR-6 y datos de PINCH. El operador pega el texto en la herramienta de PINCH (Copy) |
| Cada plantilla se usa en E2E-1 (confirmation request, Scheduled, Done) y E2E-9 (reschedule, cancellation del cleaner y del requester) con el contenido correcto, **enviada** | **Fase B en staging** (OPR-40): envío real y avisos como consecuencia de las acciones |
| Los mismos pasos de E2E-1 y E2E-9 sobre el falso | En local: T1 a T10 (§10.3) |

## 4. Las plantillas

### 4.1 La tabla y los textos

`opsrun.message_template` ya existe (OPR-20 §3.10): pk `(key, version)`, `channel`, `subject` (solo correo), `body` con placeholders y `active`, con un índice que permite **una sola versión activa por clave**. Es de solo lectura para `opsrun_app` (RLS ya lo dice) y no sale en el write-back v1.

Los textos de la versión 1 son los de la seed actual, inventados y neutros, en inglés porque es lo que ve el operador y lo que se manda:

| Clave | Asunto | Cuerpo |
|---|---|---|
| `cleaner_confirmation_request` | — | `New job: {{property}} {{space}} on {{date}}, {{window}}. Can you confirm?` |
| `reschedule_request` | — | `Can we move {{property}} {{space}} to {{date}}, {{window}}? Please confirm.` |
| `cancellation_cleaner` | — | `The job at {{property}} {{space}} on {{date}} is cancelled.` |
| `cancellation_requester` | `Cleaning cancelled` | `The cleaning at {{property}} {{space}} on {{date}} has been cancelled.` |
| `requester_scheduled` | `Cleaning scheduled` | `Your cleaning at {{property}} {{space}} is scheduled for {{date}}, {{window}}.` |
| `requester_done` | `Cleaning done` | `The cleaning at {{property}} {{space}} is done.` |

Los textos reales de PINCH no se suben a este repo (CLAUDE.md): son P-2. El asunto de las tres plantillas de correo **no se usa** en V1.1 beta: un correo desde opsRUN es una respuesta en el hilo de la request y BzzzBX pone el asunto (OPR-27 S-11, P-6 de este spec).

### 4.2 Dónde aparece cada una

Un catálogo en código (`src/lib/plantillas/catalogo.ts`) le agrega a cada clave lo que no es texto: su nombre visible, su modo y sus etapas. Es lo único que decide **qué se ofrece**; la base solo dice **qué existe**.

| Clave | Nombre visible | Composer (modo · etapas) | Panel Notices (etapas) | La usará en la Fase B |
|---|---|---|---|---|
| `cleaner_confirmation_request` | Confirmation request | Cleaner · Requests | — | Ask cleaner (OPR-17) |
| `reschedule_request` | Reschedule request | Cleaner · Scheduled | — | Reschedule (OPR-29) |
| `cancellation_cleaner` | Cancellation (cleaner) | — | Cancelled | Cancel job (OPR-29) |
| `cancellation_requester` | Cancellation (requester) | — | Cancelled | Cancel job (OPR-29) |
| `requester_scheduled` | Scheduled notice | Customer · de Scheduled en adelante | De Scheduled en adelante | Programar / enlazar (OPR-28, OPR-16) |
| `requester_done` | Done notice | Customer · Validation | Validation | Approve & confirm (OPR-31) |

Reglas:

- **Las de cancelación no están en el Composer.** Con el job `cancelled` el Composer entero está en gris "Job cancelled" (OPR-27 §10) y no tiene sentido ofrecer un aviso de cancelación mientras el job está vivo. En la Fase A se ven en el panel Notices del job cancelado, con Copy.
- **Done solo desde Validation**, es decir, después de Approve & confirm (OPR-31): el aviso Done es sobre un job aprobado.
- Una plantilla se ofrece solo si su canal es el del modo (correo en Customer, texto en Cleaner) y su etapa está en la tabla. **El servidor lo vuelve a comprobar al enviar** (§8.3); el picker no es la defensa.
- Una clave que está en la base y no está en el catálogo de código no se ofrece (y una prueba lo detecta, §10.2). Una clave del catálogo sin fila activa tampoco.

### 4.3 Los placeholders

Cuatro, y solo cuatro. Se llenan **una sola vez, en una pasada** (el valor de un placeholder que contiene `{{date}}` no se vuelve a expandir) y como texto plano.

| Placeholder | De dónde sale | Formato |
|---|---|---|
| `{{property}}` | `Property.name` de la propiedad del job (de Scheduled en adelante) o del borrador (Requests) | Tal cual |
| `{{space}}` | La etiqueta del espacio en `Property.units`; si no hay, la unidad del borrador (`unit`), como ya hacen el tablero y la ventana | Tal cual; si no hay ninguno, vacío y se colapsa el espacio doble |
| `{{date}}` | `Job.service_date` o `request.service_date` | "Wed, Nov 25" (fecha de calendario, como `fechaYVentana`) |
| `{{window}}` | `window_start` y `window_end` | "9:00 AM–12:00 PM" |

Desde Scheduled manda el job (BzzzBX es su dueño); en Requests, el borrador. Si BzzzBX no conoce la propiedad o no hay dato, el placeholder **queda literal** (`{{date}}`). Una excepción de diseño: en `reschedule_request`, `{{date}}` y `{{window}}` son la fecha y la ventana **nuevas**, que opsRUN no conoce en la Fase A (las trae la acción Reschedule en la Fase B), así que el catálogo los marca "a mano" y quedan siempre literales para que el operador los escriba. Llenarlos con los actuales sería pedir mover el trabajo a la misma fecha.

**Un mensaje no sale con un `{{…}}` sin llenar.** En el Composer, Send queda deshabilitado mientras el texto tenga uno, con "Fill in: {{date}}, {{window}}"; y las funciones de envío lo rechazan con `OP056` cuando traen plantilla (§6). P-9.

### 4.4 Un solo SMS

La tarjeta pide textos de un solo SMS cuando se pueda. Cada plantilla de texto se escribe en el alfabeto básico de SMS (GSM-7: sin acentos fuera del conjunto, sin comillas ni guiones tipográficos), donde un SMS son **160 caracteres**; con un carácter fuera de él pasa a UCS-2, **70**. Un presupuesto fijo para los valores (property 40, space 20, date 12, window 18, es decir 90 en total) deja a cada texto de la v1 por debajo de 160 con margen. [S-5]

- **Guard en la base:** una prueba descubre las plantillas de texto activas y falla si alguna tiene un carácter fuera de GSM-7 o si su parte fija más 90 pasa de 160 (§10.1).
- **En el Composer** (modo Cleaner), junto al contador de caracteres: "1 SMS" o "2 SMS" según el texto que hay en la caja, con la regla de arriba. **Informativo**: el límite sigue siendo el de OPR-27 (1 600) y Send no se bloquea por esto (P-8).

## 5. Lecturas

| Qué | Dueño | Fuente | Cuándo |
|---|---|---|---|
| Plantillas activas (clave, versión, canal, asunto, cuerpo) | opsRUN | `opsrun.message_template where active`, como `opsrun_app`, en la misma transacción de solo lectura que ya arma la conversación (`consultas.ts`) | Al pintar la ranura de la conversación |
| Propiedad, espacio, fecha, ventana | PINCH | `request` (borrador) y, desde Scheduled, `obtener("job")`; `obtener("property")` por el puerto de lectura | Al pintar, dentro del presupuesto de 1,5 s que ya tiene la ranura (OPR-27 §6, OPR-26 S-2) |
| Etapa y disponibilidad del modo | opsRUN | `ventana.etapa` y `disponibilidadDelComposer` | Al pintar |

Nada se guarda ni se cachea en la base. Con BzzzBX caído se usa lo último leído de esa request (la memoria del proceso que ya usa la conversación) con su aviso; sin lectura previa, el picker se ve, los placeholders quedan literales y el panel Notices dice "Preview unavailable · BzzzBX unavailable" (§5.3).

### 5.1 `leerConversacion` y `DatosDeConversacion`

`DatosDeConversacion` gana `plantillas`: por modo, la lista de las que se ofrecen (clave, versión, nombre, texto ya llenado, `faltan: string[]` con los placeholders sin llenar) y, para el panel, `avisos` con las que aplican a la etapa. Lo arma una función pura `plantillasDelJob({ filas, etapa, modos, datos })`. `CONSULTA_REQUEST` gana las columnas del borrador que hacen falta (`bzzzbx_property_id`, `bzzzbx_space_id`, `unit`, `service_date`, `window_start`, `window_end`) y se agrega `CONSULTA_PLANTILLAS`.

### 5.2 Refresco

El de la Job window (cada 15 s con `router.refresh()`). Cambiar la fecha en PINCH cambia lo que se ve en el picker y en Notices, pero **no** reescribe lo que el operador ya puso en la caja: un refresco nunca pisa el texto (misma regla que el borrador de IA de OPR-27 §5.5).

### 5.3 Estados no disponibles

| Caso | Picker | Notices |
|---|---|---|
| BzzzBX caído, con lectura previa | Con lo último leído, y el modo en gris como ya está ("BzzzBX unavailable") | Con lo último leído y el aviso "last update HH:MM" |
| BzzzBX caído, sin lectura previa | Modo en gris; no se puede elegir | "Preview unavailable · BzzzBX unavailable" |
| Job `cancelled` | No hay picker (Composer en gris "Job cancelled") | Las dos de cancelación, con Copy |
| Request sin hilo o sin cleaner | El modo ya está en gris con su razón (OPR-27 §5.1) | Sin cambios |
| La propiedad no existe en BzzzBX | Se ofrece, con `{{property}}` literal | La vista previa dice "Check the property" en lugar del texto |

## 6. Escrituras y migración (pide OK, P-0)

**Hace falta una migración**, `supabase/migrations/20261209120000_plantillas.sql`, solo hacia adelante, como `opsrun_migrador`, después de las de OPR-19 y OPR-36 si llegan antes (solo se ajusta el nombre del archivo). Tiene dos partes:

1. **Las seis plantillas, versión 1, como catálogo.** Hoy solo las pone `supabase/seed.sql`, y la seed no corre en staging ni en producción (el deploy aplica migraciones, nada más); OPR-20 §9 dice además que los catálogos van en la migración. `insert … on conflict (key, version) do nothing`, con los textos de §4.1. Se **quita el bloque de plantillas de `seed.sql`** (cambio de seed, no de migración) para que `supabase db reset` no choque con la migración.
2. **`send_email` y `send_text` registran la plantilla usada.** Las dos funciones de la migración `20261130120000_conversacion.sql` ganan dos parámetros con valor por defecto:

   ```
   opsrun.send_email(p_request_id, p_bzzzbx_thread_id, p_body, p_idempotency_key,
                     p_ai_suggestion_id default null,
                     p_template_key text default null, p_template_version integer default null) returns uuid
   opsrun.send_text(…misma forma, con p_bzzzbx_team_id…)
   ```

   Cambiar la lista de parámetros crea una función nueva, no reemplaza la vieja: la migración hace `drop function` de las dos firmas de cinco parámetros y crea las nuevas, con el mismo cuerpo, `security definer`, `set search_path = ''`, `require_operator()` en su propio cuerpo, `revoke all … from public` y `grant execute … to opsrun_app`. Las llamadas de cinco parámetros que ya existen (`ejecutores.ts`, `conversacion.test.sql`) siguen resolviendo por los valores por defecto.

   Con plantilla (`p_template_key` no nulo; la versión es obligatoria con la clave):
   - la fila `(key, version)` debe existir y ser del canal de la función (correo para `send_email`, texto para `send_text`); si no, **`OP055`** y no se crea la instrucción;
   - `p_body` no puede traer un `{{…}}` sin llenar (`'\{\{[a-z_]+\}\}'`); si lo trae, **`OP056`**;
   - `audit_event.details` de `email_sent` o `text_sent` gana `template_key` y `template_version`. **El payload de la instrucción no cambia** (sigue `{ bzzzbx_thread_id | bzzzbx_team_id, body }`, OPR-27 P-2): la plantilla no viaja a BzzzBX (P-4).
   - Aceptar una versión que ya no es la activa es válido: el operador pudo abrir el picker antes de un cambio de versión.

   Sin plantilla, las funciones se comportan exactamente como hoy.

**No cambia** tablas, columnas, tipos, triggers, vistas ni catálogos de Audit (`email_sent`, `text_sent` y `requester_notified` ya existen). No hay función nueva, no hay escritura nueva en la Fase A fuera del envío de OPR-27.

### 6.1 Códigos de error

Este spec se reserva **`OP055` a `OP059`** (OPR-19 tiene `OP050` a `OP054`, OPR-36 `OP045` a `OP049`, OPR-29 `OP040` a `OP044`, OPR-34 `OP035` a `OP039`; en `supabase/migrations/` el último en uso es `OP034`). Se documentan en la cabecera de la migración:

| Código | Cuándo | Lo lanza |
|---|---|---|
| `OP055` | La plantilla no existe, o es de otro canal | `send_email`, `send_text` |
| `OP056` | El cuerpo trae un `{{…}}` sin llenar | `send_email`, `send_text` (solo con plantilla) |
| `OP057` a `OP059` | Reservados para la Fase B (aviso al requester como consecuencia de una acción), sin uso | — |

### 6.2 Qué guarda opsRUN y qué no

| Guarda (opsRUN) | No guarda (es de PINCH, se lee de BzzzBX) |
|---|---|
| Las plantillas (texto con placeholders) | Nombre de la propiedad y del espacio |
| `template_key` y `template_version` en el Audit de un envío | La vista previa llenada del picker y de Notices |
| Lo que ya guarda OPR-27: el cuerpo que el operador envió, en `instruction.payload.body` | La fecha y la ventana del job |

El cuerpo enviado ya lleva, escrito por el operador, el nombre de la propiedad (igual que si lo hubiera tecleado); no es un campo nuevo ni un dato de PINCH copiado a una columna propia (P-10).

## 7. Interfaz

Textos en inglés, como el resto de la interfaz.

### 7.1 Picker en el Composer

- En los modos **Customer** y **Cleaner**, un botón **Templates** (`data-testid="plantillas"`) a la derecha de las pestañas de modo. En Note no hay. Si el modo está en gris, el botón también, con la misma razón.
- El menú lista las plantillas del modo y la etapa (§4.2) por su nombre visible. Cada opción lleva `data-plantilla="<clave>"`.
- Elegir una opción **llena la caja** con el texto del job. Si la caja ya tiene texto del operador, primero pregunta en línea "Replace what you wrote? · Replace · Cancel" (el texto no se pierde sin avisar; lo que sí se reemplaza sin preguntar es un borrador de IA sin tocar). Si hay un borrador de IA disponible, sigue ofreciéndose con "AI draft available · Use it" (OPR-27 §5.5).
- Con una plantilla elegida aparece una marca **Template · Confirmation request** (`data-testid="marca-plantilla"`), con una **x** para quitarla. La marca se queda aunque el operador edite: significa "este mensaje partió de esta plantilla". Quitarla, o vaciar la caja, borra la asociación.
- **Sin llenar:** debajo de la caja, "Fill in: {{date}}, {{window}}" (`data-testid="faltan"`), y Send deshabilitado hasta que no quede ninguno (§4.3).
- **Contador:** en modo Cleaner, "n / 1600 · 1 SMS" (§4.4).
- **Copy** (`data-testid="copiar"`), siempre visible en Customer y Cleaner: copia lo que hay en la caja. No llama al servidor ni escribe nada. Con Send apagado (Fase A en el servidor) es la acción útil del Composer.
- Send manda lo que está en la caja, igual que hoy, y pasa `template_key` y `template_version` si hay marca.

### 7.2 Panel Notices

En la ranura de la conversación, entre el hilo y el Composer, una sección plegable **Notices** (`data-testid="avisos"`), cerrada por defecto si no hay avisos que aplicar. Cada aviso (§4.2, columna "Panel Notices"):

- su nombre ("Scheduled notice", "Done notice", "Cancellation (cleaner)", "Cancellation (requester)") y el canal (Email o Text);
- la vista previa llenada, como texto plano;
- el estado **"Not sent · Available when actions are switched on"** (el texto de la Fase B de `CONTEXT.md`), con `data-estado="no-enviado"`;
- **Copy**.

Es una vista de solo lectura: no hay botón Send ni nada que llame a `ejecutarAccion` (§10.2). Request sin avisos que aplicar (Requests): la sección no se pinta. En la Fase B, el estado pasa a "Sent <hora> · by <operador>" leído del Audit `requester_notified` (OPR-35); eso es de esa fase.

## 8. Encaje en el código

### 8.1 Módulo nuevo `src/lib/plantillas/`

Sin dependencias nuevas, sin `server-only` en lo puro:

| Archivo | Qué |
|---|---|
| `catalogo.ts` | Las seis claves con nombre visible, modo, etapas, si aparecen como aviso y los placeholders "a mano" (§4.2, §4.3). Una constante tipada |
| `llenar.ts` | `llenarPlantilla(cuerpo, valores)` → `{ texto, faltan }`. Pura, una sola pasada, texto plano. La usarán también Ask cleaner, Reschedule, Cancel job y los avisos de la Fase B |
| `valores.ts` | `valoresDelJob({ borrador, job, propiedad })` → los cuatro valores, con `fechaYVentana`-style de `src/lib/tablero/formato.ts` (se separan en ese archivo `fechaCorta` y `ventanaCorta` para reusarlos; sin cambiar lo que ya se ve) |
| `disponibles.ts` | `plantillasDelJob(...)` (§5.1): qué se ofrece por modo y etapa, y los avisos |
| `sms.ts` | `contarSms(texto)` → `{ caracteres, mensajes, gsm7 }` |

### 8.2 Lo que cambia en lo que ya está

| Pieza | Dónde | Qué cambia |
|---|---|---|
| Lectura de la conversación | `src/lib/conversacion/consultas.ts` y `leer.ts` | `CONSULTA_REQUEST` con columnas del borrador; `CONSULTA_PLANTILLAS`; `leerDeBzzzbx` pide también la propiedad (en el mismo `Promise.all` y dentro del presupuesto); `DatosDeConversacion.plantillas` |
| Composer | `src/app/_conversacion/composer.tsx` | Picker, marca, faltantes, contador SMS y Copy (§7.1). El resto, igual |
| Panel | `src/app/_conversacion/avisos.tsx` (nuevo) | §7.2. **No importa** `ejecutarAccion` ni los ejecutores |
| Ejecutores | `src/lib/conversacion/ejecutores.ts` | `leerEnvio` acepta `template_key` y `template_version` opcionales; los pasa como parámetros 6 y 7; traduce `OP055` y `OP056`; ver §8.3 |
| Composer puro | `src/lib/conversacion/composer.ts` | Sin cambios de lógica; `validarCuerpo` sigue igual |
| Registro de acciones | `src/lib/acciones/registro.ts` | **Sin entradas nuevas.** `send_email` y `send_text` ya existen; la plantilla es un dato más de `datos` |

### 8.3 Validación en el servidor al enviar

`send_email` y `send_text` comprueban, **antes de llamar a la base** y con la etapa de `ctx.ventana`, que la plantilla es del catálogo, del modo y de la etapa (§4.2). Si no, `rechazada: plantilla_no_disponible` ("That template is not available here.") sin tocar la base ni el puerto. La base añade lo suyo (`OP055`, `OP056`). Códigos que traduce el ejecutor:

| SQLSTATE | `codigo` | Mensaje |
|---|---|---|
| `OP055` | `plantilla_invalida` | "That template is not available here." |
| `OP056` | `faltan_datos` | "Fill in the highlighted fields before sending." |

### 8.4 Fase B: lo que ya queda previsto, sin construirlo

Las acciones de la Fase B llamarán a `llenarPlantilla` en el servidor y pasarán el texto resultante a una función SQL del operador, que crea la instrucción `send_*` en la misma transacción que la acción (P-3). Esa función es de la tarjeta que la encienda; sus firmas y `OP057` a `OP059` se fijan en su spec. **Esa función tendrá que ampliar el guard "nada sale solo"** (§10.2): hoy solo reconoce a `opsrun.send_email` y `opsrun.send_text` como creadores de envíos.

## 9. El falso y la seed

Todo inventado (repo público): correos `@example.test`, teléfonos de la serie 555-01xx, nombres genéricos.

- **El falso:** no cambia. Acepta `send_email` y `send_text` como OPR-27 y el cuerpo ya llega editado.
- **La seed:** se **quita** el bloque "Plantillas, versión 1" (pasa a la migración, §6). Las requests que usan los E2E ya tienen lo necesario: R2 (Requests, con borrador completo y Team Alpha: propiedad `bx-prop-0002`, espacio `bx-space-0002`, fecha y ventana), R3 (Scheduled, sin espacio: prueba el colapso del espacio y cae a la unidad del borrador), R6 (Validation) y R1 (Requests sin fecha, ventana ni cleaner: prueba los placeholders sin llenar). Para un job `cancelled`, el E2E usa `/api/falso cambiar` sobre el job de R3, como OPR-29 F8. **Sin cambios de seed ni de falso** más allá de quitar el bloque [S-6].
- `pnpm local` y los E2E dependen de la migración para tener plantillas: si la migración no corre, `plantillasDelJob` devuelve vacío y el picker no aparece (no rompe nada).

## 10. Pruebas

### 10.1 pgTAP (`supabase test db`)

Archivo nuevo `plantillas.test.sql`, con fixtures dentro de la transacción:

- **Catálogo:** las seis claves existen, activas, versión 1, con el canal de §4.1; una sola activa por clave; el asunto solo en las de correo.
- **Placeholders, descubiertos:** todo `{{x}}` de cualquier `body` o `subject` de `message_template` está entre `property`, `space`, `date` y `window`. **Se ve fallar en cada corrida:** dentro de la transacción se inserta una plantilla con `{{cleaner}}`, el guard la marca, y se deshace.
- **Un SMS, descubierto:** toda plantilla de texto activa es GSM-7 y su parte fija más 90 no pasa de 160. Se ve fallar con una plantilla larga insertada en la transacción.
- **`send_text` y `send_email` con plantilla:** clave inexistente → `OP055`; plantilla de correo en `send_text` (y al revés) → `OP055`; cuerpo con `{{date}}` → `OP056`; ninguno de los dos crea instrucción ni Audit. El caso bueno crea la instrucción `pending`, con **payload idéntico al de sin plantilla** (solo crosswalk ID y cuerpo), y el `email_sent` o `text_sent` con `template_key` y `template_version` en `details`.
- **Sin plantilla:** el mismo comportamiento que antes (la prueba de `conversacion.test.sql` sigue en verde sin tocarla).
- **Versión no activa:** una versión 1 con la 2 activa se acepta.
- **Guards de OPR-20 y G6:** las funciones nuevas siguen con `search_path` vacío, dueño `opsrun_migrador`, `require_operator()` en su cuerpo y sin privilegios de más; sin actor o con actor de sistema, error. **Se ve fallar una vez** quitando `require_operator()` de la nueva `send_text` en local.
- `opsrun_app` no puede escribir `message_template` (guard de escrituras ya existente; no se toca).

### 10.2 Vitest (TDD, cada una en rojo primero)

- **`llenarPlantilla`:** los cuatro valores; espacio vacío sin doble espacio; placeholder sin valor queda literal y entra en `faltan`; una sola pasada (un valor `{{date}}` no se expande); un valor con HTML o con `$&` queda como texto; `reschedule_request` deja `{{date}}` y `{{window}}` siempre literales; la misma plantilla dos veces con valores distintos.
- **`valoresDelJob`:** Scheduled usa el job, Requests el borrador; el espacio de BzzzBX gana a la unidad; sin propiedad en BzzzBX, `{{property}}` literal; formato de fecha y ventana como el tablero (se agregan casos a `formato.test.ts`).
- **`plantillasDelJob`:** la tabla de §4.2 por etapa y modo, completa (cada clave en cada etapa, ofrecida o no); modo en gris sin lista; una clave de la base fuera del catálogo no se ofrece; una del catálogo sin fila activa tampoco.
- **Catálogo contra la base** (`OPSRUN_REQUIERE_BASE=1`, en CI): las claves de `catalogo.ts` y las activas de `message_template` son las mismas, en los dos sentidos. **Se ve fallar** con una fila extra dentro de una transacción que se deshace.
- **`contarSms`:** 160 y 161 caracteres GSM-7, 70 y 71 con un carácter fuera, los caracteres de dos unidades de GSM-7 (`{`, `}`, `[`, `]`, `~`, `^`, `\`, `|`, `€`), vacío.
- **Ejecutores `send_email` y `send_text`:** con `template_key` y versión pasan como parámetros 6 y 7; el payload no los lleva; una plantilla de otro modo o etapa → `plantilla_no_disponible` **sin llamar a la base ni al puerto**; `OP055` y `OP056` salen como sus `rechazada`; sin plantilla, la llamada es la de antes.
- **Guard "nada sale solo", ampliado (se ve fallar una vez):** (a) el panel `avisos.tsx` y `src/lib/plantillas/` no importan `ejecutarAccion`, `ejecutores`, `reales` ni el despacho, y no mencionan `send_email` ni `send_text` como código de acción; (b) elegir una plantilla, Copy y el panel no llaman a ninguna Server Action; (c) la prueba de disco de OPR-27 §11.1 (c) sigue encontrando solo al Composer y a su ejecutor; (d) **ningún camino crea una instrucción `send_*` a partir de una plantilla**: no hay función que combine `message_template` con `opsrun.instruction` fuera de `send_email` y `send_text`. El mismo detector sobre archivos de prueba que rompen cada regla tiene que marcarlos.
- **Una lectura nunca escribe:** `leerConversacion` y `plantillasDelJob` no llaman a funciones de escritura; G16 de la ADR 0006 sigue en verde y no hay `setInterval` nuevo.
- **Componentes (Testing Library):** el picker lista por modo y etapa; elegir llena la caja y pone la marca; con texto previo pregunta antes de reemplazar; editar deja la marca; quitar la marca no borra el texto; Send deshabilitado con `{{…}}` y con "Fill in: …" visible; el contador de SMS cambia de 1 a 2 al pasar de 160; Copy copia lo que hay en la caja (portapapeles simulado) y no llama a nada más; el panel muestra "Not sent · Available when actions are switched on" y no tiene botón Send; modo en gris, picker en gris con su razón.

### 10.3 Playwright (criterios de aceptación)

Contra el build de producción, la seed y el falso, con `OPSRUN_ACTOR_DEMO=1` y `OPSRUN_ZONA_HORARIA=America/New_York`. `plantillas.spec.ts` va en un proyecto aparte que corre después de los de la conversación, Alerts y las etapas, porque cambia el job de R3 (la cancelación de T8). Los textos esperados se arman en la prueba con los nombres que trae el falso (`src/lib/bzzzbx/falso/datos.ts`) y el formato de §4.3, no con cadenas escritas a mano.

| # | Criterio | Cómo se prueba |
|---|---|---|
| T1 | **Confirmation request llena el job.** (E2E-1) | R2, modo Cleaner: Templates ofrece solo "Confirmation request". Al elegirla, la caja tiene el texto de §4.1 con la propiedad, el espacio, la fecha y la ventana de R2; marca "Template · Confirmation request"; contador "1 SMS"; ningún "Fill in". |
| T2 | **Editar y enviar con plantilla.** (E2E-1) | Sobre T1, se agrega una frase y se pulsa Send: "Sending…" y, en menos de 1 minuto, "Sent" con `data-tipo="text"` y el texto editado. En la base, el `text_sent` de R2 tiene `template_key = cleaner_confirmation_request` y `template_version = 1`, y el payload de su instrucción solo `bzzzbx_team_id` y `body`. |
| T3 | **Reschedule request pide lo nuevo.** (E2E-9) | R3, modo Cleaner: "Reschedule request" deja `{{date}}` y `{{window}}` literales, "Fill in: {{date}}, {{window}}" visible y Send deshabilitado. Se escribe la fecha y la ventana nuevas: Send se habilita y el envío sale como T2. |
| T4 | **Scheduled notice, sin espacio.** (E2E-1) | R3, modo Customer: "Scheduled notice" llena el correo; como R3 no tiene espacio, no hay doble espacio. To sigue de solo lectura. Se envía: una sola burbuja `data-tipo="email"` en "Sent"; Audit con `template_key = requester_scheduled`. |
| T5 | **Done notice solo desde Validation.** (E2E-1) | R6 (Validation): Customer ofrece "Scheduled notice" y "Done notice"; se envía "Done notice" y sale. En R4 (In Progress), "Done notice" no está en el menú. |
| T6 | **Panel Notices, vista previa y Copy.** | R3: la sección Notices muestra "Scheduled notice" con el texto llenado y "Not sent · Available when actions are switched on". Copy deja ese texto en el portapapeles (con permiso `clipboard-read`) y el cursor de `/api/tablero/cambios` no se mueve. R6 muestra Scheduled y Done. R2 no pinta la sección. |
| T7 | **Copy del Composer.** | R2, Cleaner: Copy copia la caja, incluida una edición; ninguna fila nueva en `instruction` ni en `audit_event`. |
| T8 | **Cancelado: los dos avisos de cancelación.** (E2E-9) | `/api/falso cambiar` cancela el job de R3. En menos de 1 minuto: el Composer en gris "Job cancelled", sin Templates, y Notices con "Cancellation (cleaner)" (texto) y "Cancellation (requester)" (correo) llenos, con Copy. |
| T9 | **Nada sale solo.** (E2E-1) | En una request en Complete (R5 si ninguna spec anterior la aprobó; si no, la que deje E1): Approve & confirm. Se espera una vuelta del ciclo y un ciclo de sondeo: ninguna fila nueva `send_*` en `instruction`, ningún `requester_notified` en Audit y ningún mensaje nuevo en el falso (`/api/falso`, lista de mensajes). El panel de esa request, ya en Validation, muestra "Done notice" **sin enviar**. |
| T10 | **Lo que no corre no corre.** | Un `template_key` desconocido o de otro modo, mandado con `page.evaluate` a la Server Action, responde "That template is not available here." y el cursor de cambios no se mueve. Con BzzzBX en `no_disponible` abierta la ventana: picker en gris con "BzzzBX unavailable" y Notices con lo último leído y su aviso. |

**Hecho cuando, en local:** T1 a T10 en verde, más `pnpm lint`, `pnpm typecheck`, `pnpm test` y `supabase test db`. En staging, según §3.3.

## 11. Dependencias

| Dependencia | Qué toca aquí | Mientras tanto |
|---|---|---|
| **OPR-27** (Conversación, en `main`) | El Composer, los envíos y el borrador de IA | Se construye sobre él |
| **OPR-20** (modelo, en `main`) | `message_template` y los tipos de Audit | Se usa tal cual |
| **OPR-19** (spec #33) | Cambia `armarHilo` y las burbujas, no el Composer | Orden de fusión indiferente; si #33 va antes, sus Edit and resend no llevan marca de plantilla |
| **OPR-17** (textos de ida y vuelta), **OPR-5**, **OPR-13** | Ask cleaner usa `cleaner_confirmation_request`; envío real de textos | Picker y Copy en la Fase A; envío real en la Fase B |
| **OPR-16** (envío de correo), **OPR-14** | Envío real de los avisos y del apagado de Send en la Fase A | Idem |
| **OPR-28, OPR-29, OPR-31** | Programar, Reschedule, Cancel job y Approve & confirm usarán las plantillas | Fase B; hoy solo vista previa en Notices |
| **OPR-37** (borradores de IA) | Llenar huecos dentro de una plantilla; `llenarPlantilla` y la marca de plantilla son su punto de apoyo | OPR-37 depende de OPR-18 (`PLAN.md`) |
| **OPR-6** (contrato de BzzzBX) | Que la propiedad, el espacio, el job y el hilo existan como los supone el puerto | Falso |
| **OPR-4** (nombres) y zona horaria | Formato de fecha y hora de los avisos | `OPSRUN_ZONA_HORARIA`; la fecha es de calendario |
| **OPR-42** (Fase A y B) | Cuándo se encienden los envíos y los avisos | Regla de Henry: envíos en la Fase B |

## 12. Supuestos

| # | Supuesto |
|---|---|
| S-1 | Release Definition §4.3 a §4.6 y §7.1, User Guide §5.1 y R23 no se pudieron leer: nombres visibles, textos y qué aparece en qué etapa se revisan contra ellos. |
| S-2 | El texto real de PINCH puede cambiar el de la v1: se agrega como versión 2 por migración y se activa; la v1 queda en la tabla para el historial (el Audit de un envío apunta a la versión usada). |
| S-3 | El correo de una plantilla es una **respuesta en el hilo de la request** (OPR-27 S-11); el asunto de las plantillas de correo no se usa en V1.1 beta. |
| S-4 | Los cuatro placeholders de la tarjeta bastan. El nombre del requester, del cleaner o el precio no se agregan sin una tarjeta que los pida. |
| S-5 | "Un solo SMS" son 160 caracteres GSM-7 (70 en UCS-2). El presupuesto de 90 caracteres para los valores es una estimación; se ajusta con nombres reales de propiedades. |
| S-6 | Las requests de la seed (R1, R2, R3, R4, R6 y una en Complete) y el falso actuales alcanzan para T1 a T10 sin agregar datos. |
| S-7 | Un aviso Done es sobre un job aprobado (Validation); un aviso Scheduled, sobre un job ya enlazado (Scheduled en adelante). |
| S-8 | En la Fase A el aviso al requester lo manda el operador a mano desde las herramientas de PINCH, con Copy. opsRUN no lo registra (no sale por opsRUN). |
| S-9 | Los placeholders que `reschedule_request` deja "a mano" (`date`, `window`) se llenan con la fecha y la ventana nuevas cuando la Fase B traiga la acción. |
| S-10 | Cambiar las versiones activas por migración mientras un operador tiene el picker abierto no rompe nada: el envío con la versión anterior se acepta (§6). |
| S-11 | **Añadido al construir.** `{{window}}` en una plantilla **de texto** lleva guion ASCII ("9:00 AM-12:00 PM"), no la media raya del tablero ("9:00 AM–12:00 PM"): la media raya no está en GSM-7 y con ella un SMS cabría en 70 caracteres, no en 160, y T1 ("1 SMS") sería falso. Las plantillas de correo conservan la media raya del tablero. Pregunta abierta para Henry en el PR. |

## 13. Preguntas para Henry (mi recomendación primero)

- **P-0. ¿Migración?** **Recomiendo sí**, con el alcance de §6: las seis plantillas v1 como catálogo (la seed no corre en el servidor) y `send_email`/`send_text` con dos parámetros opcionales que dejan la plantilla en el Audit, con `OP055` y `OP056`; hay que reemplazar las dos funciones (`drop` y `create`) y quitar el bloque de la seed. Sin ninguna escritura nueva más. Alternativa: sin migración, con las plantillas solo en código y sin rastro de cuál se usó en el Audit; el picker funcionaría igual, pero staging y producción dependerían de que el código y la base estén de acuerdo sin un guard que lo cuide. **Pide tu OK.**
- **P-1. ¿Qué entrega OPR-18 en la Fase A?** **Recomiendo lo de §3.1:** las plantillas en la base, el picker y Copy en el Composer, y el panel Notices de solo lectura. Los avisos automáticos, el envío real y las plantillas dentro de Ask cleaner, Reschedule y Cancel job esperan a la Fase B. Alternativa: OPR-18 entera en la Fase B, que deja a Operations sin ayuda para redactar en la Fase A.
- **P-2. ¿Dónde viven los textos y quién pone los de PINCH?** **Recomiendo la tabla `message_template`, cambiada por migración, con el texto neutro de §4.1 como v1.** Si PINCH quiere sus palabras, las revisa en staging sobre el texto neutro y entran como v2 solo si no llevan nombres, teléfonos ni datos que no se puedan publicar; si los llevan, decides tú cómo cargarlos sin subirlos a este repo. Editar desde opsRUN queda para un release posterior (pregunta abierta §11.9 de OPR-20, para Federico). Alternativa: constantes en código, que no versiona ni deja rastro en la base.
- **P-3. ¿Qué es un aviso "automático" en la Fase B?** **Recomiendo que salga como consecuencia de la acción del operador**: al programar o enlazar sale el Scheduled y al Approve & confirm sale el Done, creados dentro de la transacción de esa acción por una función del operador (nunca por el ciclo, un observador o la IA), con el panel de la acción mostrando "This will also email the requester" y la vista previa, y con `requester_notified` en Audit. La persona firmó la acción; la plantilla es fija y sin IA. Alternativa: el aviso queda como borrador en el Composer y sale con un Send más, que cumple "las personas firman" a la letra pero contradice a la tarjeta ("automatic requester notices"). **Pide tu decisión antes del spec de la Fase B;** aquí no cambia nada de la Fase A.
- **P-4. ¿Dónde queda la plantilla usada?** **Recomiendo en el `details` del Audit** (`template_key`, `template_version`) y no en el payload de la instrucción, porque OPR-27 P-2 fijó el payload como crosswalk ID y cuerpo y la plantilla no debe viajar a BzzzBX. Es distinto de lo que dice OPR-20 §3.10 ("las instrucciones `send_*` guardan en su `payload` el `key` y la `version`"); se anota ahí. Alternativa: en el payload, a confirmar con el equipo de BzzzBX que lo ignora.
- **P-5. ¿Copy en la Fase A?** **Recomiendo sí**: es solo del navegador, no escribe nada, y es lo único que hace útil al picker mientras el Send está apagado en el servidor. Alternativa: sin Copy; el operador selecciona y copia a mano.
- **P-6. ¿Los avisos son respuesta en el hilo o un correo nuevo con el asunto de la plantilla?** **Recomiendo respuesta en el hilo de la request** (OPR-27 S-11), con el asunto que pone BzzzBX, y dejar `subject` en la tabla sin usar. Alternativa: correo nuevo con el asunto de la plantilla, que pide que BzzzBX permita abrir un hilo desde opsRUN (OPR-6) y vincularlo a la request.
- **P-7. ¿`cleaner_confirmation_request` en el Composer?** **Recomiendo ofrecerla en Requests mientras no exista Ask cleaner** (es la única forma de usarla en E2E-1 durante la Fase A) y retirarla del picker cuando OPR-17 entregue esa acción, que será su dueña. Aviso: un texto mandado desde el Composer no abre la espera de respuesta ni crea `cleaner_confirmation`. Alternativa: no ofrecerla hasta OPR-17, y que E2E-1 la pruebe solo en la Fase B.
- **P-8. ¿SMS: contar o bloquear?** **Recomiendo solo contar** ("1 SMS", "2 SMS") y vigilar los textos fijos con el guard de §4.4. Alternativa: bloquear el envío pasados 160 caracteres, que impide mensajes legítimos con nombres largos y no es lo que pide la tarjeta ("where possible").
- **P-9. ¿Un `{{…}}` sin llenar bloquea el envío?** **Recomiendo sí**, en el Composer y en la base (`OP056`), porque mandar "to {{date}}" a un cleaner es peor que no mandar. Alternativa: solo una advertencia en el Composer.
- **P-10. ¿El cuerpo enviado puede llevar el nombre de la propiedad?** **Recomiendo sí**: es texto escrito por el operador (la plantilla solo se lo llena), ya se guarda así en `instruction.payload.body` desde OPR-27, y no es una columna propia de datos de PINCH. Alternativa: guardar el cuerpo con los placeholders sin llenar y que BzzzBX los llene al enviar; eso cambia el contrato de OPR-6 y no deja editar el texto antes de enviarlo.

## 14. Decisiones de Henry (2026-11-27)

Henry aprobó el spec con **todas las recomendaciones**, P-0 a P-10:

| # | Decisión |
|---|---|
| P-0 | Con migración (`20261209120000_plantillas.sql`): las seis plantillas v1 como catálogo y `send_email`/`send_text` con `p_template_key` y `p_template_version`; `OP055` y `OP056`. Se quita el bloque de plantillas de la seed |
| P-1 | OPR-18 entrega en la Fase A lo de §3.1: plantillas en la base, picker y Copy en el Composer y el panel Notices de solo lectura |
| P-2 | Los textos viven en `message_template`, cambiados por migración, con el texto neutro de §4.1 como v1. Editar desde opsRUN, en un release posterior |
| P-3 | El aviso "automático" de la Fase B sale como consecuencia de la acción del operador, dentro de su transacción. Se decide el detalle en el spec de la Fase B; aquí no cambia nada |
| P-4 | La plantilla usada queda en el `details` del Audit (`template_key`, `template_version`), no en el payload de la instrucción |
| P-5 | Copy en la Fase A |
| P-6 | Los avisos de correo son respuesta en el hilo de la request; `subject` queda sin usar |
| P-7 | `cleaner_confirmation_request` se ofrece en Requests mientras no exista Ask cleaner |
| P-8 | SMS: solo contar ("1 SMS", "2 SMS"); no se bloquea el envío |
| P-9 | Un `{{…}}` sin llenar bloquea el envío, en el Composer y en la base (`OP056`) |
| P-10 | El cuerpo enviado puede llevar el nombre de la propiedad |
