# CONTEXT.md — Glosario del dominio

Términos del proyecto y su significado exacto. Úsalos en código, commits, docs y conversación. Si un término no está aquí, no lo inventes: pregunta y agrégalo.

Los términos del producto van en inglés, tal como los ve el operador. Lo que dice "por confirmar" no tiene definición en las tarjetas.

## Sistemas

| Término | Significado | Dónde aparece |
|---|---|---|
| opsRUN | Esta consola: el tablero de Operations y Finance de PINCH. | Todo el repo |
| BzzzBX | Capa de integración. Único camino de opsRUN hacia los sistemas de PINCH, para leer y para actuar. | OPR-6, OPR-22, OPR-23 |
| Caja | La instalación de BzzzBX en el servidor de PINCH. opsRUN corre en el mismo servidor pero fuera de la caja: no la instala su actualizador y no entra por su puerta, pero sí usa su Supabase (base y GoTrue), en su propio esquema y con su propio rol. _Evitar_: decir que opsRUN está "dentro de BzzzBX". | ADR 0002, ADR 0003 |
| Engine | Para Henry, cada app de Boss que corre al lado de la caja y usa su Supabase: BOb, opsRUN y las que vengan. En el glosario de BzzzBX la palabra significa otra cosa (una app fuera de la caja a la que el portal solo enlaza). | ADR 0003 |
| `opsrun_app` | Rol de Postgres con el que el servidor de opsRUN se conecta a la base de la caja. Mínimo privilegio: lee el esquema `opsrun` y ejecuta sus funciones de escritura; no llega a `opsrun_private`. | ADR 0003, OPR-20 |
| `opsrun_migrador` | Rol de Postgres dueño de los esquemas `opsrun`, `opsrun_private` y `opsrun_writeback`; aplica las migraciones. Lo crea, con los esquemas, el alta de opsRUN en Bzzz; las migraciones no crean esquemas ni roles. En local y en CI lo imita un script de prueba (OPR-1). | D77 §2.8, OPR-1, OPR-20 |
| Read layer | Parte de opsRUN que lee todo de BzzzBX y se actualiza en menos de 1 minuto. Si BzzzBX está caído, muestra lo último conocido con un aviso. | OPR-22 |
| Instruction layer | Parte de opsRUN que convierte cada acción del operador en una instrucción a BzzzBX y espera su confirmación o su error. | OPR-23 |
| Write-back | Envío de los datos que son de opsRUN a BzzzBX para que se consulten como el resto, también desde Rosie. | OPR-24 |
| Signal Maker | Parte de BzzzBX donde se calculan las reglas de alerta. | OPR-33 |
| Job Tracker | Sistema de PINCH que registra check-in, inicio, fin y fotos del trabajo; también el nombre de la pestaña que lo muestra. | OPR-9, OPR-30 |
| Puertos de BzzzBX | Las dos interfaces por las que opsRUN lee de BzzzBX y le manda instrucciones (`src/lib/bzzzbx/`). Toda implementación pasa las mismas pruebas de contrato. | OPR-22, OPR-23, ADR 0005 |
| Stand-in | Implementación falsa de BzzzBX, en memoria y con datos inventados, para construir sin el contrato real. Solo local y CI; con `OPSRUN_SERVIDOR=1` no arranca. | OPR-22, OPR-44 |
| Rosie | Analista de solo lectura en el riel izquierdo. Consulta BzzzBX y los datos de opsRUN; nunca actúa. | OPR-38 |

## Despliegue

| Término | Significado | Dónde aparece |
|---|---|---|
| Deploy | Llevar una imagen de opsRUN, etiquetada por el SHA de su commit, a un entorno del servidor con `scripts/servidor/opsrun.sh deploy`: revisa el entorno, aplica las migraciones de esa imagen, arranca la nueva y la prueba. | OPR-1, `docs/runbook-servidor.md` |
| Prueba de humo | `scripts/humo.mjs` dentro del contenedor: `GET /api/salud`, que corre `opsrun.opsrun_health()` como `opsrun_app`. Pasa si la base responde y va en la última migración de la imagen o en una posterior. Es también el healthcheck de la imagen. | OPR-1 |
| Vuelta atrás | Volver a la imagen anterior de un entorno (`opsrun:<entorno>-anterior`), sola cuando un deploy no pasa la prueba de humo o a mano con `vuelta-atras`. No deshace migraciones: son solo hacia adelante. | OPR-1 |

## Trabajo y etapas

| Término | Significado | Dónde aparece |
|---|---|---|
| Request | Solicitud que entra por correo al buzón compartido. Tiene número R hasta que se programa. | OPR-15, OPR-28 |
| R number | Identificador de una request. Es de opsRUN. | OPR-15, OPR-20 |
| Job | El trabajo de limpieza creado en la base de PINCH al programar la request. | OPR-28 |
| Job number | Número del job que devuelve la base de PINCH al programarlo. En Audit también aparece como Work App number. | OPR-28, OPR-35 |
| Requests, Scheduled, In Progress, Complete, Validation | Las cinco columnas del tablero, en ese orden. | OPR-25 |
| Paid | Estado de pago al cleaner, leído de QuickBooks por BzzzBX. Tarjeta verde y fila "paid" colapsada. No es columna. | OPR-10, OPR-32 |
| Delayed | Job Scheduled del mismo día que no empezó a la 1:00 PM (zona horaria por confirmar en OPR-4). Parpadea bajo el número; se limpia con el check-in; no manda texto. | OPR-4, OPR-29 |
| Paused | Estado que se muestra bajo el número de la tarjeta. Por confirmar. | OPR-25 |
| OSS | Marca del job que se pone con Mark as OSS / Not OSS, o sola al terminar a mano sin fotos. Qué significa la sigla, por confirmar. | OPR-30, OPR-31 |
| PO | Orden de compra del cliente. Algunos clientes la exigen, y sin ella Validate queda bloqueado con "Add PO". | OPR-8, OPR-32 |
| Health status | On track, at risk o breached, por job. Da los colores de la tarjeta. | OPR-33 |
| Operator | Persona de Operations o Finance que usa opsRUN. | OPR-2, OPR-21 |
| Cleaner | Equipo de limpieza asignado al job. | OPR-17, OPR-28 |
| Requester | Quien pidió el trabajo; recibe los avisos Scheduled y Done. | OPR-16, OPR-18 |

## Alertas

| Término | Significado | Dónde aparece |
|---|---|---|
| Standard alerts | Las 9 reglas de V1.1 beta: OPS-001 Unassigned request, OPS-002 Request open too long, OPS-010 Delayed, OPS-020 Cleaner declined, MEC-003 Running long, ORG-002 No photos, ORG-003 Partial photos, TRN-005 PO missing, Message not delivered. | OPR-3, OPR-33 |
| Needs action, Waiting, Resolved | Las tres secciones de la pestaña Alerts. Needs action: alertas abiertas de la request que opsRUN no tiene resueltas (lo que decide con qué pestaña abre la ventana); Waiting: preguntas abiertas al cleaner (`asked` o `replied`); Resolved: el historial de `alert_occurrence`, con quién y cómo. | OPR-34 |
| Registrador de alertas | La tarea `registrador_alertas` del ciclo de fondo (cada 15 s): lee de BzzzBX qué alertas cambiaron y las anota en `alert_occurrence` y en Audit (`upsert_alert_occurrence`, como actor de sistema). Provisional hasta la read layer de OPR-22. | OPR-34, ADR 0006 |
| Fixed by action / Cleared automatically / Cleared by operator | Cómo se resolvió una alerta. Fixed by action: un operador hizo, entre la apertura y el cierre, algo que arregla esa regla (`alert_fixing_events()`). Cleared automatically: cualquier otro cierre de BzzzBX (Delayed al llegar el check-in). Cleared by operator: solo Clear alert, con motivo. | OPR-34 §4.1 |
| Insignia de Alerts | El conteo de la pestaña Alerts: roja o ámbar con el de Needs action, gris con el de Waiting si Needs action está vacía. Late unas veces cuando aparece una roja nueva en esa ventana. | OPR-34 §5.2 |
| Panel de Alerts | El diálogo no modal que abre el ícono de Alerts de la barra superior: Needs action y Waiting de toda la operación, con los filtros Level, Rule, Stage y Assigned to. Cada fila abre la Job window sin `?tab`. | OPR-34 §6 |
| Clear alert | Marcar como revisada una alerta (Running long) con motivo obligatorio. El nombre final está por confirmar en OPR-4. | OPR-4, OPR-30 |

## Pantallas y acciones

| Término | Significado | Dónde aparece |
|---|---|---|
| Job window | Ventana de un job: conversación a la izquierda y pestañas a la derecha (propiedad, Alerts, Audit, Job tracker, Billing). | OPR-26 |
| Action bar | "Action ▾ + Go" con panel de motivo. Solo corren las acciones de V1.1 beta. | OPR-26 |
| Conversation | Un solo hilo por job: request original, correos, textos y notas internas, con su estado de entrega. | OPR-27 |
| Composer | Caja para escribir en la conversación, con tres modos: Customer (correo), Cleaner (texto) y Note. | OPR-27 |
| Audit | Registro ordenado de cada evento y acción del job, con persona y motivo. | OPR-35 |
| AI-marked field | Campo del borrador que la IA llenó (o con una sugerencia suya sin decidir) y se ve con el chip AI, con su motivo ("Why?") y Accept, Change y Reject, hasta que el operador lo confirma, lo corrige o lo rechaza. Solo se llenan campos vacíos, sin confirmación vigente que los cubra y que el operador no haya decidido antes. | OPR-28, OPR-36 |
| AI pending | Texto gris que ocupa el lugar del valor de un campo vacío de la pestaña de la propiedad (solo en Requests) mientras no hay análisis, el último sigue pendiente, falló o venció. No se guarda: se calcula al leer. No deshabilita nada; el operador trabaja a mano. | OPR-36 |
| Focused / Global | Alcance de Rosie: Focused sigue el filtro de operador y Global ve toda la operación. | OPR-38 |
| Board | El tablero: barra superior, riel izquierdo y las cinco columnas con sus tarjetas. Se actualiza solo en menos de 1 minuto. | OPR-25 |
| Card | La tarjeta de una request o job en el tablero: nombre y número, estado bajo el número, ciudad, type \| service, chat, flags (PO, PO missing, OSS) y color. | OPR-25 |
| Paid row | Fila colapsada "Paid (n)" al final de Validation con las tarjetas verdes. | OPR-25 |
| Live | Indicador de la barra superior: Live, Reconnecting… o "BzzzBX unavailable · last update HH:MM" cuando se muestra lo último conocido. | OPR-22, OPR-25 |
| Operator filter | All operators / Only me. Only me espera al login (OPR-21). | OPR-25 |
| PO missing | Flag de la tarjeta cuando el cliente exige PO y el job no lo tiene. | OPR-8, OPR-25 |
| — — | Lo que se muestra en un valor sin definir. | OPR-25 |
| Available in a later release | Texto de lo que se ve en gris: la barra y el riel del tablero y, en el Composer, Edit To, Cc y Temporary number. | OPR-25, OPR-27 |
| Not available in this release | Texto de las funciones que se muestran en gris porque no entran en V1.1 beta. | OPR-25, OPR-26 |

## Modelo de datos

Términos internos del esquema de opsRUN (no los ve el operador). Detalle en `docs/spec/opr-20-modelo-de-datos.md`.

| Término | Significado | Dónde aparece |
|---|---|---|
| Crosswalk ID | Identificador de BzzzBX con el que opsRUN apunta a algo de PINCH (job, cliente, contacto, propiedad, equipo, mensaje, alerta). Columnas `bzzzbx_*_id`. Nunca se guarda nada más de esa entidad. | OPR-20 |
| Draft | Job details, Who is it from? y Cleaner de una request mientras está en Requests. Es de opsRUN hasta que se programa; después manda el job de PINCH y el draft queda congelado. | OPR-20, OPR-28 |
| Schedule gate | Lo que exige Schedule: dueño, más confirmaciones vigentes de details, sender y cleaner. | OPR-28 |
| Superseded | Una confirmación que dejó de valer porque cambió el borrador: `request_confirmation.superseded_at` queda puesto, la fila se queda en la tabla y en el write-back, ya no cuenta para el gate y Audit lo dice (`confirmation_superseded`, con las columnas que cambiaron). Cada tipo se invalida por sus propias columnas: la del cleaner también por fecha, ventana y propiedad. Reasignar no invalida ninguna. Lo hace un trigger de la base. | OPR-28, `docs/spec/opr-28-assign-confirm.md` §5 |
| Assign to me | Atajo del panel de Assign / Reassign: elige como dueño al operador que actúa (el actor de la transacción; hasta OPR-21, el del selector "Acting as"). No es otra acción: pasa por `assign_request` como cualquier asignación. | OPR-28 |
| Cleaner confirmation | Pregunta al cleaner por texto, inicial o por Reschedule, con su respuesta y la decisión del operador. Las abiertas forman la sección Waiting. | OPR-17, OPR-29, OPR-34 |
| Instruction | Registro de cada acción que sale a BzzzBX: tipo, motivo, estado (pending, sent, confirmed, failed, timed out) y error. | OPR-23 |
| Alert occurrence | Una apertura de una regla de alerta sobre una request, con su resolución: Cleared automatically, resuelta por una acción o con Clear alert. | OPR-34 |
| AI suggestion | Propuesta de la IA para un campo, con motivo. Queda sin decidir (el campo se ve AI-marked) hasta que el operador la acepta, la corrige o la rechaza. | OPR-36, OPR-37 |
| Change linked job | En Scheduled (o con el job cancelado en PINCH), el operador cambia el job enlazado de una request por otro de PINCH, con motivo, por un enlace equivocado o un job que PINCH canceló y reemplazó. Es un dato de opsRUN: no toca el borrador ni las confirmaciones y no manda nada a BzzzBX. En Audit es `job_relinked` (Linked job changed, "from … to …"). | OPR-29 |
| Job cancelled (observado) | Un job de PINCH que se canceló: sale del tablero, la ventana dice Cancelled y Audit anota `job_cancel_observed` con la marca Observed, una vez por job, con la hora en que opsRUN lo vio (provisional hasta OPR-6). | OPR-29 |
| Observed event | Hecho de PINCH (check-in, inicio, fin, Paid) que la read layer ve y anota en Audit con solo el tipo, la hora y el crosswalk ID. | OPR-20, OPR-35 |
| Write-back views | Vistas `opsrun_writeback.v1_*`: el contrato de lo que BzzzBX lee de opsRUN, con el rol de la caja `bzzz_writeback_opsrun` (lo crea la caja; la migración de opsRUN solo le concede SELECT). | OPR-24, OPR-20 |
| Actor de la transacción | Quién actúa en una transacción, según lo que fija el servidor: un operador (`opsrun.auth_user_id`, validado contra GoTrue) o un proceso del sistema (`opsrun.system_actor`). Las funciones de escritura lo leen y lo escriben en Audit. | OPR-20 |
| Fase A | Primer lanzamiento (Runbook §6.1, OPR-42): el job se crea en las herramientas de PINCH y opsRUN registra decisiones y observa; casi no manda instrucciones. | OPR-28, OPR-42 |
| Enlace (job link) | En la Fase A, la confirmación del operador de que un job observado en BzzzBX es el de una request. La deja Scheduled con el crosswalk ID y el job number del job; en Audit es `request_scheduled` con `mode: "linked"`. Un candidato rechazado (`job_link_rejected`) no se vuelve a proponer para esa request. | OPR-28, spec Fase A |

## Job window (OPR-26)

Términos de la ventana de cada job. Detalle en `docs/spec/opr-26-job-window.md`.

| Término | Significado | Dónde aparece |
|---|---|---|
| Job window | La ventana de un job: arriba el encabezado y la action bar, a la izquierda la conversación y a la derecha las pestañas. Se abre encima del tablero en `/job/[requestId]` (ruta interceptada); la recarga y la URL directa la abren como página completa. | OPR-26 |
| Action bar | `Action ▾` + `Go` de la Job window. Elegir una acción abre un panel con su nombre, Reason y `Cancel`/`Go`. | OPR-26, §5 |
| Registro de acciones | Lista en `src/lib/acciones/` con cada acción de la action bar: etapas, motivo, si necesita BzzzBX, bloqueos y, cuando su tarjeta la construye, el ejecutor. | OPR-26 §5.4 |
| `ejecutarAccion` | El único camino para correr una acción: recalcula la disponibilidad en el servidor y rechaza lo que no sea `disponible`. La interfaz no es la defensa. | OPR-26 §5.4 |
| Disponibilidad | Estado de una acción para un job: `disponible`, `no_aplica` (no aparece), `bloqueada` (en gris con su motivo), `sin_construir` ("Not built yet") o `fuera_de_release` ("Not available in this release"; con `fase: "b"`, "Available when actions are switched on"). | OPR-26 §5.2, OPR-30 P-10 |
| Ranura | Lugar de la Job window que otra tarjeta llena (conversación, enlace de la Fase A, Audit, Alerts, Job tracker, Billing), con su contrato de props y su marcador `data-ranura`. | OPR-26 §7 |
| Acting as | Selector solo local con el que la demo elige qué operador de la seed actúa, sin login. Existe únicamente con `OPSRUN_ACTOR_DEMO=1`, `BZZZBX_MODO=falso` y sin `OPSRUN_SERVIDOR=1`; si falta una, no hay selector y la cookie se ignora. | OPR-26, P-2 |
| Needs action | Alerta abierta del job que pide acción; decide con qué pestaña abre la ventana (Alerts). Desde OPR-34 es exactamente la sección Needs action, sin Waiting ni lo que opsRUN ya resolvió. | OPR-26 S-8, OPR-34 |

## Etapas: In Progress, Complete y Validation (OPR-30, OPR-31 y OPR-32)

Términos de las etapas hasta Paid. Detalle en `docs/spec/opr-30-31-32-etapas.md`.

| Término | Significado | Dónde aparece |
|---|---|---|
| Job tracker | Pestaña de la Job window desde In Progress: estado y ventana en una fila, Arrival, Start, End y Duration (con la esperada, la de la ventana del job) y la galería de fotos Before / After. Todo se lee de BzzzBX al pintar; nada se guarda. | OPR-30 |
| Running long | La alerta MEC-003 abierta de un job: chip en el Job tracker. Es la única que Clear alert limpia. | OPR-30 |
| Hechos del job | Lo que opsRUN decide después de programar y guarda en columnas de `request` con la etiqueta `opsrun:job`: End manually, la marca OSS, la aprobación, el PO capturado y la validación. El guard G14 exige el candado con versión a toda función que los escribe. | OPR-30 a OPR-32 |
| Approve & confirm | Acción de Complete: firma el job y lo pasa a Validation. En la Fase A solo se registra en opsRUN y no avisa al requester. | OPR-31 |
| Mark as OSS / Not OSS | Acción de Complete: la marca del operador; cambia una marca `auto` y no se cambia después de aprobar. | OPR-31 |
| Billing | Pestaña de la Job window en Validation: PO # (editable hasta Validate), OSS status, Approved, Validated y Paid (de QuickBooks, sin control). | OPR-32 |
| PO vigente | El PO con el que se decide "Add PO": el capturado en opsRUN, si no el del job en PINCH (leído) y si no el del borrador. | OPR-32 |
| Validate | Acción de Validation: registra la validación en opsRUN. Se bloquea con "Add PO" si el cliente exige PO y no hay uno vigente, y con "BzzzBX unavailable" porque la base no puede saber si el cliente lo exige. | OPR-32 |
| Fase B (acción de) | Reschedule, Cancel job y End manually: en la Fase A se hacen en las herramientas de PINCH y opsRUN las observa. Se ven en gris con "Available when actions are switched on" y nunca corren. | OPR-30, OPR-42 |
| Observador | Proceso mínimo que escribe en Audit los hechos observados de PINCH (Checked in, Started, Completed, Paid) con `record_observed_event`. Corre solo en el ciclo de fondo de opsRUN (OPR-15), nunca desde una lectura. | OPR-30, P-9 |

## Conversación (OPR-27)

Términos de la conversación del job. Detalle en `docs/spec/opr-27-conversacion.md`.

| Término | Significado | Dónde aparece |
|---|---|---|
| Hilo | La columna de la conversación: un solo hilo por job con la Original request, los correos (Email), los textos (Text) y las notas (Internal note), por hora y con el estado de entrega de cada uno. Se arma con `armarHilo` (`src/lib/conversacion/`). | OPR-27 §4 |
| Estado de entrega | Received (entrante), Sending… (instrucción pending), Sent, Queued, Delivered, Not delivered (BzzzBX), Failed (instrucción fallida, con Edit and resend), Couldn't confirm (timed out) o Internal · not sent (nota). | OPR-27 §4.3 |
| Edit and resend | Botón de un envío Failed: copia su cuerpo al Composer en el mismo modo. Enviar crea una instrucción nueva; no reintenta la fallida. | OPR-27 S-6 |
| AI draft | Borrador de respuesta (al cliente o al cleaner) que escribió la IA, sin decidir. Aparece en el Composer marcado "AI draft" y solo sale si el operador pulsa Send: se decide accepted (igual) o corrected (editado). Discard lo rechaza. Si la IA no produce borradores, el Composer funciona igual. | OPR-27 §5.5 |
| Despacho de instrucciones | Entrega a BzzzBX las instrucciones `send_email` y `send_text` que ya existen en la base y las reconcilia con su estado (confirmed, failed, timed out). No crea instrucciones. Mínimo y provisional hasta OPR-23. | OPR-27 §7, `src/lib/instrucciones/` |
## Audit (OPR-35)

Términos de la pestaña Audit. Detalle en `docs/spec/opr-35-audit.md`.

| Término | Significado | Dónde aparece |
|---|---|---|
| Original | Marca del primer `request_assigned` de la request: el operador original. | OPR-35 |
| Observed | Marca de un evento que es un hecho de PINCH visto por la read layer (`source = 'bzzzbx_observed'`), para distinguirlo de una acción hecha en opsRUN. | OPR-35 |
| Work App number | Se muestra con el mismo valor que el Job number hasta revisarlo contra el User Guide §10.3 (P-7). | OPR-35 |

## Entrada de correo (OPR-15)

Términos de la entrada de correo y del ciclo de fondo. Detalle en `docs/spec/opr-15-entrada-correo.md` y la ADR 0006.

| Término | Significado | Dónde aparece |
|---|---|---|
| Entrada de correo | El proceso de sistema `entrada_correo`: lee los correos entrantes nuevos del puerto de lectura de BzzzBX y le pide a la base (`opsrun.ingest_request_email`) que cree la request del hilo, vincule la respuesta o diga que ya estaba. Nunca lee Gmail ni guarda nada de PINCH: a la base solo viajan el ID del mensaje, el del hilo y la hora. | OPR-15, `src/lib/entrada/` |
| Ciclo de fondo | La única pieza de opsRUN que corre trabajo propio en el servidor de Next: arrancada por `instrumentation`, corre varias tareas, cada una con su cadencia y una vuelta a la vez. Sus tareas hoy: la entrada de correo, la reconciliación de envíos, el observador de etapas, el registrador de alertas y el análisis de IA. Ninguna tarjeta abre un temporizador propio. | ADR 0006, `src/lib/ciclo/` |
| Marca de agua | Desde dónde recupera la entrada al arrancar o tras `CursorCaducado`: la última `request.received_at` menos 24 h. Sin ninguna request, no recupera nada (la entrada empieza en "ahora"). | OPR-15 §4.3 |
| Análisis de IA | La tarea `analisis_ia` del ciclo de fondo (cada 5 s): abre un `ai_analysis` por request nueva, se lo pide a BzzzBX con crosswalk IDs (nunca el correo), sigue los pendientes y guarda el resultado (`opsrun.record_ai_analysis`, actor de sistema). Sus sugerencias llenan los campos vacíos del borrador y se ven AI-marked; nunca crea confirmaciones ni instrucciones ni cambia dueño, estado o job (guard G19). A lo sumo dos por request. | OPR-36, ADR 0006 |
| Barrido de análisis | Lo que hace la tarea `analisis_ia` en cada vuelta además de las requests que la entrada despertó: propone las requests `open` de las últimas 24 h sin análisis `pending` ni `completed`, hasta 20. Encuentra lo que se perdió si el proceso cayó. La base decide si toca (`start_ai_analysis`). | OPR-36 |
| Límite del análisis | 120 s desde `requested_at` sin resultado: el análisis termina `timed_out` (también con BzzzBX caído). El reintento automático sale a los 60 s del fallo; no hay botón "Retry AI". | OPR-36 |
| Email received | Evento de Audit (`email_received`) cuando la entrada vincula una respuesta del cliente a la request de su hilo. El primer correo deja Request received. | OPR-15 P-4, OPR-35 |

## Fuera de alcance de V1.1 beta
- Escribir en QuickBooks: facturas y pagos siguen como los hace Finance hoy (OPR-10).
- Reject · re-clean, las pestañas $ y People, editar To/Cc y el número temporal: se ven, no corren.
- Alarms, Anomalies, Actions, Observe, Geo, Incidents, Activity y Map: en gris.
- Modo Prediction de Rosie hasta que exista OPR-12; voz, lectura en voz alta y recorrido en el mapa.
- Evidencia de fotos por área.

## Decisiones clave
Enlaces a ADRs en `docs/adr/`.
- [0001 — Modelo de datos de opsRUN](docs/adr/0001-modelo-de-datos.md) (OPR-20)
- [0005 — Puertos de BzzzBX con un stand-in en memoria](docs/adr/0005-puerto-de-bzzzbx.md) (OPR-22, OPR-23)
