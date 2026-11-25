# Fase A — Enlace de una request con el job observado

- **Tarjetas:** OPR-28 (Schedule de una request), con `buscarJobs` del puerto de lectura de OPR-22 y el evento de Audit de OPR-35. Contrato real: OPR-6.
- **Estado:** borrador **provisional**, para revisión de Henry. Lo marcado **[S-n]** es un supuesto que cambia con OPR-6 o con el User Guide; lo marcado **P-n** es una pregunta para Henry (§9).
- **Autorización:** Henry adoptó la Fase A del Runbook §6.1 para el primer lanzamiento (spec OPR-22 §9, P-4) y autorizó adelantar esta parte en local aunque OPR-6, OPR-15, OPR-23, OPR-26 y OPR-36 no estén.

## 1. Para qué

En la Fase A, opsRUN no crea el job: el operador lo crea en las herramientas de PINCH, y opsRUN registra las decisiones y observa. Para que la request pase a Scheduled, opsRUN tiene que saber **qué job de PINCH es el suyo**. Este trabajo:

1. busca en BzzzBX los jobs que pueden ser el de la request (`buscarJobs`);
2. se los propone al operador, ordenados;
3. el operador confirma uno (la request queda Scheduled con el crosswalk del job) o rechaza un candidato (no se vuelve a proponer);
4. cada confirmación y cada rechazo quedan en Audit.

Fuera de alcance:

- la pantalla. La Job window (OPR-26) no existe y el tablero (PR #11) no se toca. Se entrega el módulo de servidor y las funciones SQL, listos para que OPR-26 o OPR-28 les pongan botones;
- deshacer un enlace. Igual que Schedule, un enlace no se deshace (el borrador queda congelado, guard G11). Si hace falta corregir, se decide aparte (P-4);
- crear el job por instrucción a BzzzBX (Fase B, `create_job`);
- el aviso al requester (OPR-16, OPR-18);
- avisar en el tablero cuando aparece un job nuevo que encaja: las propuestas se calculan al pedirlas.

## 2. Principios que aplica

- **Un solo dueño.** Del job solo se guardan `bzzzbx_job_id` y `job_number`, que OPR-20 ya define en `opsrun.request`. Las propuestas no se guardan: se calculan cada vez con el puerto.
- **Las IAs y las búsquedas proponen, el operador confirma.** Ningún enlace se hace solo, ni siquiera con un único candidato exacto.
- **Toda acción queda en Audit.** Confirmar y rechazar escriben su `audit_event` en la misma transacción, con el actor de la transacción.
- **Fase A no manda instrucciones.** El enlace no crea una fila en `opsrun.instruction`: no sale nada hacia BzzzBX.

## 3. `buscarJobs` (puerto de lectura)

Hoy `buscarJobs` compara igualdad exacta de cliente, propiedad y fecha, y con un filtro vacío devuelve todos los jobs. Cambia a:

```ts
type FiltroDeJobs = {
  bzzzbx_customer_id?: string;
  bzzzbx_property_id?: string;
  /** Rango de service_date, ambos inclusive, YYYY-MM-DD. */
  desde: string;
  hasta: string;
};

buscarJobs(filtro: FiltroDeJobs): Promise<Leido<Job>[]>;
```

Contrato (pruebas en `contrato/lectura.contrato.ts`, para el falso y el real):

- exige **cliente o propiedad**; sin ninguno lanza `FiltroInvalido` (error tipado nuevo). Así nunca se pide "todos los jobs";
- exige `desde <= hasta` y un rango de a lo sumo 62 días [S-1]; si no, `FiltroInvalido`;
- los criterios dados se combinan con Y;
- trae también los jobs `cancelled`: el que decide qué mostrar es opsRUN (§4);
- orden: `service_date`, luego `bzzzbx_job_id`. A lo sumo 50 resultados [S-2];
- puede lanzar `BzzzbxNoDisponible`, como el resto del puerto.

El falso implementa lo mismo sobre sus datos. Se agregan al falso jobs inventados **sin request** (creados "en las herramientas de PINCH") para que las pruebas tengan candidatos: uno exacto para R1 y uno de la misma propiedad con otra fecha. No cambian `supabase/seed.sql` ni los IDs que la seed comparte con el falso.

## 4. Qué propone opsRUN

Módulo nuevo `src/lib/fase-a/enlace.ts`, en el servidor. `proponerEnlaces(requestId)`:

1. Lee la request (`opsrun.request`, como `opsrun_app`). Si no está `open`, no hay propuestas.
2. Arma la búsqueda con el borrador:
   - con `bzzzbx_customer_id`, busca por cliente (cubre un job creado con otra propiedad del mismo cliente); si no, por `bzzzbx_property_id`; sin ninguno de los dos, no hay propuestas y se dice por qué ("Confirm who it is from first");
   - fechas: `service_date` ± 3 días [S-3]; sin fecha, desde el día de `received_at` hasta 30 días después [S-3].
3. Descarta:
   - jobs `cancelled`;
   - jobs ya enlazados a **otra** request (`opsrun.request.bzzzbx_job_id`);
   - jobs que el operador ya rechazó **para esta request** (eventos `job_link_rejected` de su Audit).
4. Ordena: misma propiedad primero; luego menor distancia de fecha; luego misma ventana; luego `job_number`.
5. Marca cada candidato con por qué encaja (`misma_propiedad`, `misma_fecha`, `misma_ventana`, `mismo_equipo`) para que la pantalla lo muestre. El primero, si coincide en propiedad y fecha, va como **Suggested** [S-4].

Devuelve `{ candidatos, motivo_vacio? }`. Con BzzzBX caído devuelve el error tipado para que la pantalla diga "BzzzBX unavailable" y no proponga nada.

Las propuestas no son de IA (sale de una búsqueda determinista), así que no usan `ai_suggestion` ni la marca AI. Sí siguen la regla: proponen y el operador confirma.

## 5. Confirmar el enlace

`confirmarEnlace({ requestId, bzzzbxJobId })`, en el servidor:

1. Relee el job con `obtener("job", id)`: tiene que existir y no estar `cancelled`. Toma de ahí `job_number`. Sin BzzzBX no se enlaza.
2. Llama a la función SQL, con el actor de la transacción fijado (operador):

```sql
opsrun.link_observed_job(p_request_id uuid, p_bzzzbx_job_id text, p_job_number text)
```

`security definer`, dueño `opsrun_migrador`, `set search_path = ''`, como fija OPR-20 §4. En una transacción:

- `opsrun_private.require_operator()`;
- la request existe y está `open` (si no, error `OP0xx`);
- el job no está enlazado a otra request (el `unique` ya lo frena; la función da un error claro antes);
- pone `bzzzbx_job_id`, `job_number`, `scheduled_at = now()` y `status = 'scheduled'`. El trigger del **gate de Schedule** sigue valiendo: dueño y tres confirmaciones vigentes (P-1);
- escribe `audit_event` `request_scheduled` con `details = {"mode": "linked", "bzzzbx_job_id": …, "job_number": …}` y el actor.

La función confía en que el servidor leyó el job en BzzzBX: la base no puede leerlo. Lo único que guarda son crosswalk IDs.

## 6. Rechazar un candidato

`rechazarEnlace({ requestId, bzzzbxJobId, motivo? })` → `opsrun.reject_job_link(p_request_id uuid, p_bzzzbx_job_id text, p_reason text)`:

- `require_operator()`; la request está `open`;
- escribe `audit_event` `job_link_rejected` con `details = {"bzzzbx_job_id": …}` y el motivo si lo hay;
- no toca la request.

El candidato rechazado ya no se propone para esa request (§4, paso 3). Para otra request sí.

## 7. Migración nueva (pide OK)

`supabase/migrations/2026112512xxxx_fase_a_enlace.sql`, solo hacia adelante, como `opsrun_migrador`:

- catálogo `audit_event_type`: agrega `job_link_rejected` ("Job link rejected", `requires_reason = false` [P-2], fuente `opsrun`, orden junto a `request_scheduled`);
- funciones `opsrun.link_observed_job` y `opsrun.reject_job_link`, con `grant execute` solo a `opsrun_app`;
- no cambia tablas, triggers ni vistas `v1_*`: el write-back ya expone `bzzzbx_job_id`, `job_number`, `scheduled_at` y `audit_event`.

Guards:

- G5 y G6 (`guard_funciones.test.sql`) ya descubren las funciones `security definer` de `opsrun*` y exigen `search_path` fijo y que llamen a `require_operator()` o `require_system()`; las dos nuevas entran solas y esos guards ya se ven fallar en cada corrida. Además se ve en rojo una vez quitando `require_operator()` de `link_observed_job` en local.
- Nuevo pgTAP `fase_a_enlace.test.sql`: sin actor operador las dos funciones fallan; con el gate incompleto `link_observed_job` falla; un job ya enlazado no se enlaza a otra request; cada llamada deja su `audit_event` con actor; la request enlazada queda con el borrador congelado. El test de "sin operador" se ve fallar una vez quitando `require_operator()`.

## 8. Pruebas (TDD)

- Contrato de `buscarJobs` (falso y, con `BZZZBX_CONTRATO_REAL=1`, real): §3.
- `enlace.test.ts` (Vitest, con el falso y un lector de requests inyectado): búsqueda armada desde el borrador, descartes, orden, Suggested, motivo vacío, BzzzBX caído; `confirmarEnlace` no llama a la base si el job no existe o está cancelado.
- Integración contra la base con la seed (`OPSRUN_REQUIERE_BASE=1`, corre en CI): confirmar y rechazar de punta a punta, y que lo propuesto después de rechazar ya no trae ese job.
- pgTAP §7.

## 9. Preguntas para Henry

- **P-0. Migración.** §7 agrega un tipo de Audit y dos funciones. Sin migración no hay cómo escribir el enlace (hoy no existe ninguna función de escritura). Pide tu OK.
- **P-1. Gate.** En la Fase A, ¿enlazar exige el gate de Schedule (dueño y confirmaciones de details, sender y cleaner)? Recomiendo **sí**: el trigger de OPR-20 ya lo hace, Audit muestra lo mismo que en la Fase B y no hay que tocar la migración de OPR-20. Lo malo: el operador confirma en opsRUN cosas que ya decidió al crear el job en PINCH. Alternativa: el enlace solo exige dueño, y eso cambia el trigger.
- **P-2. Motivo del rechazo.** Recomiendo opcional: rechazar un candidato es corregir una propuesta, no una acción sobre el job. Si lo quieres obligatorio, `requires_reason = true` y G12 lo cubre solo.
- **P-3. Evento de Audit del enlace.** Recomiendo `request_scheduled` con `mode: "linked"` en vez de un tipo nuevo `job_linked`: la pestaña Audit (OPR-35) muestra "Scheduled" en las dos fases.
- **P-4. Deshacer un enlace.** Fuera de alcance. Si un operador enlaza el job equivocado, hoy no hay salida (borrador congelado). ¿Lo dejamos para cuando exista Reschedule / Cancel job (OPR-29) o lo necesitas antes del primer lanzamiento?

## 10. Supuestos

| # | Supuesto |
|---|---|
| S-1 | `buscarJobs` acepta un rango de a lo sumo 62 días. |
| S-2 | `buscarJobs` devuelve a lo sumo 50 jobs. |
| S-3 | Ventana de búsqueda: `service_date` ± 3 días; sin fecha, 30 días desde que llegó la request. |
| S-4 | Suggested = misma propiedad y misma fecha. |
| S-5 | `job_number` del job observado es el Job number que se guarda en la request. |
