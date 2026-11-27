# OPR-26 — Job window, pestañas, action bar y estados no disponibles

- **Tarjeta:** OPR-26 (P2 · Job window, tabs, action bar and unavailable states). Depende de OPR-25 (tablero, PR #11, sin fusionar) y de OPR-4 (nombres de las acciones, sin decidir).
- **Estado:** borrador para revisión de Henry. **No se implementa nada hasta su OK.** Lo marcado **[S-n]** es un supuesto; lo marcado **P-n** es una pregunta para Henry, con recomendación (§11).
- **Construye sobre:** el puerto de BzzzBX y su falso (`src/lib/bzzzbx/`, ADR 0005, en `main`), el tablero (`src/lib/tablero/`, `src/app/_tablero/`, PR #11) y el enlace de la Fase A (`src/lib/fase-a/`, PR #12). Este spec supone los dos PR fusionados antes de implementar.
- **Fuera de alcance:** el contenido de la conversación (OPR-27), del enlace de la Fase A y del resto de la pestaña de la propiedad (OPR-28), de Alerts (OPR-34), de Audit (OPR-35), de Job tracker (OPR-30) y de Billing (OPR-32); cada acción concreta (OPR-28 a OPR-32); el login (OPR-21). De esas piezas OPR-26 entrega **su lugar en la ventana y su contrato de props** (§7).

## 1. Para qué

Desde una tarjeta del tablero el operador abre la **Job window** del job: arriba el encabezado, a la izquierda la conversación, a la derecha las pestañas, y una **action bar** para actuar. OPR-26 entrega el marco: abrir rápido, mostrar lo que hay, decir con claridad lo que no está, y garantizar que una acción que no corre no se pueda correr. Las tarjetas de etapa (OPR-28 a OPR-32) enchufan después sus acciones y pestañas sin tocar el marco.

Para la demo local del lunes (Fase A sobre el stand-in): tablero → Job window → enlace con el job observado → Audit. El enlace y la pestaña Audit se ven en su lugar si OPR-28 y OPR-35 llegan a tiempo; si no, se ven los marcadores de §7.

**Prototipo R23: no disponible [S-1].** No se pudo abrir desde esta cuenta (igual que en OPR-25, P-0 abierta). La distribución sale de la tarjeta, del glosario y del tablero ya construido. Todo lo visual se revisa contra R23 cuando se pueda ver.

## 2. Abrir y cerrar

| Tema | Regla |
|---|---|
| Ruta | `/job/[requestId]`, con el `id` (uuid) de `opsrun.request`. El job number no sirve: no existe hasta Scheduled, y la request sí desde que llega. |
| Desde el tablero | La tarjeta pasa a ser un enlace (`<a href="/job/…">`): clic, Enter y abrir en otra pestaña funcionan. La ventana se abre **encima del tablero**, que sigue debajo (ruta interceptada `@ventana/(.)job/[requestId]` del App Router) (P-1). |
| URL directa o recarga | Misma ventana como página completa, con un enlace "Board" para volver. |
| Cerrar | Botón ✕, tecla Esc o atrás del navegador: vuelve al tablero sin recargarlo. |
| Pestaña activa | En la URL: `?tab=property|alerts|audit|tracker|billing`. Sin `tab`, la regla de §4.2. |
| Meta de tiempo | **< 2 s** del clic en la tarjeta al encabezado y la action bar visibles (Hecho cuando de la tarjeta). Las pestañas y la conversación pueden llegar después en su propio `Suspense`. |

Para cumplir los 2 s:

- todo se lee en el servidor, en una sola pasada en paralelo (§8);
- la lectura de BzzzBX tiene un presupuesto de **1,5 s** [S-2]: si no responde a tiempo, la ventana se pinta con lo último conocido y el aviso de §6.1, como si BzzzBX estuviera caído;
- el encabezado no espera a las pestañas ni a la conversación (streaming con `Suspense`).

## 3. Encabezado

| Parte | Qué muestra | De dónde sale |
|---|---|---|
| Stage | Requests, Scheduled, In Progress, Complete o Validation, calculada igual que en el tablero (OPR-25 §1.3, OPR-20 §5). Paid se ve como marca verde junto a Validation. Un job `cancelled` muestra "Cancelled" [S-3]. | opsRUN + puerto (misma función del tablero) |
| Property and space | `Property.name` + espacio (`units[].label` o `request.unit`), como el nombre de la tarjeta (S-2 de OPR-25). | Puerto + opsRUN |
| Job line | Número (`R<n>` o job number) · fecha y ventana · servicio · cleaner. En Requests, con lo del borrador; desde Scheduled, con lo del `Job` [S-4]. | opsRUN + puerto |
| Price | Solo lectura, sin edición ni enlace. Hoy el puerto no trae precio: se ve `— —` (P-6). | Puerto (si P-6 dice sí) |
| Assigned to | Nombre del dueño, o "Unassigned". Junto a cada operador activo, una **barra de carga** [S-5]. Cambiar el dueño es una acción (Assign / Reassign, OPR-28), no un control del encabezado. | `request.owner_operator_id`, `operator` |

Lo que falte se ve como `— —`, igual que en el tablero.

## 4. Pestañas

### 4.1 Cuáles y cuándo

En este orden, de izquierda a derecha [S-6]:

| Pestaña | Nombre visible | Aparece | Contenido (tarjeta) |
|---|---|---|---|
| Propiedad | El nombre del espacio o unidad (`units[].label` o `request.unit`); sin espacio, el de la propiedad; sin propiedad, "Property" | Siempre | OPR-28 (Requests); desde Scheduled, resumen de solo lectura (§4.3) |
| Audit | Audit | Desde Scheduled | OPR-35 |
| Job tracker | Job tracker | Desde In Progress | OPR-30 |
| Billing | Billing | En Validation | OPR-32 |
| $ | $ | Siempre, en gris | — |
| People | People | Siempre, en gris | — |
| Alerts | Alerts, con el conteo de las que piden acción | Siempre, a la derecha del todo | OPR-34 |

- "Desde X" sigue la etapa: una pestaña que aún no toca **no se muestra** [S-7]. Un `?tab=` de una pestaña que no toca cae a la regla de §4.2.
- **$ y People**: se ven, con `aria-disabled="true"` y el título "Not available in this release". No se seleccionan con clic ni con teclado y no cambian la URL.
- Accesibilidad: `role="tablist"`, flechas para moverse entre las que están disponibles, `aria-selected` en la activa.

### 4.2 Pestaña inicial

1. Si hay un `?tab=` válido para la etapa, esa.
2. Si no, **Alerts cuando alguna alerta pide acción** (Needs action [S-8]).
3. Si no, la pestaña de la propiedad.

**Vuelta a la propiedad:** si la ventana está en Alerts **porque la abrió la regla 2** y la última alerta que pedía acción se resuelve (llega por el refresco de §8.3), la ventana pasa sola a la pestaña de la propiedad. Si el operador eligió Alerts a mano, se queda [S-9].

### 4.3 Qué trae cada pestaña en OPR-26

OPR-26 no construye el contenido. Cada pestaña muestra su ranura (§7) y, mientras su tarjeta no llegue, un marcador con `data-ranura="<nombre>"` y el texto "Coming in a later build" [S-10]. Dos excepciones, porque sin ellas el Hecho cuando y la demo no se pueden probar:

- **Propiedad**, de solo lectura: cliente, contacto, propiedad y espacio, servicio, fecha y ventana, cleaner, PO y notas de acceso, con `— —` en lo que falte. En Requests, encima, la ranura del enlace de la Fase A (§7.2).
- **Alerts**, de solo lectura: la lista de alertas abiertas del job (regla, nivel y `reason_text`), para que la regla de §4.2 se vea. Secciones, acciones y Resolved son de OPR-34.

## 5. Action bar

### 5.1 Forma

`Action ▾` (lista de acciones) + `Go`. Elegir una acción abre un **panel** debajo de la barra con:

- el nombre de la acción y una línea de qué hace;
- el campo **Reason**, obligatorio si la acción lo pide (`requires_reason` de su catálogo, §5.3), con el contador de caracteres; opcional si no;
- lo que la acción necesite (su propio componente, §7.5: por ejemplo, la fecha nueva de Reschedule);
- `Cancel` y `Go`. `Go` queda deshabilitado mientras falte el motivo o lo que pida la acción.

Al pulsar `Go`, el panel muestra el resultado y no se cierra hasta que se vea: "Saved" (decisión registrada en opsRUN), los estados de una instrucción ("Sending…", "Waiting for approval", "Sent", "Confirmed", "Couldn't confirm", "Failed" con su mensaje; spec OPR-22 §4.3) o el error. Una acción con instrucción en curso no se puede volver a lanzar hasta que cierre.

### 5.2 Disponibilidad

Cada acción tiene una de estas disponibilidades, **calculada en el servidor**:

| Disponibilidad | Se ve | Corre |
|---|---|---|
| `disponible` | Normal | Sí |
| `no_aplica` | No aparece (no es de esta etapa) | No |
| `bloqueada` | En gris, con el motivo (por ejemplo "Add PO", "BzzzBX unavailable", "Instruction in progress") | No |
| `sin_construir` | En gris, "Not built yet" (P-4) | No |
| `fuera_de_release` | En gris, "Not available in this release" | No |

**Las acciones que no corren no se pueden correr** (Hecho cuando):

- en la interfaz, la opción está `disabled` y `Go` también;
- en el servidor, el punto de entrada único (`ejecutarAccion`, §5.4) **vuelve a calcular** la disponibilidad con los datos del momento y rechaza todo lo que no sea `disponible`, sin escribir nada en la base ni mandar nada a BzzzBX. La interfaz no es la defensa.

### 5.3 Qué acción aparece en cada etapa

Los nombres son provisionales hasta OPR-4: se usan los `label` de los catálogos `instruction_type` y `audit_event_type`, que se cambian sin migrar datos (P-5). La lista sale de las tarjetas, `CONTEXT.md` y el catálogo de OPR-20; la del Release Definition §6 se cruza cuando se pueda leer [S-11].

| Etapa | Acción | Motivo | Tarjeta que la construye | En V1.1 beta |
|---|---|---|---|---|
| Requests | Assign / Reassign | No | OPR-28 | Sí |
| Requests | Confirm details · Confirm sender · Confirm cleaner | No | OPR-28 | Sí |
| Requests | Ask cleaner | No | OPR-28 (con OPR-17) | Sí |
| Requests | Schedule — en la Fase A abre el enlace con el job observado (§7.2) | No | OPR-28 | Sí |
| Scheduled | Reschedule | Sí | OPR-29 | Sí |
| Scheduled | Cancel job | Sí | OPR-29 | Sí |
| In Progress | Clear alert (nombre por OPR-4) | Sí | OPR-30 | Sí |
| In Progress | End manually | Sí | OPR-30 | Sí |
| Complete | Approve & confirm | No | OPR-31 | Sí |
| Complete | Mark as OSS / Not OSS | No | OPR-31 | Sí |
| Complete | Reject · re-clean | — | — | **No** |
| Validation | Enter PO ("Add PO") | No | OPR-32 | Sí |
| Validation | Validate (bloqueada con "Add PO" si el cliente exige PO y no hay) | No | OPR-32 | Sí |

En OPR-26 todas las de V1.1 beta salen `sin_construir`, porque su tarjeta no existe todavía; cada tarjeta de etapa las pasa a `disponible` al registrar su ejecutor. Reject · re-clean sale siempre `fuera_de_release`. Editar To/Cc y el número temporal no son de la action bar: son de la conversación (OPR-27).

En la Fase A, las acciones que se hacen en las herramientas de PINCH (crear, reprogramar o cancelar el job) registran la decisión en opsRUN y opsRUN observa el resultado; no mandan instrucción (spec OPR-22, P-4). Eso lo decide cada tarjeta en su ejecutor; el marco no cambia.

### 5.4 Contrato del registro de acciones

Archivo nuevo `src/lib/acciones/` (servidor). La lista de §5.3 es un registro; cada tarjeta de etapa le agrega su ejecutor.

```ts
type CodigoAccion = string; // "reschedule_job", "schedule", …

type DefinicionAccion = {
  codigo: CodigoAccion;
  /** Label visible; sale del catálogo cuando existe (P-5). */
  etiqueta: string;
  etapas: Etapa[];
  enRelease: boolean;               // false → fuera_de_release
  motivo: "obligatorio" | "opcional" | "no";
  /** Si necesita BzzzBX para correr (lectura o instrucción). Sin BzzzBX → bloqueada. */
  necesitaBzzzbx: boolean;
  /** Bloqueos propios de la acción con los datos de la ventana; null si no hay. */
  bloqueo?: (v: VentanaJob) => string | null;
  /** Lo registra la tarjeta que la construye. Sin ejecutor → sin_construir. */
  ejecutor?: (ctx: ContextoAccion, entrada: EntradaAccion) => Promise<ResultadoAccion>;
  /** Campos extra del panel (componente de cliente), si la acción los pide. */
  panel?: ComponentType<PropsPanelAccion>;
};

type EntradaAccion = {
  requestId: string;
  codigo: CodigoAccion;
  motivo: string | null;
  datos: Record<string, unknown>;  // lo del panel propio
  /** change_seq de la request que vio el operador. */
  version: string;
};

type ResultadoAccion =
  | { tipo: "guardada" }                                  // decisión en opsRUN, con su Audit
  | { tipo: "instruccion"; idempotency_key: string }      // el panel sigue su estado
  | { tipo: "rechazada"; codigo: "no_disponible" | "motivo_requerido" | "cambio_concurrente" | string; mensaje: string };
```

`ejecutarAccion(entrada)` es una Server Action y el único camino:

1. lee la ventana de nuevo (§8) y calcula la disponibilidad; si no es `disponible`, `rechazada: no_disponible`;
2. valida el motivo (recortado, no vacío si es obligatorio);
3. si `version` no es el `change_seq` actual de la request, `rechazada: cambio_concurrente` ("This job changed. Review and try again.") [S-12];
4. llama al ejecutor con el actor de la transacción (P-2). El ejecutor escribe por funciones SQL, que dejan su Audit (principio 5); el marco no escribe nada por su cuenta;
5. pide el refresco de la ventana y del tablero.

## 6. Estados no disponibles

### 6.1 BzzzBX caído o lento

- Se usa lo último leído **de esa request**, en memoria del proceso y nunca en la base, como el tablero (OPR-25 §3). Si nunca se leyó, lo de BzzzBX se ve `— —`.
- Encima del encabezado, una franja roja con `role="status"`: "BzzzBX unavailable · last update HH:MM" (o "· no data yet"). Mismo texto que la barra del tablero.
- Las acciones con `necesitaBzzzbx` quedan `bloqueada` con "BzzzBX unavailable". Las que solo escriben en opsRUN (por ejemplo, Assign) siguen disponibles [S-13].
- Las ranuras reciben `bzzzbx.disponible = false` y deciden qué mostrar (§7).
- Cuando BzzzBX vuelve, el siguiente sondeo lo trae y la franja se va.

### 6.2 Request sin datos

Una request recién llegada (R1 en la seed: sin cliente, servicio, fecha ni dueño):

- encabezado con `— —` en lo que falta, "Unassigned" en Assigned to y "Not scheduled" en la parte de fecha de la job line;
- pestaña de la propiedad con el nombre de la propiedad o "Property";
- las acciones que dependen de un dato que falta quedan `bloqueada` con el dato ("Choose a property first", "Confirm who it is from first").

### 6.3 Otros casos

| Caso | Qué se ve |
|---|---|
| `requestId` que no es un uuid o no existe | Página 404 "Job not found", con enlace "Board". |
| BzzzBX no conoce una entidad (`obtener` → null) | `— —` en sus campos y, en la pestaña de la propiedad, "Not found in BzzzBX" junto al campo. |
| Job `cancelled` (el tablero no lo muestra, pero la URL sí abre) | Stage "Cancelled", ninguna acción `disponible`, pestañas de solo lectura [S-3]. |
| Error inesperado (base caída) | El `error.tsx` de la ruta: "Something went wrong" y "Try again". Sin detalles técnicos ni datos en pantalla. |

## 7. Ranuras: dónde enchufan las otras tarjetas

Cada ranura es un componente que la tarjeta dueña reemplaza. OPR-26 fija el lugar, las props y el marcador. Las props son solo datos ya leídos y Server Actions; ninguna ranura lee de BzzzBX desde el navegador.

Props comunes a todas:

```ts
type PropsRanuraBase = {
  requestId: string;
  etapa: Etapa | "cancelled";
  bzzzbx: { disponible: boolean; actualizadoEn: string | null };
  zona: string; // OPSRUN_ZONA_HORARIA (OPR-25 S-6)
};
```

### 7.1 Conversación (OPR-27)

Lugar: columna izquierda, de arriba abajo, con su propio `Suspense`.

```ts
type PropsRanuraConversacion = PropsRanuraBase & {
  /** Hilos de la request (`request_message.bzzzbx_thread_id`), el original primero. */
  hilos: string[];
  /** Si el composer puede enviar; false con BzzzBX caído o job cancelado. */
  puedeEnviar: boolean;
};
```

La ranura lee sus mensajes en su propio server component (puerto `listarPor("message")` y `request_message`, `note`) para no frenar el encabezado. Marcador en OPR-26: el marco con `data-ranura="conversacion"`.

### 7.2 Enlace de la Fase A (OPR-28)

Lugar: arriba de la pestaña de la propiedad, solo en Requests. La acción **Schedule** abre el panel de la action bar con este mismo componente.

```ts
type PropsRanuraEnlace = PropsRanuraBase & {
  /** De proponerEnlaces (src/lib/fase-a), o el error si BzzzBX no respondió. */
  propuesta: Propuesta | { error: "bzzzbx_no_disponible" };
  /** Estado del gate de Schedule, para decir qué falta antes de enlazar. */
  gate: { dueno: boolean; details: boolean; sender: boolean; cleaner: boolean };
  confirmar: (bzzzbxJobId: string) => Promise<ResultadoAccion>;              // confirmarEnlace
  rechazar: (bzzzbxJobId: string, motivo: string | null) => Promise<ResultadoAccion>; // rechazarEnlace
};
```

Lo que la ranura tiene que mostrar, como contrato:

- cada candidato con su job number, fecha, ventana, cleaner y las coincidencias (`coincide`), y **Suggested** en el que lo sea;
- **`truncado = true`**: un aviso visible con `role="status"` encima de la lista: "Showing the first 50 jobs. There may be more: narrow the property or the date." La lista se muestra igual;
- `motivo_vacio`: `sin_cliente_ni_propiedad` → "Confirm who it is from first"; `sin_candidatos` → "No matching job found in PINCH tools yet"; `request_no_abierta` → la ranura no se muestra;
- `error: bzzzbx_no_disponible` → "BzzzBX unavailable" y ningún candidato;
- gate incompleto: qué falta ("Owner", "Details", "Sender", "Cleaner"), y Confirm deshabilitado;
- los `EnlaceInvalido` de confirmar (`gate_incompleto`, `job_cancelado`, `job_ya_enlazado`, …) como mensaje en el panel, sin cerrar.

Confirmar y rechazar pasan por `ejecutarAccion` (acción `schedule` y una interna `reject_job_link`), así heredan el chequeo de disponibilidad, el actor y el refresco.

### 7.3 Audit (OPR-35)

Lugar: pestaña Audit (desde Scheduled).

```ts
type PropsRanuraAudit = PropsRanuraBase; // la ranura lee `audit_event` de la request
```

Marcador en OPR-26: `data-ranura="audit"` y "Coming in a later build".

### 7.4 Alerts (OPR-34), Job tracker (OPR-30), Billing (OPR-32)

Mismo patrón: `PropsRanuraBase` más, en Alerts, `alertas: AlertResult[]` (las ya leídas). La vista mínima de Alerts de §4.3 es el marcador de OPR-34.

### 7.5 Panel propio de una acción

```ts
type PropsPanelAccion = PropsRanuraBase & {
  ventana: VentanaJob;                       // lo leído (§8), solo lectura
  onCambio: (datos: Record<string, unknown>, completo: boolean) => void;
};
```

## 8. Qué lee

### 8.1 De opsRUN (`opsrun_app`, solo lectura, pool de `src/lib/db/`)

- la request por `id`: la fila del tablero (`CONSULTA_FILAS` de OPR-25 con `where r.id = $1`) más `bzzzbx_contact_id`, `bzzzbx_team_id`, `access_notes` y `change_seq`;
- los hilos de la request (`request_message`);
- los operadores activos con su carga (§3, S-5): un `count` de requests por `owner_operator_id`, agrupado, en la misma transacción;
- las confirmaciones vigentes (`request_confirmation`) para el gate;
- la última `instruction` abierta de la request, para el bloqueo "Instruction in progress".

OPR-26 **no escribe** en la base y **no trae migración**. Las escrituras son de los ejecutores de cada tarjeta.

### 8.2 Del puerto de BzzzBX (`obtenerBzzzbx().lectura`)

Reutiliza `leerDeBzzzbx` del tablero con una sola fila (Job, Property, Customer, Service, JobTrackerEvent, Message, Payment, AlertResult de la request y del job, JobHealth) y agrega `obtener("contact")` y `obtener("cleaner_team")`. Todo en paralelo, dentro del presupuesto de §2. Nada de esto se guarda.

El modelo lo arma una función pura `armarVentana({ fila, leidos, operadores, ahora, zona, bzzzbx })` en `src/lib/ventana/`, que reutiliza la etapa, el nombre y el estado de `armarTablero`. Es lo que prueban los unitarios.

### 8.3 Refresco

La ventana usa el mismo sondeo del tablero (`/api/tablero/cambios`, cada 15 s, `router.refresh()`). Un cambio en el origen o en opsRUN se ve en la ventana abierta en menos de 1 minuto. No hay ruta nueva.

## 9. Pruebas

### 9.1 Vitest (TDD, cada una en rojo primero)

- `armarVentana`: etapa, encabezado, `— —`, nombre de la pestaña de la propiedad, pestañas por etapa, pestaña inicial (§4.2), job cancelado.
- Disponibilidad: cada uno de los cinco valores de §5.2; BzzzBX caído bloquea solo las de `necesitaBzzzbx`.
- `ejecutarAccion`: rechaza `sin_construir`, `fuera_de_release`, `bloqueada`, `no_aplica` y un código desconocido **sin llamar al ejecutor ni a la base**; exige motivo; detecta `cambio_concurrente`. El guard se ve fallar una vez quitando el chequeo de disponibilidad (principio 8).
- Componentes con Testing Library: tablist con $ y People no seleccionables; panel con Go deshabilitado sin motivo.

### 9.2 Playwright (criterios de aceptación)

Contra el build de producción, la seed y el falso, con `/api/falso` para los estados que la seed no trae (OPR-25, P-7). R1 a R6 son las requests de la seed.

| # | Criterio | Cómo se prueba |
|---|---|---|
| A1 | **Abre en menos de 2 s.** | Clic en la tarjeta de EX-00003; se mide hasta que el encabezado y la action bar son visibles; `< 2000 ms`. Se repite con R1 y con EX-00006. |
| A2 | Se abre encima del tablero y se cierra sin perderlo. | Tras abrir, el tablero sigue en el DOM; Esc vuelve a `/` y las tarjetas siguen ahí. La URL directa `/job/<R3>` abre como página completa con "Board". |
| A3 | Encabezado completo. | EX-00003: stage "Scheduled", "Demo Lofts 7C", job line con EX-00003, fecha y ventana, Assigned to con el dueño de la seed y una barra por operador activo; Price `— —` (o el valor, si P-6 dice sí). |
| A4 | Pestañas por etapa. | R2 (Requests): propiedad y Alerts, sin Audit. EX-00003: + Audit. EX-00004: + Job tracker. EX-00006: + Billing. En todas, $ y People con `aria-disabled` y "Not available in this release"; clic y teclado no las seleccionan ni cambian la URL. Alerts es la última. |
| A5 | Nombre de la pestaña de la propiedad. | R2 → el label de `bx-space-0002`; EX-00003 → "7C"; R1 → el de su propiedad. |
| A6 | Abre en Alerts si una alerta pide acción, y vuelve. | R1 (OPS-001 abierta) abre en Alerts. Con `/api/falso` se cierra la alerta (`cleared_at`); antes de 1 minuto la ventana está en la pestaña de la propiedad. Con `?tab=alerts` elegido a mano, no vuelve sola. |
| A7 | **Las acciones no disponibles no corren.** | En EX-00005 (Complete), "Reject · re-clean" se ve en gris con "Not available in this release" y Go deshabilitado. Se quita el `disabled` con `page.evaluate` y se pulsa Go: el panel dice "Not available in this release" y el cursor de `/api/tablero/cambios` no cambia (incluye el último `audit_event.id`: no se escribió nada). Lo mismo con una acción `sin_construir`. |
| A8 | Acciones de la etapa. | En cada etapa aparecen las de §5.3 de esa etapa y ninguna de otra. |
| A9 | Panel con motivo. | En EX-00003, Reschedule abre el panel con Reason obligatorio; Go deshabilitado vacío y con solo espacios. (Correr la acción es de OPR-29.) |
| A10 | BzzzBX caído. | Se abre EX-00003, `/api/falso` pone `no_disponible`; tras el refresco: franja "BzzzBX unavailable · last update HH:MM", el encabezado conserva lo último leído, y las acciones que necesitan BzzzBX quedan en gris con "BzzzBX unavailable". Al volver, la franja se va. |
| A11 | BzzzBX caído desde el primer momento. | Con `no_disponible` antes de abrir: la ventana abre en < 2 s, `— —` en lo de BzzzBX, lo de opsRUN visible y la franja con "no data yet". |
| A12 | Request sin datos. | R1: `— —` en encabezado, "Unassigned", "Not scheduled"; ninguna excepción en consola. |
| A13 | Casos de §6.3. | `/job/no-es-uuid` y un uuid que no existe → "Job not found". Un job cancelado por `/api/falso` → "Cancelled" y sin acciones disponibles. |
| A14 | Ranuras en su lugar. | `data-ranura="conversacion"` a la izquierda; en R2, `data-ranura="enlace"` en la pestaña de la propiedad; `data-ranura="audit"` en Audit de EX-00003. |
| A15 | Aviso de `truncado` (cuando exista la ranura de OPR-28). | Con 50 jobs inventados de la propiedad de R2 puestos por `/api/falso`, el aviso "Showing the first 50 jobs…" se ve. Este caso entra al spec ahora y se activa con OPR-28. |
| A16 | Refresco con la ventana abierta. | Con EX-00003 abierto, un check-in por `/api/falso` cambia el stage a "In Progress" y agrega Job tracker en menos de 1 minuto. |

## 10. Supuestos

| # | Supuesto |
|---|---|
| S-1 | **El prototipo R23 no está disponible.** La distribución (encabezado, conversación a la izquierda, pestañas a la derecha, orden de las pestañas, forma del panel) sale de la tarjeta y del glosario, y se revisa contra R23 cuando se pueda ver. |
| S-2 | Presupuesto de 1,5 s para la lectura de BzzzBX al abrir; pasado eso, cuenta como caído. |
| S-3 | Un job `cancelled` abre por URL con stage "Cancelled" y sin acciones. |
| S-4 | La job line es número · fecha y ventana · servicio · cleaner. |
| S-5 | La barra de carga de cada operador es su número de requests que aún no llegan a Validation, relativo al que más tiene. |
| S-6 | Orden de las pestañas: propiedad, Audit, Job tracker, Billing, $, People y Alerts al final. |
| S-7 | Una pestaña que aún no toca por etapa no se muestra (no se ve en gris). |
| S-8 | "Pide acción" = alerta abierta (`AlertResult.cleared_at` nulo) de la request, de su job o de un mensaje de su hilo. Cuando OPR-34 separe Needs action de Waiting, se usa su definición. |
| S-9 | La vuelta a la propiedad solo ocurre si Alerts la eligió la regla, no el operador. |
| S-10 | Las pestañas sin su tarjeta muestran "Coming in a later build". |
| S-11 | La lista de acciones por etapa de §5.3 (sale de tarjetas, glosario y catálogo; el Release Definition §6 no está en el repo). |
| S-12 | El control de concurrencia usa `request.change_seq` (OPR-20 §7). |
| S-13 | Con BzzzBX caído se pueden correr las acciones que solo escriben en opsRUN. |

## 11. Preguntas para Henry

- **P-1. ¿Ventana encima del tablero o página aparte?** Recomiendo **encima**, con ruta interceptada y URL propia (`/job/[requestId]`): el tablero no se recarga al cerrar, la URL se puede compartir y la recarga abre la misma ventana como página. Alternativa más simple: página aparte, que pierde el tablero de fondo y hace más lento volver.
- **P-2. ¿Quién actúa sin login?** Las funciones de escritura exigen un operador (`require_operator()`), y los operadores de la seed no tienen `auth_user_id` porque el login es OPR-21 (bloqueado por OPR-2). Sin esto, ni el enlace de la Fase A corre en la demo. Recomiendo **un selector "Acting as" solo local**: la seed les pone a sus operadores `auth_user_id` inventados fijos (cambio de seed, no migración), el operador elegido viaja en una cookie y el servidor declara ese actor. Solo existe con `BZZZBX_MODO=falso` y sin `OPSRUN_SERVIDOR=1`, como `/api/falso`; con `OPSRUN_SERVIDOR=1` la cookie se ignora y una prueba lo comprueba (viéndola fallar una vez). Alternativa: no correr nada hasta OPR-21, y la demo solo muestra.
- **P-3. ¿Request lista para enlazar en la seed?** Ninguna request de la seed puede enlazarse hoy: R1 no tiene datos y R2 espera al cleaner, así que el gate de Schedule la frena. Recomiendo **agregar R7** a la seed: en Requests, con dueño y las tres confirmaciones, y un job inventado que encaje en el falso (sin tocar los IDs que ya comparten la seed y el falso). Alternativa: cerrar la confirmación del cleaner de R2, que borra el ejemplo de Waiting que usa OPR-34.
- **P-4. Acciones de V1.1 beta que todavía no se construyen.** Recomiendo mostrarlas **en gris con "Not built yet"**, distinto de "Not available in this release", para no decirle al operador que algo no entra en el release cuando sí entra. Alternativa: ocultarlas hasta que su tarjeta las construya, que hace que la barra crezca de una entrega a otra.
- **P-5. Nombres de las acciones sin OPR-4.** Recomiendo usar los `label` de los catálogos de OPR-20 (los de §5.3) y cambiarlos cuando OPR-4 los firme; es cambiar un `label`, sin migrar datos. ¿O prefieres esperar a OPR-4 para construir la action bar?
- **P-6. Precio.** El encabezado lleva el precio, pero el puerto no lo trae (OPR-22 S-1). Recomiendo **agregar al `Job` del puerto un `price` opcional** (`{ amount_cents, currency } | null`), provisional hasta OPR-6, en el falso y en la prueba de contrato. Solo se muestra, nunca se guarda, y no toca la base. Alternativa: `— —` hasta OPR-6.

Con las recomendaciones, OPR-26 no trae migración. P-2 y P-3 cambian `supabase/seed.sql` (datos inventados) y P-6 cambia el puerto.
