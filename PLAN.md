# opsRUN v1.1 beta — Plan de construcción

Consola de operaciones para los equipos de Operations y Finance de PINCH. Cada correo de solicitud entra como request y recorre un tablero de etapas (Requests → Scheduled → In Progress → Complete → Validation) hasta quedar Paid. opsRUN lee todo de BzzzBX, actúa solo mandando instrucciones a BzzzBX y guarda únicamente lo que es suyo.

Este archivo es el índice y el orden. **El detalle de cada entrega vive en su tarjeta de Relevo (proyecto OPR)**: entregable, referencias y "Hecho cuando" completos. Si una tarjeta cambia, manda la tarjeta; este plan se actualiza en el siguiente PR.

Los documentos fuente (Release Definition V1.1 beta, User Guide edición 1.1, prototipo R23, Runbook) no están en este repo, que es público. Se consultan en Relevo.

---

## 1. Principios (no negociables)

1. **Cada dato tiene un solo dueño.** Lo del negocio de PINCH (clientes, propiedades, equipos, trabajos, fotos, pagos) vive en sus sistemas y se lee por BzzzBX. opsRUN guarda solo lo suyo (requests, dueños, confirmaciones, notas, acciones con motivo, historial de alertas, Audit, sugerencias de IA y correcciones) y apunta a lo demás con identificadores de BzzzBX. Nadie copia datos de otro dueño.
2. **Toda acción es una instrucción a BzzzBX.** Enviar correo o texto, crear, reprogramar o cancelar un trabajo, escribir el PO, registrar la validación y las llamadas a la IA salen como instrucción a BzzzBX, que confirma o devuelve error. opsRUN nunca llama directo a Gmail, al proveedor de SMS, a la base de PINCH ni a Claude.
3. **Las IAs proponen, el operador confirma.** Un campo llenado por IA se ve marcado como AI hasta que una persona lo confirma o lo corrige, y la corrección queda registrada. Ninguna sugerencia confirma nada sola. Rosie solo lee, nunca actúa.
4. **Si la IA falla, se trabaja a mano.** Un análisis lento o caído deja los campos vacíos con "AI pending"; nada se bloquea por la IA.
5. **Todo queda en Audit.** Cada acción guarda quién, cuándo, qué y por qué, también las alertas abiertas y resueltas y las correcciones a la IA.
6. **Lo que no está en V1.1 beta se ve pero no corre.** Las funciones de releases futuras aparecen en gris con "Not available in this release" o "Available in a later release", y no se pueden ejecutar.
7. **Guards que descubren, no que enumeran.** Los tests de seguridad leen las tablas desde `information_schema` y los de CI leen los tests desde el disco.
8. **Un test que nunca se vio fallar no prueba nada.** Los guards (RLS, auth, permisos) se validan quitando la protección y viéndolos en rojo antes de darlos por buenos.

---

## 2. Stack

| Capa | Elección | Origen |
|---|---|---|
| App | Next.js (App Router), TypeScript estricto | OPR-1 |
| Dónde corre | En el mismo servidor que BzzzBX, al lado de la caja y no dentro: repo, deploy y vuelta atrás propios. Con BzzzBX solo habla por el contrato de OPR-6 ([ADR 0002](docs/adr/0002-opsrun-al-lado-de-la-caja.md)) | OPR-1 |
| Datos de opsRUN | El Supabase que ya corre en el servidor (el de la caja), en los esquemas `opsrun`, `opsrun_private` y `opsrun_writeback`. Conexión directa a Postgres con el rol propio `opsrun_app`, que solo entra a `opsrun`: sin PostgREST, sin service role, nada en `public` ([ADR 0003](docs/adr/0003-supabase-de-la-caja.md)). Esquemas y roles los crea el alta de opsRUN en Bzzz; las migraciones corren como `opsrun_migrador`, el dueño, y solo crean objetos dentro de lo suyo | OPR-1, OPR-20 |
| Login | GoTrue de la caja, compartido con las demás apps; el método y la lista de usuarios siguen en OPR-2 | OPR-2 |
| Integración | BzzzBX: lectura con actualizaciones en menos de 1 minuto, instrucciones con confirmación, write-back | OPR-6, OPR-22, OPR-23, OPR-24 |
| Tests | Vitest (unitarios, jsdom), pgTAP con `supabase test db` (base) y Playwright (E2E contra el build de producción y el Supabase local). Corren en CI en cada PR | OPR-1 (confirmado) |
| Gestor de paquetes | pnpm (versión fija en `packageManager`); Node 22 (`.nvmrc`) | OPR-1 |
| CLI de Supabase | Dependencia del proyecto (`supabase` en `devDependencies`), versión fija | OPR-1 |
| CI | GitHub Actions: lint, typecheck, Vitest, `supabase test db` y Playwright | OPR-1 |

---

## 3. Entornos

| Entorno | Dónde | Uso |
|---|---|---|
| Local | `pnpm local`: Supabase local (CLI, Docker, puertos 58320–58329), un script que imita el alta de Bzzz, las migraciones como `opsrun_migrador` y `next dev`, con datos inventados | Desarrollo y todos los tests |
| Staging | Servidor de PINCH | Pruebas E2E con datos vivos de PINCH (OPR-40) |
| Producción | Servidor de PINCH | Uso real; la ejecuta Henry |

Deploy y vuelta atrás repetibles, con un solo comando documentado (OPR-1): `scripts/servidor/opsrun.sh deploy` y `vuelta-atras`, con la imagen de producción etiquetada por SHA y `opsrun_health()` como prueba de humo ([runbook](docs/runbook-servidor.md)). Las migraciones se aplican solo desde la migración versionada, con `scripts/migrar.mjs` como `opsrun_migrador`, dentro del deploy; nunca se editan tablas desde el Studio. Son solo hacia adelante: la vuelta atrás cambia la imagen, no la base. Cómo se corren en la caja se acuerda con el equipo de BzzzBX.

### Variables de entorno

Solo nombres. Los valores viven en el servidor, nunca en el repo. Los de BzzzBX salen del contrato de OPR-6.

```
OPSRUN_SERVIDOR=1             # staging y producción: activa las comprobaciones de arranque
OPSRUN_DB_HOST=               # Postgres de la caja, visto desde el servidor de opsRUN
OPSRUN_DB_PORT=               # opcional, 5432
OPSRUN_DB_NAME=               # opcional, postgres
OPSRUN_SECRETS_FILE=          # opcional; archivo montado con OPSRUN_APP_USUARIO y OPSRUN_APP_CLAVE
OPSRUN_GOTRUE_URL=            # raíz del GoTrue de la caja; se valida, el login es de OPR-2
NEXT_PUBLIC_SITE_URL=
BZZZBX_…                      # por definir en OPR-6

# Fuera del servidor de la app
OPSRUN_DATABASE_URL=          # solo local y CI: conexión como opsrun_app
OPSRUN_MIGRADOR_URL=          # solo para aplicar migraciones (scripts/migrar.mjs), como opsrun_migrador
OPSRUN_MIGRADOR_SECRETS_FILE= # en el deploy: archivo montado solo en el contenedor de migraciones, con OPSRUN_MIGRADOR_URL
```

El servidor se conecta directo a Postgres como `opsrun_app`. Lee todo en tiempo de ejecución, así que el mismo build sirve en staging y en producción. La clave no va en variables de entorno: va en un archivo de secretos montado en el contenedor, por defecto `/run/secrets/opsrun/app.env`.

Con `OPSRUN_SERVIDOR=1` el servidor no arranca si:
- falta `OPSRUN_DB_HOST`, `OPSRUN_GOTRUE_URL` o el archivo de secretos;
- `OPSRUN_GOTRUE_URL` no es una URL http(s) limpia;
- el login es superusuario o BYPASSRLS (si la base no responde al arrancar, arranca y la primera consulta lo vuelve a comprobar: con ese login no corre ninguna);
- está definida alguna variable que el servidor no debe tener. Las llaves de Supabase (service role, secret key, JWT secret), `POSTGRES_PASSWORD`, `OPSRUN_DATABASE_URL`, `OPSRUN_APP_CLAVE` y `OPSRUN_MIGRADOR_URL` se rechazan solo por el nombre, sin mostrar su valor.

En local y en CI no hay archivos `.env`: `pnpm local`, `pnpm test:db`, Vitest y Playwright arman la conexión desde `supabase status`, con las claves locales del alta local.

---

## 4. Tarjetas

Tipos: **D** decisión (la firma una persona), **E** pendiente externo (lo entrega un tercero), **H** handoff (lo construye Henry salvo que diga otra cosa). La columna "Depende de" está tomada de cada tarjeta; las faltantes se anotan en la sección 5.

### P0 — Insumos (decisiones y entregas externas)

| Tarjeta | Tipo | Qué | Turno | Desbloquea |
|---|---|---|---|---|
| OPR-2 | D | Método de login y lista inicial de usuarios (propuesta: todos iguales en V1.1 beta) | Federico | OPR-21 |
| OPR-3 | D | Límites de las alertas estándar | Federico | OPR-33 |
| OPR-4 | D | Regla de Delayed (1:00 PM, zona horaria), nombres de las acciones y de "Clear alert" | Operations de PINCH | OPR-26, OPR-29, OPR-33 |
| OPR-5 | D | Proveedor de SMS: TrueDialog o Twilio | Federico | OPR-13, OPR-17 |
| OPR-6 | E | Contrato de BzzzBX: lecturas, notificaciones de cambio, instrucciones y ruta de IA | Equipo de BzzzBX | Casi todo |
| OPR-7 | E | Dueño de la API de cada sistema de PINCH | PINCH | — |
| OPR-8 | E | Campo PO en el trabajo y marca de "requiere PO" por cliente | PINCH | OPR-28, OPR-32, OPR-33 |
| OPR-9 | E | Feed del Job Tracker: check-in, tiempos y fotos Before/After | PINCH | OPR-30, OPR-31, OPR-33 |
| OPR-10 | E | Estado Paid de QuickBooks por BzzzBX | Finance | OPR-32 |
| OPR-11 | E | Credenciales y límites del servicio de Claude en el servidor de BzzzBX | Federico | P5 |
| OPR-12 | E | Predicciones programadas en BzzzBX para Rosie | Equipo de BzzzBX | Modo Prediction de Rosie |
| OPR-13 | E | Número de envío, registro con operadoras y STOP/HELP (empezar ya: puede tardar semanas) | PINCH IT | OPR-17 |
| OPR-14 | E | Acceso al buzón compartido y envío como la dirección de PINCH | PINCH IT | OPR-15, OPR-16 |
| OPR-33 | E | Las 9 alertas estándar calculadas en BzzzBX, más el estado de salud por trabajo | Equipo de BzzzBX | OPR-29, OPR-30, OPR-34 |

### P1 — Base

| Tarjeta | Qué | Depende de | Hecho cuando (resumen) |
|---|---|---|---|
| OPR-1 | Repo, Supabase autohospedado, staging y producción | OPR-6 (solo red) | Una página servida en staging y producción, conectada a su Supabase, desplegada con un comando |
| OPR-20 | Modelo de datos de lo que opsRUN es dueño | OPR-1 | Esquema migrado en ambos entornos, seed carga, cada pantalla tiene dónde guardar lo suyo |
| OPR-21 | Login y usuarios | OPR-2, OPR-20 | Cada usuario entra en staging y sus acciones salen con su nombre en Audit |
| OPR-22 | Capa de lectura de BzzzBX con actualizaciones | OPR-6, OPR-20 | Un cambio en un sistema de origen se ve en el tablero de staging en menos de 1 minuto |
| OPR-23 | Capa de instrucciones a BzzzBX | OPR-6, OPR-20, OPR-21 | Cada tipo de instrucción funciona de punta a punta y un error forzado se muestra y queda registrado |
| OPR-24 | Write-back de los datos de opsRUN a BzzzBX | OPR-6, OPR-20 | Una acción en opsRUN se encuentra en BzzzBX en menos de 5 minutos |

### C — Comunicación

| Tarjeta | Qué | Depende de | Hecho cuando (resumen) |
|---|---|---|---|
| OPR-15 | Entrada de correo → requests con número R | OPR-14, OPR-22, OPR-20 | Un correo de prueba es una sola request en menos de 1 minuto; la respuesta aparece en su hilo |
| OPR-16 | Envío de correo como PINCH | OPR-14, OPR-23 | Un correo enviado llega en la misma conversación y se ve como enviado |
| OPR-17 | Textos de ida y vuelta con el cleaner | OPR-5, OPR-13, OPR-23 | El "yes" del cleaner llega al trabajo con una confirmación propuesta |
| OPR-18 | Plantillas y avisos | OPR-16, OPR-17 | Cada plantilla se usa en E2E-1 y E2E-9 con el contenido correcto |
| OPR-19 | Estado de entrega y alerta "Message not delivered" | OPR-16, OPR-17, OPR-34 | Un texto y un correo inválidos salen como "failed" y abren la alerta |

### P2 — Pantallas

| Tarjeta | Qué | Depende de | Hecho cuando (resumen) |
|---|---|---|---|
| OPR-25 | Tablero y tarjetas (prototipo R23) | OPR-22 | El tablero coincide con el prototipo para los mismos datos y se actualiza en menos de 1 minuto |
| OPR-26 | Ventana del trabajo, pestañas, barra de acciones, estados no disponibles | OPR-25, OPR-4 | Un trabajo abre en menos de 2 s; las acciones no disponibles no corren |
| OPR-27 | Conversación | OPR-16, OPR-17, OPR-26 | Los pasos de conversación de E2E-1 funcionan en staging |

### P3 — Etapas

| Tarjeta | Qué | Depende de | Hecho cuando (resumen) |
|---|---|---|---|
| OPR-28 | Requests: asignar, confirmar, programar | OPR-15, OPR-23, OPR-36, OPR-26 | E2E-1 (parte de request), E2E-2, E2E-8 y E2E-10 |
| OPR-29 | Scheduled: Reschedule, Cancel job, Delayed | OPR-4, OPR-17, OPR-33 | E2E-3 y E2E-9 |
| OPR-30 | In Progress: Job tracker, fotos, Clear alert, End manually | OPR-9, OPR-33 | E2E-4 y E2E-5 |
| OPR-31 | Complete: Approve & confirm, Mark as OSS / Not OSS | OPR-30, OPR-18 | E2E-5 y E2E-6; un trabajo aprobado llega a Validation con el aviso Done |
| OPR-32 | Validation y Billing: Validate (chequeo de PO), Paid | OPR-8, OPR-10, OPR-23 | E2E-7, y E2E-1 llega a Paid |

### P4 — Alertas y Audit

| Tarjeta | Qué | Depende de | Hecho cuando (resumen) |
|---|---|---|---|
| OPR-34 | Pestaña Alerts y Alerts de la barra superior | OPR-33, OPR-26 | Las alertas de E2E-2 a E2E-7 aparecen, se arreglan y pasan a Resolved |
| OPR-35 | Pestaña Audit | OPR-20, OPR-23 | El Audit de E2E-1 muestra cada paso con hora y nombre correctos |

### P5 — Inteligencia aplicada

| Tarjeta | Qué | Depende de | Hecho cuando (resumen) |
|---|---|---|---|
| OPR-36 | Análisis de la request por IA, por adelantado y con fallback | OPR-11, OPR-6, OPR-15 | Correo analizado en menos de 1 minuto; E2E-8, E2E-10 y E2E-11 |
| OPR-37 | Sugerencias (propiedad, representante, cleaner) y borradores | OPR-36, OPR-18 | Las sugerencias están al abrir una request nueva y E2E-1 las usa |
| OPR-38 | Rosie: Situation y Recommendation, Focused y Global | OPR-11, OPR-24, OPR-22 | E2E-12; primeras palabras en unos 3 s |
| OPR-39 | Medir las metas de velocidad de la IA | OPR-36, OPR-38 | Resultado por meta anotado en la tarjeta |

### P6 — Aceptación y salida

| Tarjeta | Qué | Depende de | Turno |
|---|---|---|---|
| OPR-40 | Aceptación E2E-1 a E2E-12 en staging | Todo P1–P5 y C | Henry |
| OPR-41 | Entrenamiento para Operations y Finance | OPR-40 | Federico |
| OPR-42 | Decisión de go-live | OPR-40, OPR-41 | Federico |
| OPR-43 | Primera semana después del go-live | OPR-42 | Henry |

---

## 5. Por aclarar con Federico

Dependencias que las tarjetas no dicen y que el orden de construcción sí necesita:

- **OPR-16 y OPR-18 se piden entre sí.** OPR-16 entrega los avisos automáticos Scheduled y Done "de la tarjeta de plantillas", pero OPR-18 depende de OPR-16.
- **OPR-8** desbloquea la entrada de PO y la alerta TRN-005, pero OPR-28 y OPR-33 no la listan.
- **OPR-9** alimenta Running long y las alertas de fotos, pero OPR-33 no la lista.
- **OPR-11** desbloquea P5, pero OPR-37 no la lista.
- **OPR-14** no dice qué desbloquea, y OPR-15 y OPR-16 dependen de ella.
- **OPR-19** depende de la pestaña Alerts (OPR-34) pero no de la regla que calcula la alerta (OPR-33).
- **OPR-21** pide nombres en Audit sin depender de OPR-35.
- **OPR-28** maneja Cleaner declined (OPS-020) y abre en Alerts, sin depender de OPR-33 ni de OPR-34.
- **OPR-39** necesita datos de la primera semana en producción, así que termina después del go-live; OPR-43 no la menciona.
- **OPR-6 está en turno del "equipo de BzzzBX"**: confirmar quién lo entrega, porque bloquea casi todo el plan, incluido OPR-1.

---

## 6. Por dónde empezar

Sin esperar a terceros se puede hacer:

1. **OPR-1, parte local:** proyecto Next.js, Supabase local, lint, typecheck, tests y CI. El despliegue en el servidor de PINCH espera la red de OPR-6.
2. **OPR-20:** el modelo de datos depende solo de OPR-1 y se puede migrar y probar en local.

El resto de P1 necesita OPR-2 (login) y OPR-6 (contrato de BzzzBX).
