# OPR-22 — Stand-ins de BzzzBX (puertos de lectura e instrucciones)

- **Tarjetas:** OPR-22 (read layer), con la forma del puerto de OPR-23 (instruction layer). Contrato real: OPR-6.
- **Estado:** borrador **provisional**, para revisión de Henry. El contrato real (OPR-6) no existe. Este spec sigue el Runbook 1.1 de opsRUN (en Relevo, adjunto a OPR-6), que describe el contrato que se va a acordar; las referencias son a sus secciones. Todo lo marcado **[S-n]** es un supuesto que se cambia cuando llegue OPR-6, y lo marcado **P-n** es una pregunta para Henry (§9).
- **Decisión:** [ADR 0005](../adr/0005-puerto-de-bzzzbx.md)
- **Autorización:** Henry autorizó adelantar la parte local de OPR-22 y la forma del puerto de OPR-23 sin OPR-6. OPR-44 y el Runbook §6.2 piden construir contra stand-ins mientras tanto.

## 1. Para qué

Las pantallas (OPR-25 en adelante) necesitan leer de BzzzBX y mandarle instrucciones. El contrato real no existe. Este spec fija dos **puertos** (interfaces TypeScript) por los que opsRUN habla con BzzzBX, y una **implementación falsa en memoria** con datos inventados que encajan con `supabase/seed.sql`. Cuando llegue OPR-6 se escribe la implementación real detrás de los mismos puertos, se cambia por configuración, proyección por proyección (Runbook §6.2), y se corren contra ella las mismas pruebas de contrato.

Fuera de alcance:

- la implementación real (espera OPR-6 y las proyecciones de OPR-44);
- la caché de "último dato conocido" y el aviso de BzzzBX caído en pantalla: son de la read layer que usa el puerto, no del puerto (§6);
- escribir en `opsrun.instruction` y `opsrun.audit_event`: lo hacen las funciones SQL de OPR-20 y OPR-23. El puerto solo transporta;
- las señales que opsRUN emite por Signal Maker (Runbook §4.4) y las vistas para la IA (§4.5);
- la proyección `prediction` (Runbook §4.1: "cuando exista"; OPR-12);
- migraciones: este trabajo no toca la base (ver P-0).

## 2. Principios que aplica

- **Un solo dueño.** El puerto devuelve datos de PINCH para mostrarlos; opsRUN no los guarda. Solo se guardan los crosswalk IDs (`bzzzbx_*_id`) que ya define OPR-20. El falso vive en memoria del proceso, nunca en la base.
- **Toda acción es una instrucción.** El puerto de instrucciones es el único camino de salida. No hay llamadas a Gmail, al proveedor de SMS, a la base de PINCH ni a Claude.
- **Una acción termina cuando se observa en el origen,** no cuando se envía (Runbook §7.1). El puerto distingue "aceptada" de "confirmada".
- **Repo público.** Datos del falso inventados (`@example.test`, `bx-…`, nombres genéricos). Ningún host, IP ni nombre de servicio interno de BzzzBX.

## 3. Puerto de lectura (`src/lib/bzzzbx/lectura.ts`)

### 3.1 Entidades (proyecciones)

Las proyecciones que el Runbook §4.1 dice que opsRUN lee, que coinciden con OPR-44. Cada entidad lleva su crosswalk ID y una `version` que cambia cuando cambia la entidad. Los nombres de los campos son **supuestos [S-1]**; qué campos hay sale del Runbook §4.1 cuando lo dice y, si no, de lo que piden el tablero y la Job window (OPR-25, OPR-26, OPR-28 a OPR-32).

| Entidad | Crosswalk ID | Campos (supuestos) | Frescura (Runbook §4.1) | Lo usa |
|---|---|---|---|---|
| `Job` | `bzzzbx_job_id` | `job_number`, `bzzzbx_customer_id`, `bzzzbx_property_id`, `bzzzbx_space_id`, `bzzzbx_service_id`, `service_date`, `window_start`, `window_end`, `status` (`scheduled`, `cancelled`), `bzzzbx_team_id` (cleaner), `po_number` | ≤ 1 min | Card, etapas, Billing |
| `Assignment` | `bzzzbx_assignment_id` | `bzzzbx_job_id`, `bzzzbx_team_id`, `status` (`assigned`, `confirmed`, `declined`, `cancelled`) | ≤ 1 min | Cleaner del job, OPS-020 |
| `Customer` | `bzzzbx_customer_id` | `name`, `po_required` | ≤ 1 min | Card, Who is it from?, Validate |
| `Contact` | `bzzzbx_contact_id` | `bzzzbx_customer_id`, `name`, `email`, `phone` | ≤ 1 min | Who is it from?, Requester |
| `Property` | `bzzzbx_property_id` | `name`, `city`, `units[]` (`bzzzbx_space_id`, `label`), `default_team_id` | ≤ 1 min | Card (city), pestaña de la propiedad |
| `CleanerTeam` | `bzzzbx_team_id` | `name`, `phone`, `active`, `available_dates[]` | ≤ 1 min | Cleaner, sugerencias (OPR-37) |
| `Service` | `bzzzbx_service_id` | `name`, `type` | ≤ 1 min [S-2] | Card (type \| service) |
| `JobTrackerEvent` | `bzzzbx_event_id` | `bzzzbx_job_id`, `kind` (`checked_in`, `started`, `completed`), `occurred_at` | ≤ 1 min | Etapas In Progress / Complete, Job tracker |
| `Photo` | `bzzzbx_photo_id` | `bzzzbx_job_id`, `phase` (`before`, `after`), `taken_at`, `ref` (referencia, no el archivo) | ≤ 1 min | Job tracker, ORG-002/003 |
| `Message` | `bzzzbx_message_id` | `bzzzbx_thread_id`, `channel` (`email`, `text`), `direction`, `from`, `to`, `subject`, `body`, `sent_at`, `delivery` (`queued`, `sent`, `delivered`, `failed`) | ≤ 1 min | Conversation, intake, Message not delivered |
| `Payment` | `bzzzbx_job_id` | `paid`, `paid_at`, `bzzzbx_event_id` (para deduplicar `job_paid` en Audit) | **≤ 1 h** | Paid (OPR-10, OPR-32) |
| `AlertResult` | `bzzzbx_alert_id` | sujeto (§3.1.1), `rule_id`, `rule_version`, `level`, `reason_text`, `opened_at`, `cleared_at` | ≤ 1 min | Alerts (OPR-33, OPR-34) |
| `JobHealth` | `bzzzbx_job_id` | `status` (`on_track`, `at_risk`, `breached`) | ≤ 1 min | Colores de la card |

`Service` no está en la lista del Runbook §4.1 ni en OPR-44, pero el job lleva su servicio y la card lo muestra. Aquí entra como proyección propia [S-2].

#### 3.1.1 Sujeto de una alerta

El Runbook §8.1 dice que OPS-001 y OPS-002 se calculan sobre el estado vivo de opsRUN, antes de que haya job. El sujeto de un `AlertResult` es entonces uno de [S-3]:

- `{ tipo: "job", bzzzbx_job_id }`;
- `{ tipo: "request", request_id }`, con el `id` de `opsrun.request` (uuid de opsRUN, no un crosswalk);
- `{ tipo: "message", bzzzbx_message_id }`, para Message not delivered.

### 3.2 Operaciones

```ts
interface LecturaBzzzbx {
  // Una entidad por crosswalk ID; null si BzzzBX no la conoce.
  obtener<E extends Entidad>(entidad: E, id: string): Promise<Leido<Tipo<E>> | null>;
  // Varias por ID (para pintar el tablero en una sola ida).
  obtenerVarios<E extends Entidad>(entidad: E, ids: string[]): Promise<Leido<Tipo<E>>[]>;
  // Por relación: eventos, fotos y pagos de un job, mensajes de un hilo,
  // alertas de un sujeto.
  listarPor<E extends EntidadHija>(entidad: E, filtro: FiltroDe<E>): Promise<Leido<Tipo<E>>[]>;
  // Jobs candidatos para enlazar una request en la Fase A (Runbook §6.1).
  buscarJobs(filtro: { bzzzbx_customer_id?: string; bzzzbx_property_id?: string; service_date?: string }): Promise<Leido<Job>[]>;
  // Cambios desde un cursor (§3.3).
  cambiosDesde(cursor: Cursor | null): Promise<LoteDeCambios>;
}

type Leido<T> = T & { version: string; leido_en: string /* ISO, hora de BzzzBX */ };
```

`buscarJobs` sale del Runbook §6.1: en la Fase A el job se crea en las herramientas de PINCH y opsRUN enlaza la request con el job observado buscando por cliente, propiedad y fecha, y le pide al operador que confirme el enlace.

Errores tipados (clases en `src/lib/bzzzbx/errores.ts`):

- `BzzzbxNoDisponible`: BzzzBX no responde o tarda más que el límite. La read layer muestra lo último conocido con aviso (OPR-22).
- `CursorCaducado`: el cursor ya no sirve, por ejemplo porque se reconstruyó una proyección (§3.4). La read layer vuelve a leer todo lo que muestra y pide un cursor nuevo con `cambiosDesde(null)`.

### 3.3 Aviso de cambios (meta: menos de 1 minuto)

El Runbook §3.4 dice que opsRUN lee las proyecciones con actualizaciones en tiempo real. Como esa vía todavía no existe y hay una forma alternativa en discusión (P-1), el contrato del puerto es un **sondeo con cursor**, y el realtime, cuando exista, solo lo despierta antes [S-4]:

```ts
type LoteDeCambios = {
  cambios: { entidad: Entidad; id: string; version: string }[];
  cursor: Cursor;      // opaco; se pasa en la siguiente llamada
  hay_mas: boolean;    // si true, se vuelve a pedir enseguida
};
```

- `cambiosDesde(null)` no devuelve cambios: devuelve el cursor de "ahora".
- Un cambio solo dice **qué** cambió (entidad, id, versión). El dato se vuelve a leer con `obtener`, así el cambio no lleva datos de PINCH que alguien pueda guardar.
- La read layer sondea cada 15 s [S-5]. Con eso un cambio se ve en menos de 1 minuto aunque falle un sondeo, siempre que la proyección cumpla su frescura (≤ 1 min; ≤ 1 h para `Payment`).
- El mismo puerto sirve si la lectura real es una consulta a Postgres con realtime o un cliente HTTP con sondeo.

### 3.4 Reconstrucción de proyecciones

Las proyecciones se pueden tirar y reconstruir y nunca se respaldan (Runbook §3.2). El rebuild test del Runbook §3.2 y §13.1 vacía todas las proyecciones de opsRUN, las vuelve a llenar y comprueba que las pantallas se ven igual; si no, algo que no debía se volvió autoritativo.

Lo que se prueba ahora, del lado de opsRUN [S-6]:

- el falso tiene `reconstruir()`: vacía sus proyecciones y las vuelve a llenar desde sus datos;
- tras reconstruir, el cursor viejo da `CursorCaducado` y los crosswalk IDs no cambian;
- una prueba lee el modelo del tablero (lo que la read layer arma con `request` y el puerto) antes y después de reconstruir, y debe ser igual.

El rebuild test completo (pgTAP más el llenado real de BzzzBX) llega con las proyecciones reales.

## 4. Puerto de instrucciones (`src/lib/bzzzbx/instrucciones.ts`)

### 4.1 Cómo es en el Runbook

El Runbook §4.2 y §7.1 dicen que `opsrun.instruction` **es** el outbox: la función SQL escribe la acción, su Audit y su fila de outbox en una sola transacción, y el plano de acciones de BzzzBX la lee, la ejecuta y la cierra. En local, el stand-in es un outbox que un stub vacía y contesta (§6.2). La clave de idempotencia es el id de la instrucción (§7.1).

Hoy opsRUN no tiene las funciones SQL de las acciones ni las de resultado (`resolve_instruction` y compañía, OPR-20 §4, se escriben con cada tarjeta). Por eso el puerto aísla el transporte: con el outbox, "entregar" es la escritura que ya hace la función SQL; sin él, sería una llamada. La decisión es de Henry (P-2).

### 4.2 Operaciones

```ts
interface InstruccionesBzzzbx {
  // Entrega la instrucción. Idempotente por idempotency_key: repetir la misma
  // clave devuelve el mismo acuse y no duplica la acción.
  entregar(instr: Instruccion): Promise<Acuse>;
  // Avances y cierres desde un cursor (sondeo, como §3.3).
  resultadosDesde(cursor: Cursor | null): Promise<LoteDeResultados>;
  // Estado actual de una instrucción, por su clave.
  estado(idempotency_key: string): Promise<Resultado | null>;
}

type Instruccion = {
  idempotency_key: string;           // = opsrun.instruction.idempotency_key [S-7]
  tipo: TipoInstruccion;             // = catálogo opsrun.instruction_type
  payload: Record<string, unknown>;  // = opsrun.instruction.payload
  actor: { tipo: "operator"; operator_id: string } | { tipo: "system"; proceso: string };
  sujeto?: { bzzzbx_job_id?: string; request_id?: string };
};

type Acuse = { idempotency_key: string; bzzzbx_reference: string; aceptada_en: string };

type Paso = "requested" | "authorized" | "awaiting_approval" | "dispatched" | "executed" | "observed";

type Resultado =
  | { idempotency_key: string; estado: "en_curso"; paso: Paso }
  | { idempotency_key: string; estado: "confirmada"; bzzzbx_reference: string; datos?: Record<string, unknown> }
  | { idempotency_key: string; estado: "fallida"; error_code: string; error_message: string }
  | { idempotency_key: string; estado: "sin_confirmar"; motivo: string };
```

Los cuatro estados de `Resultado` siguen el cierre del Runbook §7.1: éxito verificado, fallo o desconocido ("Couldn't confirm", con reintento). `paso` dice en cuál de los siete pasos va, para mostrar "Sending…", "Waiting for approval" o "Sent". `datos` de una confirmación trae solo lo que opsRUN debe guardar, por ejemplo `bzzzbx_job_id` y `job_number` de `create_job` [S-8].

`entregar` puede lanzar `BzzzbxNoDisponible` (no se entregó: se reintenta con la misma clave) o `InstruccionRechazada` (BzzzBX la rechaza al recibirla, por payload inválido o tipo desconocido).

`TipoInstruccion` son los 12 códigos del catálogo `opsrun.instruction_type` de OPR-20. El Runbook §4.3 da otra lista (P-3).

### 4.3 Estados de `opsrun.instruction`

Propuesta de correspondencia entre los siete pasos (Runbook §7.1) y los cinco estados de OPR-20, **para que Henry la confirme o la cambie (P-2)**:

| Paso (Runbook §7.1) | Lo que ve el operador (§7.1) | Estado de OPR-20 propuesto |
|---|---|---|
| Requested | Sending… | `pending` |
| Authorized | Sending… | `pending` |
| Approved, si hace falta | Waiting for approval | `pending` (no hay estado propio) |
| Dispatched | Sent | `sent` |
| Source executed | Sent | `sent` |
| Observed / reconciled | Confirmed | `confirmed` |
| Closed: éxito | Confirmed | `confirmed` |
| Closed: fallo | — | `failed` |
| Closed: desconocido | Couldn't confirm | `timed_out` |

Lo que no encaja: OPR-20 no tiene estado para "Waiting for approval" ni distingue "sin confirmar" de "se pasó el plazo", y su trigger solo deja avanzar el estado, mientras que "Couldn't confirm" admite reintento. El falso emite `paso` y los cuatro estados de `Resultado`; la traducción a `opsrun.instruction` la hace quien escriba el resultado (las funciones de OPR-23), no el puerto.

### 4.4 Error forzado

El falso deja provocar un error para probar que "a forced error is shown and recorded" (OPR-23):

```ts
falso.forzarError({ tipo?: TipoInstruccion; idempotency_key?: string;
                    cuando: "al_entregar" | "al_ejecutar" | "sin_confirmar" | "no_disponible";
                    error_code?: string; error_message?: string; veces?: number });
```

- `al_entregar`: `entregar` lanza `InstruccionRechazada`.
- `al_ejecutar`: `entregar` acusa y el resultado llega `fallida`.
- `sin_confirmar`: el resultado llega `sin_confirmar` (el origen no lo muestra).
- `no_disponible`: `entregar` lanza `BzzzbxNoDisponible` (prueba el reintento idempotente).

Para los E2E, que no tocan el objeto en memoria, el payload puede traer `"__forzar_error": "<cuando>"` y el falso lo atiende [S-9]. Solo el falso lo lee; el real lo rechaza como payload inválido.

### 4.5 Efectos en la lectura

En el falso, una instrucción confirmada cambia lo que devuelve la lectura, porque en el contrato real la confirmación llega cuando el cambio se observa como proyección (Runbook §7.1): `create_job` crea el `Job` y su `Assignment`, `reschedule_job` cambia fecha y ventana, `cancel_job` pone `cancelled`, `write_po` llena `po_number`, `send_email` y `send_text` crean un `Message` con `delivery = sent`. Cada efecto genera su cambio en `cambiosDesde`. El resto de tipos solo confirma [S-10].

## 5. Implementación falsa

- `src/lib/bzzzbx/falso/`: `LecturaFalsa` e `InstruccionesFalsas`, en memoria, con un reloj inyectable para probar tiempos sin esperas.
- Resolución asíncrona: una instrucción avanza un paso por cada `avanzar()` (pruebas) o tras un retardo corto (servidor local) [S-11].
- Controles de prueba, solo en el falso: `forzarError`, `noDisponible(on/off)`, `cambiar(entidad, id, parche)` (simula un cambio en el origen, por ejemplo un check-in), `reconstruir()`, `avanzar()`, `exigirAprobacion(tipo)` (para ver "Waiting for approval").
- **Datos** (`falso/datos.ts`): inventados y con los **mismos crosswalk IDs que `supabase/seed.sql`**: `bx-cust-0001`…`0003`, `bx-cont-0001`…`0004`, `bx-prop-0001`…`0006`, `bx-space-0002`, `bx-svc-0001`…`0003`, `bx-team-0001`…`0003`, `bx-job-0003`…`0006` con `EX-00003`…`EX-00006`, `bx-msg-0001`…`0006` y `bx-msg-0102`, `bx-thread-0001`…`0006`, `bx-evt-0001`…`0005`, `bx-alert-0001`…`0004`. Los estados encajan con la seed: R4 con check-in y inicio, R6 con fin, PO y Paid, la alerta OPS-001 abierta sobre R1. Un cliente (`bx-cust-0003`, el de R6) exige PO.
- La seed armaba `bx-job-…`, `bx-msg-…`, `bx-thread-…` y el job number con el R number, que depende de la secuencia: en una base local ya usada no empieza en 1 y los IDs dejaban de coincidir. Ahora salen del último dígito del id fijo de cada request, con los mismos valores que en una base nueva. No es una migración.
- Una prueba compara los crosswalk IDs de la seed con los del falso: los literales leyendo `seed.sql`, y los que la seed arma, contra la base recién cargada del job de E2E de la CI (`OPSRUN_REQUIERE_BASE=1`).

### 5.1 Selección por variable de entorno

`BZZZBX_MODO` = `falso` | `real` [S-12]. Una fábrica `crearBzzzbx(env)` en `src/lib/bzzzbx/index.ts` devuelve los dos puertos.

- Fuera del servidor (local, CI) el valor por defecto es `falso`.
- Con `OPSRUN_SERVIDOR=1` el valor por defecto es `real`, y `BZZZBX_MODO=falso` no deja arrancar: el falso nunca corre en staging ni en producción. Se valida en `asegurarEntorno()` junto con lo de OPR-1. No se hace obligatoria para no agregarle una variable al deploy de OPR-1 antes de que exista el real.
- `real` lanza "no implementado (OPR-6)" hasta que exista.
- El Runbook §6.2 cambia cada stand-in por su fuente real de a una proyección o acción. Eso pide una selección por proyección, no un interruptor único; se agrega cuando exista la primera fuente real [S-12].

## 6. Lo que queda para la read layer

Este trabajo entrega puertos y falso, no la read layer completa de OPR-22. Lo que la read layer hará encima, cuando se construya con OPR-25:

- el bucle de sondeo cada 15 s y quién lo corre (servidor de Next; las pantallas reciben el cambio por la vía que decida OPR-25);
- el "último dato conocido" en memoria y el aviso cuando `BzzzbxNoDisponible`;
- el cálculo de la etapa del tablero (OPR-20 §5) con `request` y los `JobTrackerEvent`.

## 7. Pruebas del contrato

- `src/lib/bzzzbx/contrato/lectura.contrato.ts` y `instrucciones.contrato.ts` exportan `probarContratoDeLectura(crear)` y `probarContratoDeInstrucciones(crear)`, con las pruebas de Vitest que debe cumplir **cualquier** implementación: entidades con crosswalk ID y `version`, `null` para un ID desconocido, cursor que avanza, `cambiosDesde(null)` vacío, idempotencia de `entregar`, resultados por cursor, que ningún resultado vuelva atrás después de cerrar.
- `falso.contrato.test.ts` las corre contra el falso.
- `real.contrato.test.ts` las corre contra el real con `describe.skipIf(!process.env.BZZZBX_CONTRATO_REAL)`, para encenderlas cuando exista OPR-6 (en el laboratorio y en staging, no en CI). Es la capa "Contract" del Runbook §13.1.
- Lo que depende de controles del falso (error forzado, cambio en el origen, reconstrucción, aprobación) va aparte, en pruebas del falso: el real no tiene esos controles.
- TDD: cada prueba se ve en rojo antes de escribir la implementación.

## 8. Supuestos (cambiar con OPR-6)

| # | Supuesto |
|---|---|
| S-1 | Los nombres y tipos de los campos de cada entidad de §3.1. |
| S-2 | `Service` es una proyección propia con frescura ≤ 1 min. |
| S-3 | El sujeto de una alerta es un job, una request de opsRUN (su uuid) o un mensaje. |
| S-4 | El contrato del aviso de cambios es un sondeo con cursor opaco; el realtime, si existe, solo lo despierta. |
| S-5 | Sondeo cada 15 s. |
| S-6 | Tras reconstruir una proyección: cursor caducado, mismos crosswalk IDs, mismo tablero. |
| S-7 | La clave de idempotencia es `instruction.idempotency_key`. El Runbook §7.1 dice que es el id de la instrucción; se pueden hacer iguales al crearla. |
| S-8 | La confirmación trae `bzzzbx_reference` y, para `create_job`, `bzzzbx_job_id` y `job_number`. |
| S-9 | Error forzado por marca en el payload, solo en el falso. |
| S-10 | Qué tipos de instrucción cambian la lectura y cómo. |
| S-11 | Ritmo de avance del falso en local. |
| S-12 | Nombre `BZZZBX_MODO` (PLAN §3 deja `BZZZBX_…` por definir en OPR-6), `real` por defecto en el servidor y un interruptor único hasta la primera fuente real. |

## 9. Preguntas para Henry y su respuesta

Henry aceptó las recomendaciones de abajo (24 nov). Cada una dice qué queda decidido y qué sigue abierto con el equipo de BzzzBX.

- **P-0. ¿Stand-in en memoria o en la base?** El encargo de esta tarea pide un falso en memoria elegido por variable de entorno. El Runbook §6.2 describe los stand-ins como proyecciones sembradas con datos inventados y un outbox que un stub local vacía y contesta, es decir, en Postgres; y su rebuild test (§3.2) corre en CI vaciando y rellenando proyecciones. Este spec hace el falso en memoria, detrás del puerto, sin migraciones. Si la respuesta a P-1 es "proyecciones en Supabase", la implementación real lee tablas, y el stand-in en Postgres (proyecciones creadas por un script local que imita a BzzzBX, como `supabase/alta-local.sql` imita el alta) sería el banco de pruebas de esa implementación. Eso no es una migración de opsRUN, pero toca la base local: pide tu OK.
  - **Decisión:** el falso se queda en memoria, sin tocar la base local. Se revisa solo si P-1 resulta ser proyecciones en Supabase.
- **P-1. ¿Cómo lee opsRUN de BzzzBX?** El Runbook §3.4 y el hilo de OPR-22 (24 nov) dicen: proyecciones en el Supabase de BzzzBX con actualizaciones en tiempo real, sin una API de lectura. La respuesta de la caja en OPR-6 (D77) dice: vistas con versión sobre HTTP, con un certificado por aplicación y cada lectura auditada. Son contratos distintos. El puerto de §3 sirve para los dos; la implementación real y su prueba de staging dependen de la respuesta.
  - **Decisión:** la dirección es vistas con versión sobre HTTP, con certificado por aplicación y lectura auditada. **Sigue abierto:** que el equipo de BzzzBX lo confirme por escrito en OPR-6 y diga de dónde sale el aviso de cambios (endpoint de cambios o sondeo con versión) para cumplir el minuto. El puerto no cambia mientras tanto.
- **P-2. ¿Cómo encajan los siete pasos con los cinco estados de `opsrun.instruction`?** El Runbook §7.1 tiene siete pasos, un paso de aprobación humana y tres cierres (éxito, fallo, desconocido con reintento). OPR-20 tiene cinco estados que solo avanzan. §4.3 propone una correspondencia, que deja sin estado "Waiting for approval" y usa `timed_out` para "Couldn't confirm". Cambiarlo es una migración nueva sobre la de OPR-20 y pide tu OK.
  - **Decisión:** no se toca la migración de OPR-20 en OPR-22. El paso fino vive en el puerto (`Resultado.paso`) y opsRUN guarda el estado grueso. Se cambia la migración solo si una pantalla necesita filtrar "Waiting for approval" o "Couldn't confirm" desde la base, y antes del primer deploy con datos reales. Mientras tanto, un `timed_out` por "Couldn't confirm" se reconcilia, no se reintenta a ciegas.
- **P-3. ¿Qué lista de instrucciones manda?** El catálogo de OPR-20 tiene `end_job_manually` y cuatro tipos de IA (`ai_*`). El Runbook §4.3 no los tiene, y en cambio tiene `record_completion`, `record_approval` y `acknowledge_alert` (este último, para que Clear alert no se vuelva a abrir, §8.2). El Runbook §9 hace pasar la IA por la capa de IA de BzzzBX, no por el outbox. El falso acepta hoy los 12 de OPR-20.
  - **Decisión:** manda el catálogo de OPR-20. `acknowledge_alert` se agrega cuando se construya Clear alert. La IA va por la capa de IA de BzzzBX, no por el outbox, así que los `ai_*` salen del catálogo cuando se cambie su migración; el falso sigue aceptando los 12 hasta entonces. **Sigue abierto:** preguntar a BzzzBX si soporta `end_job_manually`.
- **P-4. Fase A.** El Runbook §6.1 propone que en la Fase A opsRUN no mande la mayoría de las acciones: registra decisiones y observa lo que se hace en las herramientas de PINCH. Si se adopta (OPR-42), el puerto de instrucciones casi no se usa en la Fase A, y `buscarJobs` pasa a ser lo más urgente del puerto de lectura.
  - **Decisión:** se adopta la Fase A para el primer lanzamiento (OPR-42): opsRUN registra decisiones y observa. `buscarJobs` es lo más urgente del puerto de lectura; el de instrucciones queda construido pero casi sin uso.
