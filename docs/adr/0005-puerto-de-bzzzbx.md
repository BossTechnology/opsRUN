# 0005 — opsRUN habla con BzzzBX por dos puertos, con un stand-in en memoria mientras no hay contrato

- **Fecha:** 2026-11-24
- **Estado:** propuesta. Provisional hasta el contrato de OPR-6
- **Tarjetas:** OPR-22, OPR-23, OPR-6, OPR-44

## Contexto
Toda lectura de lo de PINCH y toda acción salen por BzzzBX (principios 1 y 2 de `PLAN.md`). El contrato de BzzzBX (OPR-6) no existe, y las proyecciones que opsRUN leería están en espera (OPR-44). Las pantallas (OPR-25 en adelante) no pueden esperar: OPR-44 pide construir contra stand-ins mientras tanto, y Henry autorizó adelantar la parte local de OPR-22 y la forma del puerto de OPR-23.

Además, la forma del transporte no está clara. El Runbook 1.1 (en Relevo, §3.4, §4.2, §6.2 y §7.1) y los hilos de OPR-22 y OPR-23 hablan de proyecciones en el Supabase de BzzzBX con realtime, y de `opsrun.instruction` como outbox escrito en la misma transacción, con siete pasos hasta que la acción se observa en el origen. La respuesta de la caja en OPR-6 habla de vistas con versión sobre HTTP. El detalle está en [`docs/spec/opr-22-stand-ins.md`](../spec/opr-22-stand-ins.md).

## Opciones consideradas
1. **Esperar a OPR-6** antes de construir pantallas.
2. **Stand-ins en la base local**, como describe el Runbook §6.2: proyecciones sembradas con datos inventados y un outbox que un stub vacía y contesta.
3. **Dos puertos TypeScript (lectura e instrucciones) con una implementación falsa en memoria**, elegida por variable de entorno, y pruebas de contrato que corran igual contra el falso y contra el real.

## Decisión
La opción 3:

- **Puerto de lectura:** entidades con su crosswalk ID y una versión; lectura por ID, por varios IDs y por relación; aviso de cambios por **sondeo con cursor opaco**, donde cada cambio dice solo qué cambió y el dato se vuelve a leer. Si el real trae realtime, lo usa por dentro para sondear antes; el puerto no cambia. Así el mismo puerto sirve para proyecciones en Postgres y para vistas por HTTP.
- **Puerto de instrucciones:** `entregar` idempotente por `idempotency_key`, resultados por cursor y estado por clave. Un resultado dice en qué paso va (los siete del Runbook §7.1) y cierra como confirmada, fallida o sin confirmar. Con el outbox, "entregar" es la escritura que ya hace la función SQL; sin él, una llamada. El puerto no decide cuál.
- **Falso en memoria:** datos inventados con los mismos crosswalk IDs que `supabase/seed.sql`, controles para forzar errores, simular cambios en el origen, pedir aprobación y reconstruir. Nunca guarda nada en la base.
- **Selección:** `BZZZBX_MODO`. Por defecto `falso` en local y en CI; en el servidor es obligatoria y `falso` no se acepta.
- **Contrato:** las pruebas de contrato son funciones que reciben la implementación, así que se corren contra el real sin reescribirlas.

La 1 frena todo P2. La 2 es la forma del Runbook, pero ata los stand-ins a un transporte que todavía está en discusión (proyecciones en Postgres o vistas por HTTP) y toca la base local antes de saberlo. Queda como banco de pruebas de la implementación real si se confirman las proyecciones en Supabase; esa decisión es de Henry (spec, P-0).

## Consecuencias
- **Se gana:**
  - las pantallas se construyen y se prueban ya, con datos que encajan con la seed;
  - el cambio al contrato real queda en un solo lugar (`src/lib/bzzzbx/`) y se comprueba con las mismas pruebas;
  - el falso no puede llegar a staging ni a producción.
- **Se pierde:**
  - los campos de las entidades son supuestos y van a cambiar con OPR-6;
  - el sondeo agrega hasta un intervalo de demora frente a un realtime puro.
- **Qué vigilar:**
  - la correspondencia entre los siete pasos y los cinco estados de `opsrun.instruction` (spec, P-2): si cambia, cambia la migración de OPR-20, no el puerto;
  - el rebuild test real (Runbook §3.2) llega con las proyecciones reales; el falso solo prueba el lado de opsRUN;
  - que nadie empiece a guardar en la base lo que devuelve el puerto de lectura;
  - que los IDs del falso sigan coincidiendo con la seed (hay una prueba).
