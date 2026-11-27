# OPR-34 — Pestaña Alerts de la Job window y Alerts de la barra superior

- **Tarjeta:** OPR-34 (P4 · Alerts tab and top-bar Alerts). Depende de OPR-33 (las 9 reglas en BzzzBX, pendiente externo) y de OPR-26 (Job window, en `main`). Leída en Relevo el 2026-11-27 junto con OPR-33 (contrato de lectura de alertas y su respuesta oficial del 24 de noviembre) y OPR-3 (límites). Las tarjetas son información; este spec manda sobre la construcción solo cuando Henry lo apruebe.
- **Estado:** spec para revisión de Henry. **No hay código ni migración escritos.** Lo marcado **[S-n]** es un supuesto; lo marcado **P-n** es una pregunta para Henry, con mi recomendación (§13).
- **Hecho cuando (tarjeta):** las alertas de E2E-2 a E2E-7 aparecen, se arreglan y pasan a Resolved. En local se prueba sobre el stand-in (§11.3); E2E-2 a E2E-7 completos se aceptan en staging (OPR-40), con las reglas reales de OPR-33.
- **Construye sobre (todo en `main`):** el modelo de datos (`docs/spec/opr-20-modelo-de-datos.md` §3.4, §3.8, §3.11 y §4; tabla `opsrun.alert_occurrence` en `20261124130000_modelo_de_datos.sql`), el puerto de BzzzBX y su falso (`docs/spec/opr-22-stand-ins.md` §3.1 y §3.1.1, `AlertResult` y `SujetoAlerta` en `src/lib/bzzzbx/tipos.ts`), el tablero con el conteo de Alerts en la barra (`docs/spec/opr-25-tablero.md` §1.1 y P-6), la Job window con la ranura de Alerts y la regla de la pestaña inicial (`docs/spec/opr-26-job-window.md` §4.2, §4.3 y §7.4), la conversación (OPR-27, hasta `OP012`) y Audit (`docs/spec/opr-35-audit.md`, con los nombres de las reglas en `src/lib/audit/reglas.ts`).
- **Depende además de specs en revisión, sin redefinirlos:**
  - `docs/spec/opr-30-31-32-etapas.md` (PR #24): **`clear_alert`** de MEC-003 Running long (§4.3, §8.2, P-5 a P-7), `alertasLimpiadas`, `clearable_rules()`, los códigos `OP019` a `OP027` y el guard G14. Este spec usa `clear_alert` **tal cual**.
  - `docs/spec/opr-28-assign-confirm.md` (aprobado, sin construir): Assign / Reassign, R8 y `bx-job-0108`, `OP013` a `OP018` y G13.
  - `docs/spec/opr-15-entrada-correo.md` (PR #23): `OP030` a `OP034` y G15.
- **Referencias sin acceso [S-1]:** el prototipo R23, el User Guide cap. 10 y Apéndice C, y el Release Definition §4.11 y §5 (donde están E2E-2 a E2E-7) no están en este repo, que es público, y no se pudieron leer. Lo que sigue sale de las tarjetas, de `CONTEXT.md`, de los specs y del código en `main`.

## 1. Para qué

Hoy el operador ve que hay alertas, pero no puede trabajarlas: la barra superior muestra un conteo sin panel (OPR-25), la pestaña Alerts de la Job window es una lista mínima de solo lectura (OPR-26 §4.3) y nadie escribe el historial en `opsrun.alert_occurrence`, que solo tiene lo de la seed. Este trabajo entrega:

1. **La pestaña Alerts** con sus tres secciones: **Needs action** (motivo, regla, tiempo abierta y botón para arreglarla), **Waiting** (Reschedule y confirmación del cleaner) y **Resolved** (abierta, resuelta, tiempo abierta, quién y cómo, "Cleared automatically", repeticiones en el job), y su insignia gris, ámbar o roja con el conteo, que late unas veces con una alerta roja nueva.
2. **El panel de Alerts de la barra superior**, con la lista de toda la operación, filtros y el camino a la Job window.
3. **El registro del historial**: cada apertura, cambio de nivel y resolución de una alerta queda en `alert_occurrence` y en Audit, como pide el principio 5 ("también las alertas abiertas y resueltas").

### 1.1 Fuera de alcance

- **Calcular alertas o sus límites.** Las 9 reglas las calcula Signal Maker en BzzzBX (OPR-33), con los límites de OPR-3. opsRUN nunca decide si una alerta abre o cierra: lo lee.
- **Redefinir `clear_alert`.** Es de PR #24; este spec solo pone su botón en la pestaña (§5.3).
- **Las acciones que arreglan cada alerta** (Assign, Schedule, Mark as OSS, Enter PO, Edit and resend): son de OPR-27, OPR-28, OPR-31 y OPR-32. El botón de la alerta abre esa acción, no la duplica.
- **Avisarle a BzzzBX** que una alerta se limpió (`acknowledge_alert`, spec OPR-22 P-3): Fase B.
- **La alerta Message not delivered como regla:** su cálculo es de OPR-33 y su estado de entrega de OPR-19. Aquí solo se muestra y se registra.
- **Alarms, Anomalies y Actions** de la barra: siguen en gris.
- **El login** (OPR-21): "Only me" sigue deshabilitado y el actor es "Acting as" en local.

## 2. Principios que aplica

- **Un solo dueño.** Si una alerta está abierta o cerrada lo dice BzzzBX (Signal Maker), y se lee en vivo por el puerto. Lo que hizo opsRUN con ella (quién la arregló, con qué acción, con qué motivo) y su historial son de opsRUN, en `alert_occurrence`. Las preguntas al cleaner que forman Waiting son de opsRUN (`cleaner_confirmation`). Nada más se copia (§3.3).
- **Las personas firman.** Ningún botón de la pestaña ni del panel escribe por su cuenta: todos abren una acción de la action bar, que corre por `ejecutarAccion` con su disponibilidad, su motivo y su actor (OPR-26 §5.4).
- **Todo queda en Audit.** El registro de cada apertura, cambio de nivel y resolución escribe su `audit_event` en la misma transacción que la ocurrencia.
- **Guards que descubren y se ven fallar.** El guard nuevo G16 descubre las funciones que escriben `alert_occurrence` y las columnas de la tabla por el catálogo, y se ve fallar en cada corrida (§10.2).

## 3. Lectura: de dónde sale cada cosa

### 3.1 Las tres fuentes

| Qué | Dueño | Fuente | Cómo se lee |
|---|---|---|---|
| Si una alerta está abierta, su nivel actual y su `reason_text` actual | BzzzBX (Signal Maker) | `AlertResult` del puerto | En vivo, al pintar, por sujeto (OPR-25 P-6) y por id (§3.2) |
| El historial: cuándo la vio opsRUN, cuándo se resolvió, cómo, quién, con qué motivo, cuántas veces se repitió | opsRUN | `opsrun.alert_occurrence` (+ `audit_event`, `operator`) | `opsrun_app`, solo lectura |
| Waiting: preguntas al cleaner abiertas (inicial o Reschedule) | opsRUN | `opsrun.cleaner_confirmation` con `status in ('asked', 'replied')` | `opsrun_app`, solo lectura (usa el índice de OPR-20 §3.4) |
| Nombres que se muestran (cleaner, propiedad) | PINCH | Puerto (`cleaner_team`, `property`) | Al pintar; nunca se guardan |

### 3.2 Qué alertas son de una request

Una función pura y única, `alertasDeLaRequest`, en `src/lib/alertas/` (nueva), que usan **el tablero, la barra, el panel y la ventana**. Hoy hay dos criterios: el tablero cuenta solo sujetos request y job (`src/lib/tablero/armar.ts`) y la ventana suma los mensajes de su hilo (`src/lib/ventana/armar.ts`, OPR-26 S-8). Se unifican en el de la ventana [S-2]:

- sujeto `request` con el `id` de la request;
- sujeto `job` con su `bzzzbx_job_id`;
- sujeto `message` con un mensaje de la request: por `request_message.bzzzbx_message_id` o por un hilo de la request (`request_message.bzzzbx_thread_id`).

Una alerta cuyo sujeto no lleva a ninguna request no se muestra en ninguna parte y queda en el log del registrador (§4) [S-3].

**Cómo se leen las de sujeto `message` sin cambiar el puerto (P-3).** El tablero ya lee por sujeto request y job. Para los mensajes, además, relee **por id** (`obtenerVarios("alert_result", ids)`) las alertas que opsRUN tiene abiertas en `alert_occurrence` con `bzzzbx_message_id`. Su estado sigue siendo el vivo de BzzzBX; `alert_occurrence` solo dice cuáles mirar. Una alerta de mensaje nueva aparece cuando el registrador la ve (≤ 15 s, §4), dentro del minuto de OPR-22.

### 3.3 Needs action, Waiting y Resolved

| Sección | Qué entra | Fuente |
|---|---|---|
| **Needs action** | `AlertResult` con `cleared_at` nulo, de la request (§3.2), **menos** las que opsRUN ya tiene resueltas en `alert_occurrence` (por ejemplo, con `clear_alert` aunque Signal Maker la siga dando abierta: PR #24 P-7) | Puerto + opsRUN |
| **Waiting** | `cleaner_confirmation` de la request con `status` `asked` o `replied` | opsRUN |
| **Resolved** | `alert_occurrence` de la request con `resolved_at` | opsRUN |

- **"Pide acción"** (OPR-26 §4.2 regla 2 y S-8) pasa a ser exactamente Needs action. Waiting **no** abre la ventana en Alerts (P-5).
- Resolved sale solo de opsRUN porque BzzzBX no tiene que guardar historial (OPR-20 §3.8). Una alerta que Signal Maker cerró hace segundos sale de Needs action en el siguiente pintado y entra a Resolved cuando el registrador la anota: en ese intervalo no está en ninguna de las dos [S-4].
- Los `bzzzbx_alert_id` resueltos en opsRUN llegan en `FilaVentana.alertasLimpiadas` (PR #24 §7.2). Si PR #24 no se construye antes, OPR-34 lo agrega con la misma forma, pero con **toda** ocurrencia resuelta, no solo las de `cleared_by_operator`.

### 3.4 Qué guarda opsRUN

| Guarda opsRUN (dueño) | Lee de BzzzBX al pintar, nunca guarda |
|---|---|
| Por ocurrencia, lo que ya define OPR-20 §3.8: `bzzzbx_alert_id` y `bzzzbx_message_id` (crosswalk), `rule_id` y `rule_version` (crosswalk), `level` (el actual mientras está abierta), `reason_text` **como llegó al abrirse** (`bzzzbx-snapshot`, el único permitido por G9), `opened_at` (hora de BzzzBX), `first_seen_at` | Si está abierta (`cleared_at`), el `reason_text` vigente, el sujeto |
| La resolución: `resolved_at`, `resolution`, `resolved_by`, `resolution_reason`, `resolving_instruction_id` | Nombres del cleaner y de la propiedad |
| Cada `alert_opened`, `alert_level_changed`, `alert_resolved` y `alert_cleared` en `audit_event` | Health status (colores de la tarjeta) |

No hay columnas nuevas: `alert_occurrence` ya tiene todo (P-0). En la pestaña, el motivo que se ve en Needs action es el **vivo** de BzzzBX (puede traer la evidencia actualizada, "Running long 5h 18m vs 3h 0m expected", OPR-33); en Resolved, el de la ocurrencia.

## 4. Registrador de alertas (sistema)

Hoy nadie llama a `upsert_alert_occurrence` (OPR-20 §4): no existe. Sin él no hay Resolved, ni repeticiones, ni "Alert opened" en Audit. OPR-34 lo construye, **provisional hasta la read layer de OPR-22**, con el mismo patrón que el despacho de OPR-27 y el observador de PR #24 (P-9 de ese spec) (P-2).

| Tema | Regla |
|---|---|
| Dónde | `src/lib/alertas/registrador.ts`, llamado desde `/api/tablero/cambios`, a lo sumo una vez cada 15 s por proceso. |
| Qué lee | `cambiosDesde(cursor)` con un cursor propio en memoria, filtrado a `entidad = "alert_result"`, y después `obtenerVarios("alert_result", ids)`. Con cursor nulo (arranque) o `CursorCaducado`, una **pasada completa**: por sujeto para las requests que no están en Paid ni canceladas, y por id para las ocurrencias abiertas en opsRUN. |
| Sujeto → request | §3.2. Sin request, se salta con log y no se escribe [S-3]. |
| Escribe | `opsrun.upsert_alert_occurrence(…)` (§8.2) por alerta, como actor de sistema `registrador_alertas` (`opsrun.system_actor`), por `opsrun_app`, una transacción por alerta. |
| Idempotente | Llamar dos veces con lo mismo no escribe nada la segunda (la base lo garantiza). |
| BzzzBX caído | No escribe; reintenta en el siguiente sondeo con el mismo cursor. |
| Errores | `22023`, `OP035` y `OP036` se registran en el log con el `bzzzbx_alert_id` y se saltan para no frenar el resto [S-5]; cualquier otro error corta la pasada y se reintenta. |
| Refresco | Cada `audit_event` nuevo mueve el cursor de `/api/tablero/cambios`, así que el tablero y la ventana se refrescan solos. |

### 4.1 Cómo decide la resolución

Cuando BzzzBX da una alerta con `cleared_at` y opsRUN la tiene abierta, `upsert_alert_occurrence` la resuelve. **Quién y cómo** sale de opsRUN, no de BzzzBX (P-1):

- **`fixed_by_action` ("Fixed by action")** si en Audit de esa request hay un evento de un operador, de un tipo que arregla esa regla, con `occurred_at` entre `opened_at` y `cleared_at`. Se toma el último. `resolved_by` es ese operador y `resolving_instruction_id` su `instruction_id` si lo tiene (en la Fase A casi nunca).
- **`auto_cleared` ("Cleared automatically")** en cualquier otro caso: por ejemplo, Delayed al llegar el check-in.
- **`cleared_by_operator`** no lo pone nunca el registrador: es solo de `clear_alert` (PR #24). Si la ocurrencia ya está resuelta en opsRUN, no se toca.

El reparto vive en un solo lugar, el helper privado `opsrun_private.alert_fixing_events()` (§8.3) [S-6]:

| Regla | Eventos de Audit que la arreglan |
|---|---|
| OPS-001 Unassigned request | `request_assigned`, `request_reassigned` |
| OPS-002 Request open too long | `request_scheduled` |
| OPS-010 Delayed | ninguno (la limpia el check-in) |
| OPS-020 Cleaner declined | `cleaner_confirmed` |
| MEC-003 Running long | ninguno (la limpia el fin o `clear_alert`) |
| ORG-002 No photos, ORG-003 Partial photos | `oss_marked` |
| TRN-005 PO missing | `po_entered` |
| Message not delivered | `email_sent`, `text_sent` |

## 5. Pestaña Alerts

Reemplaza `PanelAlertas` (`src/app/_ventana/paneles.tsx`), que hoy es el marcador de OPR-26 §4.3, por `RanuraAlertas`: un server component con su propio `Suspense` (como `RanuraAudit`), en `src/app/_ventana/ranura-alertas.tsx`, reexportado desde `ranuras.tsx`. **No cambia `PropsRanuraAlertas`** (= `PropsRanuraBase & { alertas: AlertResult[] }`, `src/lib/ventana/ranuras.ts`): `alertas` son las de Needs action ya leídas y descontadas, y la ranura lee lo de opsRUN (Waiting y Resolved) en su propia transacción de solo lectura. Sigue siendo la última pestaña y aparece en todas las etapas (OPR-26 §4.1).

### 5.1 Qué muestra

**Needs action**, ordenadas por nivel (rojo primero) y después por `opened_at` (la más vieja arriba):

| Campo | Qué se ve | De dónde |
|---|---|---|
| Nivel | Chip rojo o ámbar | `AlertResult.level` |
| Regla | "MEC-003 Running long" (`reglaConNombre`, `src/lib/audit/reglas.ts`, que pasa a `src/lib/alertas/reglas.ts` y Audit lo importa de ahí) | `rule_id` |
| Motivo | El `reason_text` vivo, tal como llega | Puerto |
| Tiempo abierta | "Open 1 h 5 min" desde `opened_at`, con "Opened Nov 27 10:05 AM" en un `<time datetime>` | Calculado al pintar |
| Repeticiones | "Repeats on this job: 3" si hay más de una ocurrencia de la misma regla en la request (contando la actual) | `alert_occurrence` |
| Botón | El que la arregla (§5.3) | Registro de acciones |

**Waiting**, por `asked_at`:

| Campo | Qué se ve |
|---|---|
| Qué se espera | "Cleaner confirmation" (`initial`) o "Reschedule · Dec 2, 10:00 AM–2:00 PM" (`reschedule`, con lo propuesto) |
| A quién | Nombre del cleaner (puerto por `bzzzbx_team_id`), o `— —` |
| Estado | "Asked" o "Reply received" (`replied`: hay respuesta y la IA propuso una lectura; decide el operador con Confirm cleaner, OPR-28) |
| Desde | "Waiting 2 h 10 min" desde `asked_at` |

**Resolved**, la más reciente arriba:

| Campo | Qué se ve |
|---|---|
| Nivel y regla | Como en Needs action, con el nivel con el que se resolvió |
| Motivo | El `reason_text` de la ocurrencia (como llegó al abrirse) |
| Abierta y resuelta | "Opened Nov 27 10:05 AM · Resolved 11:10 AM" |
| Tiempo abierta | "Open 1 h 5 min" (`resolved_at − opened_at`) |
| Quién y cómo | "Cleared automatically"; "Fixed by Ops Uno · Assigned" (la etiqueta del evento que la arregló, del catálogo `audit_event_type`); "Cleared by Ops Dos" y debajo "Reason: …" |
| Repeticiones | Igual que en Needs action |

- Una sección vacía se ve con su encabezado y "None" (Needs action: "No alerts need action").
- Todo con `<section aria-labelledby>` por sección y una `<ul>` por lista, con `data-testid` por sección (`alertas-needs-action`, `alertas-waiting`, `alertas-resolved`) y por fila (`alerta`, con `data-regla`, `data-nivel` y `data-seccion`).
- Horas en la zona de la operación (`PropsRanuraBase.zona`), con `horaConFecha` del tablero; duraciones con un formateador nuevo `duracion()` en `src/lib/tablero/formato.ts`.

### 5.2 Insignia de la pestaña

| Caso | Insignia |
|---|---|
| Needs action con alguna roja | Roja, con el conteo de Needs action |
| Needs action solo ámbar | Ámbar, con el conteo de Needs action |
| Needs action vacía y Waiting con algo | Gris, con el conteo de Waiting (P-4) |
| Nada | Sin insignia |

- **Late unas veces con una alerta roja nueva:** cuando aparece en Needs action un `bzzzbx_alert_id` rojo que no estaba en el pintado anterior de esa misma ventana, la insignia lleva `data-pulso="si"` y una animación CSS de 3 ciclos. El primer pintado fija la base y no late (P-13). Con `prefers-reduced-motion: reduce` no hay animación; el color basta.
- El nombre accesible de la pestaña dice el conteo y el nivel: "Alerts, 2 need action, red".
- Hoy la insignia tiene `data-nivel="amber"` fijo (`src/app/_ventana/pestanas.tsx`): pasa a salir de esta tabla.

### 5.3 El botón de cada alerta

El botón **no ejecuta nada**. Abre la action bar con esa acción elegida, y si la acción necesita datos, prellenados (P-6). Desde ahí corre por `ejecutarAccion`, que recalcula la disponibilidad en el servidor (OPR-26 §5.4). Si la acción no está `disponible`, el botón se ve en gris con el mismo motivo que en la barra ("Not built yet", "BzzzBX unavailable", "Available when actions are switched on", "Add PO"…).

| Regla | Botón | Acción del registro | Prellenado |
|---|---|---|---|
| OPS-001 | Assign / Reassign | `assign_request` (OPR-28) | "Assign to me" elegido |
| OPS-002 | Schedule | `schedule` (enlace de la Fase A) | — |
| OPS-010 | Sin botón: "Clears at check-in" | — | — |
| OPS-020 | Confirm cleaner | `confirm_cleaner` (OPR-28; el cambio de equipo es de OPR-17) | — |
| MEC-003 | Clear alert | `clear_alert` (PR #24, **tal cual**) | `{ bzzzbx_alert_id }` de esta alerta |
| ORG-002, ORG-003 | Mark as OSS / Not OSS | `mark_oss` (PR #24) | — |
| TRN-005 | Enter PO | `write_po` (PR #24) | — |
| Message not delivered | Edit and resend | Ninguna de la barra: lleva el foco al mensaje en la conversación, cuyo botón Edit and resend ya existe (OPR-27 S-6) | — |

- El reparto regla → acción vive en código, en `src/lib/alertas/reglas.ts` (`ARREGLO_DE_REGLA`). Los códigos de acción salen del registro (`src/lib/acciones/registro.ts`); una prueba falla si `ARREGLO_DE_REGLA` nombra un código que el registro no tiene. Los códigos que no existen todavía (`assign_request`, `confirm_cleaner`) son los que fije la implementación de OPR-28 [S-7].
- Que MEC-003 sea la única limpiable lo decide `clearable_rules()` (PR #24): este spec no lo repite.
- La action bar gana un contexto de cliente `AccionDeLaVentana` con `elegir(codigo, datos?)`, que usan los botones de la pestaña. Es el único cambio al marco de OPR-26.
- **Nombres provisionales hasta OPR-4:** todos los textos de los botones son las `etiqueta` del registro, que salen de los catálogos (OPR-26 P-5), incluido "Clear alert". Los **límites** con que abre cada alerta esperan OPR-3 y las **9 reglas reales** esperan OPR-33: hasta entonces el stand-in las imita (§9) y opsRUN no supone nada sobre cuándo abren.

### 5.4 Abrir en Alerts y volver a la propiedad

Lo construyó OPR-26 (§4.2, `src/app/_ventana/pestanas.tsx` y `src/lib/ventana/armar.ts`). OPR-34 solo cambia qué cuenta como "pide acción":

1. Con un `?tab=` válido para la etapa, esa pestaña.
2. Si no, **Alerts cuando Needs action no está vacía** (§3.3): ya no cuentan Waiting ni las alertas resueltas en opsRUN que Signal Maker sigue dando abiertas.
3. Si no, la pestaña de la propiedad.

Si la ventana está en Alerts **por la regla 2** y la última alerta de Needs action se resuelve (por el refresco de OPR-26 §8.3, sea porque Signal Maker la cerró o porque el operador la arregló con `clear_alert`), la ventana pasa sola a la pestaña de la propiedad. Si el operador eligió Alerts a mano, se queda (OPR-26 S-9). Con Waiting abierto y Needs action vacía, también vuelve.

### 5.5 BzzzBX caído

- Needs action muestra lo último leído de esa request (memoria de la ventana, OPR-26 §6.1) con la franja "BzzzBX unavailable · last update HH:MM".
- Waiting y Resolved son de opsRUN y se ven completos; los nombres del cleaner, `— —` si no se leyeron antes.
- Los botones de acciones con `necesitaBzzzbx` quedan en gris con "BzzzBX unavailable" (Clear alert, según PR #24 P-5).

## 6. Panel de Alerts de la barra superior

### 6.1 El ícono

- El botón que ya existe (`data-testid="alertas-operacion"`, `src/app/_tablero/vista-tablero.tsx`) cuenta **Needs action de toda la operación**, con `alertasDeLaRequest` (§3.2): ahora entran también las de mensaje y salen las resueltas en opsRUN.
- Color rojo si alguna es roja, ámbar si no, sin color con 0. Late como la insignia (§5.2) con una roja nueva.
- Gana `aria-expanded`, `aria-controls` y `aria-haspopup="dialog"`, y abre el panel.
- Los conteos por columna (OPR-25 §1.3) usan la misma función, así que coinciden siempre con el panel.

### 6.2 El panel

Un `<div role="dialog" aria-label="Alerts">` no modal, debajo del ícono, de cliente (`src/app/_tablero/panel-alertas.tsx`), con los datos que el tablero ya leyó en el servidor (no hace lecturas propias ni rutas nuevas). Esc, ✕ o clic fuera lo cierran y el foco vuelve al ícono. Sigue abierto en los refrescos del tablero (`router.refresh()` conserva el estado del cliente) y la lista se actualiza sola.

Dos secciones (P-7):

**Needs action** (abierta por defecto). Una fila por alerta, mismo orden que en la pestaña (rojo primero, más vieja arriba):

| Columna | Qué se ve |
|---|---|
| Nivel | Chip |
| Regla | "OPS-001 Unassigned request" |
| Job | El nombre de la tarjeta (propiedad y espacio) y su número (`R<n>` o job number) |
| Etapa | Requests … Validation |
| Assigned to | Dueño o "Unassigned" |
| Tiempo abierta | "Open 45 min" |

**Waiting** (cerrada por defecto, con su conteo): una fila por pregunta abierta al cleaner, con el job, qué se espera y desde cuándo.

**Filtros** (encima de las secciones; filtran las dos):

| Filtro | Opciones |
|---|---|
| Level | All, Red, Amber |
| Rule | All y las reglas presentes, con su nombre |
| Stage | All y las cinco columnas |
| Assigned to | All, Unassigned y cada operador activo |

- Cada opción muestra cuántas filas quedan con ella. Sin resultados: "No alerts match these filters" y "Clear filters".
- Los filtros viven en el estado del cliente mientras la página está abierta; no van a la URL [S-8]. El filtro de operador del tablero (All operators / Only me) no cambia y no filtra el panel hasta OPR-21 [S-9].
- Con BzzzBX caído: lo último conocido del tablero, con "BzzzBX unavailable · last update HH:MM" arriba del panel.

### 6.3 Del panel a la Job window

Cada fila es un enlace `<a href="/job/[requestId]">` **sin `?tab`** (P-8). Así:

- desde el tablero, la ruta interceptada abre la ventana encima del tablero (OPR-26 P-1), y el panel se cierra;
- como la request tiene algo en Needs action, la regla 2 abre la ventana en Alerts, y cuando se resuelva la última vuelve sola a la propiedad (§5.4);
- clic con modificador o "abrir en otra pestaña" abren la página completa, igual que la tarjeta.

Una fila de Waiting abre la misma URL; como Waiting no cuenta como "pide acción", la ventana abre en la propiedad, donde está Confirm cleaner [S-10].

## 7. Encaje en el código

| Pieza | Dónde | Qué |
|---|---|---|
| Modelo puro | `src/lib/alertas/armar.ts` | `alertasDeLaRequest`, `armarAlertas` (las tres secciones, orden, tiempos, quién y cómo, repeticiones, insignia), `armarPanelAlertas` (filas, conteos por filtro) |
| Reglas | `src/lib/alertas/reglas.ts` | `NOMBRES_DE_REGLAS` (se mueve desde `src/lib/audit/reglas.ts`), `ARREGLO_DE_REGLA`, `REGLA_MENSAJE_NO_ENTREGADO` (P-12) |
| Lectura de opsRUN | `src/lib/alertas/consultas.ts` | Ocurrencias de una request (o de todas las abiertas, para el tablero), con el operador y el `audit_event` de su resolución; `cleaner_confirmation` abiertas. Una consulta parametrizada cada una, como `opsrun_app`, en `begin read only` |
| Registrador | `src/lib/alertas/registrador.ts` | §4 |
| Pulso | `src/app/_alertas/usar-pulso.ts` | Hook de cliente: compara los ids rojos con los del pintado anterior |
| Pestaña | `src/app/_ventana/ranura-alertas.tsx`, `vista-alertas.tsx`, `alertas.css` | §5 |
| Panel | `src/app/_tablero/panel-alertas.tsx` | §6 |
| Tablero | `src/lib/tablero/armar.ts`, `leer.ts` | Usa `alertasDeLaRequest`; `leer.ts` suma la relectura por id de las ocurrencias abiertas con mensaje (§3.2); `Tablero` gana `panelAlertas` |
| Ventana | `src/lib/ventana/armar.ts`, `pestanas.tsx` | "Pide acción" = Needs action; nivel de la insignia; contexto `AccionDeLaVentana` |

## 8. Migración (pide OK, P-0)

`supabase/migrations/20261205120000_alertas.sql`, solo hacia adelante, como `opsrun_migrador`, **después** de la de las etapas de PR #24 (`20261203120000`) y de la de la entrada de correo de PR #23 (`20261204120000`). No se escribe hasta que Henry apruebe este spec.

### 8.1 Tablas y vistas

- **Ninguna tabla, columna ni vista nueva.** `alert_occurrence` ya tiene todo (OPR-20 §3.8) y `v1_alert_occurrence` ya la expone. G4 y G9 no cambian.
- **Trigger nuevo** `alert_occurrence_resolved_frozen` (`BEFORE UPDATE`, por fila, función en `opsrun_private`): si `old.resolved_at is not null`, cualquier cambio lanza `OP036`. Hace cumplir "una alerta resuelta no se reabre" (OPR-20 §3.8) para todas las funciones, incluida `clear_alert`, que ya comprueba `OP022` antes y no se ve afectada.
- No cambian los catálogos: `alert_opened`, `alert_level_changed`, `alert_resolved` y `alert_cleared` ᴿ ya existen.

### 8.2 Función del sistema

En `opsrun`, `security definer`, dueño `opsrun_migrador`, `set search_path = ''`, llama a `opsrun_private.require_system()` en su cuerpo (G6), `revoke all … from public` y `grant execute … to opsrun_app` y a nadie más. Escribe la ocurrencia y su Audit **en la misma transacción**: si un paso falla, no queda ninguno.

```sql
opsrun.upsert_alert_occurrence(
  p_bzzzbx_alert_id text,
  p_request_id uuid,                    -- lo resuelve el servidor desde el sujeto (§3.2)
  p_rule_id text,
  p_rule_version text,
  p_level opsrun.alert_level,
  p_reason_text text,
  p_bzzzbx_message_id text,             -- solo con sujeto message
  p_opened_at timestamptz,
  p_cleared_at timestamptz              -- null si sigue abierta
) returns uuid                          -- id de la alert_occurrence
```

| Caso (en orden) | Qué hace |
|---|---|
| Argumentos vacíos, `p_cleared_at < p_opened_at` | `22023` |
| La request no existe | `OP006` (reutilizado) |
| No existe la ocurrencia | La inserta (`first_seen_at = now()`) y escribe `alert_opened` (`actor_kind = 'bzzzbx'`, `occurred_at = p_opened_at`, `alert_occurrence_id`, `details = {"bzzzbx_alert_id", "rule_id", "level"}`) |
| Existe con otra `request_id` o `rule_id` | `OP035`, sin escribir |
| Existe y ya está resuelta en opsRUN | Nada (no se reabre ni cambia de nivel); devuelve el id. Cubre la ocurrencia que creó `clear_alert` |
| Existe abierta y `p_level` cambió | Actualiza `level` y escribe `alert_level_changed` con `details = {"from", "to"}` (TRN-005 de ámbar a rojo en Validation, OPR-20 §3.8) |
| Abierta y `p_cleared_at` no nulo | La resuelve con `resolved_at = p_cleared_at` y la resolución de §4.1, y escribe `alert_resolved` con `occurred_at = p_cleared_at` y `details = {"resolution", "fixing_audit_event_id", "fixing_event_type"}` |

- `rule_version`, `reason_text` y `opened_at` no se actualizan después de insertar: son la instantánea de la apertura [S-11].
- **Actor de `alert_resolved`** (P-11): con `fixed_by_action`, `actor_kind = 'operator'` y el operador que la arregló, como ya hacen la seed y la prueba B3 de OPR-35 ("Fixed by action" por Finance Uno); con `auto_cleared`, `actor_kind = 'bzzzbx'`.
- Con `clear_alert` (PR #24) en carrera: si los dos insertan a la vez la misma ocurrencia, uno recibe `23505`. Para el registrador es un error que corta la pasada y se reintenta; la siguiente vuelta ve la ocurrencia resuelta y no hace nada [S-12].
- Llamar dos veces con lo mismo no escribe nada la segunda.

### 8.3 Helpers privados

En `opsrun_private` (sin EXECUTE para nadie, G7):

| Helper | Qué hace |
|---|---|
| `alert_fixing_events() returns table (rule_id text, event_type text)` | La tabla de §4.1. `immutable`. Cada `event_type` existe en `audit_event_type` (lo prueba pgTAP) |
| `alert_fix_for(p_request_id uuid, p_rule_id text, p_from timestamptz, p_to timestamptz) returns opsrun.audit_event` | El último evento de un operador de esa request, de un tipo de `alert_fixing_events()` para esa regla, entre `p_from` y `p_to`; o null |
| `alert_occurrence_resolved_frozen() returns trigger` | §8.1 |

### 8.4 Códigos de error

A partir de `OP035` (OPR-28 usa hasta `OP018`, PR #24 `OP019` a `OP027`, PR #23 `OP030` a `OP034`). Este spec se reserva `OP035` a `OP039` y usa dos. Se documentan en la cabecera de la migración:

| Código | Cuándo | Lo lanza |
|---|---|---|
| `OP006` | La request no existe (reutilizado) | `upsert_alert_occurrence` |
| `OP035` | La ocurrencia ya existe con otra request u otra regla: BzzzBX cambió el sujeto o la regla de un `bzzzbx_alert_id` | `upsert_alert_occurrence` |
| `OP036` | Se intenta cambiar una ocurrencia resuelta | trigger `alert_occurrence_resolved_frozen` |
| `22023` | Argumento inválido | `upsert_alert_occurrence` |
| `42501` | Sin actor de sistema, con un operador o con los dos (`require_system()`) | `upsert_alert_occurrence` |

## 9. Stand-in y seed

Todo inventado (repo público). No cambian los crosswalk IDs que la seed y el falso ya comparten; `seed-y-falso.test.ts` sigue pasando y gana una comprobación: cada `bzzzbx_alert_id` de la seed existe en el falso **con el mismo estado** (abierta en los dos o cerrada en los dos). Si no, el registrador escribiría eventos al arrancar.

El falso no lee opsRUN, así que **no imita a Signal Maker**: no cierra una alerta cuando el operador la arregla. Los E2E lo hacen con `/api/falso cambiar` (`cleared_at`) después de la acción, igual que en OPR-26 A6 [S-13]. `/api/falso` no cambia: `poner` y `cambiar` ya cubren alertas, mensajes y fotos, y `cambiosDesde` ya registra esos cambios.

**Falso (`src/lib/bzzzbx/falso/datos.ts`):**

- `bx-alert-0006`: OPS-010 de `bx-job-0004` (R4), roja, cerrada hace 1 día, para que R4 tenga **dos** ocurrencias de OPS-010 ("Repeats on this job: 2").
- `bx-job-0109` / `EX-00109` y `bx-alert-0007` TRN-005 **abierta**, ámbar, "Customer requires a PO.", para R9 (abajo).
- Nada nuevo en R1 (A6 de OPR-26 espera una sola alerta) ni en R2.

**Seed (`supabase/seed.sql`), al final del archivo para no mover ids (P-9):**

- `alert_occurrence` de `bx-alert-0006` (R4, OPS-010, `auto_cleared`) con su `alert_opened` y su `alert_resolved`.
- `alert_occurrence` abierta de `bx-alert-0005` (MEC-003 de R4, que agrega PR #24) con su `alert_opened`, para que el registrador no la cree al arrancar. Se coordina con la implementación de PR #24.
- **R9**: en Validation, aprobada y sin validar, cliente `bx-cust-0003` (exige PO), sin PO en el borrador ni en el job, enlazada a `bx-job-0109`, y su ocurrencia abierta de `bx-alert-0007` con `alert_opened`. Es el caso de TRN-005 PO missing (E2E-7) sin tocar R6 (validada) ni R8 (que recorre E2E-1).
- R2 ya tiene una `cleaner_confirmation` `asked` (Waiting); no cambia.

### 9.1 Qué alerta muestra cada E2E

E2E-2 a E2E-7 están en el Release Definition §5, que no se pudo leer [S-1]. El reparto sale de las etapas que el plan les da (`PLAN.md` §4, P3) y de las reglas de cada etapa (P-10):

| E2E | Etapa (tarjeta) | Alerta | Cómo se arregla | Resolved como |
|---|---|---|---|---|
| E2E-2 | Requests (OPR-28) | OPS-001 Unassigned request | Assign / Reassign | Fixed by action · Assigned |
| E2E-3 | Scheduled (OPR-29) | OPS-010 Delayed | Check-in | Cleared automatically |
| E2E-4 | In Progress (OPR-30) | MEC-003 Running long | Clear alert con motivo | Cleared by operator · Reason |
| E2E-5 | In Progress → Complete (OPR-30, OPR-31) | ORG-002 No photos | Mark as OSS | Fixed by action · Marked as OSS |
| E2E-6 | Complete (OPR-31) | ORG-003 Partial photos | Llegan las fotos que faltan | Cleared automatically |
| E2E-7 | Validation (OPR-32) | TRN-005 PO missing | Enter PO | Fixed by action · PO entered |

OPS-020 y Message not delivered se prueban aparte (L10), porque sus acciones son de OPR-17 y OPR-19; OPS-002 queda en Vitest (su botón es Schedule, que ya prueba OPR-28).

## 10. Pruebas y criterios de aceptación

### 10.1 pgTAP (`supabase test db`)

Archivo nuevo `alertas.test.sql`, con fixtures propios dentro de la transacción:

- sin actor, con un operador y con los dos a la vez, `upsert_alert_occurrence` falla con `42501` y no escribe. **Se ve en rojo una vez** quitando `require_system()` en local, además de G6, que ya la descubre y se ve fallar en cada corrida;
- G5, G6 y G7 cubren la función y los helpers nuevos sin tocarlos;
- alta: inserta la ocurrencia y un `alert_opened` con `occurred_at = p_opened_at`; la segunda llamada igual no escribe nada (cuenta de `audit_event` y `change_seq` iguales);
- llega ya cerrada: ocurrencia resuelta y `alert_opened` + `alert_resolved` en la misma llamada;
- nivel: ámbar → rojo deja `alert_level_changed` con `from` y `to`;
- resolución: con un `request_assigned` de un operador dentro de la ventana, OPS-001 queda `fixed_by_action` con ese `resolved_by` y `fixing_event_type`; con el evento **antes** de `opened_at` o **después** de `cleared_at`, `auto_cleared`; con un evento de otro tipo, `auto_cleared`; OPS-010 siempre `auto_cleared`; con dos eventos válidos, el último; con una `instruction_id`, `resolving_instruction_id`;
- todo `event_type` de `alert_fixing_events()` existe en `audit_event_type`;
- una ocurrencia que resolvió `clear_alert` (PR #24) no cambia con `upsert_alert_occurrence` (ni nivel ni eventos);
- `OP035` con otra request y con otra regla; `OP006`; `22023` con `p_cleared_at < p_opened_at` y con vacíos;
- `OP036`: el trigger rechaza un `update` a una ocurrencia resuelta, también como `opsrun_migrador`;
- un fallo forzado después del insert no deja ni la ocurrencia ni su Audit;
- `v1_alert_occurrence` muestra la resolución y `bzzz_writeback_opsrun` la lee.

**Guard nuevo G16** (`guard_alertas.test.sql`):

1. Toda función de los esquemas de opsRUN cuyo `prosrc` hace `insert into` o `update` sobre `opsrun.alert_occurrence` (descubiertas en `pg_proc`, sin lista) también hace `insert into opsrun.audit_event`. Hoy son `clear_alert` y `upsert_alert_occurrence`; una tercera entra sola.
2. Toda columna de `opsrun.alert_occurrence` (descubiertas en `pg_attribute`) queda congelada en una ocurrencia resuelta: para cada una, un `update` sobre una fixture resuelta falla con `OP036`.

**Se ve fallar en cada corrida:** dentro de la transacción, (1) crea una función de prueba que actualiza `alert_occurrence` sin escribir Audit y comprueba que G16 la detecta; (2) deshabilita el trigger y comprueba que la parte 2 lo detecta; después hace rollback.

### 10.2 Vitest (TDD, cada una en rojo primero)

- `alertasDeLaRequest`: sujetos request, job y mensaje (por `request_message` y por hilo); sin request no entra; descuenta las resueltas en opsRUN; la misma respuesta para el tablero y la ventana.
- `armarAlertas`: las tres secciones con sus campos; orden (rojo primero, más vieja arriba; Resolved, más reciente arriba); tiempos con `duracion()`; repeticiones; "Cleared automatically", "Fixed by … · <etiqueta>" y "Cleared by …" con "Reason:"; insignia de §5.2 en sus cuatro casos; "None".
- `armarPanelAlertas`: filas de toda la operación, conteos por opción de filtro, combinación de filtros, "No alerts match these filters".
- `armarVentana`: la regla 2 con Needs action, no con Waiting ni con una alerta resuelta en opsRUN; la vuelta a la propiedad cuando Needs action queda vacía y Waiting no.
- `armarTablero`: conteos de la barra, de cada columna y de cada tarjeta iguales a los de `alertasDeLaRequest`, con una alerta de mensaje.
- `ARREGLO_DE_REGLA`: cada regla de `NOMBRES_DE_REGLAS` tiene entrada; cada código de acción existe en el registro (se ve fallar con un código inventado).
- Registrador: alerta nueva → una llamada a `upsert_alert_occurrence`; la misma otra vez → la llama y la base no escribe (con la base real, `OPSRUN_REQUIERE_BASE=1`); sujeto sin request → no llama; `CursorCaducado` y arranque → pasada completa; BzzzBX caído → no llama y no avanza el cursor; `OP035` se salta y sigue; a lo sumo una vez cada 15 s. Nunca usa un actor de operador (se ve fallar declarándolo).
- `usarPulso`: late con un id rojo nuevo, no en el primer pintado, no con uno ámbar, no con uno que ya estaba.
- Componentes (Testing Library): pestaña con sus secciones y botones; botón en gris con el motivo de la acción; el panel abre y cierra con Esc y devuelve el foco; filtros; filas como enlaces sin `?tab`.
- `seed-y-falso.test.ts`: mismo estado de cada alerta en la seed y en el falso.
- Integración contra la seed (`OPSRUN_REQUIERE_BASE=1`, en una transacción que se deshace): la lectura de Resolved de R4, R5 y R6 con quién y cómo.

### 10.3 Playwright (criterios de aceptación)

Contra el build de producción, la seed y el falso, con `OPSRUN_ACTOR_DEMO=1` y `OPSRUN_ZONA_HORARIA=America/New_York`. `alertas.spec.ts` va en un proyecto aparte que corre **después** de los de Audit y de las etapas (PR #24), porque L5 a L9 cambian R1, R3, R4 y R9 una vez por base. "Cierra Signal Maker" es `/api/falso cambiar` del `cleared_at` (§9).

| # | Criterio | Cómo se prueba |
|---|---|---|
| L1 | **Secciones de la pestaña.** | R1: Needs action con OPS-001 Unassigned request, su motivo, "Open …" y el botón Assign / Reassign. R2: Waiting con "Cleaner confirmation", el cleaner y "Asked". R4: Resolved con OPS-010 "Cleared automatically" y "Repeats on this job: 2". R5: MEC-003 "Cleared by Ops Dos" con "Reason: Large unit, cleaner called ahead.". R6: TRN-005 "Fixed by Finance Uno · PO entered". |
| L2 | **Insignia.** | R1 ámbar con 1; R2 gris con 1 (Waiting); R3 sin insignia. `/api/falso poner` una alerta roja en R1 con la ventana abierta → roja con 2 y `data-pulso="si"`; con `reducedMotion: "reduce"` el color cambia y no hay animación. |
| L3 | **Abre en Alerts y vuelve.** | R1 abre en Alerts; se cierra la alerta → vuelve a la propiedad en menos de 1 minuto. R2 (solo Waiting) abre en la propiedad. Con `?tab=alerts` elegido a mano, se queda (OPR-26 A6 sigue pasando). |
| L4 | **Panel de la barra.** | El ícono dice el total de Needs action y abre el panel; están las alertas abiertas de la seed y el falso; los filtros Level, Rule, Stage y Assigned to reducen la lista con sus conteos; Esc cierra y el foco vuelve al ícono. Clic en la fila de R1 → la ventana se abre **encima del tablero**, en Alerts, sin `?tab` en la URL; Esc vuelve al tablero. |
| L5 | **E2E-2 local: OPS-001.** | R1: Assign / Reassign desde la alerta (el panel de la barra de acciones se abre con "Assign to me") → Go. Cierra Signal Maker → en menos de 1 minuto pasa a Resolved "Fixed by Ops Uno · Assigned"; el conteo de la barra baja; Audit muestra "Alert resolved". Corre cuando OPR-28 tenga Assign construido; hasta entonces, `fixme`. |
| L6 | **E2E-3 local: OPS-010.** | `/api/falso poner` una OPS-010 roja en `bx-job-0003` (R3): la tarjeta dice Delayed, la barra y la columna Scheduled cuentan una roja, la pestaña la muestra sin botón y con "Clears at check-in". `poner` el check-in y cierra Signal Maker → Resolved "Cleared automatically"; Audit "Alert opened" y "Alert resolved" con `Observed` donde toca. |
| L7 | **E2E-4 local: MEC-003.** | R4: `/api/falso poner` una MEC-003 nueva (`bx-alert-0008`; la `bx-alert-0005` ya la limpia E2 de PR #24); Clear alert desde la alerta, con ella elegida; Go deshabilitado sin motivo; con motivo → Resolved "Cleared by Ops Uno" con "Reason: …", **aunque el falso la siga dando abierta**; deja de contar en la tarjeta, la columna y la barra (PR #24 P-7). |
| L8 | **E2E-5 y E2E-6 locales: fotos.** | R4, después de L7 (R5 ya está aprobada por E5 de PR #24 y no admite Mark as OSS, `OP023`): `poner` el `completed` → Complete; `poner` ORG-002 → Mark as OSS desde la alerta → cierra Signal Maker → "Fixed by Ops Uno · Marked as OSS". Después `poner` ORG-003 → `poner` la foto After → cierra Signal Maker → "Cleared automatically". |
| L9 | **E2E-7 local: TRN-005.** | R9: Needs action con TRN-005 ámbar; `cambiar` el nivel a rojo → la insignia pasa a roja y Audit "Alert level changed"; Enter PO desde la alerta → cierra Signal Maker → "Fixed by … · PO entered"; Validate deja de estar en gris con "Add PO" (PR #24). |
| L10 | **Mensaje no entregado y alertas sin acción construida.** | `poner` un mensaje de texto `failed` en un hilo de R2 y su alerta (sujeto `message`): cuenta en la tarjeta de R2, en su columna y en la barra; en la pestaña, Edit and resend lleva el foco al mensaje. `poner` OPS-020 en R2: Confirm cleaner en gris con su motivo del registro. |
| L11 | **El botón no corre lo que no está disponible.** | En R1 se quita el `disabled` de un botón de alerta cuya acción está `sin_construir` y se pulsa: el panel dice "Not built yet" y el cursor de `/api/tablero/cambios` no cambia. |
| L12 | **BzzzBX caído.** | Con R1 abierta, `/api/falso no_disponible`: Needs action con lo último leído y la franja; Waiting y Resolved completos; Clear alert en gris con "BzzzBX unavailable" en R4. El panel de la barra muestra lo último conocido con su aviso. Al volver, todo se va. |

Las 9 reglas reales, sus límites y "aparece en menos de 1 minuto" con datos de staging son de OPR-33 y OPR-40.

## 11. Dependencias de decisiones P0 y externas

| Decisión | Qué toca aquí | Mientras tanto |
|---|---|---|
| **OPR-33** (las 9 reglas) | Qué abre y qué cierra cada regla, sus ids y versiones, el texto con evidencia, el id de Message not delivered | El stand-in las imita con `poner` y `cambiar`; `rule_id` es `text` sin suponer forma |
| **OPR-3** (límites) | Cuándo abren OPS-001, OPS-002 y MEC-003 | opsRUN no calcula; solo muestra el `reason_text` |
| **OPR-4** (nombres) | "Clear alert" y los nombres de los botones; la zona horaria de las horas | Los `label` de los catálogos |
| **OPR-6** (contrato) | Si `cambiosDesde` entrega cambios de `AlertResult`; si un `bzzzbx_alert_id` puede cambiar de sujeto (`OP035`); si una regla re-disparada trae otro id (OPR-20 §11.7) | Supuestos del stand-in |
| **OPR-2 / OPR-21** (login) | "Only me" en el panel; "Assign to me" con la sesión | "Acting as" |
| OPR-17, OPR-19 | Cambio de equipo tras OPS-020; estado de entrega para Message not delivered | El botón sale con la disponibilidad de su acción |

## 12. Supuestos

| # | Supuesto |
|---|---|
| S-1 | El prototipo R23, el User Guide cap. 10 y Ap. C y el Release Definition §4.11 y §5 no se pudieron leer: textos, distribución y el reparto de §9.1 se revisan contra ellos. |
| S-2 | Una alerta es de una request si su sujeto es la request, su job o un mensaje de sus hilos (el criterio de la ventana, OPR-26 S-8). |
| S-3 | Una alerta cuyo sujeto no lleva a ninguna request no se muestra y queda en el log. |
| S-4 | Entre que Signal Maker cierra una alerta y el registrador la anota (≤ 15 s), no se ve ni en Needs action ni en Resolved. |
| S-5 | Los errores de datos del registrador (`22023`, `OP035`, `OP036`) se saltan con log; no hay alerta para eso en V1.1 beta. |
| S-6 | Una alerta se considera arreglada por una acción si hubo un evento de un operador del tipo de §4.1 entre su apertura y su cierre. |
| S-7 | Los códigos de acción de Assign y Confirm cleaner son los que fije la implementación de OPR-28. |
| S-8 | Los filtros del panel no van a la URL. |
| S-9 | El filtro de operador del tablero no filtra el panel hasta OPR-21. |
| S-10 | Una fila de Waiting abre la ventana en la propiedad. |
| S-11 | `reason_text`, `rule_version` y `opened_at` de la ocurrencia son la instantánea de la apertura y no se actualizan; el nivel sí, mientras está abierta. |
| S-12 | La carrera entre `clear_alert` y el registrador sobre la misma ocurrencia nueva termina en `23505` para uno, y la siguiente vuelta la resuelve; no se cambia `clear_alert`. |
| S-13 | El falso no imita a Signal Maker: los E2E cierran las alertas con `/api/falso`. |

## 13. Preguntas para Henry (con mi recomendación)

- **P-0. Migración.** §8: una función del sistema (`upsert_alert_occurrence`), dos helpers y un trigger, sin tablas ni columnas nuevas, con `OP035`, `OP036` y G16. **Recomiendo sí**: sin ella no hay Resolved, ni repeticiones, ni alertas en Audit, que el principio 5 pide. Alternativa: sin migración, Resolved leído en vivo de las `AlertResult` cerradas de BzzzBX, sin quién ni cómo (salvo las de `clear_alert`), y con historial solo si BzzzBX lo guarda.
- **P-1. "Fixed by action": cómo se decide.** **Recomiendo** el reparto regla → eventos de Audit en `alert_fixing_events()` y el último evento de un operador entre la apertura y el cierre. Alternativa: todo lo que cierra Signal Maker es "Cleared automatically" y solo `clear_alert` dice quién, que pierde el "who and how" de la tarjeta.
- **P-2. Registrador provisional.** **Recomiendo** construirlo aquí, desde `/api/tablero/cambios` cada 15 s con `cambiosDesde`, como el despacho de OPR-27, y moverlo a la read layer cuando llegue OPR-22. Alternativa: esperar a OPR-22, y OPR-34 no cumple su Hecho cuando en local.
- **P-3. Alertas de mensaje sin cambiar el puerto.** **Recomiendo** releer por id las ocurrencias abiertas con `bzzzbx_message_id` (respeta tu decisión de OPR-25 P-6). Alternativa: agregar al puerto `listarPor("alert_result", { abiertas: true })`, una sola ida para toda la operación, que hay que pedirle a BzzzBX en OPR-6.
- **P-4. Insignia gris.** **Recomiendo** gris con el conteo de Waiting cuando Needs action está vacía. Alternativa: gris sin número, o sin insignia, y Waiting solo dentro de la pestaña.
- **P-5. Qué es Waiting.** **Recomiendo** `cleaner_confirmation` `asked` y `replied` (el índice de OPR-20 §3.4), que no abren la ventana en Alerts, con "Reply received" para `replied`. Alternativa: `replied` pasa a Needs action porque espera una decisión del operador.
- **P-6. El botón de la alerta.** **Recomiendo** que abra la acción en la action bar, prellenada, y que corra solo por `ejecutarAccion`. Alternativa: que ejecute directo, que abre un segundo camino para escribir y hay que vigilarlo con otro guard.
- **P-7. Contenido del panel.** **Recomiendo** Needs action abierta, Waiting cerrada con su conteo, y los filtros Level, Rule, Stage y Assigned to. Alternativa: solo Needs action, sin Waiting.
- **P-8. Del panel a la ventana.** **Recomiendo** el enlace sin `?tab`, para que la regla 2 abra en Alerts y la ventana vuelva sola a la propiedad. Alternativa: `?tab=alerts`, que deja la ventana fija en Alerts aunque ya no haya nada.
- **P-9. Seed y falso.** **Recomiendo** `bx-alert-0006` (repetición en R4), la ocurrencia abierta de `bx-alert-0005` (coordinada con PR #24) y una R9 en Validation sin PO con TRN-005 (`bx-job-0109`, `bx-alert-0007`). Alternativa: sin R9, usar R8 después de que E1 de PR #24 la lleve a Validation, que ata las dos pruebas.
- **P-10. Reparto de E2E-2 a E2E-7.** **Recomiendo** el de §9.1 hasta leer el Release Definition §5. ¿Me lo confirmas o me pasas los casos?
- **P-11. Actor de "Alert resolved" arreglada por una acción.** **Recomiendo** el operador que la arregló, como ya hacen la seed y la prueba B3 de OPR-35. Alternativa: siempre `bzzzbx` (quien la cerró), con el operador solo en `resolved_by`, y cambiar la seed y B3.
- **P-12. Id de la regla Message not delivered.** CONTEXT.md no le da código. **Recomiendo** una constante `REGLA_MENSAJE_NO_ENTREGADO` en `src/lib/alertas/reglas.ts`, provisional hasta OPR-33, con un valor inventado en el falso. Alternativa: esperar a OPR-33 para mostrarla.
- **P-13. Cuándo late.** **Recomiendo** que el primer pintado fije la base y solo late una roja que aparece después. Alternativa: latir también al abrir si la roja abrió hace menos de 1 minuto.
