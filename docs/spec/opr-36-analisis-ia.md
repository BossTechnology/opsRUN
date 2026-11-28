# OPR-36 — Análisis de la request por IA, por adelantado y con fallback

- **Tarjeta:** OPR-36 (P5 · AI request analysis through BzzzBX, ahead of time, with fallback). Depende de OPR-11 (credenciales y límites del servicio de Claude en el servidor de BzzzBX), OPR-6 (contrato de BzzzBX, incluida la ruta de IA) y OPR-15 (entrada de correo). De esas, solo OPR-15 está en `main`; OPR-11 y OPR-6 son externas y están pendientes.
- **Estado:** borrador para revisión de Henry. No hay código ni migración escritos. Lo marcado **[S-n]** es un supuesto; lo marcado **P-n** es una pregunta para Henry, con mi recomendación primero (§18).
- **Construye sobre:** el modelo de datos (spec OPR-20 §3.9 y §4: `ai_analysis`, `ai_suggestion`, `ai_field`, la vista `request_ai_marks`, `record_ai_analysis` prevista), la entrada de correo (spec OPR-15 §7: el enganche `alCrearRequest` vacío y el barrido de requests `open` sin `ai_analysis`), el ciclo de fondo único (ADR 0006), los puertos de BzzzBX y su falso (ADR 0005, spec OPR-22, P-3: la IA va por la capa de IA de BzzzBX, no por el outbox), las confirmaciones de Requests (spec OPR-28 §5.4: cerrar sugerencias al confirmar, `ai_fields_of`, G13; S-8: la forma de `value` la fija esta tarjeta) y la conversación (spec OPR-27 §5.5: los borradores de IA, que no cambian).
- **Tarjeta en Relevo:** leída (OPR-36, 2026-11-27). De ella salen: cada correo de request sale **al llegar** por BzzzBX al servicio de Claude para analizar propiedad, espacio y unidad, camas, servicio, fecha, ventana, notas e instrucciones de acceso, número de PO, la persona real detrás de direcciones de sistema o de portal, y si el correo pide varios jobs; los resultados se guardan y se ven como campos AI-marked; el operador confirma o corrige y la corrección queda registrada; si la IA tarda o no está, los campos quedan vacíos con "AI pending" y el operador trabaja a mano. "Hecho cuando": correo analizado en menos de 1 minuto desde que llega; E2E-8, E2E-10 y E2E-11. **No se pudieron leer** el Release Definition §7.1 y §7.2, el User Guide §4.3 y §12.5 ni el texto de E2E-8, E2E-10 y E2E-11 (no están en este repo, que es público) [S-1].
- **Fuera de alcance:** las sugerencias de cleaner y los borradores de respuesta (OPR-37: `cleaner_team`, `draft_*`, que ya se muestran en la conversación desde OPR-27), la lectura de la respuesta del cleaner (`cleaner_reply`, OPR-17), separar una request de varios jobs en varias requests, editar el borrador con búsqueda libre de cliente, propiedad o servicio (`update_request_detail`, pendiente de OPR-28), Rosie (OPR-38), medir las metas de velocidad (OPR-39; aquí solo se guardan las horas que necesita) y volver a analizar cuando el cliente responde en el hilo [S-2].

## 1. Para qué

Hoy una request nueva entra con el borrador vacío y se queda así: nada lo llena salvo la seed. Este trabajo hace que, al llegar un correo de request:

1. la entrada de correo (OPR-15) crea la request y despierta al análisis;
2. una tarea del ciclo de fondo pide a BzzzBX que analice el correo original, mandando **solo** crosswalk IDs; BzzzBX lee el correo y llama a Claude (opsRUN nunca llama a Claude ni manda el cuerpo del correo);
3. cuando BzzzBX devuelve el resultado, la base guarda las sugerencias y llena con ellas los campos vacíos del borrador, que se ven **AI-marked**;
4. el operador acepta (con Confirm details o Confirm sender de OPR-28, o campo por campo), corrige o rechaza cada campo; cada decisión queda en `ai_suggestion` y en Audit;
5. si BzzzBX o la IA no responden, o responden mal, la request sigue usable a mano: los campos se ven vacíos con "AI pending" y ninguna acción se bloquea por la IA.

Todo el trabajo de la IA se hace **por adelantado**, en el ciclo de fondo, para que el operador encuentre el borrador lleno al abrir la request. Abrir la request, el tablero o cualquier lectura nunca pide un análisis.

## 2. Principios que aplica

- **Las IAs proponen, las personas firman.** El análisis solo escribe sugerencias (`ai_suggestion` sin decisión) y valores del borrador que quedan AI-marked. No crea confirmaciones, ni instrucciones, ni cambia el dueño, el estado ni el gate de Schedule; no cierra alertas. Un guard lo comprueba descubriendo las funciones del sistema (§14.1). Aceptar, corregir y rechazar es siempre de un operador (`require_operator()` y los checks `ai_suggestion_operator_decision` que ya existen).
- **Toda llamada a la IA es una instrucción a BzzzBX.** Sale por un puerto nuevo de la capa de IA de BzzzBX (§12), nunca directo a Claude (OPR-22 P-3).
- **Un solo dueño.** El correo (remitente, asunto, cuerpo, adjuntos) es de PINCH y BzzzBX lo lee por su lado. A BzzzBX viajan solo `bzzzbx_message_id`, `bzzzbx_thread_id` y la clave del análisis; de vuelta, opsRUN guarda solo lo que su modelo ya permite: crosswalk IDs y valores del borrador (`opsrun:draft`), con un motivo corto (§6).
- **Si la IA falla, se trabaja a mano.** Lento, caído, rechazado, con límite de uso o con un resultado inválido: el análisis termina `failed` o `timed_out`, los campos siguen vacíos con "AI pending" y todo lo de Requests corre igual (§9.4).
- **Una lectura nunca escribe** (ADR 0006). El análisis es una tarea registrada del ciclo de fondo; G16 se amplía para que ninguna lectura lo importe (§14.2).
- **Todo queda en Audit.** `ai_analysis_completed`, `ai_analysis_failed` y `ai_suggestion_accepted` / `corrected` / `rejected`, en la misma transacción que el dato. Los tipos ya están en el catálogo.
- **Guards que descubren.** El guard "la IA no actúa sola" descubre en `pg_proc` las funciones del sistema y se ve fallar en cada corrida (§14.1).

## 3. Qué se construye ya y qué espera

| Pieza | Ahora, sobre el falso | Espera a |
|---|---|---|
| Puerto de IA de BzzzBX, su falso y sus pruebas de contrato | Sí | OPR-6: forma real de la ruta de IA (§12.4) |
| Tarea `analisis_ia` en el ciclo de fondo, despertada por la entrada y con barrido | Sí | — |
| Guardar resultado, llenar el borrador y marcar AI | Sí, en la base | — |
| Fallback: AI pending con BzzzBX caído, IA lenta, fallida o con límite | Sí | OPR-11 para los límites reales y los códigos de error |
| Aceptar, corregir y rechazar por campo, con Audit | Sí | `update_request_detail` para corregir con búsqueda libre (P-5) |
| Aviso de varios jobs | Sí, solo aviso | Separar la request: fuera de V1.1 beta (P-12) |
| "Analizado en menos de 1 minuto" en staging | Solo en local, I1 (§15.3) | OPR-6, OPR-11, OPR-14 y staging |

## 4. Qué analiza la IA

### 4.1 Campos

Los de la tarjeta, sobre el catálogo `opsrun.ai_field` que ya existe. Ningún campo nuevo en el catálogo.

| Campo (`ai_field.code`) | Forma de `value` (jsonb) | Columnas del borrador que llena |
|---|---|---|
| `property` | `"bx-prop-…"` (crosswalk ID) | `bzzzbx_property_id` |
| `space` | `"bx-space-…"` | `bzzzbx_space_id` |
| `unit` | texto, ≤ 32 caracteres | `unit` |
| `beds` | entero 0 a 50 | `beds` |
| `service` | `"bx-svc-…"` | `bzzzbx_service_id` |
| `service_date` | `"YYYY-MM-DD"` | `service_date` |
| `time_window` | `{"start": "HH:MM", "end": "HH:MM"}`, con `start < end` | `window_start`, `window_end` |
| `access_notes` | texto, ≤ 500 | `access_notes` |
| `po_number` | texto, ≤ 64 | `po_number` |
| `sender` | `{"bzzzbx_customer_id": "…", "bzzzbx_contact_id": "…" \| null}` | `bzzzbx_customer_id`, `bzzzbx_contact_id` |
| `multiple_jobs` | `{"count": n}`, `n ≥ 2` | Ninguna: es un aviso (§10.3) |

Las formas escalares coinciden con las de la seed (R1: `"bx-prop-0001"`, `3`, `"4B"`), así que la comparación de OPR-28 §5.4 sigue valiendo sin cambios (cierra OPR-28 S-8). Los crosswalk IDs se aceptan con la forma de un ID de BzzzBX y no se comprueban contra BzzzBX en la base: los propone BzzzBX mismo [S-3].

`sender` es "la persona real detrás de direcciones de sistema o de portal": cuando el correo llega de un portal o de un buzón automático, BzzzBX propone el cliente y el contacto que el cuerpo nombra. Si esa persona no es un contacto de PINCH, BzzzBX propone solo el cliente (`bzzzbx_contact_id: null`) y lo dice en el motivo; opsRUN no guarda su nombre ni su dirección [S-4].

`cleaner_team`, `cleaner_reply` y `draft_*` no los pide este análisis (P-6). La base los rechaza en `record_ai_analysis` (`OP046`) hasta que OPR-37 amplíe la lista.

### 4.2 Rangos y alternativas

Cada campo trae una propuesta principal (`rank = 1`) y, si BzzzBX quiere, hasta 2 alternativas (`rank` 2 y 3) [S-5]. Solo la principal llena el borrador y marca el campo (vista `request_ai_marks`); las alternativas aparecen en el campo para corregir con un clic (§10.2). Un campo puede no venir: la IA no supo, y el campo queda vacío y sin marca.

## 5. Ciclo de vida de un análisis

### 5.1 Estados

Los de `opsrun.ai_analysis_status`, sin cambios: `pending` → `completed`, `failed` o `timed_out`. Uno terminado no cambia más.

| Estado | Cuándo | Qué ve el operador |
|---|---|---|
| sin análisis | La request acaba de entrar o el análisis no se pudo empezar | AI pending |
| `pending` | Pedido a BzzzBX, sin respuesta | AI pending |
| `completed` | BzzzBX devolvió un resultado válido | Los campos propuestos, AI-marked; los demás vacíos, sin "AI pending" |
| `failed` | BzzzBX rechazó el pedido, la IA falló o el resultado era inválido | AI pending (OPR-20 §3.9: sin sugerencias se ve AI pending) |
| `timed_out` | Pasó el límite sin resultado (§9.2) | AI pending |

"AI pending" no se guarda: se calcula al leer, desde el último análisis de la request (§10.1).

### 5.2 Reintentos

A lo sumo **dos análisis por request** (el primero y un reintento automático), y el reintento solo cuando el primero terminó `failed` o `timed_out` hace al menos 60 s (P-7). Lo decide la base en `start_ai_analysis` (§8.1), no el servidor. Después del segundo fallo la request se queda en AI pending y se trabaja a mano; no hay botón "Retry AI" en V1.1 beta (P-7).

### 5.3 Qué pasa con el resultado según el estado de la request

| La request, cuando llega el resultado | Qué hace `record_ai_analysis` |
|---|---|
| `open`, campo vacío, sin confirmación vigente que lo cubra y sin decisión previa del operador sobre ese campo | Guarda la sugerencia sin decidir y llena el borrador: el campo queda AI-marked |
| `open`, campo ya lleno | Guarda la sugerencia sin decidir; no toca el borrador. El campo se ve AI-marked y, si difiere, al confirmar se cierra `corrected` (OPR-28 §5.4) |
| `open`, campo cubierto por una confirmación vigente (`draft_invalidating_fields`, OPR-28 §5.1) | Guarda la sugerencia como `superseded` (sin marca, sin tocar el borrador): un resultado tardío nunca deshace lo que el operador ya firmó (P-8) |
| `open`, el operador ya rechazó o corrigió ese campo en un análisis anterior | Igual que el anterior: `superseded` |
| `scheduled` | Marca el análisis `completed` sin guardar sugerencias; Audit lo dice (`details.discarded = "request_not_open"`). El borrador está congelado (G11) |

La regla "no tocar lo cubierto por una confirmación" usa las columnas que **invalidan**, no solo las que guarda: llenar la propiedad vacía de una request con el cleaner confirmado invalidaría esa confirmación (OPR-28 §5.5), y la IA no puede hacer eso.

Las sugerencias abiertas de un análisis anterior de la misma request (el primero, si este es el reintento) pasan a `superseded` antes de guardar las nuevas.

## 6. Qué guarda opsRUN y qué no

| Guarda (opsRUN) | No guarda (es de PINCH, lo lee BzzzBX) |
|---|---|
| `ai_analysis`: request, estado, `model` (el nombre que reporte BzzzBX), `requested_at`, `completed_at` | El cuerpo, el asunto, el remitente y los adjuntos del correo |
| `ai_suggestion`: campo, rango, `value` con la forma de §4.1, `reason` (≤ 200 caracteres, P-9), decisión, `final_value`, quién y cuándo | El texto que la IA leyó, el prompt, la respuesta cruda del modelo |
| Los valores del borrador que llena (columnas `:draft` de `request`) | Nombres y direcciones de la propiedad, el cliente o el contacto: se leen de BzzzBX al pintar |
| Audit con `details = {"ai_analysis_id", "fields": [...], "filled": [...]}` o `{"ai_analysis_id", "status", "error_code"}` | El detalle del error de BzzzBX más allá de su código |

Lo que viaja **a** BzzzBX es `{ clave, bzzzbx_message_id, bzzzbx_thread_id, campos }` (§12.1). La tarea nunca lee el `Message` del puerto de lectura: no lo necesita, y una prueba lo comprueba (§15.2).

`ai_analysis.instruction_id` deja de ser obligatorio (P-1): la IA no pasa por el outbox, así que no hay instrucción que referenciar. La clave de idempotencia con BzzzBX es el `ai_analysis.id`.

## 7. Lecturas

Todas de solo lectura: ninguna escribe, ninguna pide un análisis y ninguna llama al puerto de IA. Las de la ventana corren como `opsrun_app` en `begin read only`, dentro de la transacción de `leerDeOpsrun` (OPR-26), una consulta tras otra.

| Quién lee | Qué | Dónde |
|---|---|---|
| Job window, pestaña de la propiedad | El último `ai_analysis` de la request (estado, `requested_at`, `completed_at`) y sus sugerencias sin decidir de los campos de §4.1: la principal y sus alternativas, con valor y motivo | `src/lib/ventana/ia.ts` (archivo nuevo, para no tocar `consultas.ts`), sobre `ai_analysis`, `ai_suggestion` y `request_ai_marks` |
| Job window, nombres | Los nombres de los crosswalk IDs propuestos (también los de las alternativas), con `obtenerVarios` dentro del presupuesto de 1,5 s de la ventana. Nunca se guardan | `leerVentanaDeBzzzbx` (OPR-26), que suma esos IDs a lo que ya pide |
| Panel de Confirm (OPR-28) | Sin cambios: `CONSULTA_SUGERENCIAS_ABIERTAS` ya da la marca AI | `src/lib/ventana/confirmar.ts` |
| Tablero | Sin cambios. El cursor de `/api/tablero/cambios` ya incluye el último `audit_event.id`, así que `ai_analysis_completed` y cada decisión refrescan las ventanas abiertas | OPR-25 |
| Audit | Sin cambios: los tipos `ai_*` ya tienen label | OPR-35 |
| Tarea `analisis_ia` | El barrido, los análisis `pending` con el mensaje original de su request y la hora del último fallo. Solo datos de opsRUN; nunca lee el `Message` del puerto de lectura | `src/lib/analisis-ia/datos-sql.ts` |

Las dos consultas de la tarea, en forma:

```sql
-- Barrido: requests open recientes sin análisis en curso ni terminado bien.
select r.id from opsrun.request as r
 where r.status = 'open' and r.created_at >= now() - interval '24 hours'
   and not exists (select 1 from opsrun.ai_analysis as a
                    where a.request_id = r.id and a.status in ('pending', 'completed'))
 order by r.received_at limit 20;

-- Pendientes: con el original de la request para pedirlo a BzzzBX.
select a.id, a.request_id, a.requested_at, m.bzzzbx_message_id, m.bzzzbx_thread_id
  from opsrun.ai_analysis as a
  join opsrun.request_message as m on m.request_id = a.request_id and m.is_original
 where a.status = 'pending'
 order by a.requested_at limit 20;
```

El barrido solo propone candidatas: `start_ai_analysis` decide en la base si toca (reintentos, intervalo, estado de la request; §8.1).

## 8. Escrituras y su migración (pide OK, P-0)

### 8.1 Migración

`supabase/migrations/20261207120000_analisis_ia.sql`, solo hacia adelante, como `opsrun_migrador`, después de `20261204120000_entrada_correo.sql` (y de la de OPR-29, si llega antes). No crea tablas ni columnas, ni tipos, ni entradas de catálogo. Cambia:

1. **`ai_analysis.instruction_id` deja de ser `not null`** (P-1), con su `COMMENT` nuevo ("La instrucción que pidió el análisis; null cuando salió por la capa de IA de BzzzBX, OPR-36"). La vista `v1_ai_analysis` no cambia de columnas; la columna pasa a admitir `null`, y se avisa al equipo de BzzzBX en OPR-6. Los `ai_*` del catálogo de instrucciones no se quitan aquí: el análisis de R1 de la seed referencia uno (P-1).
2. **Check nuevo** `ai_analysis_completed_at`: `(status = 'pending') = (completed_at is null)`. La seed lo cumple.
3. **Índice único parcial** `ai_analysis_one_pending_key` sobre `(request_id) where status = 'pending'`: un solo análisis en curso por request, también con dos procesos.
4. **Funciones del sistema**, en `opsrun`, `security definer`, dueño `opsrun_migrador`, `set search_path = ''`, `require_system()` en su cuerpo, `revoke all … from public`, `grant execute … to opsrun_app` y a nadie más:

   ```sql
   opsrun.start_ai_analysis(p_request_id uuid) returns uuid   -- null si no toca (§5.2)

   opsrun.record_ai_analysis(
     p_ai_analysis_id uuid,
     p_status opsrun.ai_analysis_status,     -- completed | failed | timed_out
     p_model text default null,
     p_suggestions jsonb default '[]',      -- [{field, rank, value, reason}]
     p_error_code text default null
   ) returns text                           -- 'recorded' | 'duplicate'
   ```

   `start_ai_analysis` bloquea la request (`for update`) y aplica §5.2. `record_ai_analysis` bloquea el análisis; si no está `pending`, `duplicate`; si no, valida todo `p_suggestions` antes de escribir (`OP046`) y hace §5.3 en una transacción, con su Audit. Es la `record_ai_analysis` prevista en OPR-20 §4.

5. **Función del operador**, igual pero con `require_operator()`:

   ```sql
   opsrun.decide_ai_suggestion(
     p_ai_suggestion_id uuid,
     p_decision opsrun.ai_decision,          -- accepted | corrected | rejected
     p_version bigint,
     p_final_value jsonb default null,       -- obligatorio con corrected
     p_reason text default null
   ) returns void
   ```

   Usa `lock_open_request` de OPR-28 (`OP006`, `OP007`, `OP013`) y escribe la decisión, el borrador si toca (§10.2) y su `ai_suggestion_*` en la misma transacción. El trigger `request_confirmation_supersede` de OPR-28 invalida lo que haga falta, con el operador como actor. No reemplaza a `discard_ai_draft` (OPR-27), que sigue siendo el camino de los borradores de mensaje.

6. **Helpers privados** en `opsrun_private`, sin EXECUTE para nadie (G7): `ai_analysis_fields() returns text[]` (los campos de §4.1, `immutable`), `ai_value_valid(p_field text, p_value jsonb) returns boolean` (las formas de §4.1), `ai_draft_columns(p_field text) returns text[]` (la columna derecha de §4.1) y `ai_apply_to_draft(p_request opsrun.request, p_field text, p_value jsonb)`. G13 se amplía: toda columna de `ai_draft_columns` es `:draft`, y todo campo de `ai_analysis_fields` está en `ai_field`.

7. **Write-back:** sin cambios. `ai_analysis`, `ai_suggestion`, `request` y `audit_event` ya salen por `v1_*`.

### 8.2 Códigos de error

Este spec se reserva **`OP045` a `OP049`** (OPR-34 tiene `OP035` a `OP039`; `OP040` a `OP044` quedan para OPR-29). Se documentan en la cabecera de la migración:

| Código | Cuándo | Lo lanza |
|---|---|---|
| `OP045` | El análisis o la sugerencia no existe | `record_ai_analysis`, `decide_ai_suggestion` |
| `OP046` | El resultado de la IA no es válido: campo no permitido, forma, rango, duplicado o motivo largo | `record_ai_analysis` |
| `OP047` | La sugerencia ya está decidida | `decide_ai_suggestion` |
| `OP048` | La decisión no vale para esa sugerencia: `accepted` con el borrador distinto, `corrected` sin `final_value` o con forma inválida | `decide_ai_suggestion` |
| `OP049` | Reservado, sin uso | — |
| `OP006`, `OP007`, `OP013` | Reutilizados de `lock_open_request` | `decide_ai_suggestion` |
| `22023` | `p_status = 'pending'` en `record_ai_analysis`; `p_decision = 'superseded'` en `decide_ai_suggestion` | las dos |
| `42501` | Actor equivocado | las tres |

La tarea registra `OP045` y `OP046` en el log con el id del análisis (sin valores) y sigue: `OP046` ya no llega a la base porque `forma.ts` lo detecta antes, pero la base es la defensa.

### 8.3 SQLSTATE del ejecutor

| SQLSTATE | `codigo` | Mensaje |
|---|---|---|
| `OP006` | `request_no_encontrada` | "Job not found." |
| `OP007` | `request_no_abierta` | "This request is not open anymore." |
| `OP013` | `cambio_concurrente` | "This job changed. Review and try again." |
| `OP045` | `sugerencia_no_encontrada` | "That AI suggestion is gone. Refresh and try again." |
| `OP047` | `ya_decidida` | "Someone already decided this." |
| `OP048` | `decision_invalida` | "That value can't be saved." |
| `42501` | — | Sube: `ejecutarAccion` lo registra y muestra "Something went wrong. Try again." |

## 9. La tarea del ciclo de fondo

### 9.1 Quién la corre

Una tarea registrada en `tareasDeOpsrun()` (`src/lib/ciclo/arranque.ts`), **`analisis_ia`, cada 5 s** (P-7), con actor de sistema `analisis_ia`. Nunca abre su temporizador (G16) y nunca corre desde una lectura. Módulo nuevo `src/lib/analisis-ia/`:

- `analisis.ts`: `crearAnalisis({ ia, datos, reloj, log })` → `{ vuelta(), despertar(requestId) }`, pura respecto a sus dependencias;
- `datos-sql.ts`: las llamadas a las funciones de §8.1 y las consultas del barrido, como `opsrun_app` con `escritura: true` y actor `{ tipo: "sistema", proceso: "analisis_ia" }`;
- `tarea.ts`: `tareaAnalisisIa()`, sin `server-only`, con el puerto vigente en cada vuelta (como `lecturaVigente` de la entrada) y su cierre;
- `forma.ts`: la forma de cada campo de §4.1, pura; la usan la tarea (para descartar antes de llamar a la base) y la UI de corregir.

### 9.2 Una vuelta

1. **Empezar.** Candidatas: las requests despertadas (§9.3) más el **barrido**: `status = 'open'`, `created_at ≥ now() − 24 h` y sin análisis `pending` ni `completed` [S-6]. Hasta 20 por vuelta, primero las despertadas y después por `received_at` [S-7]. Para cada una, `opsrun.start_ai_analysis(request_id)`; devuelve el id del análisis nuevo o `null` si la base decide que no toca (ya hay uno, ya hubo dos, la request no está `open` o el reintento es muy pronto).
2. **Seguir los pendientes.** Para cada `ai_analysis` `pending` (hasta 20, el más viejo primero), `ia.resultadoDeAnalisis(clave)`:
   - `null` (BzzzBX no lo conoce): `ia.pedirAnalisis(...)` con los IDs del original de la request. Es idempotente por la clave: si el pedido anterior se perdió, este lo repite; si llegó, no duplica nada;
   - `en_curso`: si `now − requested_at` pasó el **límite de 120 s** (P-7), `record_ai_analysis(id, 'timed_out')`; si no, se deja;
   - `listo`: `forma.ts` revisa cada propuesta; si todas sirven, `record_ai_analysis(id, 'completed', model, propuestas)`; si alguna no, `record_ai_analysis(id, 'failed', error_code = 'invalid_result')` y el log dice qué campo, sin el valor;
   - `fallido`: `record_ai_analysis(id, 'failed', error_code)`.
3. Cada llamada a la base va en su propia transacción. Un error en una request no frena a las otras.

El límite cuenta desde `requested_at`, no desde la llegada del correo, y lo aplica la tarea con su reloj: con BzzzBX caído, el análisis también termina `timed_out` a tiempo, porque esa escritura es solo de opsRUN.

### 9.3 Despertar desde la entrada

`tareaEntradaCorreo()` llena su `alCrearRequest` con el `despertar(requestId)` de la tarea de análisis: agrega el id a un conjunto en memoria y nada más. **La vuelta de la entrada nunca llama a BzzzBX por la IA**: si lo hiciera, una IA lenta frenaría la entrada de correos. `tareasDeOpsrun()` crea primero el análisis y le pasa su `despertar` a la entrada.

Si el proceso cae entre el commit de la request y la vuelta del análisis, el despertar se pierde y el barrido la encuentra (spec OPR-15 §7). Dos procesos a la vez (cruce de un deploy) pueden despertar la misma request: `start_ai_analysis` la deja con un solo `pending` (índice único parcial, §8.1).

### 9.4 Fallback: qué pasa si algo falla

| Caso | Qué hace | Qué ve el operador |
|---|---|---|
| BzzzBX caído (`BzzzbxNoDisponible`) en `pedirAnalisis` o `resultadoDeAnalisis` | Termina la vuelta sin tocar más; el análisis sigue `pending` y vence a los 120 s. El log avisa una vez al caer y una al volver | AI pending; el tablero ya muestra "BzzzBX unavailable" si la lectura también cae |
| El real no existe (servidor, hasta OPR-6) | `iaOAusente` responde siempre no disponible (§12.3): cada análisis termina `timed_out` dos veces y la request se queda a mano | AI pending |
| IA lenta | `timed_out` a los 120 s; reintento a los 60 s; segundo `timed_out` | AI pending, unos 5 minutos como máximo, y después a mano |
| BzzzBX rechaza el pedido (`IaRechazada`: mensaje desconocido, campo no soportado) | `failed` con su `error_code`; reintento solo si el código no es definitivo [S-8] | AI pending |
| Límite de uso (`IaLimitada`, OPR-11) | El análisis sigue `pending`; la tarea no pide más en esa vuelta y espera la siguiente. Si dura más que el límite, `timed_out` | AI pending |
| Resultado con un campo inválido | `failed` (`invalid_result`), sin guardar ninguna propuesta de ese resultado [S-9] | AI pending |
| La base falla en una request | Se reintenta en la vuelta siguiente: las funciones son idempotentes | — |
| Respuesta tardía de un análisis ya `timed_out` | `record_ai_analysis` responde `duplicate` y no escribe (§8.1) | — |

En ningún caso hay una acción bloqueada por la IA: Assign, Confirm details / sender / cleaner, el enlace de la Fase A y la conversación responden igual que con una request sin análisis (OPR-28 ya los hace correr con el borrador que haya).

### 9.5 La meta de 1 minuto

| Tramo | Tiempo |
|---|---|
| Correo → request en opsRUN | ≤ 1 min de BzzzBX + ≤ 15 s de la entrada (spec OPR-15 §8.2) |
| Request → pedido a BzzzBX | ≤ 5 s (despertar más una vuelta) |
| Pedido → resultado | Lo que tarde la capa de IA de BzzzBX y Claude (OPR-11) |
| Resultado → guardado | ≤ 5 s (una vuelta) |
| Guardado → ventana abierta | ≤ 15 s (sondeo; el `ai_analysis_completed` mueve el cursor de `/api/tablero/cambios`) |

En local, con el falso respondiendo en 2 s, el borrador llega en menos de 30 s desde `correo_nuevo`. "Analizado en menos de 1 minuto" se mide como `ai_analysis.completed_at − request.received_at` (OPR-39), con las horas que ya guarda el modelo.

## 10. Interfaz

### 10.1 AI pending

En la pestaña de la propiedad de la Job window (Job details y Who is it from?), solo en Requests. Cada campo de §4.1 que esté vacío se ve:

| Último análisis de la request | Campo vacío | Campo con valor |
|---|---|---|
| ninguno, `pending`, `failed` o `timed_out` sin sugerencias | **AI pending** (texto gris, `aria-live="polite"` en el grupo) | Su valor, sin marca |
| `completed` | `— —`, como hoy | Su valor; con marca **AI** si tiene sugerencia `rank = 1` sin decidir |

"AI pending" no deshabilita nada: es un texto donde iría el valor. El tablero no cambia: la tarjeta sigue mostrando `— —` en lo que falta (P-11). Cuando el análisis llega, el sondeo de la ventana (OPR-26, mismo cursor) refresca y "AI pending" se cambia por los valores en la vuelta siguiente, sin recargar.

### 10.2 Campos AI-marked

Cada campo con sugerencia abierta muestra:

- el valor, con el chip **AI** y, al lado, el motivo de la IA (botón "Why?" que lo despliega; `aria-expanded`);
- los nombres que la ventana ya lee de BzzzBX para los crosswalk IDs (propiedad, espacio, servicio, cliente, contacto); si BzzzBX está caído, `— —` en el nombre y el ID como texto secundario;
- tres controles: **Accept** (✓), **Change** y **Reject** (✕), cada uno con su `aria-label` ("Accept AI property", …):
  - **Accept** cierra la sugerencia `accepted` sin cambiar el valor. Confirm details y Confirm sender de OPR-28 siguen cerrando todas las abiertas de su tipo de una vez, como hoy;
  - **Change** abre la edición en el lugar: para texto, fecha, ventana y camas, un campo con la forma de `forma.ts`; para crosswalk IDs, la lista de alternativas de la IA (`rank` 2 y 3) y, para `space`, los espacios de la propiedad que la ventana ya lee. Guardar cierra la sugerencia `corrected` con `final_value` y escribe el borrador. La búsqueda libre de cliente, propiedad o servicio es de `update_request_detail` (P-5);
  - **Reject** cierra la sugerencia `rejected` y, si el borrador todavía tiene el valor de la IA, lo vacía. Un análisis posterior no vuelve a llenar ese campo (§5.3).

Los tres pasan por `ejecutarAccion` con una entrada nueva del registro, `decide_ai_suggestion`, **interna** (`interna: true`: no sale en la action bar), `motivo: "opcional"`, `necesitaBzzzbx: false` y `concurrencia: "request"`. Un rechazo por versión dice "This job changed. Review and try again.", como OPR-28.

### 10.3 Varios jobs

Si hay una sugerencia `multiple_jobs` abierta, arriba de Job details un aviso (`role="status"`): **"AI: this email may ask for {n} jobs."** con **Got it** (`accepted`) y **Not multiple** (`rejected`). No separa la request ni crea nada: el operador decide qué hacer (P-12).

### 10.4 Lo que no cambia

La conversación y los borradores de IA del Composer (OPR-27), el panel de Confirm de OPR-28 (que ya muestra la marca AI desde `CONSULTA_SUGERENCIAS_ABIERTAS`) y la pestaña Audit (OPR-35), que muestra los tipos `ai_*` con su label. En Audit, `ai_analysis_completed` sale con persona **AI** y los fallos con persona sistema.

## 11. Encaje con el código

| Dónde | Qué |
|---|---|
| `src/lib/bzzzbx/puertos.ts`, `tipos.ts`, `errores.ts`, `ausente.ts`, `index.ts` | `IaBzzzbx`, sus tipos, `IaRechazada` / `IaLimitada` con `esIaRechazada` / `esIaLimitada`, `iaOAusente`, y `ia` en `Bzzzbx` y en la fábrica |
| `src/lib/bzzzbx/contrato/ia.contrato.ts` | `probarContratoDeIa`; `falso.contrato.test.ts` y `real.contrato.test.ts` la corren |
| `src/lib/bzzzbx/falso/` | `ia-falsa.ts` y los controles de §13 |
| `src/lib/analisis-ia/` | `analisis.ts`, `datos-sql.ts`, `tarea.ts`, `forma.ts`, `armar.ts` (la vista por campo para la ventana, pura) |
| `src/lib/ciclo/arranque.ts` | Registra `analisis_ia` y le pasa su `despertar` a la entrada |
| `src/lib/entrada/servidor.ts` | `tareaEntradaCorreo({ alCrearRequest })` recibe el enganche en vez de dejarlo vacío |
| `src/lib/ventana/` | Una consulta de solo lectura nueva, `ia.ts` (último análisis y sugerencias de §4.1 con sus alternativas), dentro de la transacción de `leerDeOpsrun`; `VentanaJob.datos` gana `ia` |
| `src/lib/acciones/ia.ts`, `registro.ts` | Ejecutor y entrada interna `decide_ai_suggestion` |
| `src/app/_ventana/` | `campo-ia.tsx`, `aviso-varios-jobs.tsx`, "AI pending" en la pestaña de la propiedad |
| `CONTEXT.md` (en el PR de la implementación) | "Análisis de IA" (la tarea `analisis_ia`), "Barrido de análisis", "Límite del análisis"; ajustar "AI pending" y "AI-marked field" |
| ADR 0006 (en el PR de la implementación) | Una línea de actualización: tareas del ciclo hoy, con `analisis_ia` |

No hay variables de entorno nuevas. `BZZZBX_MODO` elige el falso o el real como para los otros dos puertos; `OPSRUN_CICLO_DE_FONDO=0` apaga también el análisis.

## 12. El puerto de IA de BzzzBX

### 12.1 Interfaz

Un tercer puerto junto a lectura e instrucciones (ADR 0005), en `src/lib/bzzzbx/puertos.ts`. `Bzzzbx` pasa a `{ lectura, instrucciones, ia }`. **Provisional hasta OPR-6**, como `buscarJobs` y `buscarMensajes`:

```ts
export interface IaBzzzbx {
  /**
   * Pide el análisis de una request. Idempotente por `clave` (el ai_analysis.id):
   * la misma clave no repite el trabajo. Puede lanzar BzzzbxNoDisponible,
   * IaRechazada o IaLimitada.
   */
  pedirAnalisis(pedido: PedidoDeAnalisis): Promise<{ recibido_at: string }>;
  /** El estado del análisis de esa clave; null si BzzzBX no la conoce. */
  resultadoDeAnalisis(clave: string): Promise<ResultadoDeAnalisis | null>;
}
```

Tipos nuevos en `tipos.ts`:

```ts
export type CampoDeIa =
  | "property" | "space" | "unit" | "beds" | "service" | "service_date"
  | "time_window" | "access_notes" | "po_number" | "sender" | "multiple_jobs";

export type PedidoDeAnalisis = {
  clave: string;
  bzzzbx_message_id: string;       // el original de la request
  bzzzbx_thread_id: string | null;
  campos: CampoDeIa[];
};

export type Propuesta = { campo: CampoDeIa; rank: 1 | 2 | 3; valor: unknown; motivo: string | null };

export type ResultadoDeAnalisis =
  | { estado: "en_curso" }
  | { estado: "listo"; modelo: string | null; propuestas: Propuesta[]; terminado_at: string }
  | { estado: "fallido"; error_code: string; terminado_at: string };
```

Asíncrono, pedir y consultar, por tres razones: el tic del ciclo no espera a una llamada de varios segundos, una IA lenta no ocupa la vuelta, y una clave idempotente sobrevive a un reinicio del proceso (P-2). Si OPR-6 da una llamada síncrona, la implementación real la envuelve detrás de esta misma interfaz.

### 12.2 Errores, por nombre

En `src/lib/bzzzbx/errores.ts`, como los que ya están, y reconocidos **por nombre, nunca con `instanceof`** (el falso es una sola instancia por proceso y Next empaqueta copias del módulo):

| Error | Cuándo | Reconocedor |
|---|---|---|
| `BzzzbxNoDisponible` (ya existe) | BzzzBX no respondió | `esNoDisponible` |
| `IaRechazada` (nuevo, con `error_code`, `definitivo: boolean`) | BzzzBX rechazó el pedido al recibirlo | `esIaRechazada` |
| `IaLimitada` (nuevo, con `reintentar_despues_ms` opcional) | Límite de uso o de concurrencia del servicio de Claude (OPR-11) | `esIaLimitada` |

### 12.3 Ausente

`iaOAusente()` en `src/lib/bzzzbx/ausente.ts`, como `lecturaOAusente`: si BzzzBX no se puede crear (el real en el servidor hasta OPR-6), un puerto que responde siempre `BzzzbxNoDisponible`. Así el servidor arranca y todo queda en AI pending, que es el fallback.

### 12.4 Lo que se pregunta a OPR-6

Si la ruta de IA es asíncrona o síncrona; si acepta una clave idempotente y cuánto la recuerda; si lee ella el correo por `bzzzbx_message_id` (o necesita otra referencia); qué campos y formas devuelve, y si devuelve crosswalk IDs o texto; los códigos de error y cuáles son definitivos; el nombre del modelo; si el motivo puede venir sin datos personales (P-9).

## 13. El falso

`src/lib/bzzzbx/falso/ia-falsa.ts`: `IaFalsa`, en memoria, con el reloj inyectable del falso (`RelojManual` en las pruebas, sin esperas). Va en `crearFalso()` como `ia` y se reinicia con `reiniciarFalso`.

- **Respuestas por mensaje.** Un mapa `bzzzbx_message_id → guion`. Sin guion, el mensaje responde `fallido` con `message_unknown` (definitivo), así que los correos de la seed no se analizan por accidente.
- **Guiones:** `normal` (listo a los 2 s con propuestas inventadas que encajan con los datos del falso: `bx-prop-0001`, `bx-svc-0001`, mañana, 09:00–12:00, `beds: 3`, `unit: "4B"`, `sender` con `bx-cust-0001` y `bx-cont-0001`, y alternativas para la propiedad); `lenta` (en curso hasta `ia_terminar`); `falla` (`fallido` con `model_error`, no definitivo); `varios` (`normal` más `multiple_jobs: {count: 2}`); `invalida` (una propuesta con forma mala); `limitada` (lanza `IaLimitada` en el primer pedido).
- **Idempotencia** por clave, como `InstruccionesFalsas.entregar`. `__forzar_error` no aplica: los guiones lo cubren.
- **Controles en `/api/falso`** (`control.ts`): `correo_nuevo` gana `ia?: Guion` (por defecto `normal`) y fija el guion de su mensaje; `{ accion: "ia_no_disponible", valor: boolean }` hace que el puerto de IA lance `BzzzbxNoDisponible` sin tocar la lectura; `{ accion: "ia_terminar", bzzzbx_message_id }` libera una `lenta` con el guion `normal`. Responden 404 sin falso o en el servidor, como los demás.
- Todo con datos inventados y los IDs que ya comparten la seed y el falso. Ningún texto parece un correo real.

**Seed (P-10):** R2, R7 y R8 son `open` y no tienen análisis; el barrido los tomaría y cambiaría su borrador y su Audit, del que dependen la demo y los E2E de OPR-28 y OPR-35. Se agrega al final del archivo un `ai_analysis` `completed` **sin sugerencias y sin Audit** para cada uno, con `instruction_id` nulo, que el barrido salta. R1 ya tiene el suyo; R3 a R6 no son `open`.

## 14. Guards

### 14.1 La IA no actúa sola (pgTAP, nuevo)

En `guard_escrituras.test.sql`, junto a G15. Descubre en `pg_proc` las funciones de los esquemas de opsRUN cuyo `prosrc` llama a `require_system()` y escriben en `opsrun.ai_suggestion`, y comprueba que ninguna:

- inserta en `request_confirmation`, `instruction` ni `cleaner_confirmation`;
- actualiza `request.status`, `request.owner_operator_id`, `request.bzzzbx_job_id` ni `alert_occurrence`;
- pone en `ai_suggestion.decision` otro valor que `superseded`.

**Se ve fallar en cada corrida:** dentro de la transacción crea una función de prueba del sistema que inserta una sugerencia y una confirmación, comprueba que el guard la detecta y hace rollback. El número del guard se fija al fusionar (el siguiente libre después de los de OPR-29) [S-10].

### 14.2 Una lectura nunca pide un análisis (Vitest, se amplía G16)

`un-solo-ciclo.test.ts` descubre las lecturas (un `route.ts` que exporta GET, los `page`/`layout`, los módulos de lectura del tablero y la ventana) y falla si alguna importa `src/lib/analisis-ia/` o el puerto `ia`. Un guard propio, como `observados/solo-en-segundo-plano.test.ts`, falla si algo que no sea `lib/ciclo/arranque.ts` importa `analisis-ia/tarea.ts`, y si el arranque deja de registrarla. Se ven fallar una vez agregando el import a una ruta de prueba.

### 14.3 Nada de PINCH viaja (Vitest)

La tarea nunca llama a `lectura.obtener("message", …)` ni a `obtenerVarios("message", …)`; `pedirAnalisis` recibe exactamente `clave`, `bzzzbx_message_id`, `bzzzbx_thread_id` y `campos`; los parámetros de `record_ai_analysis` son exactamente las propuestas con las claves de §4.1. Se ve fallar agregando `body` al pedido.

## 15. Pruebas y criterios de aceptación

### 15.1 pgTAP (`supabase test db`)

Archivo nuevo `analisis_ia.test.sql`, con fixtures propios dentro de la transacción:

- **Actor:** `start_ai_analysis` y `record_ai_analysis` fallan con `42501` sin actor, con operador y con los dos; `decide_ai_suggestion` falla sin actor y con sistema. **Se ve en rojo una vez** quitando `require_system()` de `record_ai_analysis`, además de G6, que descubre las funciones nuevas y se ve fallar en cada corrida. G5 y G7 las cubren sin tocarlos.
- **`start_ai_analysis`:** crea un `pending` con `instruction_id` nulo; la segunda llamada devuelve `null`; con uno `completed`, `null`; con uno `failed` hace menos de 60 s, `null`; después de 60 s, uno nuevo; con dos análisis, `null`; request `scheduled`, `null`. El índice: insertar a mano un segundo `pending` falla con `23505`.
- **`record_ai_analysis` `completed`:** sugerencias con `ai_analysis_id`; el borrador se llena solo en columnas vacías; columna llena intacta; columna cubierta por una confirmación vigente (también la propiedad con solo el cleaner confirmado) intacta y sugerencia `superseded`; campo rechazado antes, `superseded`; las abiertas del análisis anterior, `superseded`; `time_window` llena las dos columnas; `sender` las dos; `multiple_jobs` ninguna; Audit `ai_analysis_completed` con actor `ai`, `fields` y `filled`; **ninguna** fila nueva en `request_confirmation`, `instruction` ni `cleaner_confirmation`, y `status`, dueño y `change_seq` de confirmaciones sin cambio (el trigger de OPR-28 no escribe `confirmation_superseded`).
- **Forma:** campo fuera de §4.1 (`cleaner_team`, `draft_customer_reply`, uno inexistente), rango fuera de 1 a 3, dos `rank = 1` del mismo campo, clave extra en `sender`, ventana invertida, fecha inválida, texto largo y `reason` de más de 200 → `OP046`, sin escribir nada.
- **`failed` y `timed_out`:** estado, `completed_at`, sin sugerencias, `ai_analysis_failed` con actor `system` y `details.status` y `error_code`.
- **Idempotencia:** el segundo `record_ai_analysis` del mismo análisis devuelve `duplicate` y no escribe; análisis inexistente → `OP045`.
- **Request `scheduled`:** `completed` sin sugerencias, con `details.discarded`.
- **`decide_ai_suggestion`:** `accepted` con el borrador igual al valor; con el borrador distinto → `OP048`; `corrected` escribe el borrador y `final_value` y su Audit, y el trigger de OPR-28 invalida la confirmación que cubra la columna con el operador como actor; `rejected` vacía el borrador si tenía el valor de la IA y no si alguien lo cambió; `multiple_jobs` acepta y rechaza sin tocar el borrador; ya decidida → `OP047`; `superseded` → `22023`; `corrected` sin `final_value` o con forma inválida → `OP048`; versión vieja → `OP013`; request no `open` → `OP007`; sugerencia inexistente → `OP045`.
- **Flujo completo en SQL:** `ingest_request_email` → `start_ai_analysis` → `record_ai_analysis` → `confirm_details` cierra las abiertas `accepted` → `request_ai_marks` vacía para esos campos.
- G13 sigue en verde: `ai_fields_of` no cambia.
- El guard de §14.1.

### 15.2 Vitest (TDD, cada una en rojo primero)

- `crearAnalisis().vuelta()` con un puerto de IA, datos y reloj de prueba: despertada primero, barrido después, tope de 20; `null` de BzzzBX → `pedirAnalisis` con la misma clave; `en_curso` antes y después del límite; `listo` válido e inválido; `fallido`; `IaRechazada` definitiva y no definitiva; `IaLimitada` no cuenta como fallo; `BzzzbxNoDisponible` corta la vuelta y avisa una vez por caída; un error de la base en una request no frena las otras; el actor es de sistema (`analisis_ia`), nunca operador.
- `despertar` no llama a BzzzBX; `tareaEntradaCorreo` llama al `despertar` solo con `created` y su vuelta nunca toca el puerto de IA.
- `forma.ts`: cada campo de §4.1, bueno y malo.
- Lo de §14.2 y §14.3.
- Puerto: `probarContratoDeIa(crear)` nuevo en `contrato/ia.contrato.ts`, contra el falso y, con `BZZZBX_CONTRATO_REAL=1`, contra el real (hoy falla a propósito): idempotencia de `pedirAnalisis` por clave, `null` para una clave desconocida, un resultado terminado no cambia, propuestas solo con campos pedidos y con la forma de §4.1. `esIaRechazada` y `esIaLimitada` reconocen el error de otra copia del módulo (mismo patrón que `errores.test.ts`).
- Falso: los controles de §13.
- Integración contra la base (`OPSRUN_REQUIERE_BASE=1`, en CI): dos conexiones llaman a la vez a `start_ai_analysis` de la misma request y queda un solo `pending`; dos `record_ai_analysis` a la vez dejan un solo resultado.
- Ventana: `armarIa` (pura) da por campo "AI pending", `— —`, valor o valor con marca, y el aviso de varios jobs.
- Componentes (Testing Library): chip AI y "Why?"; Accept, Change y Reject con su `aria-label`; Change de un crosswalk ofrece solo alternativas; "AI pending" con `aria-live`; aviso de varios jobs con sus dos botones.
- Ejecutor `decide_ai_suggestion`: cada SQLSTATE sale como su `rechazada` (§8.3); datos sin decisión o con forma inválida se rechazan **sin llamar a la base**; `42501` sube.

### 15.3 Playwright (criterios de aceptación)

Contra el build de producción, la seed y el falso, con el ciclo corriendo. Proyecto aparte que corre al final, como `entrada-correo.spec.ts`, porque crea requests de verdad. Cada prueba usa su propio correo (`correo_nuevo`) y elige cómo responde la IA del falso (§13).

| # | Criterio | Cómo se prueba |
|---|---|---|
| I1 | **Correo analizado en menos de 1 minuto.** | `correo_nuevo` con `ia: "normal"`. Se toma la hora; se abre la tarjeta nueva; en menos de 60 s la pestaña de la propiedad muestra propiedad, servicio, fecha y ventana con el chip AI, y Audit muestra "AI analysis completed" con persona AI. Se comprueba que pasaron menos de 60 s |
| I2 | **IA lenta: se trabaja a mano.** | `ia: "lenta"`. La request aparece; sus campos dicen "AI pending"; Assign / Reassign corre y Confirm details sale en gris con "Complete the details first: …", como en una request sin borrador |
| I3 | **BzzzBX sin IA, y vuelve.** | `ia_no_disponible: true`, `correo_nuevo`: AI pending y la entrada sigue creando requests; `ia_no_disponible: false`: el análisis llega en menos de 1 minuto (dentro del límite y del reintento) |
| I4 | IA fallida. | `ia: "falla"`: AI pending; Audit muestra "AI analysis failed" con persona sistema, y después de dos fallos no hay más intentos |
| I5 | Aceptar. | Desde I1, Confirm details: las marcas AI de los detalles desaparecen y Audit muestra "Details confirmed" y un "AI suggestion accepted" por campo |
| I6 | **Corregir queda registrado.** | `ia: "normal"` con `beds: 3`. Change → 2 → Save: el chip AI desaparece, el campo dice 2 y Audit muestra "AI suggestion corrected" con el operador |
| I7 | Rechazar. | Reject en `unit`: el campo queda vacío, sin chip, y Audit muestra "AI suggestion rejected" |
| I8 | Varios jobs. | `ia: "varios"`: el aviso "AI: this email may ask for 2 jobs."; Not multiple lo quita y deja su evento en Audit |
| I9 | Resultado tardío no pisa lo firmado. | `ia: "lenta"`; el operador confirma el sender a mano (R con cliente puesto por la fixture del control); `ia_terminar` libera el resultado: el sender confirmado no cambia y no aparece su chip |

**E6 de OPR-15 cambia:** abre su request con `ia: "lenta"` y ahora sí verifica el texto "AI pending", que su spec dejó para esta tarjeta.

E2E-8, E2E-10 y E2E-11 son del Release Definition, que no se pudo leer; se asume que I1 a I8 los cubren en local y se verifican en staging en OPR-40 [S-1].

**Hecho cuando, en local:** I1 a I9 en verde, más `pnpm lint`, `pnpm typecheck`, `pnpm test` y `supabase test db`. El Hecho cuando de la tarjeta en staging espera OPR-6, OPR-11 y OPR-14.

## 16. Dependencias

| Tarjeta | Qué espera |
|---|---|
| **OPR-6** (equipo de BzzzBX) | La ruta de IA real: forma, idempotencia, quién lee el correo, campos y formas, códigos de error, modelo (§12.4); que `v1_ai_analysis.instruction_id` admita `null` (P-1) |
| **OPR-11** (externa) | Credenciales y límites del servicio de Claude en el servidor de BzzzBX: con qué frecuencia y cuántos análisis a la vez, para ajustar el tope de 20, la cadencia y el límite de 120 s; qué devuelve al pasar el límite (`IaLimitada`) |
| OPR-14 | Correos de verdad para el Hecho cuando en staging |
| OPR-37 | Suma `cleaner_team` y los borradores a `ai_analysis_fields` y usa las alternativas |
| OPR-39 | Mide con `received_at`, `requested_at` y `completed_at` |
| OPR-29 | Su migración (`20261206120000`, probable) y sus códigos (`OP040` a `OP044`) van antes; si cambia el orden, solo se ajusta el nombre del archivo |

## 17. Supuestos

| # | Supuesto |
|---|---|
| S-1 | El Release Definition §7.1 y §7.2, el User Guide §4.3 y §12.5 y E2E-8, E2E-10 y E2E-11 no se pudieron leer. Las reglas salen de la tarjeta, del glosario y de los specs en `main`, y se revisan contra esos documentos. |
| S-2 | Una request se analiza sobre su correo original; las respuestas del cliente no disparan otro análisis en V1.1 beta. |
| S-3 | Los crosswalk IDs propuestos existen en BzzzBX: los propone BzzzBX. La base solo valida su forma. |
| S-4 | Si la persona detrás de un portal no es un contacto de PINCH, `sender` trae solo el cliente. opsRUN no guarda nombres. |
| S-5 | Hasta 2 alternativas por campo. |
| S-6 | El barrido mira las requests creadas en las últimas 24 h. Una request más vieja sin análisis se trabaja a mano. |
| S-7 | Hasta 20 requests nuevas y 20 pendientes por vuelta. |
| S-8 | `IaRechazada.definitivo` lo dice BzzzBX; sin el dato, se trata como no definitivo y se reintenta una vez. |
| S-9 | Un resultado con un campo inválido se descarta entero, para no guardar la mitad de un análisis que pudo leer mal. |
| S-10 | El número del guard nuevo se fija al fusionar, después de los de OPR-29. |

## 18. Preguntas para Henry, con mi recomendación

- **P-0. Migración.** §8.1: `instruction_id` deja de ser obligatorio, un check, un índice único parcial, dos funciones del sistema, una del operador y cuatro helpers, sin tablas, columnas, tipos ni catálogos nuevos. **Recomiendo sí**: sin ella no hay dónde guardar un análisis que salió por la capa de IA. Alternativa: ninguna razonable; sin migración la tarjeta no se puede hacer.
- **P-1. `ai_analysis.instruction_id`.** **Recomiendo que admita `null`**: OPR-22 P-3 decidió que la IA va por la capa de IA de BzzzBX y no por el outbox, y la clave con BzzzBX es el `ai_analysis.id`. Los `ai_*` del catálogo de instrucciones se quitan con la migración de OPR-23, que ya va a tocar ese catálogo (la seed de R1 usa uno). Alternativa: crear una instrucción `ai_analyze_request` por análisis, que contradice P-3 y llena el outbox de filas que nadie entrega.
- **P-2. Puerto asíncrono.** **Recomiendo pedir y consultar con clave idempotente** (§12.1): no ocupa el ciclo, sobrevive a reinicios y aguanta una IA lenta. Alternativa: una llamada síncrona con tiempo límite, más simple pero que retiene la vuelta durante segundos y pierde el trabajo si el proceso cae.
- **P-3. Qué viaja a BzzzBX.** **Recomiendo solo crosswalk IDs** (mensaje, hilo, clave y campos), y que BzzzBX lea el correo. Alternativa: que opsRUN lea el cuerpo del puerto de lectura y lo mande, que hace viajar datos de PINCH por opsRUN sin necesidad. Va a OPR-6.
- **P-4. Llenar el borrador.** **Recomiendo llenarlo con la propuesta principal**, solo en campos vacíos, no cubiertos por una confirmación vigente y no decididos antes por el operador (§5.3), como dice OPR-20 §3.9: la tarjeta pide "results stored and shown as AI-marked fields", y así Confirm details de OPR-28 sirve tal cual. Alternativa: solo sugerencias, sin tocar el borrador, que obliga a aceptar campo por campo antes de poder confirmar.
- **P-5. Cómo se corrige.** **Recomiendo `decide_ai_suggestion` en esta tarjeta** (Accept, Change y Reject por campo), con Change limitado a texto, fecha, ventana, camas, alternativas de la IA y espacios de la propiedad, y la búsqueda libre de cliente, propiedad o servicio para `update_request_detail`. Alternativa: esperar a `update_request_detail`, que deja la tarjeta sin "corrections recorded" salvo por Confirm.
- **P-6. Qué campos.** **Recomiendo los de la tarjeta, incluido `sender`** ("the real person behind system or portal addresses"), y dejar `cleaner_team` y los borradores para OPR-37. Alternativa: pedir todo ahora, que adelanta OPR-37 sin su spec.
- **P-7. Tiempos.** **Recomiendo cadencia de 5 s, límite de 120 s, un reintento automático a los 60 s y como máximo dos análisis por request, sin botón "Retry AI"**. Con esto, "AI pending" dura a lo sumo unos 5 minutos y la meta de 1 minuto se mide aparte (OPR-39). Se ajusta con los límites de OPR-11. Alternativa: sin reintento (más simple, más requests a mano) o con botón (una acción más del operador que no pide la tarjeta).
- **P-8. Resultado tardío sobre lo ya firmado.** **Recomiendo guardarlo como `superseded`**: no marca ni toca el borrador, y queda para comparar en OPR-39. Alternativa: descartarlo sin guardar, que pierde el dato de cuánto acierta la IA cuando llega tarde.
- **P-9. El motivo.** **Recomiendo guardarlo con un tope de 200 caracteres** y pedir en OPR-6 que BzzzBX no ponga datos personales en él; opsRUN no puede comprobarlo. OPR-37 necesita el "con motivo". Alternativa: no guardar el motivo, que deja el chip AI sin explicación.
- **P-10. Seed.** **Recomiendo agregar un análisis `completed` sin sugerencias y sin Audit a R2, R7 y R8** (§13), para que el barrido no cambie la demo ni los E2E de OPR-28 y OPR-35. Alternativa: que el barrido solo mire las requests que creó la entrada (por el `details` de su `request_received`), que ata el análisis a un detalle de Audit.
- **P-11. Dónde se ve "AI pending".** **Recomiendo solo en la Job window**, en los campos vacíos; la tarjeta del tablero sigue con `— —`. Alternativa: un chip "AI pending" en la tarjeta, que no está en el tablero de OPR-25 y se revisaría contra R23.
- **P-12. Varios jobs.** **Recomiendo solo el aviso con Got it / Not multiple**; separar la request queda fuera de V1.1 beta. Alternativa: un botón para crear las requests hermanas, que choca con "un hilo, una request" (spec OPR-15 §5.2) y con G15.

Con las recomendaciones, OPR-36 trae **una migración** (§8.1), un puerto nuevo con su falso y su prueba de contrato, la tarea `analisis_ia` del ciclo, el enganche de la entrada, la UI de la pestaña de la propiedad, un guard pgTAP y la ampliación de G13 y G16.
