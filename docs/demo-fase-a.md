# Demo de la Fase A: guion

- **Para qué:** la demo local del lunes. Recorrido: tablero → Job window → enlace con el job observado → conversación → Audit.
- **Sobre qué:** el stand-in de BzzzBX (`src/lib/bzzzbx/falso/`) y la seed de `supabase/seed.sql`. Todo es inventado: `@example.test`, `bx-…`, `EX-000NN`.
- **Estado:** en `main` están el tablero (OPR-25), la Job window (OPR-26), Audit (OPR-35), el enlace de la Fase A con su UI (OPR-28, PR #17) y la conversación (OPR-27, PR #19).
- **Marcas:** lo que no está confirmado en la corrida de ensayo del 2026-11-27 (con `main` en e51c33b y la base recién reseteada) o en el código va como **(por verificar)**.

## 1. Preparación

### 1.1 Requisitos

Node 22 (`.nvmrc`), pnpm, Docker corriendo y unos 10 GB libres para las imágenes de Supabase (`README.md`).

### 1.2 Comandos

```bash
pnpm install
pnpm db:reset   # solo con el OK de Henry; ver la advertencia
pnpm local
```

**Advertencia:** `pnpm local` solo carga la seed cuando aplica migraciones en esa misma corrida (`scripts/base-local.mjs`). Una base que ya existe no recibe la seed nueva: sin R7 ni su enlace. Para cargarla hace falta `pnpm db:reset`, que borra la base local y la vuelve a crear. **Requiere el OK de Henry.**

`pnpm local` (`scripts/local.mjs`) levanta Supabase local, aplica el alta y las migraciones pendientes, y arranca Next en http://localhost:3000. Además de la conexión a la base local, pone estas dos variables:

| Variable | Valor | Qué activa |
|---|---|---|
| `BZZZBX_MODO` | `falso` | El stand-in de BzzzBX, y la ruta `/api/falso` |
| `OPSRUN_ACTOR_DEMO` | `1` | El selector "Acting as" de la Job window |

No hay que crear ningún `.env`. El selector "Acting as" solo existe si se cumplen las tres condiciones: `OPSRUN_ACTOR_DEMO=1`, `BZZZBX_MODO=falso` y sin `OPSRUN_SERVIDOR=1` (OPR-26 P-2). Con `pnpm dev` o `pnpm start` no hay falso: `/api/falso` responde 404 y no aparece "Acting as".

### 1.3 Antes de empezar

1. Abrir http://localhost:3000. Deben verse las cinco columnas con estas requests: **Requests** con R1, R2 y R7; **Scheduled** con R3; **In Progress** con R4; **Complete** con R5; y **Validation** con R6, dentro de la fila "Paid" (por verificar el conteo exacto de cada columna).
2. Si la base ya se usó en un ensayo y R7 está enlazada, `pnpm db:reset` (con el OK de Henry) la devuelve a Requests. Un enlace no se deshace hasta OPR-29 (`docs/spec/fase-a-enlace.md` §9, P-4).

### 1.4 Si Docker no levanta todos los servicios de Supabase

Si `pnpm local` falla porque falta `API_URL`, Supabase no levantó todos sus servicios. Levantarlo sin los que la demo no usa y después correr `pnpm local`:

```bash
supabase start -x realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,supavisor,mailpit,postgres-meta,postgrest
pnpm local
```

### 1.5 Ojo en vivo

- **Esc** cierra la Job window, también si el selector está abierto. Para cerrar un desplegable, hacer clic fuera de él.

## 2. Requests de la seed

Las R son la secuencia de la base: tras `pnpm db:reset`, R1 a R7 salen en ese orden. El job number de cada request con job es `EX-0000N`, donde N es el último dígito de su id.

| Request | Etapa inicial | Qué tiene | Para qué sirve en la demo |
|---|---|---|---|
| R1 | Requests | Sin dueño, sin cliente. Alerta OPS-001 abierta. Análisis de IA con sugerencias | Tarjeta oscura, Job window que abre en Alerts |
| R2 | Requests | Dueño Ops Uno. Details y sender confirmados. Cleaner preguntado (Waiting) | Conversación: hilo, nota, borrador de IA |
| R3 | Scheduled | EX-00003, Demo Lofts. Creado en PINCH | Pestaña Audit |
| R4 | In Progress | EX-00004. Check-in y inicio observados. Job en riesgo | Tarjeta con borde rojo |
| R5 | Complete | EX-00005. Terminada a mano sin fotos (OSS automático). Alerta MEC-003 revisada con motivo | Audit con motivo visible |
| R6 | Validation | EX-00006. Aprobada, PO escrito, Paid observado | Audit completo, con hechos "Observed" |
| R7 | Requests | Dueño Ops Dos, las tres confirmaciones vigentes. Job de PINCH en el falso: **bx-job-0107** (EX-00107) | El enlace: se abre, se elige, se confirma |

## 3. Recorrido

### Paso 1. El tablero

**Clic:** nada; es la página de inicio.

**Se ve:**
- Barra superior: el marcador de logo, "opsRUN", el indicador **Live** (verde), el contador de **Alerts**, y **Alarms**, **Anomalies** y **Actions** en gris ("Available in a later release").
- Filtro de operador: **All operators** y **Only me (sign-in required)**, deshabilitado hasta OPR-21.
- Riel izquierdo: **Rosie**, con el título "Rosie is not connected yet"; **Observe**, **Geo**, **Incidents**, **Activity** y **Map** en gris.
- Las cinco columnas con su conteo. R1 oscura (sin dueño). R4 con borde rojo (job en riesgo). R6 en la fila "Paid", colapsada y en verde.
- Si se cambia algo en el falso o en la base, el tablero lo muestra en menos de un minuto (sondeo cada 15 s).

### Paso 2. Abrir R7

**Clic:** la tarjeta R7 en Requests.

**Se ve:** la Job window se abre encima del tablero, con la URL `/job/<id>`. Esc, la ✕ o atrás vuelven al tablero sin recargarlo.
- Encabezado: etapa **Requests**; nombre "Placeholder House" (R7 no tiene unidad); fecha y ventana del borrador, 13:00 a 16:00; **Assigned to: Ops Dos**, con una barra de carga por operador; **Price** en `— —`, porque el job todavía no existe en PINCH.
- Pestañas: **Propiedad** y **Alerts**. No hay Audit: la pestaña aparece desde Scheduled. La pestaña inicial es Propiedad, porque R7 no tiene alertas abiertas.
- Action bar: **Action ▾** y **Go**.

### Paso 3. Elegir el actor en "Acting as"

**Clic:** el selector **Acting as**, en el encabezado de la Job window.

**Se ve:** "Nobody (read only)" por defecto, y los operadores en orden alfabético: Finance Dos, Finance Uno, Ops Dos, Ops Uno. **Elegir Ops Uno.** Ese operador firma el enlace y queda en el Audit como quien lo hizo. Con "Nobody", las escrituras no corren (el mensaje exacto por verificar).

El dueño de R7 es Ops Dos. Que el que enlaza sea Ops Uno no cambia nada: el dueño es un dato de la request, no un permiso.

### Paso 4. Los candidatos y el Suggested

**Clic:** en **Action ▾**, elegir **Schedule**. Abre el panel con la lista "Job in PINCH tools" (la lista vive en la pestaña Propiedad).

**Se ve:**
- El gate de Schedule (dueño, detalles, sender y cleaner). Si faltara algo, el panel diría qué falta y **Confirm** quedaría deshabilitado. En R7 no falta nada.
- Un solo candidato: **EX-00107** (bx-job-0107), marcado **Suggested**, con las coincidencias "Same property", "Same customer", "Same date", "Same window" y "Same cleaner".
- No aparecen **EX-00004** (bx-job-0004): ya está enlazado a R4. Tampoco **EX-00104**, que está cancelado.

Con la seed, R7 solo tiene un candidato, y para rechazar hace falta un segundo. Ver el paso 4b.

### Paso 4b. Rechazar un candidato

Con la seed sola no hay nada que rechazar en R7. Antes del paso, poner un job de prueba en la misma propiedad con `POST /api/falso` (`poner`, entidad `job`). El valor es una copia de bx-job-0107 (`src/lib/bzzzbx/falso/datos.ts`, línea 72), cambiando:
- `bzzzbx_job_id` a `bx-job-0108`;
- `job_number` a `EX-00108`;
- `service_date` a hoy más 5 días, en formato `YYYY-MM-DD`.

```bash
curl -X POST http://localhost:3000/api/falso \
  -H 'content-type: application/json' \
  -d '{"accion":"poner","entidad":"job","valor":{ ...campos de bx-job-0107 con los cambios... }}'
```

(Forma exacta del pedido, por verificar: `poner` de un job con esos campos.)

**Clic:** en EX-00108, **Reject EX-00108**. Se abre el campo **Reason (optional)**; el motivo es opcional. Confirmar con **Reject job**.

**Se ve:** EX-00108 deja de aparecer en la lista de R7. Ese rechazo vale solo para R7: el job puede proponerse para otra request. El evento `job_link_rejected` queda en el Audit de R7, que se verá en el paso 8.

### Paso 5. Confirmar bx-job-0107

**Clic:** **Confirm**, en la fila de EX-00107.

**Se ve:** el mensaje de resultado (por verificar el texto exacto). R7 queda en **Scheduled**: la fila muestra "EX-00107 · Mon, Nov 30 · 1:00 PM–4:00 PM · Standard clean · Team Alpha" y **Price $175.00**. Aparece la pestaña **Audit**.

El enlace no manda nada a BzzzBX: es una decisión registrada en opsRUN, y el job se lee del falso para confirmar que existe y no está cancelado (`docs/spec/fase-a-enlace.md` §2 y §5).

### Paso 6. R7 en Scheduled

**Clic:** **Esc** para volver al tablero.

**Se ve:** R7 en la columna **Scheduled**, con el job number EX-00107 bajo el nombre (por verificar el formato de la tarjeta). Abrir R7 de nuevo: las pestañas son **Propiedad**, **Audit**, **$** y **People** (en gris, "Not available in this release") y **Alerts**. Job tracker y Billing aparecen más adelante, con sus etapas.

### Paso 7. La conversación

La columna izquierda de la Job window es la conversación. Para ver todo, abrir R2 (tiene original, texto al cleaner y nota).

**7.1. Leer el hilo de R2.** Se ve en orden por hora:
- **Original request** (neutro, a la izquierda).
- Un **Text** a Team Alpha, en verde, con el estado **Delivered** (por verificar el texto exacto del estado en la seed).
- **Internal note** "Requester prefers mornings.", en ámbar, a la derecha.

**7.2. Nota interna.** El Composer abre en el modo **Note**.

**Clic:** escribir una nota y pulsar **Send**.

**Se ve:** la nota aparece como "Internal note · Ops Dos · Internal · not sent", con el operador elegido en "Acting as". Nada sale a BzzzBX. Para verla luego en Audit ("Note added"), hacerla en R7 después del paso 5; R2 no tiene pestaña Audit.

**7.3. Correo al cliente.** Pasar al modo **Customer**.

**Se ve:** **To** muestra al remitente del original, solo lectura (por verificar la dirección exacta de la seed). **Cc**, **Edit To** y **Temporary number** en gris, "Available in a later release". Como R2 tiene un borrador de IA sin decidir, aparece la marca **AI draft** con el cuerpo del borrador y **Discard**. Si ya se había escrito algo en ese modo, el borrador no lo pisa: aparece el aviso "AI draft available" con **Use it**.

**Clic:** editar el borrador si hace falta y pulsar **Send**.

**Se ve:** la burbuja sale como **Sending…** y, en menos de un minuto, **Sent**. La instrucción la recibe el falso: no sale ningún correo real. Al enviar, el borrador queda decidido como aceptado o corregido, según haya cambiado el texto (`docs/spec/opr-27-conversacion.md` §5.5).

**Clic (opcional, en lugar de enviar):** **Discard**. El borrador desaparece y no sale nada.

**7.4. Texto al cleaner.** Pasar al modo **Cleaner**. **To** muestra Team Alpha, solo lectura. Escribir y **Send**: el texto pasa a **Sent** (por verificar).

**7.5. Fallo visible y reenviable (opcional).** Con `POST /api/falso`:

```bash
curl -X POST http://localhost:3000/api/falso \
  -H 'content-type: application/json' \
  -d '{"accion":"forzar_error","tipo":"send_email","cuando":"al_ejecutar","error_message":"Forced error (stand-in)."}'
```

(Por verificar: valores válidos de `tipo`.) Luego enviar un correo en R2. En menos de un minuto la burbuja muestra **Failed · Forced error (stand-in).** en rojo, con **Edit and resend**, que copia el cuerpo al Composer. El reenvío crea una instrucción nueva.

**7.6. Respuesta del cliente (opcional).** Con `POST /api/falso` y `accion: "poner"`, `entidad: "message"` en `bx-thread-0002`, aparece un correo entrante con **Received** en menos de un minuto (por verificar la forma del valor).

### Paso 8. El Audit de R7

**Clic:** la pestaña **Audit** en la Job window de R7.

**Se ve:**
- Arriba, en una línea: **Request** R7, **Job number** EX-00107 y **Work App number** EX-00107. Son el mismo valor hasta revisarlo contra el User Guide (`docs/spec/opr-35-audit.md` P-7). Debajo, "Times in UTC".
- Una fila por evento, del más viejo al más nuevo (`docs/spec/opr-35-audit.md` P-4):
  1. **Request received**, de opsRUN.
  2. **Assigned to Ops Dos**, marcado **Original**.
  3. **Details confirmed**, **Sender confirmed** y **Cleaner confirmed**.
  4. **Note added**, si se hizo la nota del paso 7.2 en R7.
  5. **Job link rejected**, de Ops Uno, solo si se hizo el rechazo del paso 4b.
  6. **Scheduled · linked to observed job EX-00107**, de Ops Uno.
- Cada fila tiene hora con fecha, la persona que lo hizo y, si lo hay, el motivo ("Reason:").

Para mostrar más historia, en la misma base:
- **R5**: "Ended manually" con "Reason: Cleaner finished but the app did not sync.", y la alerta MEC-003 "Alert cleared" con su motivo, de Ops Dos.
- **R6**: la historia completa. Check-in, inicio y completed con la marca **Observed** (hechos de PINCH), OSS, aprobación, PO, Paid, y la alerta TRN-005 resuelta por Finance Uno.

## 4. Qué decir de lo que no está

- **Gris o "Not built yet".** Las acciones de V1.1 beta que su tarjeta todavía no construye (Assign, Reschedule, Cancel job, Ask cleaner, Clear alert, End manually, Approve & confirm, Mark as OSS, Enter PO, Validate) se ven en gris con "Not built yet", y no corren (`src/lib/acciones/disponibilidad.ts`). "Reject · re-clean" aparece como "Not available in this release", porque no entra en V1.1 beta. Decir: "Esto se ve para que sepan que existe; corre cuando su tarjeta lo construya."
- **Sin login real.** El operador lo elige el selector "Acting as". El login es OPR-21, bloqueado por OPR-2. Decir: "En la demo, la persona la elegimos nosotros; con login, la sesión la decide."
- **Sin BzzzBX real.** Todo viene del stand-in en memoria, con datos inventados. El contrato real es OPR-6. Decir: "Lo que vemos es el falso del contrato; el real lo confirma el equipo de BzzzBX."
- **Sin envío real de correo ni SMS.** Enviar deja la instrucción en el falso, y nada sale a un correo ni a un proveedor de SMS. El envío real es OPR-6 (C · Email sending y C · Texting both ways).
- **Check-in forzado sin Audit.** Un check-in puesto con `/api/falso` cambia la etapa (OPR-26 A16), pero no aparece en Audit: nadie escribe `job_checked_in` en vivo todavía (OPR-35 P-6). Decir: "Lo observado en vivo entra a Audit cuando su tarjeta lo escriba (OPR-30 a OPR-32)."
- **Deshacer un enlace.** No existe hasta OPR-29 (`docs/spec/fase-a-enlace.md` P-4). Por eso la demo se repite con `pnpm db:reset`.
- **Aspecto sin revisar.** Nadie ha comparado la pantalla con el prototipo R23: no se pudo abrir desde la cuenta de trabajo (OPR-25 P-0, OPR-26 S-1, OPR-27 S-1, OPR-35 S-2). Decir: "La distribución sale de la tarjeta y del glosario; el aspecto fino se revisa con R23."
- **Alerts.** La pestaña muestra la lista de alertas abiertas de solo lectura. Secciones, acciones y Resolved son de OPR-34.
- **Paused** no se muestra: su definición está por confirmar (OPR-25 P-4).

## 5. Si algo falla en vivo

### 5.1 "BzzzBX unavailable"

Aparece como franja en la Job window y como barra en el tablero. Si alguien lo pidió antes con `no_disponible`, quitarlo:

```bash
curl -X POST http://localhost:3000/api/falso \
  -H 'content-type: application/json' \
  -d '{"accion":"no_disponible","valor":false}'
```

Cuando BzzzBX vuelve, el siguiente sondeo quita la franja. Si no, recargar la página (`docs/spec/opr-26-job-window.md` A10).

Si la franja sigue, o dice "no data yet" sin haberlo pedido, reiniciar el stand-in:

```bash
curl -X POST http://localhost:3000/api/falso \
  -H 'content-type: application/json' \
  -d '{"accion":"reiniciar"}'
```

`reiniciar` vuelve a crear los datos inventados del stand-in en memoria. Lo que se puso con `/api/falso` se pierde (por ejemplo, EX-00108). **No toca la base:** los enlaces ya hechos siguen en la base.

### 5.2 `/api/falso` responde 404

El servidor no tiene el falso. Se arrancó con `pnpm dev` o `pnpm start` en lugar de `pnpm local`, o con `OPSRUN_SERVIDOR=1`. Parar el servidor y correr `pnpm local`.

### 5.3 No aparece "Acting as"

Faltan las mismas condiciones del punto 1.2: `OPSRUN_ACTOR_DEMO=1`, `BZZZBX_MODO=falso` y sin `OPSRUN_SERVIDOR=1`. Solo `pnpm local` las pone todas.

### 5.4 `pnpm local` falla por `API_URL`

Supabase no levantó todos sus servicios. Ver el punto 1.4.

### 5.5 La base no responde

Ver http://localhost:3000/salud o `GET /api/salud` (503 si la base no responde). Si pasa, `pnpm db:start`. Si la base sigue mal, `pnpm db:reset`, con el OK de Henry.

### 5.6 Repetir la demo desde cero

`pnpm db:reset`, con el OK de Henry, y después volver a correr `pnpm local`. Vuelven R1 a R7 con su seed, sin los enlaces. El stand-in vive en la memoria del servidor: al arrancarlo de nuevo, vuelve a su estado inicial y se van los jobs puestos con `/api/falso`.

### 5.7 El tablero no se actualiza

Esperar hasta un minuto (sondeo cada 15 s). Si no, recargar la página.

## Referencias

- `docs/spec/opr-25-tablero.md`: tablero y tarjetas.
- `docs/spec/opr-26-job-window.md`: Job window, pestañas, action bar y "Acting as" (§11.1, P-2).
- `docs/spec/opr-35-audit.md`: pestaña Audit.
- `docs/spec/fase-a-enlace.md`: enlace con el job observado (OPR-28).
- `docs/spec/opr-27-conversacion.md`: conversación y Composer (OPR-27).
- `CONTEXT.md`: términos de la demo.
