# CONTEXT.md — Glosario del dominio

Términos del proyecto y su significado exacto. Úsalos en código, commits, docs y conversación. Si un término no está aquí, no lo inventes: pregunta y agrégalo.

Los términos del producto van en inglés, tal como los ve el operador. Lo que dice "por confirmar" no tiene definición en las tarjetas.

## Sistemas

| Término | Significado | Dónde aparece |
|---|---|---|
| opsRUN | Esta consola: el tablero de Operations y Finance de PINCH. | Todo el repo |
| BzzzBX | Capa de integración. Único camino de opsRUN hacia los sistemas de PINCH, para leer y para actuar. | OPR-6, OPR-22, OPR-23 |
| Caja | La instalación de BzzzBX en el servidor de PINCH. opsRUN corre en el mismo servidor pero fuera de la caja: no usa su base, no la instala su actualizador y no entra por su puerta. _Evitar_: decir que opsRUN está "dentro de BzzzBX" o que es un "engine" de la caja. | ADR 0002 |
| Read layer | Parte de opsRUN que lee todo de BzzzBX y se actualiza en menos de 1 minuto. Si BzzzBX está caído, muestra lo último conocido con un aviso. | OPR-22 |
| Instruction layer | Parte de opsRUN que convierte cada acción del operador en una instrucción a BzzzBX y espera su confirmación o su error. | OPR-23 |
| Write-back | Envío de los datos que son de opsRUN a BzzzBX para que se consulten como el resto, también desde Rosie. | OPR-24 |
| Signal Maker | Parte de BzzzBX donde se calculan las reglas de alerta. | OPR-33 |
| Job Tracker | Sistema de PINCH que registra check-in, inicio, fin y fotos del trabajo; también el nombre de la pestaña que lo muestra. | OPR-9, OPR-30 |
| Rosie | Analista de solo lectura en el riel izquierdo. Consulta BzzzBX y los datos de opsRUN; nunca actúa. | OPR-38 |

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
| Needs action, Waiting, Resolved | Las tres secciones de la pestaña Alerts. | OPR-34 |
| Clear alert | Marcar como revisada una alerta (Running long) con motivo obligatorio. El nombre final está por confirmar en OPR-4. | OPR-4, OPR-30 |

## Pantallas y acciones

| Término | Significado | Dónde aparece |
|---|---|---|
| Job window | Ventana de un job: conversación a la izquierda y pestañas a la derecha (propiedad, Alerts, Audit, Job tracker, Billing). | OPR-26 |
| Action bar | "Action ▾ + Go" con panel de motivo. Solo corren las acciones de V1.1 beta. | OPR-26 |
| Conversation | Un solo hilo por job: request original, correos, textos y notas internas, con su estado de entrega. | OPR-27 |
| Composer | Caja para escribir en la conversación, con tres modos: Customer (correo), Cleaner (texto) y Note. | OPR-27 |
| Audit | Registro ordenado de cada evento y acción del job, con persona y motivo. | OPR-35 |
| AI-marked field | Campo llenado por la IA que se ve marcado como AI hasta que el operador lo confirma o lo corrige. | OPR-28, OPR-36 |
| AI pending | Estado de los campos cuando la IA tarda o está caída; el operador trabaja a mano. | OPR-36 |
| Focused / Global | Alcance de Rosie: Focused sigue el filtro de operador y Global ve toda la operación. | OPR-38 |
| Not available in this release | Texto de las funciones que se muestran en gris porque no entran en V1.1 beta. | OPR-25, OPR-26 |

## Modelo de datos

Términos internos del esquema de opsRUN (no los ve el operador). Detalle en `docs/spec/opr-20-modelo-de-datos.md`.

| Término | Significado | Dónde aparece |
|---|---|---|
| Crosswalk ID | Identificador de BzzzBX con el que opsRUN apunta a algo de PINCH (job, cliente, contacto, propiedad, equipo, mensaje, alerta). Columnas `bzzzbx_*_id`. Nunca se guarda nada más de esa entidad. | OPR-20 |
| Draft | Job details, Who is it from? y Cleaner de una request mientras está en Requests. Es de opsRUN hasta que se programa; después manda el job de PINCH y el draft queda congelado. | OPR-20, OPR-28 |
| Schedule gate | Lo que exige Schedule: dueño, más confirmaciones vigentes de details, sender y cleaner. | OPR-28 |
| Cleaner confirmation | Pregunta al cleaner por texto, inicial o por Reschedule, con su respuesta y la decisión del operador. Las abiertas forman la sección Waiting. | OPR-17, OPR-29, OPR-34 |
| Instruction | Registro de cada acción que sale a BzzzBX: tipo, motivo, estado (pending, sent, confirmed, failed, timed out) y error. | OPR-23 |
| Alert occurrence | Una apertura de una regla de alerta sobre una request, con su resolución: Cleared automatically, resuelta por una acción o con Clear alert. | OPR-34 |
| AI suggestion | Propuesta de la IA para un campo, con motivo. Queda sin decidir (el campo se ve AI-marked) hasta que el operador la acepta, la corrige o la rechaza. | OPR-36, OPR-37 |
| Observed event | Hecho de PINCH (check-in, inicio, fin, Paid) que la read layer ve y anota en Audit con solo el tipo, la hora y el crosswalk ID. | OPR-20, OPR-35 |
| Write-back views | Vistas `writeback.v1_*`: el contrato de lo que BzzzBX lee de opsRUN. | OPR-24 |

## Fuera de alcance de V1.1 beta
- Escribir en QuickBooks: facturas y pagos siguen como los hace Finance hoy (OPR-10).
- Reject · re-clean, las pestañas $ y People, editar To/Cc y el número temporal: se ven, no corren.
- Alarms, Anomalies, Actions, Observe, Geo, Incidents, Activity y Map: en gris.
- Modo Prediction de Rosie hasta que exista OPR-12; voz, lectura en voz alta y recorrido en el mapa.
- Evidencia de fotos por área.

## Decisiones clave
Enlaces a ADRs en `docs/adr/`.
- [0001 — Modelo de datos de opsRUN](docs/adr/0001-modelo-de-datos.md) (OPR-20)
