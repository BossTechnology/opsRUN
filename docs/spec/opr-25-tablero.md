# OPR-25 — Tablero y tarjetas

- **Tarjeta:** OPR-25 (P2 · Board and cards, prototipo R23). Depende de OPR-22 (read layer), cuyos stand-ins ya están en `main` (ADR 0005).
- **Estado:** aprobado por Henry el 2026-11-24 con las respuestas propuestas en §7. **No se pudo leer el prototipo R23** (el artifact del hilo de OPR-6 no está compartido con esta cuenta). Todo lo visual que la tarjeta no fija va como supuesto **[S-n]** y se ajusta cuando se pueda ver el prototipo (**P-0**).
- **Fuera de alcance:** Job window (OPR-26), pestaña y panel de Alerts (OPR-34), Rosie (OPR-38), login y "Only me" real (OPR-21), cálculo de alertas y de health (OPR-33, en BzzzBX).

## 1. Qué se ve

Una sola página, `/`, que reemplaza la página de salud de OPR-1 (la salud sigue en `GET /api/salud`).

### 1.1 Barra superior

| Elemento | Estado en V1.1 beta | De dónde sale |
|---|---|---|
| Logo | Marcador genérico (P-1) | — |
| `opsRUN` | Texto | — |
| Live | Verde "Live" si el último sondeo respondió; ámbar "Reconnecting…" si falló uno; rojo "BzzzBX unavailable · last update HH:MM" si sigue caído | Bucle de actualización (§4) |
| Alerts | Ícono con el conteo de alertas abiertas de toda la operación. Sin panel todavía (el panel es OPR-34) | `AlertResult` abiertos del puerto |
| Alarms, Anomalies, Actions | En gris, no corren, título "Available in a later release" | — |
| Operator filter | `All operators` / `Only me` (P-2) | `opsrun.operator`, `request.owner_operator_id` |

### 1.2 Riel izquierdo

- **Rosie**: se ve disponible (P-3: hasta OPR-38 no abre nada útil).
- **Observe, Geo, Incidents, Activity, Map**: en gris, `aria-disabled`, título "Available in a later release". No navegan.

### 1.3 Columnas

`Requests · Scheduled · In Progress · Complete · Validation`, en ese orden. Cada encabezado: nombre, conteo de tarjetas y, si hay, conteo de alertas abiertas de esa columna (ámbar, o rojo si alguna es roja).

La etapa se calcula como dice OPR-20 §5:

| Etapa | Condición | Datos |
|---|---|---|
| Requests | `request.status = 'open'` | opsRUN |
| Scheduled | programada, sin `checked_in` | opsRUN + `JobTrackerEvent` |
| In Progress | con `checked_in`, sin `completed` ni `ended_manually_at` | ídem |
| Complete | `completed` o `ended_manually_at`, sin `approved_at` | ídem |
| Validation | `approved_at` | opsRUN |

Un job con `Job.status = 'cancelled'` no aparece.

Orden dentro de la columna [S-1]: Requests por `received_at` (la más vieja arriba); Scheduled por fecha y ventana; In Progress por check-in; Complete por fin; Validation por `approved_at`, con las Paid al final en una fila "paid" colapsada (CONTEXT.md: Paid no es columna).

### 1.4 Tarjeta

| Parte | Qué muestra | De dónde sale |
|---|---|---|
| Nombre | Propiedad y espacio (`Property.name` + `units[].label`, o `request.unit`) [S-2] | Puerto + opsRUN |
| Número | `R<r_number>` en Requests; `job_number` después de programar | opsRUN |
| Estado bajo el número | Requests: hora de llegada. Scheduled: fecha y ventana. Delayed (parpadea) si hay `OPS-010` abierta. Paused (P-4). In Progress: hora de check-in. Complete: hora de fin. Validation: Paid con fecha si `Payment.paid` [S-3] | opsRUN + puerto |
| Ciudad | `Property.city` | Puerto |
| Type \| service | `Service.type` y `Service.name`, con un ícono por tipo | Puerto |
| Chat | Ícono si el hilo tiene un mensaje entrante después del original (P-5) | Puerto (`Message`) + `request_message` |
| Flags | `PO` si el job tiene PO; `PO missing` si `Customer.po_required` y no hay PO; `OSS` si `request.oss_mark = 'oss'` | Puerto + opsRUN |
| Dueño | Iniciales del operador, o nada si no tiene [S-4] | opsRUN |

En Requests se usa el borrador de la request; desde Scheduled, el `Job` de BzzzBX (el borrador queda congelado).

**Valores sin definir:** cualquier campo que falte (propiedad sin elegir, servicio sin elegir, entidad que BzzzBX no conoce) se ve como `— —`.

**Colores** [S-5], en este orden de prioridad:

1. **Verde**: `Payment.paid`.
2. **Sombreado rojo**: `JobHealth = breached` o alguna alerta roja abierta.
3. **Borde rojo**: `JobHealth = at_risk` o alguna alerta ámbar abierta.
4. **Oscura**: request sin dueño (`owner_operator_id` nulo).
5. Normal.

Cada estado de color lleva además un `data-estado` y un texto accesible, para que no dependa solo del color y para los E2E.

## 2. De dónde sale cada dato

- **opsRUN** (`opsrun_app`, pool de `src/lib/db/`, solo lectura): `request`, `operator`, `request_message` (hilo original). Nada se escribe: OPR-25 no hace acciones.
- **BzzzBX** (`obtenerBzzzbx().lectura`, hoy el falso): `Job`, `Property`, `Customer`, `Service`, `JobTrackerEvent`, `Message`, `Payment`, `AlertResult`, `JobHealth`. Se piden con `obtenerVarios` y `listarPor` en una sola pasada por render. Nada de esto se guarda.
- **Alertas:** el tablero cuenta las `AlertResult` abiertas del puerto (sujeto request o job), que es la fuente viva. `opsrun.alert_occurrence` es el historial y lo llena OPR-34; el tablero no lo usa (P-6).
- **Nada desde el navegador:** las lecturas corren en server components. El navegador solo pide "¿hubo cambios?" a una ruta del servidor (§4).

El modelo del tablero lo arma una función pura `armarTablero(requests, leidos, ahora)` en `src/lib/tablero/`, que es lo que prueban los unitarios y la prueba de reconstrucción del spec OPR-22 §3.4.

## 3. BzzzBX lento o caído

Si una lectura lanza `BzzzbxNoDisponible`, el servidor usa el último tablero armado (en memoria del proceso, nunca en la base) y la barra superior muestra el aviso en rojo con la hora. Si nunca hubo uno, se ve el tablero con lo de opsRUN y `— —` en lo de BzzzBX, más el aviso.

## 4. Actualización en menos de 1 minuto

- Ruta `GET /api/tablero/cambios?cursor=…` (servidor): llama a `cambiosDesde(cursor)` del puerto y lee una marca de opsRUN (`max(audit_event.occurred_at)` y conteo de requests: toda escritura de opsRUN deja Audit). Devuelve `{ cambio: boolean, cursor }`, sin datos.
- Un componente de cliente pequeño la llama cada 15 s (S-5 de OPR-22) y, si hubo cambio, hace `router.refresh()`. Con eso un cambio se ve en ≤ 30 s aunque falle un sondeo.
- `CursorCaducado`: se pide un cursor nuevo con `cambiosDesde(null)` y se refresca todo.
- Cuando exista realtime, solo despierta el sondeo antes (ADR 0005).

## 5. Pruebas (TDD)

- **Vitest:** `armarTablero` (etapa, orden, conteos, colores, `— —`, flags, cancelados fuera, Paid colapsado), formato del estado bajo el número, componentes de tarjeta y columna con Testing Library, la ruta de cambios (con cambio, sin cambio, cursor caducado, BzzzBX caído) y que el tablero se ve igual después de `reconstruir()` del falso.
- **Playwright**, contra el build de producción, la seed y el falso: cinco columnas con sus conteos; R1 oscura con alerta; R4 con borde rojo; R6 verde y en la fila paid; `— —` en R1; riel y barra con lo gris no clicable; y un cambio en el origen que aparece en menos de 1 minuto. Para los estados que la seed no tiene (Delayed, sombreado rojo) y para simular el cambio, el E2E usa una ruta de control del falso (P-7).

## 6. Supuestos

| # | Supuesto |
|---|---|
| S-1 | Orden de las tarjetas en cada columna. |
| S-2 | El nombre de la tarjeta es propiedad + espacio o unidad. |
| S-3 | Formato del estado bajo el número (hora en Requests, fecha y ventana en Scheduled, etc.). |
| S-4 | La tarjeta muestra las iniciales del dueño. |
| S-5 | Qué enciende cada color y su prioridad. |
| S-6 | Zona horaria de las horas que se muestran: una variable `OPSRUN_ZONA_HORARIA` (por defecto UTC fuera del servidor) hasta OPR-4. Las fechas de servicio y las ventanas ya llegan locales (tipos de OPR-22). |

## 7. Preguntas para Henry

- **P-0. Prototipo R23.** No lo puedo abrir desde esta cuenta. ¿Me lo compartes (o capturas sin datos reales)? Sin él, "coincide con el prototipo" no se puede comprobar y S-1 a S-5 quedan a ciegas.
- **P-1. Logo.** La tarjeta pide el logo de PINCH. Propuesta: un marcador genérico ("Logo") en el repo, y el logo real entra por configuración del servidor, nunca al repo. ¿OK?
- **P-2. Only me** necesita saber quién es el operador, y el login es OPR-21 (bloqueado por OPR-2). Propuesta: el filtro se ve; `All operators` funciona; `Only me` queda deshabilitado con "Sign-in required" hasta OPR-21. Alternativa: en local, un operador elegido por cookie. ¿Cuál?
- **P-3. Rosie** "available": hasta OPR-38 no hay Rosie. Propuesta: se ve activa y abre un panel vacío "Rosie is not connected yet". ¿O gris como el resto?
- **P-4. Paused** no tiene definición (CONTEXT.md: por confirmar) ni dato en el puerto. Propuesta: no se muestra hasta que se defina. ¿OK?
- **P-5. Chat icon:** ¿qué significa? (OPR-20 §11.10: si es "respuesta no leída", falta guardar qué leyó cada operador, que sería una migración). Propuesta: hasta saberlo, se ve cuando hay un mensaje entrante después del original.
- **P-6. Fuente de las alertas del tablero:** propuesta, las `AlertResult` abiertas del puerto. El puerto no tiene "todas las abiertas"; se piden por sujeto (una ida por request y job). ¿Agrego `listarPor("alert_result", { abiertas: true })` al puerto y al contrato, o lo dejo por sujeto?
- **P-7. Ruta de control del falso para E2E:** `POST /api/falso/…` que llama a `cambiar` del falso (check-in, alerta, health). Solo existe con `BZZZBX_MODO=falso`, que no arranca en el servidor, y responde 404 en cualquier otro caso. ¿OK, o prefieres que los E2E solo cubran lo que trae la seed?
- **P-8. Zona horaria** (S-6): ¿la variable `OPSRUN_ZONA_HORARIA` está bien, o hay un valor fijo hasta OPR-4?

Ninguna de las opciones propuestas necesita migración.

### 7.1 Decisiones (2026-11-24)

Henry aprobó las respuestas propuestas. Quedó así:

- P-1: marcador genérico "Logo" en el repo.
- P-2: `Only me` deshabilitado con "(sign-in required)" hasta OPR-21.
- P-3: Rosie se ve activa, con el título "Rosie is not connected yet", hasta OPR-38.
- P-4: Paused no se muestra.
- P-5: chat cuando hay un mensaje entrante después del original.
- P-6: las alertas se piden por sujeto (request y job); el puerto no cambia.
- P-7: `POST /api/falso` (reiniciar, cambiar, poner, no_disponible); 404 sin falso o en el servidor.
- P-8: `OPSRUN_ZONA_HORARIA`, UTC si falta o no es válida.
- P-0 sigue abierta: el aspecto se revisa contra R23 cuando se pueda ver.

### 7.2 Cómo quedó construido

- Modelo: `src/lib/tablero/` (`armar.ts` puro, `leer.ts` con lo último conocido, `cambios.ts`, `consultas.ts` y `servidor.ts`).
- Vista: `src/app/_tablero/`. La página de salud de OPR-1 pasa a `/salud`; `/api/salud` no cambia.
- El cursor de `/api/tablero/cambios` junta el del puerto, el último `audit_event.id` y si BzzzBX respondía. Cuando BzzzBX cae o vuelve, cuenta como cambio.
