# OPR-29 — Scheduled: la etapa en la Fase A, Delayed y Reschedule / Cancel job en gris

- **Tarjeta:** OPR-29 (P3 · Scheduled: Reschedule, Cancel job, Delayed). Depende de OPR-4 (regla de Delayed, nombres), OPR-17 (textos de ida y vuelta) y OPR-33 (alertas en BzzzBX). Leída en Relevo el 2026-11-27, junto con la regla oficial de Henry sobre la Fase A y la Fase B (OPR-42). La tarjeta es información; este spec manda sobre la construcción solo cuando Henry lo apruebe.
- **Estado:** borrador para revisión. **No hay código ni migración escritos.** Lo marcado **[S-n]** es un supuesto; lo marcado **P-n** es una pregunta para Henry, con mi recomendación primero (§14).
- **Hecho cuando (tarjeta):** E2E-3 y E2E-9 pasan en staging. En local se prueba la parte de la Fase A sobre el stand-in (§11.3). E2E-3 completo pide las reglas reales de OPR-33; la parte de E2E-9 que reprograma o cancela desde opsRUN es de la Fase B [S-8].
- **Construye sobre (todo en `main`):** el modelo de datos (`docs/spec/opr-20-modelo-de-datos.md` §1.1, §3.4, §3.7, §3.8, §3.11, §4 y §5), el puerto de BzzzBX y su falso (`docs/spec/opr-22-stand-ins.md`), el tablero (OPR-25, con Delayed que ya parpadea), la Job window con su registro de acciones (`docs/spec/opr-26-job-window.md` §5, `src/lib/acciones/registro.ts`, donde Reschedule y Cancel job ya salen con `faseB: true`), el enlace de la Fase A (`docs/spec/fase-a-enlace.md`, que dejó "deshacer un enlace" para esta tarjeta, su P-4), Audit (`docs/spec/opr-35-audit.md`), las etapas hasta Paid (`docs/spec/opr-30-31-32-etapas.md`: `fuera_de_release` con `fase: "b"`, `lock_scheduled_request`, `record_observed_event` y el observador) y el ciclo de fondo único (ADR 0006, `src/lib/ciclo/`).
- **Depende además de OPR-34, aprobado y en construcción (PR #32, sin fusionar):** `docs/spec/opr-34-alerts.md` (registrador de alertas, `upsert_alert_occurrence`, pestaña Alerts con "Clears at check-in" para OPS-010, `OP035` a `OP039`, migración `20261205120000_alertas.sql`). Las entradas de Delayed en Audit las escribe ese registrador (§5.3, P-8).
- **Referencias sin acceso [S-1]:** User Guide cap. 5, Release Definition §4.4 y §5.1 (donde están E2E-3 y E2E-9) y el prototipo R23 no están en este repo, que es público, y no se pudieron leer. Lo que sigue sale de la tarjeta, de OPR-42, de `CONTEXT.md`, de los specs y del código en `main`.

## 1. Para qué

Un job enlazado entra en Scheduled y espera el check-in. La tarjeta de OPR-29 pide tres cosas en esa etapa: reprogramar, cancelar y avisar cuando el job no empezó a tiempo (Delayed). Con la regla de la Fase A ("observe and assist"), **Reschedule y Cancel job se hacen en las herramientas de PINCH** y opsRUN los observa. Así que en esta tarjeta se construye lo que la Fase A permite:

1. **La vista de la etapa Scheduled:** tarjeta con fecha y ventana bajo el número, Job window con lo que se lee del job de PINCH, y el paso solo a In Progress con el check-in. Casi todo ya existe; aquí se fija y se prueba (§4).
2. **Delayed:** el estado que parpadea en la tarjeta, un chip gris en la ventana, la alerta OPS-010 leída de BzzzBX y sus dos líneas en Audit. Sin texto automático (§5).
3. **Reschedule y Cancel job en gris** con "Available when actions are switched on". Nunca corren (§6).
4. **Lo que opsRUN observa de PINCH en esta etapa:** la fecha nueva de un job reprogramado se ve sola, y un job cancelado sale del tablero y deja "Job cancelled · Observed" en Audit (§7, P-3 y P-4).
5. **Change linked job:** la salida para un enlace equivocado o para un job que PINCH canceló y reemplazó. Es solo un dato de opsRUN, así que entra en la Fase A (§8, P-2).

La Fase B (§9) se describe solo hasta donde hace falta para saber que el modelo de datos ya está listo.

### 1.1 Qué hace la Fase A con cada pieza de la tarjeta

| Pieza de la tarjeta | Fase A (este spec) | Fase B (después) |
|---|---|---|
| Fecha y ventana bajo el número | Se leen del job de PINCH al pintar | Igual |
| Reschedule (fecha, ventana, motivo, texto al cleaner, Waiting, PINCH actualizado) | En gris, no corre. Se hace en PINCH y la fecha nueva se ve sola | Desde opsRUN, con `reschedule_job` y Waiting |
| Cancel job (confirmación, motivo, avisos, PINCH actualizado) | En gris, no corre. Se hace en PINCH; la tarjeta sale del tablero y Audit lo dice | Desde opsRUN, con `cancel_job` y avisos |
| Delayed (OPS-010) | Se lee de BzzzBX: parpadea, chip, alerta, Audit. Sin texto | Igual |
| Paso a In Progress con el check-in | Ya lo calcula la etapa; se prueba | Igual |

### 1.2 Fuera de alcance

- **Ejecutar Reschedule y Cancel job,** con sus textos al cleaner, sus avisos al requester, el Waiting de Reschedule y la escritura en PINCH: Fase B (§9).
- **Calcular Delayed.** La regla OPS-010 la calcula Signal Maker (OPR-33) con la regla de OPR-4. opsRUN la lee y nunca decide si abre o cierra (P-5).
- **La pestaña Alerts y su registrador:** son de OPR-34. Aquí solo se usa lo que OPR-34 ya define para OPS-010 ("Clears at check-in", sin botón).
- **Clear alert sobre Delayed:** OPS-010 no es limpiable (`clearable_rules()` es solo MEC-003, OPR-30 P-6). Delayed se limpia solo con el check-in.
- **Volver una request a Requests.** El trigger `request_draft_frozen` no deja que una request programada vuelva a `open` (`OP003`), y este spec no lo cambia: Change linked job cambia el job sin salir de Scheduled (§8).
- **El login** (OPR-21): el actor sigue siendo "Acting as" en local.

## 2. Principios que aplica

- **Un solo dueño.** La fecha, la ventana, el cleaner y el estado del job (programado o cancelado) son de PINCH: se leen del puerto al pintar y no se guardan. Si una alerta Delayed está abierta lo dice Signal Maker. opsRUN guarda solo sus decisiones (el cambio de job enlazado, con su motivo) y en Audit los hechos observados con solo el tipo, la hora y el crosswalk ID.
- **Las personas firman.** Change linked job es de un operador (`require_operator()`), con motivo obligatorio. Nada de esta tarjeta escribe solo, salvo el observador del ciclo de fondo, que solo anota hechos de PINCH.
- **Fase A no manda instrucciones.** Ninguna función nueva crea filas en `opsrun.instruction`. Delayed no manda texto (la tarjeta lo dice: "No automatic text"), y el guard "nada sale solo" de OPR-27 lo sigue vigilando.
- **Una lectura nunca escribe.** El tablero, la ventana y `/api/tablero/cambios` solo leen. Lo único que corre en segundo plano es el ciclo de fondo (ADR 0006): la cancelación observada la anota la tarea `observador_etapas` que ya existe, sin otro temporizador.
- **Todo queda en Audit,** en la misma transacción que el dato.
- **Guards que descubren y se ven fallar.** G18 descubre en el catálogo las funciones que escriben el job enlazado; la prueba de la Fase B descubre en el registro las acciones `faseB`. Las dos se ven fallar en cada corrida (§11).

## 3. Lectura: de dónde sale cada cosa

| Qué | Dueño | Fuente | Cuándo |
|---|---|---|---|
| Fecha, ventana, cleaner, job number, estado (`scheduled` o `cancelled`) | PINCH | `Job` del puerto (`obtener("job")`) | Al pintar el tablero y la ventana |
| Check-in (paso a In Progress) | PINCH (Job Tracker) | `JobTrackerEvent` `checked_in` | Al pintar; el observador lo anota en Audit (OPR-30) |
| Delayed abierta o cerrada, nivel y motivo | BzzzBX (Signal Maker) | `AlertResult` con `rule_id = "OPS-010"` | Al pintar, por sujeto job (OPR-25 P-6) |
| Historial de Delayed (abrió, se limpió) | opsRUN | `alert_occurrence` y `audit_event` que escribe el registrador de OPR-34 | Pestañas Alerts y Audit |
| Job enlazado | opsRUN (crosswalk) | `request.bzzzbx_job_id`, `request.job_number` | Siempre |
| Cambios del job enlazado y cancelaciones observadas | opsRUN | `audit_event` (`job_relinked`, `job_cancel_observed`) | Pestaña Audit |

Nada leído de PINCH se copia a una columna de opsRUN. El motivo de Delayed que se ve en Audit es la instantánea `reason_text` de la ocurrencia, el único texto de BzzzBX que OPR-20 permite guardar (`bzzzbx-snapshot`, G9).

## 4. La vista de la etapa Scheduled

### 4.1 Qué hay hoy y qué cambia

| Lugar | Qué muestra en Scheduled | Hoy | Cambia en OPR-29 |
|---|---|---|---|
| Tarjeta, bajo el número | Fecha y ventana del job ("Nov 28 · 10:00 AM–2:00 PM") | Sí (`fechaYVentana`, `armarTablero`) | No |
| Tarjeta, Delayed | "Delayed" en rojo, parpadeando, **en lugar** de la fecha [S-6]; sin animación con `prefers-reduced-motion` | Sí | No; se prueba (§11) |
| Tarjeta, color | Sombreado rojo con Delayed (OPS-010 es roja) | Sí | No |
| Tarjeta, job cancelado | No aparece en el tablero | Sí | No; Audit lo anota (§7.2) |
| Encabezado de la ventana | Stage "Scheduled", job number, fecha y ventana, servicio, cleaner, precio | Sí | **Chip gris "Delayed"** junto a Stage mientras OPS-010 está abierta (§5.2) |
| Pestañas | Propiedad, Audit, $ y People en gris, Alerts. Sin Job tracker (llega con In Progress) | Sí | No |
| Pestaña de la propiedad | Cliente, contacto, propiedad, espacio, servicio, fecha y ventana, cleaner, PO, notas, leídos del job | Sí | Una fila **Linked job**: job number y "Linked Nov 27 by Ops Uno" (de `request_scheduled` en Audit) |
| Action bar | Reschedule y Cancel job en gris (Fase B); Change linked job (P-2) | Las dos en gris | Change linked job (§8) |
| Conversación y Composer | Igual que en las demás etapas | Sí | No |
| Ventana de un job cancelado | Stage "Cancelled", Composer deshabilitado ("Job cancelled") | Sí | Change linked job disponible (§8.1) |

### 4.2 Paso a In Progress

No se construye nada: la etapa ya se calcula (OPR-20 §5, `armarTablero`) y pasa a In Progress con el primer `checked_in` del Job Tracker. El tablero y la ventana abiertos se refrescan con el sondeo de 15 s (OPR-25), porque `cambiosDesde` trae el evento y el observador anota "Checked in · Observed" en Audit (OPR-30 P-9). Este spec lo fija con pruebas (§11.2 y F3).

Delayed deja de verse en el mismo pintado del check-in, aunque Signal Maker todavía no haya cerrado la alerta: la tarjeta solo dice Delayed en Scheduled (ya es así en `armarTablero`) y el chip sale con la misma regla [S-10].

## 5. Delayed (OPS-010)

### 5.1 La regla es de Signal Maker

Delayed es una alerta más: **OPS-010**, roja, que calcula Signal Maker. opsRUN no la calcula, no tiene la hora límite en su configuración y no tiene un respaldo propio si OPR-33 no llega (P-5). Lo que se supone mientras OPR-4 no decide:

- **[S-2] La regla:** un job en Scheduled cuya `service_date` es hoy en la zona de la operación y que no tiene check-in a la **1:00 PM** de esa zona. Se cierra con el check-in. Default recomendado: 1:00 PM.
- **[S-3] La zona:** la de la operación, la misma con que opsRUN muestra las horas: **`OPSRUN_ZONA_HORARIA`**, con **`America/New_York`** como default recomendado. Signal Maker usa la misma zona; si no, el "1:00 PM" que se lee en Audit no coincide con la hora que muestra el tablero. Qué hace el servidor si falta la variable: P-6.

Si OPR-4 cambia la hora o la zona, opsRUN no cambia de código: la hora viene en el texto de la alerta (§5.3) y la zona en la variable.

### 5.2 Dónde se ve

| Lugar | Qué | De dónde |
|---|---|---|
| Tarjeta | "Delayed" que parpadea bajo el número, sombreado rojo; conteo rojo en la columna y en Alerts de la barra | Ya existe (`armarTablero`, `globals.css`) |
| Encabezado de la ventana | **Chip gris "Delayed"** junto a Stage, solo en Scheduled. `VentanaJob.encabezado.delayed: boolean`, con la misma condición que la tarjeta. Gris y sin parpadeo: la tarjeta llama la atención, la ventana informa | Nuevo |
| Pestaña Alerts | OPS-010 en Needs action, roja, sin botón, con "Clears at check-in" | OPR-34 §5.3 (ya especificado; aquí no se repite) |
| Pestaña inicial | Alerts, porque OPS-010 pide acción (regla 2 de OPR-26 §4.2) | Ya existe |
| Audit | "Delayed · Not started by 1:00 PM." y "Started · Delayed cleared" | §5.3 |

Con BzzzBX caído, la tarjeta y el chip muestran lo último leído, con la franja "BzzzBX unavailable · last update HH:MM" (OPR-25, OPR-26 §6.1).

### 5.3 Las dos líneas de Audit

La tarjeta pide "Delayed · not started by 1:00 PM" y "Started · Delayed cleared". No son tipos nuevos: son el `alert_opened` y el `alert_resolved` de OPS-010 (OPR-20 §3.11) que escribe el registrador de OPR-34. Lo único que cambia es cómo los muestra la pestaña Audit (`src/lib/audit/armar.ts`, `complementoDeAlerta`), solo para OPS-010 [S-5]:

| Evento | Hoy se vería | Con OPR-29 |
|---|---|---|
| `alert_opened` de OPS-010 | "Alert opened · OPS-010 Delayed · red · Not started by 1:00 PM." | **"Delayed · Not started by 1:00 PM."** (el `reason_text` de la ocurrencia, tal como llegó) |
| `alert_resolved` de OPS-010, `auto_cleared` | "Alert resolved · OPS-010 Delayed · red · Cleared automatically" | **"Started · Delayed cleared"** |
| `alert_resolved` de OPS-010 con otra resolución | — | Como hoy (no debería pasar: no hay acción que la arregle, OPR-34 §4.1) |

- La hora "1:00 PM" sale del texto de Signal Maker, no de opsRUN (P-7). Si Signal Maker no la pone en el texto, la línea dice "Delayed · <su texto>".
- Las dos llevan la marca **Observed**: el actor de `alert_opened` y del `alert_resolved` automático es `bzzzbx` (OPR-34 §8.2, P-11).
- Los textos son provisionales hasta OPR-4 y viven en una constante de `src/lib/alertas/reglas.ts` (el archivo que OPR-34 crea con `NOMBRES_DE_REGLAS`), no en el catálogo: el `label` de `alert_opened` sigue siendo el mismo para las demás reglas.

### 5.4 Sin texto automático

Abrir o cerrar Delayed no crea ninguna `instruction` ni ningún mensaje. Ya es así porque nadie lo programa; se prueba: el registrador escribe la ocurrencia de OPS-010 y la cuenta de `opsrun.instruction` no cambia (pgTAP), y el guard "nada sale solo" de OPR-27 sigue en verde (§11).

## 6. Reschedule y Cancel job en la Fase A

Ya están en el registro (`reschedule_job` y `cancel_job`, etapa Scheduled, `faseB: true`, motivo obligatorio, `necesitaBzzzbx: true`) y salen `fuera_de_release` con `fase: "b"`, que la action bar pinta en gris con **"Available when actions are switched on"** (OPR-30 P-10 y su nota de implementación). Este spec no los cambia; fija lo que tienen que cumplir:

| Regla | Cómo |
|---|---|
| Se ven en Scheduled, en gris, con el texto de la Fase B | `disponibilidadDe` (ya existe) |
| No aparecen en otras etapas ni con el job cancelado | `no_aplica` (ya existe) |
| No corren aunque se fuerce el botón | `ejecutarAccion` recalcula la disponibilidad y rechaza `fuera_de_release` antes de tocar la base (ya existe) |
| No tienen ejecutor | Prueba nueva que descubre las entradas `faseB` del registro (§11.2) |
| La descripción le dice al operador dónde se hace | `descripcion` pasa a "Reschedule the job in the PINCH tools; opsRUN shows the new date." y "Cancel the job in the PINCH tools; opsRUN takes it off the board." [S-4] |

Los nombres "Reschedule" y "Cancel job" son provisionales hasta OPR-4 (los `label` de `instruction_type`; cambiar uno no migra datos).

## 7. Lo que opsRUN observa en Scheduled

### 7.1 Un job reprogramado en PINCH

La fecha y la ventana se leen del job al pintar, así que una reprogramación hecha en PINCH se ve sola en la tarjeta, en el encabezado y en la pestaña de la propiedad en el siguiente sondeo (menos de 1 minuto). opsRUN no guarda la fecha vieja ni la nueva.

Audit **no** anota la reprogramación en la Fase A (P-4): para saber que la fecha cambió habría que comparar con la anterior, y guardarla es copiar un dato de PINCH. El puerto hoy solo dice que el job cambió (entidad, id y versión), no qué cambió. Si OPR-6 trae un evento de BzzzBX con id y tipo ("job rescheduled"), se agrega un tipo observado como el de §7.2.

### 7.2 Un job cancelado en PINCH

| Tema | Regla |
|---|---|
| Tablero | La tarjeta sale (ya es así, `armarTablero`) |
| Ventana | Stage "Cancelled", Composer deshabilitado (ya es así) |
| Audit | **"Job cancelled · Observed"**, tipo nuevo `job_cancel_observed` (P-3) |
| Quién lo anota | La tarea `observador_etapas` del ciclo de fondo (ADR 0006), que ya recorre los jobs enlazados cada 15 s. En cada job, además de los eventos y el pago, lee el `Job` (`obtener("job")`) y, si está `cancelled`, llama a `record_observed_event`. No hay tarea nueva ni temporizador nuevo |
| Deduplicación | `bzzzbx_event_id = "<bzzzbx_job_id>:cancelled"`: un job se cancela una vez [S-9]. La base deduplica con el `unique` de siempre |
| Hora | La del `leido_en` de la lectura en que el observador lo vio (el `Job` no trae hora de cancelación) [S-9]. Es provisional hasta que OPR-6 dé un evento con hora |
| Qué no hace | No toca `request` ni su `change_seq`; no manda nada; no cierra alertas (las cierra Signal Maker y las anota el registrador) |

`record_observed_event` no cambia: ya acepta cualquier tipo del catálogo con `source = 'bzzzbx_observed'`. El observador sigue leyendo solo las requests `scheduled` con job (`CONSULTA_JOBS_ENLAZADOS`), que incluye las de jobs cancelados: la request de opsRUN sigue `scheduled` aunque su job esté cancelado.

## 8. Change linked job (P-2)

### 8.1 Para qué y cuándo

En la Fase A el operador enlaza la request con un job que ya existe en PINCH. Hoy un enlace equivocado no tiene salida (spec de la Fase A, P-4: "queda para OPR-29"). Hay dos casos:

1. el operador enlazó el job equivocado;
2. PINCH canceló el job y creó otro para el mismo trabajo (una reprogramación hecha como "cancelar y crear").

**Change linked job** cambia el job enlazado de la request por otro, sin salir de Scheduled: el borrador sigue congelado y las confirmaciones siguen valiendo, porque son sobre el borrador y no sobre el job. Es un dato de opsRUN (el crosswalk), así que es de la Fase A.

| Tema | Regla |
|---|---|
| Etapa | Scheduled (sin check-in) y job cancelado (`cancelled`). En In Progress o después, no aplica: el job ya tiene hechos [S-11] |
| Panel | Los candidatos de `proponerEnlaces` (los mismos de la ranura del enlace, con Suggested, coincidencias y `truncado`), sin el job actual. **Reason obligatorio** |
| Bloqueos | Con BzzzBX caído, "BzzzBX unavailable" (`necesitaBzzzbx: true`). Sin candidatos, "No other job to link" |
| Lectura | El ejecutor relee en BzzzBX el job nuevo (existe, no está cancelado) y el actual (sin check-in), como `confirmarEnlace` |
| Escritura | `relink_observed_job` (§10.2) cambia `bzzzbx_job_id` y `job_number`; `scheduled_at` y `status` no cambian |
| Audit | `job_relinked` ("Linked job changed"), con el motivo y `details = {"from_bzzzbx_job_id", "from_job_number", "to_bzzzbx_job_id", "to_job_number"}`. La pestaña lo muestra "Linked job changed · from EX-00111 to EX-00110" |
| Después | El job viejo ya no se propone para esa request (`proponerEnlaces` lo descarta como a uno rechazado). Lo del job viejo que ya está en Audit se queda: Audit no se edita |

### 8.2 Encaje

- **Registro:** entrada nueva `relink_job` ("Change linked job"), etapas Scheduled y `cancelled`, motivo `"obligatorio"`, `necesitaBzzzbx: true`, `concurrencia: "request"`. Hoy `disponibilidadDe` devuelve `no_aplica` para cualquier acción con el job cancelado: gana un campo `DefinicionAccion.conJobCancelado?: true` que solo esta entrada usa.
- **Propuestas:** `proponerEnlaces` acepta una request `scheduled` cuando se le pide para un cambio (`{ paraCambio: true }`); descarta el job actual, los rechazados y los `from_bzzzbx_job_id` de sus `job_relinked`. Una request `open` sigue igual.
- **Ejecutor:** `src/lib/acciones/enlace.ts` gana `relink_job`, con la llamada en `src/lib/fase-a/datos-sql.ts`. Rechaza sin llamar a la base un job inexistente, cancelado o el mismo. SQLSTATE: `OP006`, `OP013`, `OP019` (de OPR-30), `OP008` y `23505` (`job_ya_enlazado`, como el enlace), `OP040` y `OP041` (§10.4), `22023`.
- **Alertas del job viejo:** una ocurrencia abierta de un job que dejó de ser de la request la cierra el registrador de OPR-34 en su pasada por id, cuando Signal Maker la cierre [S-12].

Si Henry dice que no a P-2, esta sección, `job_relinked`, la función, `OP040`, `OP041` y G18 salen del spec.

## 9. Fase B: solo lo que el modelo de datos necesita

La Fase B no se construye aquí. Se anota lo justo para saber que el modelo ya la soporta y que no hará falta cambiar tablas:

| Pieza de la Fase B | Ya existe en el modelo (OPR-20) |
|---|---|
| Instrucciones a BzzzBX | `instruction_type` `reschedule_job` y `cancel_job`, los dos con `requires_reason` |
| Audit de la acción | `job_rescheduled`ᴿ y `job_cancelled`ᴿ (`source = 'opsrun'`) |
| Preguntar al cleaner y Waiting | `cleaner_confirmation` con `purpose = 'reschedule'`, `new_service_date`, `new_window_start`, `new_window_end`, `reason` obligatorio (check) y `ask_instruction_id`; las abiertas ya forman Waiting (OPR-34) |
| Avisos | `message_template` con `reschedule_request`, `cancellation_cleaner` y `cancellation_requester` |
| Funciones | `opsrun.reschedule_job` y `opsrun.cancel_job`, previstas en OPR-20 §4; sus firmas las fija el spec de la Fase B |
| Códigos de error | `OP042` a `OP044`, reservados en este bloque (§10.4) |

Lo que la Fase B tendrá que decidir y este spec no decide: el orden de Reschedule (preguntar al cleaner y después escribir en PINCH, o al revés), qué pasa si el cleaner dice que no, y si Cancel job avisa al requester siempre. Las acciones de la Fase A (`relink_observed_job`, `job_cancel_observed`) no estorban: una cancelación hecha desde opsRUN dejará `job_cancelled` con su motivo y, al verla el observador, también `job_cancel_observed`, que la pestaña Audit puede agrupar.

## 10. Migración nueva (pide OK, P-0)

`supabase/migrations/20261206120000_scheduled.sql`, solo hacia adelante, como `opsrun_migrador`, **después** de la de alertas de OPR-34 (`20261205120000_alertas.sql`, aprobada sin escribir). No se escribe hasta que Henry apruebe este spec.

### 10.1 Catálogo

```sql
insert into opsrun.audit_event_type (code, label, requires_reason, source, sort_order) values
  ('job_relinked',        'Linked job changed', true,  'opsrun',          87),   -- si P-2
  ('job_cancel_observed', 'Job cancelled',      false, 'bzzzbx_observed', 215);  -- si P-3
```

- El `sort_order` deja `job_relinked` junto a `request_scheduled` (80) y `job_link_rejected` (85), y `job_cancel_observed` entre los observados (`job_completed` 210, `job_paid` 220).
- Ninguna tabla, columna, tipo ni vista cambia. El write-back ya expone `request.bzzzbx_job_id`, `job_number` y `audit_event`. G4 y G9 no cambian. G12 cubre solo el motivo obligatorio de `job_relinked`.

### 10.2 Función del operador (si P-2)

```sql
opsrun.relink_observed_job(
  p_request_id uuid,
  p_version bigint,
  p_bzzzbx_job_id text,       -- el job nuevo, leído por el servidor en BzzzBX
  p_job_number text,          -- su job number, leído por el servidor
  p_reason text
) returns void
```

`security definer`, dueño `opsrun_migrador`, `set search_path = ''`, `require_operator()` en su cuerpo (G6), `revoke all … from public`, `grant execute … to opsrun_app` y a nadie más. En una transacción:

| Paso | Error |
|---|---|
| `lock_scheduled_request(p_request_id, p_version)` (de OPR-30) | `OP006`, `OP019`, `OP013` |
| Motivo no vacío, job y número no vacíos | `22023` |
| La request no tiene hechos del job de opsRUN (columnas `:job`: `ended_manually_*`, `oss_*`, `approved_*`, `entered_po_*`, `validated_*`) | `OP040` |
| El job nuevo no es el actual | `OP041` |
| El job nuevo no está enlazado a otra request | `OP008` (y `23505` en una carrera, como el enlace) |
| Actualiza `bzzzbx_job_id` y `job_number`; escribe `job_relinked` | — |

La comprobación de que el job actual no tiene check-in la hace el servidor con la lectura fresca (como OPR-30 S-12); la base comprueba lo de opsRUN.

### 10.3 Función del sistema

No hay función nueva. `record_observed_event` (OPR-30 §8.3) ya escribe `job_cancel_observed` en cuanto el tipo está en el catálogo con `source = 'bzzzbx_observed'`.

### 10.4 Códigos de error

El siguiente bloque libre: `OP035` a `OP039` los reservó OPR-34; `OP040` a `OP044` quedan para OPR-29. Comprobado en `supabase/migrations/` y en las ramas del repo: ningún código `OP04x` está en uso. Se documentan en la cabecera de la migración:

| Código | Cuándo | Lo lanza |
|---|---|---|
| `OP006`, `OP013`, `OP019` | Reutilizados de `lock_scheduled_request` | `relink_observed_job` |
| `OP008` | El job nuevo ya es de otra request (reutilizado del enlace) | `relink_observed_job` |
| `OP040` | La request ya tiene hechos del job en opsRUN | `relink_observed_job` |
| `OP041` | El job nuevo es el mismo que el actual | `relink_observed_job` |
| `OP042` a `OP044` | Reservados para Reschedule y Cancel job de la Fase B | — |
| `22023` | Argumento vacío | `relink_observed_job` |
| `42501` | Sin operador o con operador y sistema a la vez | `relink_observed_job` |

## 11. Pruebas y criterios de aceptación

### 11.1 pgTAP (`supabase test db`)

Archivo nuevo `scheduled.test.sql`, con fixtures propios dentro de la transacción:

- sin actor, con actor de sistema y con los dos a la vez, `relink_observed_job` falla con `42501` y no escribe. **Se ve en rojo una vez** quitando `require_operator()` en local, además de G6, que la descubre sola y se ve fallar en cada corrida;
- G5, G6, G7 y G12 cubren la función y el tipo nuevos sin tocarlos;
- `relink_observed_job`: request `open` → `OP019`; versión vieja → `OP013` y sin escritura; sin motivo → `22023`; con `approved_at` → `OP040`; mismo job → `OP041`; job de otra request → `OP008`; en el caso bueno cambian `bzzzbx_job_id` y `job_number`, no cambian `status`, `scheduled_at` ni el borrador, las confirmaciones siguen vigentes y queda un `job_relinked` con el motivo y los cuatro valores de `details`; un fallo forzado después del update no deja ni el cambio ni su Audit;
- `record_observed_event` con `job_cancel_observed`: escribe con `source = 'bzzzbx_observed'` y `actor_kind = 'bzzzbx'`; la segunda vez con el mismo id no escribe; no toca `request`;
- **sin texto automático:** con la función de OPR-34 (`upsert_alert_occurrence`), abrir y cerrar una OPS-010 no cambia la cuenta de `opsrun.instruction` (corre cuando esa función exista);
- ninguna función de esta migración inserta en `opsrun.instruction` (por `prosrc`, como el guard G17 de alertas de OPR-34, PR #32, busca `alert_occurrence`);
- `v1_audit_event` muestra los dos tipos nuevos y `bzzz_writeback_opsrun` los lee.

**Guard nuevo G18** (`guard_job_enlazado.test.sql`): toda función de los esquemas de opsRUN cuyo `prosrc` escribe `bzzzbx_job_id` o `job_number` de `opsrun.request` (descubiertas en `pg_proc`, sin lista) llama a `require_operator()` y escribe un `audit_event` de `request_scheduled` o `job_relinked`. Hoy son `link_observed_job` y `relink_observed_job`. **Se ve fallar en cada corrida:** dentro de la transacción crea una función de prueba, ejecutable por `opsrun_app`, que hace `update opsrun.request set job_number = …` sin Audit, comprueba que G18 la detecta y hace rollback. (G16 es el guard del ciclo de fondo de la ADR 0006 y G17 el de alertas que construye OPR-34 en PR #32; este es el siguiente libre, P-11.)

### 11.2 Vitest (TDD, cada una en rojo primero)

- `armarTablero`: Scheduled muestra fecha y ventana del job; con OPS-010 abierta, "Delayed" (`tipo: "delayed"`) y color sombreado; con OPS-010 cerrada en BzzzBX, la fecha; con check-in y OPS-010 todavía abierta, In Progress sin Delayed (S-10); un job cancelado no tiene tarjeta; una fecha cambiada en el job cambia el texto.
- `armarVentana`: `encabezado.delayed` solo en Scheduled con OPS-010 abierta; la fila Linked job; la línea del encabezado con la fecha nueva.
- Audit (`armarAudit`): `alert_opened` de OPS-010 → "Delayed · <reason_text>"; `alert_resolved` `auto_cleared` de OPS-010 → "Started · Delayed cleared"; las demás reglas como hoy; `job_relinked` con "from … to …" y el motivo; `job_cancel_observed` con la marca Observed.
- `disponibilidadDe`: Reschedule y Cancel job `fuera_de_release` con `fase: "b"` en Scheduled y `no_aplica` en el resto y con el job cancelado; Change linked job disponible en Scheduled y con el job cancelado, `bloqueada` con BzzzBX caído y sin candidatos, `no_aplica` en Requests e In Progress.
- **Prueba de la Fase B** (`src/lib/acciones/fase-b.test.ts`): descubre en `REGISTRO_DE_ACCIONES` las entradas con `faseB` y falla si alguna tiene `ejecutor`, si alguna sale `disponible` en alguna etapa, o si `ejecutarAccion` no la rechaza antes de llamar a la base. Se ve fallar en cada corrida con una entrada de prueba `faseB` con ejecutor.
- `ejecutarAccion` con `reschedule_job` y `cancel_job` forzados: rechazados, sin llamar a la base ni al puerto de instrucciones.
- Observador: un job `cancelled` → una llamada a `record_observed_event` con `job_cancel_observed` y el id `<job>:cancelled`; la siguiente vuelta no repite; un job `scheduled` no la llama; BzzzBX caído no escribe. `solo-en-segundo-plano.test.ts` y G16 siguen en verde sin cambios (no hay tarea nueva).
- Ejecutor de `relink_job`: relee los dos jobs; rechaza sin llamar a la base un job inexistente, cancelado, el mismo o un job actual con check-in; cada SQLSTATE sale como su `rechazada`; `42501` sube. Se ve fallar una vez quitando la relectura.
- `proponerEnlaces` con `paraCambio`: descarta el job actual y los `from_bzzzbx_job_id` de `job_relinked`; una request `open` no cambia.
- Zona (si P-6): con `OPSRUN_SERVIDOR=1`, el servidor no arranca sin `OPSRUN_ZONA_HORARIA` o con una zona inválida; fuera del servidor sigue cayendo a UTC con aviso.
- Integración contra la seed (`OPSRUN_REQUIERE_BASE=1`, en una transacción que se deshace): Change linked job de R11 de punta a punta.

### 11.3 Playwright (criterios de aceptación)

Contra el build de producción, la seed y el falso, con `OPSRUN_ACTOR_DEMO=1` y `OPSRUN_ZONA_HORARIA=America/New_York`. `scheduled.spec.ts` va en un proyecto aparte que corre al final, porque F3 lleva R10 a In Progress y F6 a F8 cambian R11, una vez por base.

| # | Criterio | Cómo se prueba |
|---|---|---|
| F1 | **Vista de Scheduled.** | R10: la tarjeta en Scheduled con fecha y ventana bajo el número; la ventana con Stage "Scheduled", job number, fecha, cleaner, la fila Linked job y las pestañas propiedad, Audit, $ y People en gris y Alerts, sin Job tracker. |
| F2 | **Delayed se ve.** (E2E-3, primera mitad) | `/api/falso poner` una OPS-010 roja, `bx-alert-0011`, en `bx-job-0110` ("Not started by 1:00 PM."): en menos de 1 minuto la tarjeta dice "Delayed" (`data-tipo="delayed"`, con animación) en vez de la fecha, sombreada, y la columna y la barra cuentan una roja; la ventana abre en Alerts y el encabezado tiene el chip gris "Delayed". Con `reducedMotion: "reduce"` no hay animación. La conversación no tiene mensajes nuevos y `opsrun.instruction` no cambia (consulta a la base). |
| F3 | **Se limpia con el check-in.** (E2E-3, segunda mitad) | `poner` el `checked_in` de R10 y cerrar la alerta con `cambiar` (`cleared_at`): la tarjeta pasa a In Progress en menos de 1 minuto, sin Delayed, y el chip sale. Audit, en orden: "Delayed · Not started by 1:00 PM.", "Checked in · Observed" y "Started · Delayed cleared". Las líneas de Delayed piden el registrador de OPR-34: hasta entonces, esa parte es `fixme` (P-8). |
| F4 | **Reschedule y Cancel job no corren.** | R11: los dos en gris con "Available when actions are switched on". Se quita el `disabled` y se pulsa Go: el panel lo rechaza y la cuenta de `audit_event` e `instruction` de R11 no cambia. |
| F5 | **BzzzBX caído.** | Con R10 en Delayed (antes de F3), `/api/falso no_disponible`: tarjeta y chip con lo último leído y la franja; Change linked job en gris con "BzzzBX unavailable" en R11. |
| F6 | **Change linked job.** | R11 está enlazada a `bx-job-0111`. Change linked job: el panel ofrece `bx-job-0112` y no el actual; Go deshabilitado sin motivo; con motivo, el encabezado muestra EX-00112 y Audit "Linked job changed · from EX-00111 to EX-00112" con el motivo y Ops Uno. La request sigue en Scheduled. |
| F7 | **Reprogramado en PINCH.** (parte observada de E2E-9) | `/api/falso cambiar` la fecha y la ventana de `bx-job-0112`: la tarjeta, el encabezado y la fila Date and window de R11 muestran las nuevas en menos de 1 minuto; Audit de R11 no gana filas (P-4). |
| F8 | **Cancelado en PINCH.** (parte observada de E2E-9) | `/api/falso cambiar` el `status` de `bx-job-0112` a `cancelled`: la tarjeta de R11 sale del tablero en menos de 1 minuto; la ventana dice "Cancelled" con el Composer deshabilitado; tras una vuelta del observador, Audit "Job cancelled · Observed"; Change linked job sigue disponible. |

E2E-3 completo, con la regla real de OPR-33 y la hora real de OPR-4, y E2E-9 completo, con Reschedule y Cancel job desde opsRUN, sus textos y sus avisos (Fase B, OPR-17 y OPR-18), siguen en **staging** (OPR-40).

## 12. Stand-in y seed

Todo inventado (repo público). No cambian los crosswalk IDs que la seed y el falso ya comparten; `seed-y-falso.test.ts` sigue pasando. Los ids siguen a los que ya usa la implementación de OPR-34 (PR #32, sin fusionar): R9, `bx-job-0109`, `bx-alert-0005` a `0009` en el falso y la seed, y `bx-alert-0010` en una fixture de Vitest. Comprobado contra la rama de PR #32: R10, R11, `bx-job-0110` a `0112` y `bx-alert-0011` están libres (P-9):

**Seed (`supabase/seed.sql`), al final del archivo para no mover ids:**

- **R10:** Scheduled, con dueño y las tres confirmaciones, enlazada a `bx-job-0110` con su `request_scheduled` (`mode: "linked"`). Es la de Delayed.
- **R11:** Scheduled igual, enlazada a `bx-job-0111`. Es la de Change linked job, reprogramado y cancelado.
- Ninguna `alert_occurrence` nueva: la OPS-010 de F2 (`bx-alert-0011`) se pone durante la prueba, para que el registrador no la cree al arrancar.

**Falso (`src/lib/bzzzbx/falso/datos.ts`):**

- `bx-job-0110` / `EX-00110`: hoy (`dia(0)`), 09:00–12:00, sin eventos, con su asignación, su pago sin pagar y su salud.
- `bx-job-0111` / `EX-00111` y `bx-job-0112` / `EX-00112`: la misma propiedad y cliente de R11, en días distintos, para que `proponerEnlaces` ofrezca el segundo.
- Ninguna alerta nueva en los datos iniciales: `bx-alert-0011` solo existe cuando F2 la pone. `/api/falso` no cambia: `poner` y `cambiar` ya cubren alertas, eventos y jobs.

## 13. Dependencias y supuestos

### 13.1 Dependencias

| De qué | Qué toca aquí | Mientras tanto |
|---|---|---|
| **OPR-4** (Fernando) | La regla de Delayed (1:00 PM, mismo día), la zona horaria, los nombres "Reschedule", "Cancel job", "Delayed", "Change linked job", y si "Clear alert" aplica a Delayed | S-2 a S-5: 1:00 PM, `America/New_York` en `OPSRUN_ZONA_HORARIA`, los nombres del registro y de los catálogos (cambiar un `label` no migra datos), Delayed sin Clear alert |
| **OPR-33** | La regla OPS-010 real, su `rule_id` y su texto | El stand-in con `/api/falso poner` |
| **OPR-34** (PR #32, sin fusionar) | El registrador (las dos líneas de Audit de Delayed) y la pestaña Alerts ("Clears at check-in") | F3 en parte `fixme` hasta que esté (P-8) |
| **OPR-6** | Si BzzzBX da eventos de job con id, tipo y hora (reprogramado, cancelado) | S-9: id sintético y la hora en que se vio |
| **OPR-17, OPR-18** | Textos al cleaner y avisos de Reschedule y Cancel | Fase B |
| **OPR-42** | Cuándo se encienden las acciones (Fase B) | Reschedule y Cancel job en gris |

### 13.2 Supuestos

| # | Supuesto |
|---|---|
| S-1 | El User Guide cap. 5, el Release Definition §4.4 y §5.1 y el prototipo R23 no se pudieron leer; textos y distribución se revisan contra ellos. |
| S-2 | Delayed (OPS-010) abre para un job Scheduled de hoy, en la zona de la operación, sin check-in a la 1:00 PM, y se cierra con el check-in. La calcula Signal Maker. Default: 1:00 PM (OPR-4). |
| S-3 | La zona de la operación es `OPSRUN_ZONA_HORARIA`, con `America/New_York` como default recomendado, y Signal Maker usa la misma (OPR-4). |
| S-4 | Los nombres son "Reschedule", "Cancel job", "Delayed" y "Change linked job"; Delayed no tiene Clear alert y se ve "Clears at check-in" (OPR-4). |
| S-5 | Las líneas "Delayed · <texto de Signal Maker>" y "Started · Delayed cleared" son el `alert_opened` y el `alert_resolved` automático de OPS-010, con otro texto solo en la pestaña Audit. |
| S-6 | Mientras Delayed está abierta, la tarjeta muestra "Delayed" en lugar de la fecha y la ventana (como hoy). |
| S-7 | El chip "Delayed" de la ventana es gris y no parpadea. |
| S-8 | E2E-9 es el caso de Reschedule y Cancel job con sus avisos (OPR-18 lo usa para las plantillas); en la Fase A solo se prueba lo observado. |
| S-9 | Un job se cancela una sola vez: la cancelación observada se deduplica con `<bzzzbx_job_id>:cancelled` y lleva la hora en que el observador la vio, hasta que OPR-6 dé un evento con id y hora. |
| S-10 | Con el check-in, Delayed deja de verse aunque Signal Maker aún no cierre la alerta. |
| S-11 | Change linked job solo aplica sin check-in (Scheduled) o con el job cancelado. |
| S-12 | Una ocurrencia abierta del job viejo la cierra el registrador de OPR-34 en su pasada por id cuando Signal Maker la cierre. |

## 14. Preguntas para Henry (con mi recomendación primero)

- **P-0. Migración.** §10: dos tipos de Audit, una función del operador, `OP040` y `OP041` (más `OP042` a `OP044` reservados) y G18; sin tablas, columnas ni vistas nuevas. **Recomiendo sí.** Si dices que no a P-2 y P-3, no hace falta migración.
- **P-1. Qué se construye ahora.** **Recomiendo** lo de §1.1: la vista de Scheduled, Delayed leído de BzzzBX con chip y Audit, Reschedule y Cancel job en gris con "Available when actions are switched on", lo observado de PINCH y Change linked job. Alternativa: solo Delayed y los botones en gris, y lo observado y Change linked job en otra tarjeta.
- **P-2. Change linked job.** El spec de la Fase A dejó para OPR-29 cómo deshacer un enlace. **Recomiendo cambiar el job sin salir de Scheduled**, con motivo obligatorio, también con el job cancelado: cubre el enlace equivocado y el "cancelar y crear" de PINCH, y no toca la regla de que una request programada no vuelve a Requests (`OP003`). Alternativa: volver la request a Requests, que cambia `request_draft_frozen` y reabre el borrador; o dejarlo para otra tarjeta, con el riesgo de no tener salida en el primer lanzamiento.
- **P-3. Cancelación observada en Audit.** **Recomiendo** el tipo `job_cancel_observed`, anotado por el observador del ciclo con un id sintético y la hora en que se vio, provisional hasta OPR-6. Alternativa: no anotar nada hasta que OPR-6 dé un evento de cancelación, y que la tarjeta solo desaparezca.
- **P-4. Reprogramación observada en Audit.** **Recomiendo no anotarla en la Fase A**: la fecha nueva se ve sola y saber que cambió obliga a guardar la anterior, que es un dato de PINCH. Alternativa: guardar en Audit la versión del job y anotar "Job changed · Observed" sin decir qué cambió.
- **P-5. Quién calcula Delayed.** **Recomiendo solo Signal Maker** (OPS-010): un dato, un dueño, y opsRUN sin la hora límite en su configuración. Alternativa: que opsRUN calcule un Delayed provisional con la hora de OPR-4 mientras OPR-33 no llega, que duplica la regla y puede contradecir a Signal Maker.
- **P-6. Zona horaria en el servidor.** Hoy, sin `OPSRUN_ZONA_HORARIA`, todo cae a UTC en silencio, y un "1:00 PM" en UTC engaña. **Recomiendo** que con `OPSRUN_SERVIDOR=1` el servidor no arranque sin una zona válida, que `pnpm local` fije `America/New_York` y que el default se confirme con OPR-4. Alternativa: dejar el aviso de hoy.
- **P-7. De dónde sale el "1:00 PM" de Audit.** **Recomiendo** el texto de la alerta tal como llegó (la instantánea `reason_text`), con "Delayed · " delante. Alternativa: una constante de opsRUN con la hora, que vuelve a duplicar la regla.
- **P-8. Orden de construcción.** Las dos líneas de Delayed en Audit y la alerta en la pestaña Alerts las da el registrador de OPR-34. **Recomiendo construir OPR-29 después de OPR-34.** Alternativa: construirla antes, con esa parte de F3 en `fixme`.
- **P-9. Seed y falso.** **Recomiendo** R10 y R11 con `bx-job-0110`, `0111` y `0112` (§12), después de los ids que usa PR #32, y poner la OPS-010 (`bx-alert-0011`) durante la prueba. Alternativa: usar R3 (`bx-job-0003`), que choca con L6 de OPR-34, que la lleva a In Progress.
- **P-10. Fase B.** **Recomiendo** no cambiar el modelo ahora: `cleaner_confirmation` `reschedule`, las instrucciones, los tipos de Audit y las plantillas ya cubren la tarjeta (§9); se reservan `OP042` a `OP044`. Alternativa: escribir ya las firmas de `reschedule_job` y `cancel_job` sin cuerpo, que fija decisiones de la Fase B antes de tiempo.
- **P-11. Número del guard.** G16 es el guard del ciclo de fondo (ADR 0006) y G17 el de alertas de OPR-34 (PR #32, sin fusionar). **Recomiendo G18** para el de este spec (`guard_job_enlazado.test.sql`). Alternativa: si PR #32 cambia de número antes de fusionarse, tomar el siguiente libre al construir OPR-29.
