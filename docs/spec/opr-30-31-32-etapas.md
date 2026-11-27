# OPR-30, OPR-31 y OPR-32 — In Progress, Complete y Validation/Billing hasta Paid (Fase A)

- **Tarjetas:** OPR-30 (P3 · In Progress: Job tracker, photos, Clear alert, End manually), OPR-31 (P3 · Complete: Approve & confirm, Mark as OSS / Not OSS) y OPR-32 (P3 · Validation and Billing: Validate (PO check), Paid). Leídas en Relevo el 2026-11-27, junto con el comentario oficial de OPR-42 (Fase A). Las tarjetas son información; este spec manda sobre la construcción solo cuando Henry lo apruebe.
- **Estado:** aprobado por Henry el 2026-11-27, con P-0 a P-15 según las recomendaciones y P-9 dentro del único ciclo de fondo de opsRUN (§13.1). **No hay código ni migración escritos.** Lo marcado **[S-n]** es un supuesto; lo marcado **P-n** es una pregunta para Henry, con su decisión (§13).
- **Meta:** que **E2E-1 llegue hasta Paid sobre el stand-in**: una request recorre Requests → Scheduled → In Progress → Complete → Validation → Paid en local, con cada paso en Audit.
- **Construye sobre (todo en `main`):** el modelo de datos (`docs/spec/opr-20-modelo-de-datos.md` §3.2, §3.8, §3.11, §4 y §5; migración `20261124130000_modelo_de_datos.sql`), el puerto de BzzzBX y su falso (`docs/spec/opr-22-stand-ins.md`, `src/lib/bzzzbx/`), el tablero (OPR-25), la Job window con su registro de acciones y sus ranuras (`docs/spec/opr-26-job-window.md` §5 y §7, `src/lib/acciones/`, `src/lib/ventana/ranuras.ts`), la conversación (OPR-27, migración `20261130120000_conversacion.sql`, hasta `OP012`), el enlace de la Fase A (`docs/spec/fase-a-enlace.md`) y Audit (`docs/spec/opr-35-audit.md`).
- **Depende además de un spec aprobado sin construir:** `docs/spec/opr-28-assign-confirm.md` (Assign y Confirm, con R8 y `bx-job-0108`, y los códigos `OP013` a `OP018`). E2E-1 empieza en Requests, así que su prueba de punta a punta (§11.3, E1) corre después de esa implementación.
- **Referencias sin acceso [S-1]:** User Guide cap. 6 a 9, Release Definition §4.5 a §4.9 y el prototipo R23 no están en este repo, que es público, y no se pudieron leer. Lo que sigue sale de las tarjetas, de OPR-42, de `CONTEXT.md`, del catálogo de OPR-20 y del código en `main`.

## 1. Para qué

Hoy un job enlazado se queda en Scheduled para siempre desde el punto de vista de opsRUN: el tablero y la ventana ya calculan In Progress, Complete y Validation con lo que lee el stand-in, pero ninguna acción de esas etapas corre (todas salen `sin_construir`), y las pestañas Job tracker y Billing muestran "Coming in a later build". Este trabajo entrega lo que falta para cerrar el ciclo en la Fase A:

1. **In Progress (OPR-30):** la pestaña Job tracker (estado, ventana, llegada, inicio, fin, duración con la esperada) y la galería de fotos Before/After, leídas de BzzzBX; **Clear alert** de Running long (MEC-003) con motivo obligatorio, registrado solo en opsRUN.
2. **Complete (OPR-31):** **Mark as OSS / Not OSS** y **Approve & confirm**, registrados en opsRUN. Approve deja el job en Validation.
3. **Validation y Billing (OPR-32):** captura del **PO** en opsRUN, bloqueo **"Add PO"**, **Validate** registrado en opsRUN, pestaña Billing (PO #, OSS, Paid) y **Paid** leído del stand-in (tarjeta verde y fila Paid, que el tablero ya pinta).

### 1.1 Qué hace la Fase A con cada acción

Según el comentario oficial de OPR-42 (Fase A, "observe and assist"):

| Acción o dato | Fase A (este spec) | Fase B (después) |
|---|---|---|
| Job tracker, fotos | Se leen de BzzzBX | Igual |
| Clear alert | Se registra en opsRUN | Igual; además `acknowledge_alert` a BzzzBX (spec OPR-22 P-3) |
| Mark as OSS / Not OSS | Se registra en opsRUN | Igual |
| Approve & confirm | Se registra en opsRUN | Se escribe en PINCH por el action plane |
| PO | Se registra en opsRUN | Se escribe en PINCH (`write_po`) |
| Validate | Se registra en opsRUN | Se escribe en PINCH (`record_validation`) |
| Paid | Se lee de BzzzBX (QuickBooks) | Igual |
| End manually, Reschedule, Cancel, envíos | Se hacen en las herramientas de PINCH; opsRUN observa | Desde opsRUN |

### 1.2 Fuera de alcance

- **End manually** (OPR-30): es Fase B y sigue abierto si BzzzBX soporta `end_job_manually` (spec OPR-22, P-3). Se ve, no corre (P-10). Con él queda fuera el OSS automático "sin fotos al terminar a mano".
- **El aviso Done al requester** (OPR-31): espera OPR-18 (plantillas) y OPR-16 (envío). Approve no manda nada [S-9].
- **La alerta TRN-005 PO missing** (OPR-32): la calcula BzzzBX y espera OPR-33. El flag "PO missing" de la tarjeta, que ya existe, sí cambia (§7.4).
- **Calcular alertas** (MEC-003, ORG-002, ORG-003): son de Signal Maker (OPR-33). opsRUN solo lee `AlertResult` y registra su Clear alert.
- **La pestaña Alerts completa** (secciones, Resolved, "Mark as OSS" desde la alerta de fotos): OPR-34.
- **Reject · re-clean:** sigue `fuera_de_release`.
- **Evidencia de fotos por área:** fuera de V1.1 beta.
- **Escribir en QuickBooks:** fuera de V1.1 beta (`CONTEXT.md`).

## 2. Principios que aplica

- **Un solo dueño.** Los tiempos del Job Tracker, las fotos, el PO del job en PINCH, `po_required` del cliente y Paid son de PINCH: se leen del puerto al pintar y no se guardan. opsRUN guarda solo sus decisiones: la marca OSS, la aprobación, el PO que el operador capturó en opsRUN, la validación y el Clear alert con su motivo (§6).
- **Las personas firman.** Las cinco acciones son de un operador (`require_operator()`); ninguna corre sola.
- **Todo queda en Audit,** en la misma transacción que el dato, con persona y motivo.
- **Fase A no manda instrucciones.** Ninguna función nueva crea filas en `opsrun.instruction`. En Fase B las mismas funciones agregarán la instrucción en su transacción sin cambiar su firma.
- **Guards que descubren y se ven fallar.** El guard nuevo G14 descubre las columnas de hechos del job por su `COMMENT` y las funciones por el catálogo, y se ve fallar en cada corrida (§10.1).

## 3. Etapas y qué decide cada una

La etapa no cambia de fórmula (OPR-20 §5, `src/lib/tablero/armar.ts`): In Progress con check-in y sin fin; Complete con `completed` del Job Tracker o `ended_manually_at`, sin `approved_at`; Validation con `approved_at`. Paid no es columna: sale de `Payment.paid` y pinta la tarjeta verde en la fila "Paid (n)".

| Etapa | Lo nuevo | Quién lo guarda |
|---|---|---|
| In Progress | Pestaña Job tracker con fotos; Clear alert | Tiempos y fotos: BzzzBX. Clear alert: opsRUN |
| Complete | Mark as OSS / Not OSS; Approve & confirm | opsRUN |
| Validation | Pestaña Billing; Enter PO; Validate (bloqueo "Add PO") | PO capturado y validación: opsRUN. PO del job, `po_required`, Paid: BzzzBX |
| Paid | Tarjeta verde, fila Paid, "Paid <fecha>" en Billing | BzzzBX |

Un job que se termina en las herramientas de PINCH (incluido un fin a mano allí) llega como `completed` del Job Tracker [S-5]. La pestaña Job tracker sigue visible desde In Progress en adelante (OPR-26 §4.1).

## 4. OPR-30 — In Progress

### 4.1 Pestaña Job tracker

Reemplaza el marcador `data-ranura="tracker"` con un server component con su propio `Suspense`, sin cambiar `PropsRanuraTracker` (= `PropsRanuraBase`). Lee del puerto, en paralelo y dentro del presupuesto de la ventana (OPR-26 §2): `obtener("job")`, `listarPor("jobtracker_event")`, `listarPor("photo")` del job y las alertas ya leídas.

| Fila | Qué muestra | De dónde |
|---|---|---|
| Estado y ventana (una fila) | Etapa ("In Progress", "Complete", …), chip **Running long** si hay una MEC-003 abierta, y "Nov 27 · 10:00 AM–2:00 PM" | Etapa de la ventana; `AlertResult`; `Job.service_date`, `window_*` |
| Arrival | Hora del `checked_in` o `— —` | `JobTrackerEvent` |
| Start | Hora del `started` o `— —` | `JobTrackerEvent` |
| End | Hora del `completed` o `— —` | `JobTrackerEvent` |
| Duration | `end − start` (o `ahora − start`, "running", si no terminó) y "expected <ventana>" [S-2] | Calculada al pintar; nunca se guarda |

- Si hay varios eventos del mismo tipo, se usa el primero (igual que `armarTablero`) [S-3].
- Las horas van en la zona de la operación (`PropsRanuraBase.zona`), con el formato del tablero (`horaConFecha`).
- Con BzzzBX caído: lo último leído de la request (memoria de la ventana) o `— —`, con la franja de OPR-26 §6.1.

### 4.2 Galería de fotos

Debajo del tracker, dos grupos: **Before** y **After**, cada uno con sus miniaturas por `taken_at`.

- **"No photos"** si el job no tiene ninguna; "No before photos" / "No after photos" si falta un grupo.
- Clic o Enter en una miniatura la **agranda** en un `<dialog>` modal (Esc, ✕ o clic fuera cierra; flechas para la anterior y la siguiente). `alt` = "Before photo, Nov 27 10:05 AM".
- La imagen no se guarda ni pasa por la base. Llega por una ruta del servidor `GET /api/fotos/[bzzzbxPhotoId]` que la pide al puerto y la devuelve con `Cache-Control: private, no-store` (P-8). El navegador nunca habla con BzzzBX.
- El puerto gana `leerFoto(ref: string): Promise<{ contentType: string; bytes: Uint8Array } | null>`, provisional hasta OPR-6/OPR-9, con su prueba de contrato. El falso devuelve un SVG inventado (un recuadro con "Before" o "After" y el id), nunca una foto real.
- Con BzzzBX caído, las miniaturas se ven como recuadros "Photo unavailable".

### 4.3 Clear alert

| Tema | Regla |
|---|---|
| Etapa | In Progress (registro de OPR-26 §5.3) [S-6]. |
| Qué alertas | Solo las reglas limpiables: **MEC-003 Running long** (P-6). Un helper `opsrun_private.clearable_rules()` es el único lugar de la lista. |
| Bloqueo | Sin alerta abierta limpiable: `bloqueada` con "No alert to clear". |
| Panel | La alerta (regla, nivel, `reason_text`, abierta hace…); si hay varias, se elige una. **Reason obligatorio** (el catálogo ya lo marca: `alert_cleared` ᴿ). |
| Lectura | El ejecutor **vuelve a leer** el `AlertResult` en BzzzBX: tiene que existir, estar abierto y ser del job o de la request. Por eso `necesitaBzzzbx: true` (P-5). |
| Escritura | `clear_alert` crea la `alert_occurrence` si todavía no existe (nadie la escribe hasta OPR-34) con la instantánea que pasa el servidor, y la resuelve `cleared_by_operator` con `resolved_by` y `resolution_reason`. |
| Audit | `alert_cleared`, con `reason`, `alert_occurrence_id` y `details = {"bzzzbx_alert_id", "rule_id"}`. Si la ocurrencia la creó `clear_alert`, no hay `alert_opened` antes [S-15]. |
| Cómo se ve después | La alerta deja de contar en la tarjeta, en Alerts de la barra superior y en la ventana **aunque BzzzBX la siga dando abierta** (P-7): la lectura descuenta los `bzzzbx_alert_id` resueltos en opsRUN. La pestaña Audit muestra "Alert cleared · MEC-003 Running long · amber" con el motivo y el operador. |
| BzzzBX | Signal Maker ve la resolución por el write-back (`v1_alert_occurrence`). Si la regla vuelve a disparar, llega otra ocurrencia con otro `bzzzbx_alert_id` (OPR-20 §11.7) [S-7]. |

El nombre "Clear alert" es provisional hasta **OPR-4**.

### 4.4 End manually

Sigue en la action bar de In Progress, en gris con **"Available when actions are switched on"** (el texto de OPR-42) y sin ejecutor (P-10). `ejecutarAccion` lo rechaza como hoy.

## 5. OPR-31 y OPR-32 — Complete, Validation y Billing

### 5.1 Mark as OSS / Not OSS

| Tema | Regla |
|---|---|
| Etapa | Complete (registro). |
| Panel | Dos opciones, **OSS** y **Not OSS**, con la actual marcada; Reason opcional. `Go` deshabilitado si se elige la marca que ya tiene. |
| Escritura | `mark_oss` pone `oss_mark`, `oss_marked_at`, `oss_marked_by` y `oss_source = 'operator'`. Puede cambiar una marca `auto` (R5) o una del operador. |
| Después de aprobar | No se cambia (P-12): `OP023`. |
| Audit | `oss_marked` con `details = {"mark", "previous_mark"}` y el motivo si lo hay. |
| Alertas de fotos | ORG-002 y ORG-003 las cierra BzzzBX al ver la marca por el write-back; opsRUN no las toca (como OPS-001 en OPR-28 S-3). |
| Dónde se ve | Chip **OSS** en la tarjeta (ya existe) y en el encabezado de la ventana (nuevo), y "OSS status" en Billing. |

### 5.2 Approve & confirm

| Tema | Regla |
|---|---|
| Etapa | Complete. |
| Panel | Resumen (fin observado, OSS) y `Go`. Sin Reason [S-8: no exige marca OSS]. |
| Escritura | `approve_job` pone `approved_at` y `approved_by`. El job pasa a Validation en el tablero y en la ventana (la etapa ya se calcula así). |
| Dos veces | `OP023`. |
| Audit | `job_approved`. **No** hay `requester_notified`: el aviso Done espera OPR-18 [S-9]. |

### 5.3 PO: captura en opsRUN

| Tema | Regla |
|---|---|
| Dónde | Campo **PO #** editable en la pestaña Billing (con Save) y acción **Enter PO** de la action bar en Validation; los dos pasan por `ejecutarAccion` con el código `write_po` [S-13]. |
| Qué guarda | `request.entered_po_number`, `entered_po_at`, `entered_po_by` (columnas nuevas, P-1). El PO del borrador (`po_number`, Requests) sigue congelado al programar. |
| Valor | Recortado, no vacío, hasta 64 caracteres [S-14] (`22023`). El mismo valor que ya tiene → `OP024`. |
| Hasta cuándo | Hasta Validate (P-13): con el job validado, `OP025`. |
| Audit | `po_entered` con `details = {"po_number", "previous_po_number"}`: es el valor que escribió el operador en opsRUN, no uno leído de PINCH. |
| BzzzBX | `necesitaBzzzbx: false`: corre con BzzzBX caído. En Fase A no sale nada; BzzzBX lo lee por el write-back (P-4). |

**PO vigente (P-2).** Para el bloqueo y para mostrar, opsRUN considera tres fuentes, en este orden: el PO capturado en opsRUN (`entered_po_number`), el PO del job en PINCH (`Job.po_number`, leído) y el PO del borrador (`request.po_number`). El job tiene PO si cualquiera no está vacío. Billing muestra el capturado en opsRUN como valor editable y, si PINCH tiene otro distinto, una línea "In PINCH: <po>" (leída, nunca guardada).

### 5.4 Validate

| Tema | Regla |
|---|---|
| Etapa | Validation, con el job aprobado. |
| Bloqueo | Si el cliente exige PO (`Customer.po_required`, leído) y no hay PO vigente: `bloqueada` con **"Add PO"** (ya en el registro). |
| Lectura | El ejecutor vuelve a leer en BzzzBX el `Customer` y el `Job` (`po_required` y `po_number`) y se los pasa a la función. `necesitaBzzzbx: true`: con BzzzBX caído, `bloqueada` con "BzzzBX unavailable", porque no se puede saber si el cliente exige PO. |
| Escritura | `validate_job` pone `validated_at` y `validated_by` (columnas nuevas, P-3), después de comprobar dentro que el job esté aprobado (`OP026`), que no esté validado (`OP025`) y, con `p_po_required`, que haya PO (`OP027`). |
| Audit | `job_validated` con `details = {"po_required", "po_source": "opsrun" | "pinch" | "draft" | null, "po_number"}`. |
| Quién | Cualquier operador activo hasta OPR-2 (P-11). **Depende de OPR-2** (por ejemplo, solo Finance). |
| "Informs Finance" | En Fase A no hay aviso: Finance lo ve en la tarjeta ("Validated <fecha>") y en Billing [S-10, S-11]. |

### 5.5 Pestaña Billing

Reemplaza el marcador `data-ranura="billing"` (en Validation, OPR-26 §4.1), sin cambiar `PropsRanuraBilling`.

| Fila | Qué muestra | De dónde |
|---|---|---|
| PO # | Editable (§5.3) hasta validar; después, solo lectura. "In PINCH: …" si difiere. "PO required" si el cliente lo exige | opsRUN + puerto |
| OSS status | OSS, Not OSS o `— —`, con "auto" si `oss_source = 'auto'` | opsRUN |
| Approved | "Approved Nov 27 by Ops Uno" | opsRUN |
| Validated | "Validated Nov 27 by Finance Uno" o "Not validated" | opsRUN |
| Paid | **"Paid Nov 26"** (de QuickBooks, solo lectura, sin control) o "Not paid yet". Con BzzzBX caído, lo último leído o `— —` | `Payment` del puerto (frescura ≤ 1 h, spec OPR-22 §3.1) |

### 5.6 Paid

Nada que construir en opsRUN fuera de Billing: el tablero ya pinta la tarjeta verde y la fila "Paid (n)" con `Payment.paid` (OPR-25). En el stand-in se llega a Paid con `/api/falso` (`cambiar` el `payment` del job). El evento `job_paid` en Audit depende de P-9.

## 6. Qué guarda opsRUN y qué lee de BzzzBX

| Guarda opsRUN (dueño) | Lee de BzzzBX al pintar (dueño PINCH), nunca guarda |
|---|---|
| `alert_occurrence` resuelta con `cleared_by_operator`, `resolved_by`, `resolution_reason`, y la instantánea de la alerta (`rule_id`, `rule_version`, `level`, `reason_text` como `bzzzbx-snapshot`, `opened_at`) que ya define OPR-20 §3.8 | `AlertResult` vivo (abierta o no según Signal Maker) |
| `oss_mark`, `oss_marked_at`, `oss_marked_by`, `oss_source` | Fotos (`Photo` y su imagen por `leerFoto`) |
| `approved_at`, `approved_by` | Check-in, inicio, fin (`JobTrackerEvent`) y la ventana del job |
| `entered_po_number`, `entered_po_at`, `entered_po_by` (lo que escribió el operador) | `Job.po_number` (PO en PINCH) y `Customer.po_required` |
| `validated_at`, `validated_by` | `Payment.paid`, `paid_at` (QuickBooks) |
| Cada `audit_event`, con su motivo | Precio, nombres de cliente, propiedad y cleaner |

Si P-9 se acepta, opsRUN guarda además los hechos observados en Audit (`job_checked_in`, `job_started`, `job_completed`, `job_paid`) con **solo** el tipo, la hora de BzzzBX y el crosswalk ID (OPR-20, "Observed event"). Las duraciones, el estado "running long" y el PO vigente se calculan al pintar. Nada leído de PINCH se copia a una columna de opsRUN; el guard G9 obliga a declarar el dueño de cada columna nueva.

Lo que viaja del navegador a la base: el id de la request, la versión (`change_seq`), la marca OSS, el PO escrito y el motivo. La instantánea de la alerta, `po_required` y el PO de PINCH los lee el **servidor** en BzzzBX y los pasa a la función, igual que `link_observed_job` recibe el job number (frontera de confianza: el servidor, no el navegador).

## 7. Encaje en el código

### 7.1 Registro de acciones

Las entradas ya existen en `REGISTRO_DE_ACCIONES`. Se conservan los códigos [S-13] y se agrega el ejecutor:

| Código | `necesitaBzzzbx` | `motivo` | `bloqueo(v)` (en orden) | `datos` | Función SQL |
|---|---|---|---|---|---|
| `clear_alert` | `true` (hoy `false`, P-5) | `"obligatorio"` | "No alert to clear" | `{ bzzzbx_alert_id }` | `clear_alert` |
| `end_job_manually` | `true` | `"obligatorio"` | — | — | ninguna: `fase_b` (P-10) |
| `mark_oss` | `false` | `"opcional"` (hoy `"no"`) | — | `{ mark: "oss" \| "not_oss" }` | `mark_oss` |
| `approve_confirm` | `false` | `"no"` | — | `{}` | `approve_job` |
| `write_po` | `false` (hoy `true`) | `"no"` | "Already validated" | `{ po_number }` | `enter_po` |
| `record_validation` | `true` | `"no"` | "Already validated"; "Add PO" | `{}` | `validate_job` |

- **Disponibilidad nueva `fase_b`** (P-10), en gris con "Available when actions are switched on" (`DefinicionAccion.faseB: true`). Se usa en End manually, Reschedule y Cancel job. `ejecutarAccion` la rechaza como `no_disponible`.
- **Concurrencia:** `concurrencia: "request"` (por defecto). El ejecutor pasa `entrada.version` como `p_version`.
- **Ejecutores:** módulo nuevo `src/lib/acciones/etapas.ts` (`crearEjecutoresDeEtapas`, mismo patrón que `enlace.ts`), con las llamadas en `src/lib/etapas/datos-sql.ts` como `opsrun_app`, `escritura: true` y el actor. Devuelven `{ tipo: "guardada" }`. SQLSTATE por código:

| SQLSTATE | `codigo` | Mensaje |
|---|---|---|
| `OP006` | `request_no_encontrada` | "Job not found." |
| `OP013` | `cambio_concurrente` | "This job changed. Review and try again." |
| `OP019` | `job_no_programado` | "This request has no job yet." |
| `OP020` | `alerta_no_limpiable` | "This alert can't be cleared here." |
| `OP021` | `alerta_de_otro_job` | "That alert is not from this job." |
| `OP022` | `alerta_ya_resuelta` | "This alert is already resolved." |
| `OP023` | `ya_aprobado` | "This job is already approved." |
| `OP024` | `sin_cambios` | "Nothing to change." |
| `OP025` | `ya_validado` | "This job is already validated." |
| `OP026` | `sin_aprobar` | "Approve the job first." |
| `OP027` | `falta_po` | "Add PO" |
| `22023` | `dato_invalido` | "Check the value and try again." |
| `42501` | — | Sube: "Something went wrong. Try again." |

### 7.2 Ventana

- `FilaVentana` gana `entered_po_number`, `entered_po_at`, `validated_at`, `validated_by`, `approved_by`, `oss_source` y `alertasLimpiadas: string[]` (los `bzzzbx_alert_id` resueltos en opsRUN), en la misma transacción de solo lectura de OPR-26 §8.1.
- `alertasAbiertas` (ventana) y el filtro de `armarTablero` descuentan `alertasLimpiadas` (P-7).
- `VentanaJob.datos` gana `alertasLimpiables: { id; regla; nivel; razon }[]`, `oss: "oss" | "not_oss" | null`, `aprobada`, `validada` y `poVigente: { valor; fuente: "opsrun" | "pinch" | "draft" } | null`; `tienePo` pasa a salir de `poVigente`.
- Encabezado: chip OSS junto a Stage.
- Ranuras nuevas `src/app/_ventana/ranura-tracker.tsx` y `ranura-billing.tsx` (server components), con su presentación pura en `src/lib/tracker/armar.ts` (`armarTracker`) y `src/lib/billing/armar.ts` (`armarBilling`).

### 7.3 Fotos

`src/app/api/fotos/[id]/route.ts`: exige que la foto sea de un job enlazado a una request de opsRUN (busca el job por `listarPor("photo")` del `bzzzbx_job_id` de esa request; `?request=<uuid>` en la URL), llama a `leerFoto`, responde la imagen o 404. Sin login todavía (OPR-21), como el resto de la ventana. Con `OPSRUN_SERVIDOR=1` pasa a exigir la sesión cuando llegue OPR-21.

### 7.4 Tablero

- El flag **PO** / **PO missing** usa el PO vigente (§5.3).
- En Validation, el estado bajo el número: "Approved <día>", "Validated <día>" (nuevo, [S-10]) o "Paid <día>".
- Las alertas resueltas en opsRUN no cuentan (P-7).

### 7.5 Observador de hechos (si P-9)

`src/lib/observados/`: corre en segundo plano **dentro del único ciclo de fondo de opsRUN** que define OPR-15 (su P-1, en `instrumentation`, ADR 0006), nunca desde una consulta de lectura como `/api/tablero/cambios`. En cada vuelta del ciclo, a lo sumo cada 15 s, lee los `JobTrackerEvent` y `Payment` de los jobs enlazados que estén en Scheduled a Validation y llama a `record_observed_event` como actor de sistema `observador`. Deduplica por `bzzzbx_event_id` (la base lo hace con `unique`). Provisional hasta la read layer de OPR-22.

## 8. Migración nueva (pide OK, P-0)

`supabase/migrations/20261203120000_etapas_in_progress_a_paid.sql`, solo hacia adelante, como `opsrun_migrador`, **después** de la de assign-confirm (`2026120112xxxx_requests_assign_confirm.sql`). No se escribe hasta que Henry apruebe este spec.

### 8.1 Cambios de tabla y vista

```sql
alter table opsrun.request
  add column entered_po_number text,
  add column entered_po_at timestamptz,
  add column entered_po_by uuid references opsrun.operator (id) on delete restrict,
  add column validated_at timestamptz,
  add column validated_by uuid references opsrun.operator (id) on delete restrict;
```

- Constraints nuevas: `request_entered_po_together` (`num_nulls(...) in (0, 3)`), `request_entered_po_not_blank` (`length(btrim(entered_po_number)) between 1 and 64`), `request_validated_pair`, `request_validated_needs_approval` (`validated_at is null or approved_at is not null`). `request_job_facts_need_job` se reemplaza (drop + add) para incluir `entered_po_at` y `validated_at`.
- `COMMENT` de las cinco columnas nuevas y de las de hechos del job que ya existen (`ended_manually_*`, `oss_*`, `approved_*`) con la etiqueta **`opsrun:job · …`** (P-15), que usa G14. G9 pasa a aceptar `(:draft|:job)?`.
- `opsrun_writeback.v1_request`: `create or replace view` agregando las cinco columnas **al final** (P-4); el resto de v1 no cambia.
- No cambian tipos, catálogos (todos los tipos de Audit que usa ya existen: `alert_cleared` ᴿ, `oss_marked`, `job_approved`, `po_entered`, `job_validated`, `job_checked_in`, `job_started`, `job_completed`, `job_paid`) ni otras tablas. G4 no necesita fixture nueva (no hay tabla nueva).

### 8.2 Funciones del operador

En `opsrun`, `security definer`, dueño `opsrun_migrador`, `set search_path = ''`, cada una llama a `opsrun_private.require_operator()` en su cuerpo (G6), `revoke all … from public` y `grant execute … to opsrun_app` y a nadie más. Cada una bloquea la request con `lock_scheduled_request(p_request_id, p_version)` (`for update` y comparación de `change_seq` **dentro** de la transacción) y escribe su `audit_event` en la misma transacción: si cualquier paso falla, no queda ni el dato ni su Audit.

```sql
opsrun.clear_alert(
  p_request_id uuid,
  p_version bigint,
  p_bzzzbx_alert_id text,
  p_rule_id text,
  p_rule_version text,
  p_level opsrun.alert_level,
  p_reason_text text,
  p_opened_at timestamptz,
  p_reason text
) returns uuid                                -- id de la alert_occurrence

opsrun.mark_oss(
  p_request_id uuid,
  p_mark opsrun.oss_mark,
  p_version bigint,
  p_reason text default null
) returns void

opsrun.approve_job(p_request_id uuid, p_version bigint) returns void

opsrun.enter_po(p_request_id uuid, p_po_number text, p_version bigint) returns void

opsrun.validate_job(
  p_request_id uuid,
  p_version bigint,
  p_po_required boolean,                      -- Customer.po_required, leído por el servidor
  p_job_po_number text default null           -- Job.po_number de PINCH, leído por el servidor
) returns void
```

Los nombres son los de OPR-20 §4 (`clear_alert` y `end_job_manually` para OPR-30, `mark_oss` y `approve_job` para OPR-31, `enter_po` y `validate_job` para OPR-32). `end_job_manually` no entra.

| Función | Comprueba (en orden, después del candado) | Escribe |
|---|---|---|
| `clear_alert` | motivo no vacío (`22023`; el trigger de Audit lo exige igual, `OP002`); regla en `clearable_rules()` (`OP020`); si la ocurrencia existe: de otra request (`OP021`) o ya resuelta (`OP022`) | inserta la ocurrencia si falta; la resuelve `cleared_by_operator`; `alert_cleared` |
| `mark_oss` | no aprobada (`OP023`); marca distinta de la actual (`OP024`) | columnas `oss_*` con `oss_source = 'operator'`; `oss_marked` |
| `approve_job` | no aprobada (`OP023`) | `approved_*`; `job_approved` |
| `enter_po` | valor válido (`22023`); no validada (`OP025`); distinto del capturado (`OP024`) | `entered_po_*`; `po_entered` |
| `validate_job` | aprobada (`OP026`); no validada (`OP025`); con `p_po_required`, PO vigente (`OP027`) | `validated_*`; `job_validated` |

Que el job esté **observado** en la etapa correcta (con check-in, con fin) depende de BzzzBX: lo comprueba `ejecutarAccion` con la lectura fresca, y la base comprueba los hechos de opsRUN [S-12].

### 8.3 Función del sistema (si P-9)

```sql
opsrun.record_observed_event(
  p_bzzzbx_job_id text,
  p_event_type text,                          -- de audit_event_type con source = 'bzzzbx_observed'
  p_bzzzbx_event_id text,
  p_occurred_at timestamptz
) returns bigint                              -- id del evento, o null si ya estaba o el job no es de ninguna request
```

Llama a `opsrun_private.require_system()`; tipo fuera del catálogo observado → `22023`; `on conflict (bzzzbx_event_id) do nothing`; `actor_kind = 'bzzzbx'`, `source = 'bzzzbx_observed'`, `details = {}`. No toca `request` ni `change_seq`.

### 8.4 Helpers privados

En `opsrun_private` (sin EXECUTE para nadie, G7):

| Helper | Qué hace |
|---|---|
| `lock_scheduled_request(p_request_id uuid, p_version bigint) returns opsrun.request` | `select … for update`; `OP006` si no existe, `OP019` si no está `scheduled`, `OP013` si `p_version <> change_seq`. |
| `clearable_rules() returns text[]` | `{'MEC-003'}`. `immutable`. |
| `current_po(p_request opsrun.request, p_job_po text) returns jsonb` | `{"po_number", "po_source"}` según el orden de §5.3; lo usa `validate_job`. |

### 8.5 Códigos de error

A partir de `OP019`, documentados en la cabecera de la migración:

| Código | Cuándo | Lo lanza |
|---|---|---|
| `OP006` | La request no existe (reutilizado) | todas las del operador |
| `OP013` | `p_version` no es el `change_seq` actual (reutilizado de assign-confirm) | todas las del operador |
| `OP019` | La request no está programada (no tiene job) | todas las del operador |
| `OP020` | La regla no se puede limpiar con Clear alert | `clear_alert` |
| `OP021` | La ocurrencia es de otra request | `clear_alert` |
| `OP022` | La ocurrencia ya está resuelta | `clear_alert` |
| `OP023` | El job ya está aprobado | `approve_job`, `mark_oss` |
| `OP024` | Sin cambios: la marca OSS o el PO ya tienen ese valor | `mark_oss`, `enter_po` |
| `OP025` | El job ya está validado | `enter_po`, `validate_job` |
| `OP026` | El job no está aprobado | `validate_job` |
| `OP027` | El cliente exige PO y no hay PO vigente | `validate_job` |
| `OP002` | Falta el motivo de `alert_cleared` (trigger de OPR-20) | `clear_alert` |
| `22023` | Argumento inválido: motivo vacío, PO vacío o largo, nivel o tipo de evento inválido | `clear_alert`, `enter_po`, `record_observed_event` |
| `42501` | Sin actor o con los dos (de `require_operator()` / `require_system()`) | todas |

## 9. Stand-in y seed

Todo inventado (repo público). No cambian los crosswalk IDs que la seed y el falso ya comparten; `seed-y-falso.test.ts` sigue pasando.

**Falso (`src/lib/bzzzbx/falso/`):**

- `leerFoto(ref)`: SVG generado, sin archivos ni fotos reales (P-8), y su prueba de contrato.
- **R4 (`bx-job-0004`)**: una alerta **MEC-003 abierta** nueva (`bx-alert-0005`, amber, "Running 45 min over the window.") para Clear alert; sigue sin fotos ("No photos").
- **R6 (`bx-job-0006`)**: ya tiene Before/After y Paid; no cambia.
- **R8 (`bx-job-0108`, de assign-confirm)**: su `payment` (`paid: false`) y su `job_health`, para que `/api/falso cambiar payment` lo lleve a Paid. Sin eventos ni fotos al empezar: E1 los pone con `/api/falso poner`.
- `/api/falso` no cambia: `poner` y `cambiar` ya cubren eventos, fotos, alertas y pagos.

**Seed (`supabase/seed.sql`), al final del archivo para no mover ids (P-14):**

- **R8** (cuando assign-confirm la agregue): cliente `bx-cust-0003` (el que exige PO) y **sin PO en el borrador**, para que E2E-1 pase por "Add PO". Coordinar con la implementación de OPR-28.
- **R6**: `validated_at`/`validated_by` (Finance Uno, hace 3 días) y su `job_validated`, para que Billing y B3 muestren un job validado y pagado. Su PO sigue viniendo del job de PINCH y de la instrucción `write_po` de la seed (anterior a la Fase A, se deja).
- **R5**: no cambia (Complete, OSS `auto`): sirve para Approve y Mark as OSS.

## 10. Pruebas y criterios de aceptación

### 10.1 pgTAP (`supabase test db`)

Archivo nuevo `etapas.test.sql`, con fixtures propios dentro de la transacción:

- sin actor, con actor de sistema y con los dos a la vez, las cinco funciones del operador fallan con `42501` y no escriben nada; `record_observed_event` (si P-9) falla sin actor de sistema. **Se ve en rojo una vez** quitando `require_operator()` de `approve_job` en local, además de G6, que ya descubre las funciones nuevas y se ve fallar en cada corrida;
- G5, G6 y G7 cubren las funciones y helpers nuevos sin tocarlos; G9 cubre las columnas nuevas; G11 sigue pasando (las columnas nuevas no son `:draft`);
- cada función: request `open` → `OP019`; versión vieja → `OP013` y sin escritura; cada código de §8.5 en su caso; el dato y su `audit_event` con persona, motivo y `details` esperados, en la misma transacción (un fallo forzado después del update no deja ninguno de los dos);
- `clear_alert`: crea la ocurrencia si falta y la reutiliza si existe; `OP002`/`22023` sin motivo; `OP020` con OPS-001; `v1_alert_occurrence` muestra la resolución;
- `mark_oss` cambia una marca `auto` a `operator`; `approve_job` + `validate_job` respetan `request_validated_needs_approval`;
- `validate_job` con `p_po_required = true`: sin PO → `OP027`; con PO de opsRUN, de PINCH (`p_job_po_number`) o del borrador → pasa, y `details.po_source` dice cuál;
- `v1_request` expone las cinco columnas nuevas al final y `bzzz_writeback_opsrun` las lee;
- el flujo en SQL: request enlazada → `clear_alert` → `mark_oss` → `approve_job` → `enter_po` → `validate_job`.

**Guard nuevo G14** (`guard_hechos_del_job.test.sql`, P-15): toda función `security definer` que `opsrun_app` puede invocar y cuyo `prosrc` nombra una columna `:job` de `opsrun.request` (descubiertas por su `COMMENT`) llama a `opsrun_private.lock_scheduled_request(`; y toda columna `:job` es nula en una request `open` (se prueba poniéndole un valor a cada una, descubierta, y esperando `23514`). **Se ve fallar en cada corrida:** dentro de la transacción crea una función de prueba, ejecutable por `opsrun_app`, con `require_operator()`, que hace `update opsrun.request set approved_at = now()` sin el candado; comprueba que G14 la detecta y hace rollback.

### 10.2 Vitest (TDD, cada una en rojo primero)

- `armarTracker`: llegada, inicio, fin, duración terminada y "running", esperada desde la ventana, primer evento si hay repetidos, `— —` sin datos, zona horaria a ambos lados de un cambio de horario.
- Galería: agrupa Before/After por `taken_at`; "No photos"; el diálogo abre, navega con flechas y cierra con Esc (Testing Library).
- `armarBilling`: PO vigente por fuente y "In PINCH" cuando difiere; OSS con "auto"; Approved/Validated con nombre; Paid con fecha y "Not paid yet".
- `armarVentana` y `armarTablero`: descuentan `alertasLimpiadas`; `alertasLimpiables` solo MEC-003; `tienePo` desde el PO vigente; "Validated <día>".
- `disponibilidadDe`: cada bloqueo de §7.1 en su orden; `fase_b` en End manually, Reschedule y Cancel con "Available when actions are switched on"; con BzzzBX caído, Mark OSS, Approve y Enter PO siguen disponibles y Clear alert y Validate quedan `bloqueada`.
- `crearEjecutoresDeEtapas`: arma la llamada con la versión, el actor y lo leído de BzzzBX; cada SQLSTATE sale como su `rechazada`; `datos` inválidos (marca desconocida, PO vacío, alerta que no es del job o ya cerrada en BzzzBX) se rechazan **sin llamar a la base**; `42501` sube. Se ve fallar una vez quitando la relectura del `AlertResult`.
- `/api/fotos/[id]`: 404 con una foto de otro job o una request inexistente; nunca escribe en la base (espía sobre el pool).
- `leerFoto` en la prueba de contrato (falso; el real se salta hasta OPR-6).
- Observador (si P-9): un evento nuevo llama a `record_observed_event` una vez; repetido no duplica.
- Integración contra la seed (`OPSRUN_REQUIERE_BASE=1`, en CI, dentro de una transacción que se deshace): de Clear alert a Validate sobre R4 y R5.

### 10.3 Playwright (criterios de aceptación)

Contra el build de producción, la seed y el falso, con `OPSRUN_ACTOR_DEMO=1` y `OPSRUN_ZONA_HORARIA=America/New_York`. `etapas.spec.ts` va en un proyecto aparte que corre después de `chromium-audit`, porque E1 lleva R8 a Paid y E5 aprueba R5, una vez por base.

| # | Criterio | Cómo se prueba |
|---|---|---|
| E1 | **E2E-1 de Requests a Paid sobre el stand-in.** | Con pasos (`test.step`). "Acting as" Ops Uno. R8: asignar, tres confirmaciones y enlazar `bx-job-0108` (D1 de OPR-28) → Scheduled. `/api/falso poner` check-in e inicio → In Progress con Job tracker (Arrival y Start). `/api/falso poner` una MEC-003 abierta → Clear alert con motivo → deja de contar en la tarjeta y en la ventana. `/api/falso poner` el `completed` y una foto Before y una After → Complete; la galería las muestra y agranda. Mark as OSS → Not OSS. Approve & confirm → Validation. "Acting as" Finance Uno: Validate en gris con "Add PO"; PO # en Billing → Save → Validate. `/api/falso cambiar payment` → tarjeta verde en "Paid (n)" y "Paid <fecha>" en Billing. Audit, en orden: Request received … Scheduled · linked, (Checked in, Started, Completed · Observed, si P-9), Alert cleared con motivo y Ops Uno, Marked as OSS / Not OSS, Approved & confirmed, PO entered, Validated (Finance Uno), (Paid · Observed, si P-9). |
| E2 | Clear alert exige motivo. | R4: Clear alert con la MEC-003 nueva; Go deshabilitado vacío y con espacios; con motivo, Audit "Alert cleared" con "Reason: …". |
| E3 | Job tracker. | R4: estado y ventana en una fila, Arrival y Start con hora, End `— —`, duración "running" y la esperada; chip Running long mientras la alerta está abierta; "No photos". |
| E4 | Galería. | R6: Before y After; clic agranda en un diálogo, Esc cierra y el foco vuelve a la miniatura. |
| E5 | Approve. | R5: Mark as OSS muestra "auto" y se cambia a Not OSS; Approve & confirm → la tarjeta pasa a Validation en menos de 1 minuto. |
| E6 | **No corre forzando el `disabled`.** | En una Validation sin PO con cliente que lo exige: se quita el `disabled` de Validate y se pulsa Go: "Add PO" y el cursor de `/api/tablero/cambios` no cambia. Igual con End manually ("Available when actions are switched on"). |
| E7 | BzzzBX caído. | Con `/api/falso no_disponible`: Approve, Mark as OSS y Enter PO corren; Clear alert y Validate en gris con "BzzzBX unavailable"; Billing muestra lo último leído de Paid. |
| E8 | Cambio concurrente. | Dos contextos con R5: en uno se marca OSS; en el otro, Approve responde "This job changed. Review and try again." y no aparece `job_approved`. |
| E9 | Paid. | R6: tarjeta verde en la fila "Paid (n)"; Billing con "Paid <fecha>", sin control editable, PO en solo lectura (validado). |

E2E-4, E2E-5, E2E-6, E2E-7 y "E2E-1 llega a Paid" completos (Hecho cuando de las tres tarjetas) siguen en **staging** y dependen de OPR-9, OPR-10, OPR-8, OPR-33 y OPR-6. El "Done notice sent" de OPR-31 depende de OPR-18. E1 es la versión local sobre el stand-in.

## 11. Dependencias de decisiones P0

| Decisión | Qué toca aquí | Mientras tanto |
|---|---|---|
| **OPR-2** (login y roles) | Quién puede Validate (¿solo Finance?), Approve y Clear alert. "Acting as" en vez de sesión. Acceso a `/api/fotos` | Cualquier operador activo (P-11), con Audit diciendo quién. Si OPR-2 limita por rol, se agrega `operator_permission` y un chequeo en las funciones (OPR-20 §3.1) sin cambiar sus firmas |
| **OPR-4** (nombres) | "Clear alert", "Approve & confirm", "Mark as OSS / Not OSS", "Enter PO" / "Add PO", "Validate", y la zona horaria de las horas del tracker y de Paid | Los `label` de los catálogos (OPR-26 P-5); cambiar un `label` no migra datos |
| **OPR-3** (límites de alertas) | Cuándo abre Running long (MEC-003) y las alertas de fotos; si la duración "esperada" es la ventana u otro límite | opsRUN no calcula alertas: solo las lee y las limpia. La esperada es la ventana [S-2] |
| OPR-8, OPR-9, OPR-10, OPR-33, OPR-6 | Campo PO y `po_required`; feed del Job Tracker y fotos; Paid; TRN-005 y las demás reglas; contrato real | Stand-in con los supuestos de OPR-22 |
| OPR-18 | Aviso Done al aprobar | Approve no avisa [S-9] |

## 12. Supuestos

| # | Supuesto |
|---|---|
| S-1 | User Guide cap. 6–9, Release Definition §4.5–§4.9 y R23 no se pudieron leer; textos y distribución se revisan contra ellos. |
| S-2 | La duración esperada es la de la ventana del job (`window_end − window_start`). |
| S-3 | Con eventos repetidos del mismo tipo vale el primero. |
| S-4 | La imagen de una foto se pide al puerto por su `ref` y nunca se guarda ni se cachea en el servidor. |
| S-5 | Un fin en las herramientas de PINCH, también a mano, llega como `completed` del Job Tracker. |
| S-6 | Clear alert es de In Progress, como dice el registro. |
| S-7 | Signal Maker lee el Clear alert por el write-back y no reabre la misma ocurrencia; si vuelve a disparar, es otra con otro id. |
| S-8 | Approve no exige una marca OSS. |
| S-9 | Approve no avisa al requester hasta OPR-18. |
| S-10 | Una tarjeta validada y sin pagar dice "Validated <día>". |
| S-11 | "Informs Finance" no tiene aviso en la Fase A. |
| S-12 | La etapa observada (check-in, fin) la comprueba el servidor con la lectura fresca; la base comprueba los hechos de opsRUN. |
| S-13 | Se conservan los códigos del registro (`approve_confirm`, `write_po`, `record_validation`) aunque la función SQL tenga otro nombre. |
| S-14 | Un PO es texto recortado de 1 a 64 caracteres. |
| S-15 | Si `clear_alert` crea la ocurrencia, Audit no tiene `alert_opened` antes (lo escribirá `upsert_alert_occurrence`, OPR-34). |

## 13. Preguntas para Henry (con mi recomendación)

- **P-0. Migración.** §8: cinco columnas en `request`, cinco funciones del operador (y una del sistema si P-9), tres helpers, constraints y la vista `v1_request` ampliada. **Recomiendo sí.**
- **P-1. Dónde vive el PO capturado después de programar.** El borrador está congelado. **Recomiendo tres columnas `entered_po_*` en `request`**: es una decisión del operador, como `approved_*`. Alternativas: una tabla `po_entry` con historial (más objetos, G4, write-back nuevo) o solo la instrucción `write_po` (es Fase B).
- **P-2. PO vigente con tres fuentes.** **Recomiendo** que cualquiera desbloquee Validate, que Billing edite el de opsRUN y muestre "In PINCH: …" si difiere, y que `job_validated` diga la fuente. Alternativa: que mande el de PINCH y el de opsRUN solo cuente si PINCH no tiene.
- **P-3. Dónde queda Validate.** **Recomiendo `validated_at` y `validated_by` en `request`**, que el tablero y Billing leen sin buscar en Audit. Alternativa: solo el evento `job_validated` (Audit como estado, frágil).
- **P-4. Write-back.** **Recomiendo agregar las columnas nuevas al final de `v1_request`** (compatible: nadie lo consume todavía, OPR-24). Alternativa: `v2_request`.
- **P-5. Clear alert y BzzzBX.** **Recomiendo `necesitaBzzzbx: true`**: el servidor relee la alerta y crea la ocurrencia con su instantánea, porque nadie escribe `alert_occurrence` hasta OPR-34. Alternativa: esperar a `upsert_alert_occurrence` (OPR-34) y dejar Clear alert sin BzzzBX.
- **P-6. Qué alertas se limpian.** **Recomiendo solo MEC-003**, como dice la tarjeta, en un helper. Alternativa: cualquier alerta abierta del job.
- **P-7. Alerta limpiada en opsRUN y abierta en BzzzBX.** **Recomiendo que opsRUN la muestre resuelta** (la descuenta al leer): el operador ya decidió. Alternativa: mostrarla hasta que Signal Maker la cierre, que deja la tarjeta roja después del Clear.
- **P-8. Imágenes de las fotos.** **Recomiendo `leerFoto` en el puerto y la ruta `/api/fotos/[id]`**, con un SVG inventado en el falso. Alternativa: solo la lista de fotos con su hora, sin imagen, hasta OPR-9.
- **P-9. Hechos observados en Audit.** Hoy nadie escribe check-in, fin ni Paid en vivo (OPR-35 P-6), y E2E-1 los pide. **Recomiendo agregar `record_observed_event` y un observador mínimo aquí**, provisional hasta OPR-22. Alternativa: dejarlo en OPR-22 y que E1 compruebe en Audit solo lo de opsRUN.
- **P-10. Acciones de Fase B.** **Recomiendo una disponibilidad `fase_b` con "Available when actions are switched on"** (texto de OPR-42) para End manually, Reschedule y Cancel job. Alternativa: dejarlas "Not built yet", que no le dice al operador que se hacen en PINCH.
- **P-11. Quién valida.** **Recomiendo cualquier operador activo hasta OPR-2**, como en OPR-28 P-2. Alternativa: solo `operator.team = 'finance'` desde ya, que adelanta una decisión de OPR-2.
- **P-12. OSS después de aprobar.** **Recomiendo que no se cambie** (`OP023`): Approve firma lo que se ve. Alternativa: editable hasta Validate.
- **P-13. PO después de validar.** **Recomiendo que no se cambie** (`OP025`). Alternativa: editable hasta Paid, con su Audit.
- **P-14. Seed y falso.** **Recomiendo** R8 con `bx-cust-0003` y sin PO (coordinado con OPR-28), una MEC-003 abierta en R4, el pago de `bx-job-0108` y R6 validada (§9). Alternativa: una request nueva R9 solo para estas etapas, que duplica la parte de Requests.
- **P-15. Guard G14 y la etiqueta `:job`.** **Recomiendo etiquetar las columnas de hechos del job con `opsrun:job`** y que G14 exija el candado con versión a toda función que las escribe. Alternativa: probar cada función a mano, sin guard que descubra.

### 13.1 Decisiones (2026-11-27)

Henry aprobó el spec con las dieciséis recomendaciones ("con un solo ciclo de fondo"). Quedó así:

- **P-0:** sí a la migración de §8: cinco columnas en `request`, cinco funciones del operador, `record_observed_event` del sistema, tres helpers, constraints y `v1_request` ampliada.
- **P-1:** el PO capturado después de programar vive en `entered_po_number`, `entered_po_at` y `entered_po_by` de `request`.
- **P-2:** cualquiera de las tres fuentes de PO desbloquea Validate; Billing edita el de opsRUN y muestra "In PINCH: …" si difiere; `job_validated` dice la fuente.
- **P-3:** Validate queda en `validated_at` y `validated_by` de `request`.
- **P-4:** las columnas nuevas se agregan al final de `v1_request`.
- **P-5:** Clear alert necesita BzzzBX: el servidor relee la alerta y la función crea la ocurrencia con su instantánea.
- **P-6:** solo MEC-003 se limpia con Clear alert, desde `clearable_rules()`.
- **P-7:** una alerta limpiada en opsRUN se ve resuelta aunque BzzzBX la siga dando abierta.
- **P-8:** `leerFoto` en el puerto y la ruta `/api/fotos/[id]`, con un SVG inventado en el falso.
- **P-9:** se agregan `record_observed_event` y el observador mínimo, provisionales hasta OPR-22. **El observador corre en segundo plano solo dentro del único ciclo de fondo de opsRUN que define OPR-15 (P-1, `instrumentation`, ADR 0006), nunca desde una consulta de lectura** (§7.5).
- **P-10:** disponibilidad `fase_b` con "Available when actions are switched on" para End manually, Reschedule y Cancel job.
- **P-11:** cualquier operador activo valida hasta OPR-2, con Audit diciendo quién.
- **P-12:** la marca OSS no cambia después de aprobar (`OP023`).
- **P-13:** el PO no cambia después de validar (`OP025`).
- **P-14:** R8 con `bx-cust-0003` y sin PO (coordinado con OPR-28), una MEC-003 abierta en R4, el pago de `bx-job-0108` y R6 validada (§9).
- **P-15:** las columnas de hechos del job llevan la etiqueta `opsrun:job` y el guard G14 exige el candado con versión a toda función que las escribe.
