# OPR-35 — Pestaña Audit

- **Tarjeta:** OPR-35 (P4 · Audit tab). Depende de OPR-20 (modelo de datos, en `main`) y de OPR-23 (instruction layer, sin construir). Encaja en la ranura de OPR-26 §7.3 (Job window, spec aprobado; la implementación va en paralelo y aún no está en `main`).
- **Estado:** spec para revisión. Lo marcado **[S-n]** es un supuesto; lo marcado **P-n** es una pregunta para Henry, con mi recomendación (§11).
- **Construye sobre:** el modelo de datos (`docs/spec/opr-20-modelo-de-datos.md`, migración `20261124130000_modelo_de_datos.sql`), el enlace de la Fase A (`docs/spec/fase-a-enlace.md`, migración `20261125120000_fase_a_enlace.sql`), el puerto de BzzzBX y su falso (`src/lib/bzzzbx/`), el formato de horas del tablero (`src/lib/tablero/formato.ts`, `zonaDeLaOperacion`) y la Job window (`docs/spec/opr-26-job-window.md`).
- **Referencias de la tarjeta sin acceso [S-1]:** User Guide §10.3 y Release Definition §4.11 no están en este repo, que es público, y no se pudieron leer. La lista de eventos sale de la tarjeta, de `CONTEXT.md` y del catálogo `audit_event_type` de OPR-20. Se revisa contra esos documentos cuando se puedan leer.
- **Fuera de alcance:** escribir eventos. Cada evento lo escribe la función SQL de la tarjeta dueña de la acción (§3). OPR-35 solo lee y muestra.

## 1. Para qué

La pestaña **Audit** de la Job window cuenta la historia completa de un job: arriba sus identificadores y abajo cada evento en orden de tiempo, con quién lo hizo y por qué. Es la cara visible del principio 5 de `PLAN.md` ("Todo queda en Audit").

Hecho cuando (tarjeta): el Audit de E2E-1 muestra cada paso con hora y nombre correctos. E2E-1 completo se acepta en staging (OPR-40); en local se prueba lo que ya escribe alguien (§4).

Para la demo local del lunes (Fase A sobre el stand-in): tablero → Job window → enlace → conversación → **Audit**. Tras enlazar R7, la pestaña Audit aparece (la request pasa a Scheduled) y muestra recibido, asignado, confirmaciones, rechazos de enlace y Scheduled con el operador elegido en "Acting as" (OPR-26 P-2).

## 2. Qué se ve

### 2.1 Cuándo aparece

La pestaña aparece **desde Scheduled** (OPR-26 §4.1). Muestra **toda** la historia de la request, también lo que pasó en Requests (recibida, asignada, confirmaciones, rechazos de enlace) [S-6]. En Requests la pestaña no existe; lo que el operador necesita ahí lo da la pestaña de la propiedad.

### 2.2 Identificadores

Arriba de la lista, en una línea:

| Etiqueta | Valor | De dónde |
|---|---|---|
| Request | `R<r_number>` | `request.r_number` |
| Job number | `job_number` | `request.job_number` |
| Work App number | `job_number` [S-3] | `request.job_number` |

Lo que falte se ve `— —`, como en el resto de la ventana. Debajo, en gris: "Times in <zona>" con la abreviatura de la zona (por ejemplo "Times in EST") [S-5].

### 2.3 Lista de eventos

Una fila por `audit_event` de la request (`request_id = $1`), **del más viejo al más nuevo**: `occurred_at` ascendente y, a igual hora, `id` ascendente [S-4, P-4].

Cada fila:

| Parte | Qué muestra |
|---|---|
| Hora | `occurred_at` en la zona de la operación (§6) |
| Evento | El `label` del catálogo `audit_event_type`, más un complemento según el tipo (§2.4) |
| Persona | Según `actor_kind` (§5) |
| Reason | `audit_event.reason` si lo hay, en su propia línea, con la etiqueta "Reason:" |

Nunca se muestra el `details` en crudo, ni un crosswalk ID, ni un id interno. Un evento observado (`source = 'bzzzbx_observed'`) lleva una marca discreta "Observed" para distinguir un hecho de PINCH de una acción en opsRUN.

Los eventos sin request (`operator_added`, `operator_deactivated`, con `request_id` nulo) no salen en la pestaña de ningún job [S-8].

### 2.4 Complemento por tipo

El complemento sale de columnas de opsRUN y del `details` (solo valores de opsRUN y crosswalk IDs, OPR-20 §3.11). Los nombres de PINCH que haga falta mostrar se leen del puerto al pintar y nunca se guardan (§7.2, P-2).

| Tipo | Complemento | Sale de |
|---|---|---|
| `request_received` | — | — |
| `request_assigned` | "to <operador>". El primero de la request es el **operador original** y lleva la marca "Original" [S-7] | `details.to_operator_id` → `operator.display_name` |
| `request_reassigned` | "from <operador> to <operador>" | `details.from_operator_id`, `details.to_operator_id` |
| `details_confirmed`, `sender_confirmed`, `cleaner_confirmed` | "· by phone" o "· by text" si `details.method` lo dice (lo escribe OPR-28) | `details.method` |
| `request_scheduled` | "· job <job_number>"; con `details.mode = 'linked'`, "· linked to observed job <job_number>" | `details.job_number`, `details.mode` |
| `job_link_rejected` | "· job <job_number>" si el puerto lo da; si no, "· a proposed job" | `details.bzzzbx_job_id` → puerto `obtener("job")` |
| `alert_opened`, `alert_level_changed`, `alert_resolved`, `alert_cleared` | "<rule_id> <nombre de la regla> · <level>" y, al abrir, el `reason_text`; al resolver, "Cleared automatically", "Fixed by action" o "Cleared by operator" | `alert_occurrence` por `alert_occurrence_id`; nombres de regla en código [S-11] |
| `ai_analysis_completed` | "· <n> suggestions" | `ai_suggestion` por `details.ai_analysis_id` (lo escribe OPR-36) |
| `ai_analysis_failed` | "· worked by hand" | — |
| `ai_suggestion_accepted`, `ai_suggestion_rejected` | "<campo>: <valor>" | `ai_suggestion` por `ai_suggestion_id`; `ai_field.label` |
| `ai_suggestion_corrected` | "<campo>: <valor propuesto> → <valor final>" | `ai_suggestion.value`, `final_value` |
| `instruction_failed` | "<tipo de instrucción> · <error_message>" | `instruction` por `instruction_id`; `instruction_type.label` |
| `cleaner_asked`, `cleaner_replied`, `cleaner_declined` | "· <cleaner>" | `cleaner_confirmation.bzzzbx_team_id` → puerto `obtener("cleaner_team")` |
| `note_added` | — (el texto de la nota vive en la conversación) [S-12] | — |
| Cualquier otro tipo | Solo el `label`, la persona y el motivo | Catálogo |

La última fila es la regla general: un tipo nuevo del catálogo **se ve solo**, sin tocar la pestaña. La pestaña descubre los tipos desde `audit_event_type`; no los enumera. La tabla de arriba solo agrega complementos.

Un valor de IA que es crosswalk ID (propiedad, equipo, servicio) se muestra con su nombre del puerto; un valor escalar (beds, unit, fecha), tal cual. Con BzzzBX caído, el nombre se ve `— —` (§7.2).

## 3. Eventos que pide la tarjeta y su tipo de Audit

Todos los tipos citados están en el catálogo `opsrun.audit_event_type`: los de `20261124130000_modelo_de_datos.sql` (sección "audit_event_type", `insert` con `sort_order` 10 a 380) y `job_link_rejected` de `20261125120000_fase_a_enlace.sql` (`sort_order` 85). **Ningún evento que pide la tarjeta falta en el catálogo.** Lo que falta en casi todos es la función que lo escribe.

| Evento de la tarjeta | Tipo de Audit | Quién lo escribe hoy | Tarjeta que lo producirá |
|---|---|---|---|
| Received | `request_received` | Solo la seed | OPR-15 (`ingest_request_email`) |
| Assigned (original operator) | `request_assigned` (el primero) | Solo la seed | OPR-28 (`assign_request`) |
| Reassigned | `request_reassigned` | Nadie | OPR-28 (`assign_request`) |
| Confirmed | `details_confirmed`, `sender_confirmed`, `cleaner_confirmed`, `confirmation_superseded` | Solo la seed | OPR-28 (`confirm_details`, `confirm_sender`, `decide_cleaner_reply`, `confirm_cleaner_by_phone`) |
| (preguntas al cleaner) | `cleaner_asked`, `cleaner_replied`, `cleaner_declined` | Solo la seed | OPR-28 con OPR-17 |
| Scheduled | `request_scheduled` | **`opsrun.link_observed_job`** (Fase A, `mode: "linked"`, en `main`) | OPR-28; en la Fase B, `schedule_request` |
| (enlace rechazado) | `job_link_rejected` | **`opsrun.reject_job_link`** (en `main`) | OPR-28 |
| Rescheduled | `job_rescheduled` ᴿ | Nadie | OPR-29 (`reschedule_job`) |
| (cancelado) | `job_cancelled` ᴿ | Nadie | OPR-29 (`cancel_job`) |
| Check-in | `job_checked_in` (observado) | Solo la seed | `record_observed_event` (OPR-22, con el feed de OPR-9; se usa en OPR-30) |
| (inicio) | `job_started` (observado) | Solo la seed | Igual que check-in |
| Completed | `job_completed` (observado) | Solo la seed | Igual que check-in |
| (End manually) | `job_ended_manually` ᴿ | Solo la seed | OPR-30 (`end_job_manually`) |
| (OSS) | `oss_marked` | Solo la seed | OPR-31 (`mark_oss`) |
| Approved | `job_approved` | Solo la seed | OPR-31 (`approve_job`) |
| (PO) | `po_entered` | Solo la seed | OPR-32 (`enter_po`) |
| Validated | `job_validated` | Nadie | OPR-32 (`validate_job`) |
| Paid | `job_paid` (observado) | Solo la seed | `record_observed_event` (OPR-22, con OPR-10; se usa en OPR-32) |
| Every action with person and reason | `actor_kind`, `actor_operator_id`, `reason` de cada evento; ᴿ = `requires_reason` (guard G12) | — | Cada tarjeta de acción |
| Alerts opened and resolved | `alert_opened`, `alert_level_changed`, `alert_resolved`, `alert_cleared` ᴿ | Solo la seed | OPR-34 (`upsert_alert_occurrence`, con OPR-33); `alert_cleared` en OPR-30 (`clear_alert`) |
| AI suggestions | `ai_analysis_completed`, `ai_analysis_failed` | Solo la seed | OPR-36 (`record_ai_analysis`) |
| Operator corrections | `ai_suggestion_accepted`, `ai_suggestion_corrected`, `ai_suggestion_rejected` | Solo la seed | OPR-28 (al editar o confirmar un campo marcado); OPR-37 para borradores |
| (acción fallida) | `instruction_failed` | Nadie | OPR-23 (`resolve_instruction`) |
| (mensajes) | `email_sent`, `text_sent`, `requester_notified`, `note_added` | Solo la seed (`note_added` no) | OPR-16, OPR-17, OPR-18, OPR-27 |

ᴿ = el tipo exige motivo.

Tres cosas que las tarjetas productoras deben dejar en el `details` para que la pestaña tenga su complemento (no piden migración: `details` es `jsonb`):

- `request_assigned` y `request_reassigned`: `to_operator_id` y, al reasignar, `from_operator_id` (la seed ya usa `to_operator_id`).
- Confirmaciones: `method` (`operator`, `cleaner_text`, `phone`).
- `ai_analysis_completed` y `ai_analysis_failed`: `ai_analysis_id`. `audit_event` no tiene columna para el análisis (OPR-20 §3.11) y sin ese dato la pestaña no sabe cuántas sugerencias trajo.

Si falta, la fila se ve igual, sin el complemento.

## 4. Lo que la demo local muestra ya y lo que llega después

| Ahora (demo del lunes, seed + falso + funciones en `main`) | Después |
|---|---|
| Identificadores (R number, job number) | Work App number confirmado contra el User Guide (P-7) |
| `request_received`, `request_assigned`, `details_confirmed`, `sender_confirmed`, `cleaner_confirmed` de la seed | Los mismos, escritos por OPR-15 y OPR-28 |
| `job_link_rejected` y `request_scheduled` con `mode: "linked"`, escritos en vivo por el operador de "Acting as" | `schedule_request` de la Fase B |
| En R3 a R6 (seed): check-in, inicio, completed, End manually, OSS, Approved, PO, Paid, alertas abiertas y resueltas | Los mismos, escritos por `record_observed_event`, OPR-30 a OPR-32 y OPR-34 |
| Análisis y correcciones de IA: solo en R1, que está en Requests y no tiene pestaña Audit; se prueban en Vitest | En la ventana cuando OPR-36 y OPR-37 escriban y la request llegue a Scheduled |
| — | Reassigned, Rescheduled, Cancelled, Validated, acción fallida, mensajes enviados |

Dos límites de la demo, para decirlos en voz alta:

- Un check-in forzado con `/api/falso` cambia la etapa (OPR-26 A16) pero **no** aparece en Audit: nadie escribe todavía `job_checked_in` en vivo. La pestaña no mezcla eventos leídos del puerto (P-6).
- Para que R7 muestre su historia previa, la seed de R7 (OPR-26 P-3) tiene que traer sus eventos `request_received`, `request_assigned` y las tres confirmaciones; y a R3–R6 les faltan los eventos de sus confirmaciones (P-5).

## 5. Nombres de persona

| `actor_kind` | Se ve | De dónde |
|---|---|---|
| `operator` | `operator.display_name` | `audit_event.actor_operator_id` → `operator` |
| `system` | "opsRUN" | — |
| `ai` | "AI" | — |
| `bzzzbx` | "BzzzBX" | — |

(P-3.) Un operador desactivado sigue saliendo con su nombre: los operadores no se borran (FK `restrict`). Los operadores que aparecen en `details` (`to_operator_id`, `from_operator_id`) se resuelven igual, en la misma consulta.

Mientras no exista el login (OPR-21), las acciones de la demo las firma el operador elegido en "Acting as" (OPR-26 P-2), que la seed enlaza con un `auth_user_id` inventado. Desde OPR-21 es el operador de la sesión. La pestaña no cambia.

## 6. Hora y zona horaria

- Se muestra `occurred_at`: cuándo pasó. Para hechos observados es la hora que da BzzzBX (OPR-20 §3.11). `recorded_at` no se muestra.
- La zona es `OPSRUN_ZONA_HORARIA`, la misma del tablero, leída con `zonaDeLaOperacion` (UTC si falta o no es válida). Llega a la ranura en `PropsRanuraBase.zona`; la pestaña no lee el entorno por su cuenta.
- Formato, en inglés como el resto: "Nov 25, 9:30 AM"; con el año delante si no es el año en curso en esa zona ("Nov 25, 2025, 9:30 AM") [S-5]. Siempre con fecha: el Audit se lee días después y "9:30 AM" solo no basta. Se agrega `horaConFecha` a `src/lib/tablero/formato.ts`, al lado de `horaOFecha`, en vez de duplicar el formato.
- Encima de la lista, "Times in <abreviatura>" (`Intl.DateTimeFormat` con `timeZoneName: "short"` sobre la hora actual).
- La zona final la fija OPR-4; cambiarla es cambiar la variable.

## 7. Qué lee y cómo

### 7.1 De opsRUN: solo lectura, como `opsrun_app`

- Por el pool de `src/lib/db/` (`comoOpsrunApp`), en su transacción `begin read only` por defecto, sin actor y sin `escritura: true`. **Sin service role, sin supabase-js y sin PostgREST** (ADR 0003).
- Una sola consulta parametrizada en `src/lib/audit/consultas.ts`: `audit_event` de la request, con `audit_event_type` (`label`, `source`), `operator` (actor y operadores del `details`), `alert_occurrence`, `ai_suggestion` con `ai_field`, `instruction` con `instruction_type` y `cleaner_confirmation`, todo por `left join`; más la fila de la request (`r_number`, `job_number`). Usa el índice `audit_event_request_idx (request_id, occurred_at)`.
- `opsrun_app` ya tiene `SELECT` en todas esas tablas (`grant select on all tables in schema opsrun to opsrun_app`, migración de OPR-20) y su política de RLS `using (true)`.
- Sin límite de filas en V1.1 beta: un job tiene decenas de eventos, no miles [S-13].

**No hace falta migración (P-1).** No se agrega vista ni función de lectura: todo lo que se lee ya existe y ya es legible por `opsrun_app`. Una vista `opsrun.audit_timeline` pediría migración, `COMMENT` por columna (G9), entraría a G4 y sería un contrato más que mantener, sin dar nada que la consulta parametrizada no dé.

### 7.2 Del puerto de BzzzBX: solo nombres, nunca guardados

Para los complementos de §2.4 que nombran cosas de PINCH (cleaner, job rechazado, valores de IA que son crosswalk IDs), la ranura junta los IDs y los lee de una vez con `obtenerVarios` por entidad, en paralelo, dentro del mismo presupuesto de la ventana (OPR-26 §2). Nada se guarda (principio 1).

Con `bzzzbx.disponible = false`, o si la lectura falla o tarda, la ranura no llama al puerto: los nombres de PINCH se ven `— —` y todo lo de opsRUN (eventos, horas, operadores, motivos) se ve completo. Audit nunca espera a BzzzBX.

### 7.3 Refresco

No hay sondeo propio. El cursor de `/api/tablero/cambios` ya incluye el último `audit_event.id` (`leerMarca`), así que un evento nuevo dispara el `router.refresh()` de la ventana (OPR-26 §8.3) y la ranura se vuelve a pintar en menos de 1 minuto.

## 8. Encaje en la ranura de OPR-26 §7.3

```ts
type PropsRanuraAudit = PropsRanuraBase; // sin cambios
// PropsRanuraBase = { requestId; etapa; bzzzbx: { disponible; actualizadoEn }; zona }
```

OPR-35 **no cambia el contrato**. La ranura es un server component con su propio `Suspense`, que reemplaza el marcador `data-ranura="audit"`:

```
RanuraAudit(props: PropsRanuraAudit)
  → leerAudit(requestId)                       // §7.1, comoOpsrunApp, solo lectura
  → leerNombres(ids, props.bzzzbx.disponible)  // §7.2, opcional
  → armarAudit({ filas, nombres, zona: props.zona, ahora })  // pura, src/lib/audit/armar.ts
  → <VistaAudit vista={…} />                   // presentación, sin datos propios
```

- `requestId`: la request cuyo Audit se lee.
- `etapa`: la ranura solo se monta desde Scheduled; con `"cancelled"` muestra lo mismo (la cancelación es un evento más).
- `bzzzbx.disponible`: decide si se piden nombres al puerto (§7.2).
- `zona`: la de §6.

La ranura conserva `data-ranura="audit"` en su raíz para que el A14 de OPR-26 siga pasando. La lista va en un `<ol>` (orden con significado) con `aria-label="Audit"`; cada hora en un `<time datetime="<ISO UTC>">`.

Archivos: `src/lib/audit/` (consulta, `armarAudit`, tipos, nombres de reglas) y el componente donde OPR-26 deje sus ranuras. Si al implementar la ventana no está en `main`, OPR-35 se construye y prueba contra `armarAudit` y la consulta, y se enchufa cuando llegue.

## 9. Sin Zendesk

La tarjeta pide "No Zendesk references anywhere". Hoy no hay ninguna en el repo. Para que siga así:

- ni etiquetas, ni códigos de catálogo, ni textos de la pestaña, ni `details` mencionan Zendesk ni un id de un sistema de tickets;
- el origen de una request es el buzón compartido (OPR-15) y la pestaña dice solo "Request received", sin el canal ni ids del correo;
- las pruebas de §10 lo comprueban en el catálogo y en la pantalla.

## 10. Pruebas y criterios de aceptación

### 10.1 Vitest (TDD, cada una en rojo primero)

`armarAudit` (pura, sin base ni puerto):

- orden por `occurred_at` y, a igual hora, por `id`, aunque las filas lleguen desordenadas;
- persona por cada `actor_kind` (§5); un operador inactivo sale con su nombre;
- el primer `request_assigned` lleva "Original" y los siguientes no; `request_reassigned` con "from … to …";
- `request_scheduled` con y sin `mode: "linked"`; `job_link_rejected` con y sin nombre del puerto;
- motivo visible cuando existe; ninguna fila muestra `details` en crudo, crosswalk IDs ni uuids (se busca `bx-` y la forma de un uuid en todo el texto armado);
- un tipo que no está en la tabla de §2.4 sale con su `label`, persona y motivo;
- hora: la misma instancia en `UTC` y en `America/New_York`, a ambos lados de un cambio de horario, y el año cuando no es el en curso;
- BzzzBX sin nombres: `— —` en lo de PINCH y el resto completo;
- IA: aceptada, corregida ("3 → 2") y rechazada, con el `label` del campo;
- ningún texto armado contiene "zendesk" (sin distinguir mayúsculas), recorriendo todos los tipos.

Componentes con Testing Library: `<ol aria-label="Audit">`, un `<time datetime>` por fila, "Reason:" solo cuando hay motivo, "Observed" solo en eventos observados.

Integración contra la base con la seed (`OPSRUN_REQUIERE_BASE=1`, corre en CI):

- `leerAudit(R6)` devuelve sus eventos en orden, con nombres de operador, alertas y motivos, como `opsrun_app` y en transacción de solo lectura;
- `leerAudit` de un uuid sin request devuelve lista vacía, sin error;
- `leerAudit` llama a `comoOpsrunApp` sin `escritura` y sin `actor` (espía sobre el pool), así que corre en `begin read only`. La prueba se ve fallar una vez pasándole `escritura: true` (principio 8). Escribir tampoco podría: `opsrun_app` no tiene INSERT (G2).

### 10.2 pgTAP

Sin migración no hay funciones ni grants nuevos que cubrir: G2 (nadie escribe salvo el dueño), G4 (RLS de respaldo) y G8 (Audit inmutable) ya cubren las tablas que se leen. Se agrega una prueba pequeña, `audit_catalogo.test.sql`:

- todo `audit_event_type` tiene `label` no vacío;
- ningún `code` ni `label` del catálogo menciona Zendesk;
- se ve fallar en cada corrida: dentro de la transacción inserta un tipo de prueba con label "Zendesk ticket", comprueba que lo detecta y hace rollback.

### 10.3 Playwright (criterios de aceptación)

Contra el build de producción, la seed y el falso, con `OPSRUN_ZONA_HORARIA=America/New_York` fija en la configuración de Playwright y `OPSRUN_ACTOR_DEMO=1` (OPR-26 P-2).

| # | Criterio | Cómo se prueba |
|---|---|---|
| B1 | **Demo: el enlace queda en Audit con hora y nombre.** | "Acting as" Ops Uno. Se abre R7, se rechaza un candidato y se confirma el bueno. La pestaña Audit aparece; en orden: Request received, Assigned (Original) to su dueño, las tres confirmaciones, Job link rejected (Ops Uno), Scheduled · linked to observed job <job number> (Ops Uno). La hora de los dos últimos es la del reloj del test en Nueva York, ± 1 minuto. |
| B2 | Identificadores. | En EX-00003: "R<n>", Job number "EX-00003" y Work App number "EX-00003". |
| B3 | Historia completa de un job avanzado. | EX-00006 (R6): received, assigned, scheduled, check-in y completed (con "Observed"), OSS, Approved, PO entered, Paid, y la alerta TRN-005 abierta y resuelta "Fixed by action" por Finance Uno, en orden de tiempo. |
| B4 | Motivo visible. | EX-00005 (R5): "Ended manually" con "Reason: Cleaner finished but the app did not sync." y la alerta MEC-003 "Alert cleared" con su motivo y Ops Dos. |
| B5 | BzzzBX caído. | Con `/api/falso` en `no_disponible`, el Audit de EX-00003 se ve completo en lo de opsRUN; el nombre del cleaner y el del job rechazado salen `— —`. |
| B6 | Sin Zendesk ni IDs. | En EX-00003 a EX-00006 y en R7 tras B1, el texto de la pestaña no contiene "zendesk", `bx-` ni un uuid. |
| B7 | Refresco. | Dos contextos del navegador con R7 abierto en la pestaña de la propiedad. En el segundo, "Acting as" Ops Uno confirma el enlace. En menos de 1 minuto y sin recargar, el primero muestra la pestaña Audit con "Scheduled · linked to observed job …" y Ops Uno. |
| B8 | Sin pestaña en Requests. | R2: no hay pestaña Audit (lo mismo que OPR-26 A4; aquí se repite porque B1 depende de ello). |

## 11. Supuestos y preguntas

### 11.1 Supuestos

| # | Supuesto |
|---|---|
| S-1 | **User Guide §10.3 y Release Definition §4.11 no se pudieron leer** (no están en el repo y no hubo acceso). La lista de eventos, los identificadores y la forma de la pestaña salen de la tarjeta, `CONTEXT.md` y el catálogo de OPR-20. |
| S-2 | El prototipo R23 no está disponible (como en OPR-25 y OPR-26): el aspecto se revisa cuando se pueda ver. |
| S-3 | Work App number es el mismo valor que el Job number (`request.job_number`), como dice `CONTEXT.md`. |
| S-4 | Orden: del más viejo al más nuevo, por `occurred_at` y luego `id`. |
| S-5 | Hora con fecha siempre ("Nov 25, 9:30 AM"), año solo si no es el en curso, y "Times in <abreviatura>" encima de la lista. |
| S-6 | La pestaña, que aparece desde Scheduled, muestra también lo que pasó en Requests. |
| S-7 | El operador original es el destino del primer `request_assigned` de la request. |
| S-8 | Los eventos sin `request_id` (alta y baja de operadores) no salen en ningún job. |
| S-9 | Un tipo nuevo del catálogo se ve solo, con su `label`, persona y motivo, sin tocar la pestaña. |
| S-10 | El `reason_text` de una alerta se muestra tal como llegó (es el único `bzzzbx-snapshot`, OPR-20 G9). |
| S-11 | Los nombres de las reglas (OPS-001 Unassigned request, …, Message not delivered) salen de `CONTEXT.md` y viven en código hasta OPR-3 y OPR-33. |
| S-12 | `note_added` se ve sin el texto de la nota, que vive en la conversación (OPR-27). |
| S-13 | Sin paginación: un job no pasa de unas decenas de eventos en V1.1 beta. |

### 11.2 Preguntas para Henry

- **P-1. ¿Migración para leer?** Recomiendo **no**: una consulta parametrizada como `opsrun_app` en solo lectura, sobre tablas que ya puede leer. Una vista `opsrun.audit_timeline` agrega migración, comentarios (G9), un objeto más en G4 y un contrato que mantener, sin ganar nada. Si más adelante Rosie u otra pantalla necesitan la misma lectura, se decide entonces.
- **P-2. Nombres de PINCH en el Audit** (cleaner, job rechazado, valores de IA que son crosswalk IDs). Recomiendo **leerlos del puerto al pintar**, sin guardarlos, con `— —` si BzzzBX no responde. Alternativa: mostrar solo lo de opsRUN (sin nombre de cleaner ni de propiedad), que es más simple pero deja filas como "AI suggestion corrected · Cleaner" sin valor.
- **P-3. Cómo se llama a quien no es un operador.** Recomiendo "opsRUN" (`system`), "AI" (`ai`) y "BzzzBX" (`bzzzbx`), que es el nombre que el operador ya ve en "BzzzBX unavailable". Alternativa: nombrar el sistema de origen (Job Tracker, QuickBooks), que pide que la read layer lo anote en `details`.
- **P-4. Orden.** Recomiendo **del más viejo al más nuevo** ("in time order" de la tarjeta; se lee como la historia de E2E-1, paso a paso). Alternativa: el más nuevo arriba, como un feed.
- **P-5. Seed.** Recomiendo **completar la seed**, sin migración: agregar los eventos `details_confirmed`, `sender_confirmed` y `cleaner_confirmed` de R3 a R6 (hoy tienen las confirmaciones pero no su Audit), y que R7 (OPR-26 P-3) traiga `request_received`, `request_assigned` y sus tres confirmaciones con su Audit. Sin esto, B1 y B3 muestran una historia con huecos. Es un cambio de `supabase/seed.sql` que hay que coordinar con la implementación de OPR-26.
- **P-6. Hechos observados en vivo.** Hoy nadie escribe `job_checked_in`, `job_completed` ni `job_paid` en vivo (falta `record_observed_event`). Recomiendo que **Audit lea solo `audit_event`** y que la demo diga que el check-in forzado no entra a Audit todavía. Alternativa: mezclar en la pestaña lo que el puerto trae (JobTrackerEvent, Payment), que rompe "un solo dueño del registro" y daría dos fuentes para el mismo hecho cuando la read layer empiece a escribirlo.
- **P-7. Work App number.** Recomiendo mostrar **Job number y Work App number con el mismo valor** (S-3) y revisarlo contra el User Guide §10.3 cuando se pueda leer. Si resultan ser números distintos, el segundo es un crosswalk que hoy no existe y pide su columna (con migración) y su dato en el puerto.

Con las recomendaciones, OPR-35 **no trae migración**. P-5 cambia `supabase/seed.sql` (datos inventados) y P-2 solo lee del puerto que ya existe.
