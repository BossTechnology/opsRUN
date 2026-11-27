# OPR-28 — Requests: Assign / Reassign y Confirm details, sender y cleaner

- **Tarjeta:** OPR-28 (P3 · Requests (single job): assign, confirm, schedule). Depende de OPR-15 (intake), OPR-23 (instruction layer), OPR-36 (análisis de IA) y OPR-26 (Job window). De esas, solo OPR-26 está en `main`; esta parte no las necesita (§3).
- **Estado:** spec para revisión. Lo marcado **[S-n]** es un supuesto; lo marcado **P-n** es una pregunta para Henry, con mi recomendación (§12). No hay código ni migración escritos.
- **Construye sobre:** el modelo de datos (`docs/spec/opr-20-modelo-de-datos.md` §3.2, §3.3, §3.4, §3.9 y §4; migración `20261124130000_modelo_de_datos.sql`), el enlace de la Fase A (`docs/spec/fase-a-enlace.md`, migración `20261125120000_fase_a_enlace.sql`), la Job window y su registro de acciones (`docs/spec/opr-26-job-window.md` §5, `src/lib/acciones/`), la conversación (`20261130120000_conversacion.sql`, que usa hasta `OP012`) y Audit (`docs/spec/opr-35-audit.md` §2.4 y §3).
- **Tarjeta en Relevo:** leída (OPR-28, 2026-11-27). De ella salen "Assign to me", "Assigned to for any operator", los campos de Job details, "Confirm / Change" del sender y "confirm on reply or Confirm by phone" del cleaner. **No se pudieron leer** el User Guide cap. 4 ni el Release Definition §4.3 y §4.8 (no están en este repo, que es público), ni el prototipo R23 [S-1].
- **Fuera de alcance:** editar el borrador (Change, la búsqueda de cliente y contacto, cambiar de equipo: la función `update_request_detail` de OPR-20 §4), Ask cleaner y la lectura de la respuesta (OPR-17), Cleaner declined y OPS-020 (P-6), el aviso de "varios jobs" (OPR-36, OPR-37), Schedule de la Fase B (`create_job` y `schedule_request`, OPR-23), el botón "Assign to me" dentro de la pestaña Alerts (OPR-34) y el login (OPR-21).

## 1. Para qué

Hoy nadie puede dar dueño a una request ni confirmar nada desde la interfaz: Assign / Reassign y Confirm details, sender y cleaner salen `sin_construir` en la action bar (OPR-26 P-4), y la única request que se puede enlazar es R7, porque la seed ya trae su dueño y sus tres confirmaciones. Este trabajo entrega esas cuatro acciones para que una request nueva recorra Requests entera en opsRUN:

1. el operador la toma o se la da a otro (**Assign / Reassign**);
2. confirma lo que la request pide (**Confirm details**), de quién viene (**Confirm sender**) y quién la limpia (**Confirm cleaner**, por teléfono o aceptando la respuesta por texto);
3. con dueño y las tres confirmaciones vigentes, el gate de Schedule se cumple y el enlace de la Fase A deja la request Scheduled.

Cada paso queda en Audit en la misma transacción, con persona y método, y las sugerencias de IA de los campos confirmados se cierran como aceptadas o corregidas.

## 2. Principios que aplica

- **Un solo dueño.** Una confirmación guarda solo valores del borrador de opsRUN y crosswalk IDs, calculados por la base a partir de la fila de la request: nunca un nombre, una dirección, un teléfono ni un precio de PINCH (§6).
- **Las IAs proponen, el operador confirma.** Confirmar es siempre de un operador (`require_operator()` y el check `request_confirmation_by_operator`). Una sugerencia abierta se cierra al confirmar el campo; nunca confirma sola.
- **Todo queda en Audit.** Cada función escribe su `audit_event` en la misma transacción. La invalidación de una confirmación también (§5.5).
- **Guards que descubren.** El reparto de las columnas del borrador entre los tres tipos de confirmación se comprueba contra las columnas `:draft` descubiertas en el catálogo, y el guard se ve fallar en cada corrida (§8.2).
- **Ninguna instrucción a BzzzBX.** Las cuatro acciones son decisiones de opsRUN; no crean filas en `opsrun.instruction` y corren con BzzzBX caído (OPR-26 S-13).

## 3. Qué se construye ya y qué espera

| Pieza | Ahora | Espera a |
|---|---|---|
| Assign / Reassign, con "Assign to me" en el panel | Sí | OPR-21 para que "me" sea la sesión y no "Acting as"; OPR-34 para el botón en Alerts |
| Confirm details y Confirm sender | Sí, sobre el borrador que haya | OPR-36 para que la IA llene el borrador; `update_request_detail` para que el operador lo cambie |
| Confirm cleaner por teléfono (`phone`) | Sí | — |
| Confirm cleaner aceptando la respuesta (`cleaner_text`) | La función SQL y la opción del panel, visibles solo si hay una respuesta `replied` | OPR-17 para que lleguen respuestas de verdad |
| Invalidación de confirmaciones cuando cambia el borrador | Sí, por trigger (§5.5) | Que alguien cambie el borrador (OPR-36, `update_request_detail`) para verla en la interfaz |
| Gate de Schedule y enlace | Ya en `main`; no cambia | — |

## 4. Las acciones

Todas son de la etapa **Requests** (`request.status = 'open'`), como dice el registro de OPR-26 §5.3. En Scheduled y después no aplican: la request ya tiene su job y el borrador está congelado (G11) [S-2]. Todas tienen `necesitaBzzzbx: false` y `concurrencia: "request"` (§7).

**Quién puede:** cualquier operador activo, en las cuatro (P-2). En V1.1 beta todos los operadores son iguales (propuesta de OPR-2); si OPR-2 decide permisos por rol, se agrega el chequeo en las funciones (OPR-20 §3.1) sin cambiar este contrato. **Depende de OPR-2.**

### 4.1 Assign / Reassign

| Tema | Regla |
|---|---|
| Panel | Lista de los operadores activos con su barra de carga (la de OPR-26 §3), sin el dueño actual; arriba, **Assign to me** (el actor de la transacción). Reason **opcional** (P-1). `Go` deshabilitado hasta elegir un operador. |
| Sin dueño (Unassigned) | Es **Assign**: escribe `request_assigned` con `details = {"to_operator_id": …}`. El primero de la request es el que Audit marca **Original** (OPR-35 S-7). |
| Con dueño | Es **Reassign**: escribe `request_reassigned` con `details = {"from_operator_id": …, "to_operator_id": …}`. Audit lo muestra "from X to Y" y la fila Original sigue siendo la primera asignación. |
| Mismo dueño | Error `OP015`; el panel no lo ofrece. |
| Operador inexistente o inactivo | Error `OP014`. |
| Quitar el dueño | No existe en V1.1 beta (P-8). La función exige un operador. |
| Confirmaciones | **Reasignar no invalida ninguna**: las confirmaciones son sobre el borrador, no sobre el dueño. |
| Alerta OPS-001 | La cierra BzzzBX (Signal Maker) cuando ve el dueño por el write-back; opsRUN no la toca [S-3]. |

El nombre visible es "Assign / Reassign" hasta OPR-4 (OPR-26 P-5). **Depende de OPR-4.**

### 4.2 Confirm details

| Tema | Regla |
|---|---|
| Qué confirma | Job details: propiedad, espacio, unidad, camas, servicio, fecha, ventana, notas de acceso y PO (las columnas `details` de §5.1). |
| Panel | Muestra el valor actual de cada campo, con los nombres que la ventana ya leyó de BzzzBX, y la marca **AI** en los que tengan una sugerencia abierta. Sin Reason. No pide valor: confirma lo que se ve (§6). |
| Exige | Propiedad, servicio, fecha y ventana (P-3). Si falta alguno, la acción queda `bloqueada` con "Complete the details first: <campos>", y la función responde `OP016` si se llega de todos modos. |
| IA | Cierra las sugerencias `rank = 1` sin decidir de los campos de detalle (§5.4). |
| Audit | `details_confirmed` con `details = {"method": "operator", "confirmation_id": …}`, y un `ai_suggestion_accepted` o `ai_suggestion_corrected` por cada sugerencia cerrada. |

### 4.3 Confirm sender

| Tema | Regla |
|---|---|
| Qué confirma | Who is it from?: el cliente y el representante (`bzzzbx_customer_id`, `bzzzbx_contact_id`). |
| Panel | Cliente y representante con sus nombres leídos de BzzzBX, con la marca AI y el motivo de la sugerencia `sender` si está abierta. "Change" (buscar otro cliente o contacto) es de `update_request_detail`, fuera de alcance. |
| Exige | El cliente. El representante es opcional [S-4]. Sin cliente, `bloqueada` con "Choose who it is from first" (el mismo texto que ya usa Schedule); la función responde `OP016`. |
| IA | Cierra la sugerencia `sender` abierta. |
| Audit | `sender_confirmed` con `{"method": "operator", "confirmation_id": …}`. |

### 4.4 Confirm cleaner

| Tema | Regla |
|---|---|
| Qué confirma | El equipo del borrador (`bzzzbx_team_id`) para la fecha y ventana del borrador. |
| Panel | El equipo con su nombre y un método obligatorio: **Confirm by phone** (`phone`) o, si existe, **Cleaner replied yes** (`cleaner_text`), que muestra la respuesta y la lectura de la IA. Reason **opcional**, para anotar la llamada (P-6). No se guarda el teléfono ni el texto de la llamada. |
| Exige | Un equipo en el borrador; sin él, `bloqueada` con "Choose a cleaner first" (`OP016`). |
| `cleaner_text` | Exige una `cleaner_confirmation` de la request, `purpose = 'initial'`, `status = 'replied'` y el mismo `bzzzbx_team_id` del borrador; si no, `OP018`. La pasa a `confirmed` con `decided_by` y `decided_at`, y la enlaza en `request_confirmation.cleaner_confirmation_id`. Cierra como `accepted` su sugerencia `cleaner_reply` abierta [S-5]. |
| `phone` | Si hay una pregunta abierta (`asked` o `replied`, `initial`) al **mismo** equipo, la pasa a `confirmed` y la enlaza: el cleaner contestó por teléfono y sale de Waiting. Si es a **otro** equipo, la pasa a `withdrawn` (P-9). |
| `operator` | No se acepta para el cleaner (`22023`): la tarjeta dice "confirm on reply or Confirm by phone" (P-6). |
| IA | Cierra la sugerencia `cleaner_team` `rank = 1` abierta. Las alternativas (`rank > 1`) se quedan sin decidir; no marcan el campo (OPR-20 §3.9). |
| Audit | `cleaner_confirmed` con `{"method": "phone" | "cleaner_text", "confirmation_id": …}` y, con `cleaner_text`, `cleaner_confirmation_id` en su columna. Audit lo muestra "· by phone" o "· by text" (OPR-35 §2.4). |
| Declined | "Choose another team if declined" (OPS-020) es de OPR-17: hace falta la respuesta "no" y cambiar el equipo del borrador (P-6). |

### 4.5 Una confirmación que ya existe

Si ya hay una confirmación vigente del mismo tipo, la acción queda `bloqueada` con "Already confirmed" y la función responde `OP017` (dos operadores a la vez, o una pestaña vieja) (P-11). Para volver a confirmar, primero tiene que cambiar el borrador, que invalida la anterior (§5.5).

## 5. Reglas de datos

### 5.1 Qué columnas del borrador son de cada confirmación

Un helper `opsrun_private.draft_fields(p_kind opsrun.confirmation_kind) returns text[]` es el único lugar donde se reparte el borrador (P-4):

| Tipo | Columnas que guarda en `confirmed_value` | Columnas que la invalidan al cambiar |
|---|---|---|
| `details` | `bzzzbx_property_id`, `bzzzbx_space_id`, `unit`, `beds`, `bzzzbx_service_id`, `service_date`, `window_start`, `window_end`, `access_notes`, `po_number` | Las mismas |
| `sender` | `bzzzbx_customer_id`, `bzzzbx_contact_id` | Las mismas |
| `cleaner` | `bzzzbx_team_id`, `service_date`, `window_start`, `window_end` | `bzzzbx_team_id`, `service_date`, `window_start`, `window_end`, `bzzzbx_property_id` |

El cleaner guarda la fecha y la ventana porque confirmó **ese** día; si cambian, ya no se sabe si puede. Un cambio de propiedad también lo invalida (es otro trabajo), aunque la propiedad no viaje en su valor. Un helper hermano, `opsrun_private.draft_invalidating_fields(kind)`, da la columna derecha.

Toda columna `:draft` de `opsrun.request` tiene que estar en al menos un tipo, y ningún tipo puede nombrar una columna que no sea `:draft`. Lo comprueba G13 (§8.2), descubriendo las columnas por su `COMMENT`, igual que G11.

### 5.2 El valor confirmado

`opsrun_private.draft_value(p_request opsrun.request, p_kind) returns jsonb` arma `confirmed_value` con `jsonb_build_object` de las columnas de `draft_fields(kind)`, **incluidas las nulas** (un `null` confirmado también es un dato: "sin espacio"). Lo calcula la base desde la fila bloqueada; el navegador no manda ningún valor. Ejemplo para `sender`: `{"bzzzbx_customer_id": "bx-cust-0008", "bzzzbx_contact_id": null}`.

Las filas de la seed con `confirmed_value = '{}'` (R3 a R7) o parciales (R2) son fixtures anteriores y no se migran [S-6].

### 5.3 Bloqueo y versión

Cada función:

1. `opsrun_private.require_operator()`;
2. `select … from opsrun.request where id = p_request_id for update` (`OP006` si no existe, `OP007` si no está `open`);
3. compara `p_version` con `request.change_seq` y responde `OP013` si no coinciden (P-10). `ejecutarAccion` ya lo comprueba antes (§7), pero entre esa lectura y la transacción puede cambiar el borrador; con el `for update` la base confirma exactamente la fila que vio el operador.

Un efecto aceptado: Assign cambia `change_seq` (toca `request`), así que una confirmación pedida con la ventana de antes de una reasignación se rechaza con "This job changed. Review and try again." aunque el borrador no cambió [S-7]. Las confirmaciones no tocan `request` y no cambian su `change_seq`.

### 5.4 Sugerencias de IA al confirmar

Para cada `ai_suggestion` de la request con `rank = 1`, `decision is null` y `field` en los campos de IA del tipo:

| Tipo | Campos de IA (`ai_field.code`) |
|---|---|
| `details` | `property`, `space`, `unit`, `beds`, `service`, `service_date`, `time_window`, `access_notes`, `po_number` |
| `sender` | `sender` |
| `cleaner` | `cleaner_team` (y `cleaner_reply` con `cleaner_text`, §4.4) |

- si el valor del borrador es igual a `value`, se cierra `accepted`;
- si es distinto (alguien lo cambió por un camino que no cerró la sugerencia), se cierra `corrected` con `final_value` = el valor del borrador;
- en los dos casos con `decided_by` = el operador y `decided_at = now()`, y su evento `ai_suggestion_accepted` o `ai_suggestion_corrected` con `ai_suggestion_id`.

La forma de `value` de cada campo (escalar, crosswalk ID, `{start, end}` para `time_window`) la fija OPR-36; mientras tanto la comparación es por `jsonb` con la misma forma que usa la seed [S-8]. El reparto de campos de IA vive en otro helper, `opsrun_private.ai_fields_of(kind)`, y G13 comprueba que todo `ai_field` que sea de borrador (todos menos `multiple_jobs`, `cleaner_reply` y `draft_*`) esté en un tipo.

### 5.5 Qué invalida una confirmación

Un trigger nuevo `request_confirmation_supersede`, `after update on opsrun.request for each row when (old.status = 'open')`, sin lista de columnas en la cabecera: para cada tipo compara `draft_invalidating_fields(kind)` entre `old` y `new` (`to_jsonb`), y si alguna cambió y hay confirmación vigente de ese tipo:

- pone `superseded_at = now()` (la fila queda en la tabla y en el write-back, ya no cuenta para el gate);
- escribe `confirmation_superseded` con `details = {"kind": …, "confirmation_id": …, "fields": [columnas que cambiaron]}` y el actor de la transacción: el operador si lo hay (`current_operator_id()`), si no `system` (un proceso como la intake o la IA). Sin ninguno de los dos, el trigger no escribe Audit con un actor inventado: lanza `42501`, porque un cambio del borrador sin actor no debería existir (P-5). Solo lo lanza cuando hay algo que invalidar: un UPDATE que no toca esas columnas (por ejemplo el paso a `scheduled` de los fixtures de G11) o una request sin confirmaciones vigentes no hace nada.

Lo que **no** invalida: reasignar, notas, mensajes, rechazar un candidato, cambiar una alternativa de IA, y cualquier cambio con la request ya `scheduled` (el borrador está congelado, OP003). Invalidar el tipo `details` no invalida `sender` ni al revés, salvo las columnas compartidas de §5.1.

Con una confirmación invalidada el gate vuelve a estar incompleto: la ranura del enlace dice qué falta y `link_observed_job` responde `OP005`, sin cambios en esas piezas.

## 6. Qué guarda opsRUN y qué no

| Guarda (opsRUN) | No guarda (es de PINCH, se lee de BzzzBX) |
|---|---|
| `request.owner_operator_id` y el evento con `from_operator_id` / `to_operator_id` | — |
| `request_confirmation`: tipo, método, `confirmed_value` (valores del borrador y crosswalk IDs), quién, cuándo, `superseded_at` | Nombre y dirección de la propiedad, nombre del cliente y del contacto, nombre y teléfono del equipo, precio |
| `cleaner_confirmation.status`, `decided_by`, `decided_at` | El texto de la respuesta del cleaner (vive en BzzzBX; opsRUN guarda su `reply_bzzzbx_message_id`) |
| `ai_suggestion.decision`, `final_value` | — |
| El motivo opcional (Audit `reason`) | El número al que se llamó, la hora de la llamada fuera de Audit |

El panel muestra nombres leídos de BzzzBX (la ventana ya los trae, OPR-26 §8.2), pero lo que viaja a la base son solo el id de la request, el operador destino, el método, el id de la respuesta y la versión. Nada que el navegador escriba se guarda como valor confirmado.

## 7. Encaje con `ejecutarAccion`

Las cuatro entradas ya existen en `REGISTRO_DE_ACCIONES` (`assign`, `confirm_details`, `confirm_sender`, `confirm_cleaner`). Esta tarjeta les agrega:

| Código | `motivo` | `bloqueo(v)` (en este orden) | `panel` | `datos` | Función SQL |
|---|---|---|---|---|---|
| `assign` | `"opcional"` (P-1; hoy `"no"`) | — | lista de operadores + Assign to me | `{ operator_id }` | `assign_request` |
| `confirm_details` | `"no"` | "Already confirmed"; "Complete the details first: …" | resumen de campos con marca AI | `{}` | `confirm_details` |
| `confirm_sender` | `"no"` | "Already confirmed"; "Choose who it is from first" | cliente y contacto con marca AI | `{}` | `confirm_sender` |
| `confirm_cleaner` | `"opcional"` (P-6; hoy `"no"`) | "Already confirmed"; "Choose a cleaner first" | equipo + método | `{ method, cleaner_confirmation_id? }` | `confirm_cleaner` |

- **Disponibilidad:** `necesitaBzzzbx: false` en las cuatro, así que con BzzzBX caído siguen `disponible` (OPR-26 S-13); el panel muestra lo último leído o `— —` en los nombres [S-9]. Una instrucción abierta no las bloquea (no son instrucciones).
- **Datos de la ventana:** `VentanaJob.datos` gana `faltanDetalles: string[]`, `tieneCliente: boolean`, `tieneEquipo: boolean` y `respuestaDelCleaner: { id: string; equipoId: string } | null`, que arma `armarVentana` con lo que ya lee (§8.1 de OPR-26 más la `cleaner_confirmation` abierta). Los bloqueos usan `v.gate` para "Already confirmed". Sin migración.
- **Concurrencia:** `concurrencia: "request"` (por defecto). `ejecutarAccion` compara `entrada.version` con `ventana.version` (`change_seq`), y el ejecutor pasa esa misma versión a la función SQL como `p_version` (§5.3).
- **Ejecutores:** módulo nuevo `src/lib/acciones/requests.ts` (`crearEjecutoresDeRequests`, mismo patrón que `enlace.ts`: dependencias cargadas al correr), con las llamadas SQL en `src/lib/requests/datos-sql.ts` como `opsrun_app`, `escritura: true` y el actor de la transacción. Devuelven `{ tipo: "guardada" }`. Los SQLSTATE se traducen por código, como `src/lib/fase-a/datos-sql.ts`:

| SQLSTATE | `codigo` | Mensaje |
|---|---|---|
| `OP006` | `request_no_encontrada` | "Job not found." |
| `OP007` | `request_no_abierta` | "This request is not open anymore." |
| `OP013` | `cambio_concurrente` | "This job changed. Review and try again." |
| `OP014` | `operador_invalido` | "That operator is not active." |
| `OP015` | `ya_es_dueno` | "That operator already owns this request." |
| `OP016` | `faltan_datos` | El texto del bloqueo correspondiente |
| `OP017` | `ya_confirmada` | "Already confirmed." |
| `OP018` | `respuesta_invalida` | "That reply can't confirm this cleaner." |
| `42501` | — | Sube: `ejecutarAccion` lo registra y muestra "Something went wrong. Try again." |

- **Refresco:** `ejecutarAccion` pide el refresco; el cursor de `/api/tablero/cambios` ya incluye el último `audit_event.id`, así que las otras ventanas abiertas y el tablero (Assigned to, filtro de operador) lo ven en menos de 1 minuto.
- **Gate del enlace:** no cambia nada. `v.gate` ya sale de las confirmaciones vigentes y del dueño (OPR-26 §8.1); la ranura del enlace habilita Confirm cuando las cuatro partes están, y `link_observed_job` sigue exigiéndolas con el trigger `request_schedule_gate` (`OP005`). El bloqueo de `schedule` ("Confirm who it is from first") se queda.
- **Tarjeta del tablero:** "Assigned to" y el color salen de `request.owner_operator_id`, que el tablero ya lee.

## 8. Migración nueva (pide OK, P-0)

`supabase/migrations/2026120112xxxx_requests_assign_confirm.sql`, solo hacia adelante, como `opsrun_migrador`, después de `20261130120000_conversacion.sql`.

**No cambia tablas, tipos, catálogos ni vistas `v1_*`.** Todo lo que guarda ya tiene columna: `request.owner_operator_id`, `request_confirmation`, `cleaner_confirmation.status`/`decided_*`, `ai_suggestion.decision`/`final_value`, y los tipos de Audit `request_assigned`, `request_reassigned`, `*_confirmed`, `confirmation_superseded` y `ai_suggestion_*` ya están en el catálogo. El write-back ya expone esas tablas. Agrega solo funciones y un trigger.

### 8.1 Funciones

Del operador, en `opsrun`, `security definer`, dueño `opsrun_migrador`, `set search_path = ''`, cada una llama a `opsrun_private.require_operator()` en su propio cuerpo (G6 lo busca en `prosrc`), `revoke all … from public` y `grant execute … to opsrun_app` y a nadie más:

```sql
opsrun.assign_request(
  p_request_id uuid,
  p_operator_id uuid,
  p_version bigint,
  p_reason text default null
) returns void

opsrun.confirm_details(p_request_id uuid, p_version bigint) returns uuid   -- id de la confirmación

opsrun.confirm_sender(p_request_id uuid, p_version bigint) returns uuid

opsrun.confirm_cleaner(
  p_request_id uuid,
  p_method opsrun.confirmation_method,      -- 'phone' | 'cleaner_text'
  p_version bigint,
  p_cleaner_confirmation_id uuid default null,  -- obligatorio con cleaner_text
  p_reason text default null
) returns uuid
```

`confirm_cleaner` reemplaza a `decide_cleaner_reply` y `confirm_cleaner_by_phone` de OPR-20 §4: la action bar tiene una sola acción con dos métodos (P-6). `update_request_detail`, `ask_cleaner` y `schedule_request` siguen pendientes.

Privados, en `opsrun_private` (sin EXECUTE para nadie, G7; los llaman las funciones de arriba y el trigger, que corren como `opsrun_migrador`):

| Helper | Qué hace |
|---|---|
| `draft_fields(kind) returns text[]` | Columnas del valor confirmado (§5.1). `immutable`. |
| `draft_invalidating_fields(kind) returns text[]` | Columnas que invalidan (§5.1). `immutable`. |
| `ai_fields_of(kind) returns text[]` | Campos de IA del tipo (§5.4). `immutable`. |
| `draft_value(opsrun.request, kind) returns jsonb` | El `confirmed_value` (§5.2). |
| `lock_open_request(p_request_id uuid, p_version bigint) returns opsrun.request` | Pasos 2 y 3 de §5.3 (`OP006`, `OP007`, `OP013`). |
| `confirm_request(p_request opsrun.request, p_kind, p_method, p_operator_id uuid, p_cleaner_confirmation_id uuid, p_reason text) returns uuid` | Lo común de las tres confirmaciones: `OP017`, el insert en `request_confirmation`, el cierre de sugerencias (§5.4) y los `audit_event`. |
| `supersede_confirmations() returns trigger` | El trigger de §5.5. |

Las tres `confirm_*` comprueban primero sus datos obligatorios (`OP016`) y `confirm_cleaner` su método y su respuesta (`22023`, `OP018`); después llaman a `confirm_request`. Todo en la transacción de la llamada: si falla cualquier paso, no queda ni la confirmación ni su Audit.

### 8.2 Trigger

```sql
create trigger request_confirmation_supersede
  after update on opsrun.request
  for each row when (old.status = 'open')
  execute function opsrun_private.supersede_confirmations();
```

Corre como quien escribe, como los demás triggers de OPR-20 §6; no necesita `security definer`.

### 8.3 Códigos de error

Siguen a `OP012` (conversación). Se documentan en la cabecera de la migración, como en `20261130120000_conversacion.sql`:

| Código | Cuándo | Lo lanza |
|---|---|---|
| `OP006` | La request no existe (reutilizado) | todas |
| `OP007` | La request no está `open` (reutilizado) | todas |
| `OP013` | `p_version` no es el `change_seq` actual | todas |
| `OP014` | El operador destino no existe o está inactivo | `assign_request` |
| `OP015` | El operador destino ya es el dueño | `assign_request` |
| `OP016` | Falta un dato obligatorio del borrador; el mensaje dice cuáles | `confirm_*` |
| `OP017` | Ya hay una confirmación vigente de ese tipo | `confirm_*` (también lo atrapa el índice único `request_confirmation_current_key` en una carrera, `23505`, que el servidor traduce igual) |
| `OP018` | La respuesta del cleaner no es de la request, no es `initial`, no está `replied` o es de otro equipo | `confirm_cleaner` |
| `22023` | Argumento inválido: `p_operator_id` nulo, método `operator` o `cleaner_text` sin respuesta | `assign_request`, `confirm_cleaner` |
| `42501` | Sin operador, con operador y sistema a la vez (de `require_operator()`), o cambio del borrador sin actor (trigger) | todas, trigger |

## 9. Pruebas y criterios de aceptación

### 9.1 pgTAP (`supabase test db`)

Archivo nuevo `requests_assign_confirm.test.sql`, con fixtures propios dentro de la transacción (no depende de la seed):

- sin actor, con actor de sistema y con los dos a la vez, las cuatro funciones fallan con `42501` y no escriben nada. **Se ve en rojo una vez** quitando `require_operator()` de `assign_request` en local, además de G6, que ya descubre las funciones nuevas y se ve fallar en cada corrida;
- G5, G6 y G7 (`guard_funciones.test.sql`, `guard_ajenos.test.sql`) cubren las funciones y helpers nuevos sin tocarlos;
- `assign_request`: el primero escribe `request_assigned` con `to_operator_id`; el segundo, `request_reassigned` con `from` y `to`; mismo dueño → `OP015`; inactivo → `OP014`; request `scheduled` → `OP007`; versión vieja → `OP013`; reasignar no toca `request_confirmation`;
- `confirm_details` y `confirm_sender`: sin datos obligatorios → `OP016`; con datos, una fila vigente con `confirmed_value` igual a `draft_value`, su evento con `method` y `confirmation_id`; la segunda vez → `OP017`;
- `confirmed_value` de toda confirmación que escriben las funciones solo tiene claves que son columnas `:draft` de `opsrun.request` (descubiertas por `COMMENT`);
- IA: una sugerencia abierta igual al borrador se cierra `accepted`; una distinta, `corrected` con `final_value`; una `rank = 2` queda abierta; cada cierre deja su evento;
- `confirm_cleaner`: `phone` cierra la pregunta abierta del mismo equipo como `confirmed` y retira la de otro equipo; `cleaner_text` con una respuesta `replied` correcta la pasa a `confirmed` y la enlaza; con otro equipo, otra request o `asked` → `OP018`; método `operator` → `22023`;
- trigger: cambiar `service_date` de una request `open` invalida `details` y `cleaner` pero no `sender`, con un `confirmation_superseded` por tipo y su lista de columnas; cambiar `owner_operator_id` no invalida nada; después de invalidar, `link_observed_job` responde `OP005`;
- el flujo completo en SQL: request nueva → `assign_request` → tres `confirm_*` → `link_observed_job` deja `scheduled`.

**Guard nuevo G13** (`guard_borrador.test.sql`, junto a G11): toda columna `:draft` de `opsrun.request` está en `draft_fields` de algún tipo, y ninguna columna de `draft_fields` ni de `draft_invalidating_fields` deja de ser `:draft`; todo `ai_field` de borrador está en `ai_fields_of` de algún tipo. **Se ve fallar en cada corrida:** dentro de la transacción agrega a `opsrun.request` una columna de prueba con `COMMENT 'opsrun:draft · prueba'`, comprueba que el guard la detecta y hace rollback.

### 9.2 Vitest (TDD, cada una en rojo primero)

- `disponibilidadDe` para las cuatro: cada bloqueo de §7 en su orden, `disponible` con BzzzBX caído, `no_aplica` fuera de Requests.
- `armarVentana`: `faltanDetalles`, `tieneCliente`, `tieneEquipo` y `respuestaDelCleaner` desde filas de prueba.
- `crearEjecutoresDeRequests`: arma la llamada con la versión y el actor; cada SQLSTATE de §7 sale como su `rechazada`; `datos` sin `operator_id` o con un método desconocido se rechaza **sin llamar a la base**; `42501` sube.
- Componentes (Testing Library): el panel de Assign no ofrece al dueño actual, Assign to me elige al actor, `Go` deshabilitado sin operador; el de Confirm cleaner no ofrece "Cleaner replied yes" sin respuesta y exige un método; los paneles de confirmar muestran la marca AI en los campos abiertos.
- Integración contra la base con la seed (`OPSRUN_REQUIERE_BASE=1`, en CI, dentro de una transacción que se deshace): asignar y confirmar R8 de punta a punta.

### 9.3 Playwright (criterios de aceptación)

Contra el build de producción, la seed y el falso, con `OPSRUN_ACTOR_DEMO=1` y `OPSRUN_ZONA_HORARIA=America/New_York`. Va en un proyecto aparte que corre después del resto, como `audit.spec.ts`, porque enlaza R8 una sola vez por base (P-7).

| # | Criterio | Cómo se prueba |
|---|---|---|
| D1 | **R nueva → asignar → 3 confirmaciones → enlazar.** | "Acting as" Ops Uno. Se abre R8 (Unassigned, abre en Alerts por OPS-001). Assign / Reassign → Assign to me: el encabezado dice Ops Uno. Reassign a Ops Dos. Confirm details, Confirm sender, Confirm cleaner → Confirm by phone. La ranura del enlace pasa de "Owner, Details, Sender, Cleaner" a ningún faltante; se confirma `bx-job-0108`. La request queda Scheduled y Audit muestra, en orden: Request received, Assigned (Original) to Ops Uno, Reassigned from Ops Uno to Ops Dos, Details confirmed, Sender confirmed, Cleaner confirmed · by phone, Scheduled · linked to observed job EX-00108, todos con Ops Uno como persona. |
| D2 | Bloqueos visibles. | En R1: Confirm details en gris con "Complete the details first: …", Confirm sender con "Choose who it is from first", Confirm cleaner con "Choose a cleaner first". En R2: Confirm details y Confirm sender con "Already confirmed". |
| D3 | Cambio concurrente. | Dos contextos con R8 abierta antes de D1 (o una R de prueba). En el segundo se asigna; en el primero, Confirm details responde "This job changed. Review and try again." y no aparece `details_confirmed` en Audit. |
| D4 | No corre forzando el `disabled`. | En R2, se quita el `disabled` de Confirm details y se pulsa Go: el panel dice "Already confirmed" y el cursor de `/api/tablero/cambios` no cambia. |
| D5 | BzzzBX caído. | Con `/api/falso` en `no_disponible`, Assign sigue disponible y asigna R8; el encabezado lo muestra. |

D1 es la parte de request de E2E-1 que se puede probar en local. E2E-1, E2E-2, E2E-8 y E2E-10 completos (Hecho cuando de la tarjeta) siguen en staging y dependen de OPR-15, OPR-17, OPR-23 y OPR-36.

## 10. Cambios fuera de la base

- `supabase/seed.sql` (P-7): **R8** en Requests, sin dueño, con el borrador completo (cliente, contacto, propiedad, servicio, fecha, ventana y equipo inventados), sin confirmaciones, con su correo original, `request_received` y una sugerencia de IA abierta `property` igual al borrador. Al final del archivo, para no mover los `id` de los eventos que ya están.
- `src/lib/bzzzbx/falso/datos.ts`: `bx-job-0108` / `EX-00108` que encaja con R8, y una alerta OPS-001 abierta para R8. No cambian los IDs que la seed y el falso ya comparten.
- `CONTEXT.md`: agregar "Superseded" (confirmación que dejó de valer porque cambió el borrador) y "Assign to me".

## 11. Supuestos

| # | Supuesto |
|---|---|
| S-1 | El User Guide cap. 4, el Release Definition §4.3 y §4.8 y el prototipo R23 no se pudieron leer. Los textos del panel y los bloqueos salen de la tarjeta, del registro de OPR-26 y del glosario, y se revisan contra esos documentos. |
| S-2 | Assign / Reassign es solo de Requests, como dice el registro de OPR-26 §5.3. Cambiar el dueño de un job Scheduled no entra en V1.1 beta. |
| S-3 | OPS-001 la resuelve BzzzBX al ver el dueño por el write-back; Assign no resuelve la alerta en opsRUN. |
| S-4 | Confirm sender exige el cliente; el representante es opcional. |
| S-5 | Con `cleaner_text`, la lectura de la IA (`cleaner_reply`) se cierra `accepted`. Si OPR-17 define que una lectura "no" confirmada a mano es `corrected`, se ajusta en esa tarjeta. |
| S-6 | Las confirmaciones de la seed con `confirmed_value` vacío o parcial se quedan como están. |
| S-7 | Un rechazo por `cambio_concurrente` tras una reasignación es aceptable aunque el borrador no haya cambiado. |
| S-8 | La forma de `ai_suggestion.value` es la de la seed hasta que OPR-36 la fije. |
| S-9 | Con BzzzBX caído se puede confirmar viendo lo último leído o `— —` en los nombres, como cualquier acción que solo escribe en opsRUN (OPR-26 S-13). |
| S-10 | La pestaña de la propiedad marca cada sección como confirmada o no con `v.gate`; el detalle visual se revisa contra R23. |

## 12. Preguntas para Henry

- **P-0. Migración.** §8 agrega cuatro funciones del operador, siete helpers privados y un trigger, sin cambiar tablas, tipos, catálogos ni vistas. Sin ella no hay cómo escribir dueño ni confirmaciones. **Recomiendo sí.**
- **P-1. Motivo en Assign / Reassign.** El catálogo no lo exige y el registro dice `"no"`. **Recomiendo opcional:** sirve para decir por qué se pasa una request a otro sin frenar la asignación normal. Alternativa: sin motivo, como hoy.
- **P-2. Quién asigna y confirma.** **Recomiendo cualquier operador activo** en las cuatro, con Audit diciendo quién. Alternativa: solo el dueño confirma, que obliga a asignar antes y choca con "Assigned to for any operator". **Depende de OPR-2.**
- **P-3. Campos obligatorios de Confirm details.** **Recomiendo propiedad, servicio, fecha y ventana**; espacio, unidad, camas, notas y PO opcionales. El PO obligatorio por cliente es de OPR-8 y Validate, no de aquí. Alternativa: exigir todo lo que la tarjeta lista, que frena requests sin unidad o sin PO.
- **P-4. Qué invalida cada confirmación.** **Recomiendo la tabla de §5.1:** cada tipo por sus columnas, y el cleaner además por fecha, ventana y propiedad. Alternativa: cualquier cambio del borrador invalida las tres, más simple pero obliga a reconfirmar el sender por un cambio de hora.
- **P-5. Invalidar por trigger o en cada función.** **Recomiendo trigger:** el borrador lo van a cambiar varias funciones (`update_request_detail`, la IA de OPR-36) y así ninguna se olvida, con G13 comprobando el reparto. Alternativa: cada función que escribe el borrador invalida por su cuenta.
- **P-6. Confirm cleaner.** **Recomiendo una sola función `confirm_cleaner` con dos métodos (`phone` y `cleaner_text`), sin `operator`, con motivo opcional**, en vez de `decide_cleaner_reply` y `confirm_cleaner_by_phone` de OPR-20 §4. Declined (OPS-020) y "choose another team" quedan para OPR-17, que trae las respuestas. Alternativa: las dos funciones de OPR-20, con decline incluido ahora sobre datos de la seed.
- **P-7. R8 en la seed.** Ninguna request de la seed sirve para el flujo nuevo (R1 no tiene cliente ni servicio, R2 es el ejemplo de Waiting, R7 ya está confirmada). **Recomiendo agregar R8** y `bx-job-0108` (§10). Alternativa: usar R7 quitándole su dueño y sus confirmaciones, que rompe la demo y B1 de Audit.
- **P-8. Quitar el dueño.** **Recomiendo que no exista en V1.1 beta**: la tarjeta no lo pide y volvería a abrir OPS-001. Alternativa: `p_operator_id` nulo devuelve la request a Unassigned con un evento propio.
- **P-9. Confirm by phone con una pregunta por texto abierta.** **Recomiendo** cerrarla como `confirmed` si es al mismo equipo (sale de Waiting) y `withdrawn` si es a otro. Alternativa: dejarla abierta, que deja en Waiting algo ya resuelto.
- **P-10. Versión dentro de la función.** **Recomiendo pasar `p_version` y compararla con la fila bloqueada** (`OP013`), porque el valor confirmado se calcula de esa fila. Alternativa: confiar solo en el chequeo de `ejecutarAccion`, como `link_observed_job`, con una ventana chica de carrera.
- **P-11. Volver a confirmar.** **Recomiendo "Already confirmed"** (`bloqueada` y `OP017`); para reconfirmar tiene que cambiar el borrador. Alternativa: reconfirmar invalida la anterior y crea otra, que deja más filas sin decir nada nuevo.
