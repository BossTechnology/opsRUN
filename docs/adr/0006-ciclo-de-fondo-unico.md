# 0006 — Un solo ciclo de fondo dentro del servidor de Next, que corre varias tareas

- **Fecha:** 2026-11-27
- **Estado:** aceptada (Henry aprobó P-1 del spec de OPR-15: "con un solo ciclo de fondo")
- **Tarjeta:** OPR-15 (también OPR-34, OPR-33 y OPR-36, que se suman al ciclo)

## Contexto
Hasta ahora opsRUN no hacía nada por su cuenta: todo lo que escribe lo dispara un operador, o el sondeo del tablero (`/api/tablero/cambios`) pone al día los envíos abiertos (spec OPR-27 §7). La entrada de correo (OPR-15) es el primer trabajo que no tiene a nadie esperándolo: un correo de las 3 AM tiene que ser una request aunque nadie tenga el tablero abierto, porque de ella cuelgan la alerta OPS-001 y el análisis de IA "ahead of time" de OPR-36. Detrás vienen el registrador de alertas (OPR-34) y el observador de lo que pasa en PINCH.

Si cada tarjeta abre su temporizador, el servidor acaba con varios `setInterval` sueltos, sin un lugar donde ver qué corre, sin garantía de que una vuelta no se pise con la anterior y con errores que cada uno registra a su manera.

Además, una lectura (`GET`) no debe escribir: colgar la entrada del sondeo del tablero haría que el tablero abierto decida cuándo entra un correo.

## Opciones consideradas
1. **Colgarla del sondeo del tablero**, como el despacho de OPR-27. Sin trabajos de fondo, pero con nadie mirando no entra nada, y una lectura escribe.
2. **Un proceso o cron aparte.** Otra imagen, otro contenedor, otro despliegue y otro secreto para algo que cabe en el servidor.
3. **Un bucle por tarjeta dentro del servidor de Next**, cada uno con su `setInterval`.
4. **Un solo ciclo de fondo dentro del servidor de Next**, arrancado por `instrumentation`, que corre las tareas que se le registran.

## Decisión
La opción 4:

- **Una sola pieza** (`src/lib/ciclo/`), arrancada por `src/instrumentacion-node.ts` (runtime `nodejs`, nunca en `next build`), en local, CI, staging y producción. Una instancia por proceso, guardada en `globalThis` para que sobreviva a la recarga en caliente sin duplicarse.
- **Un solo temporizador** (un tic de 1 s). Cada tarea declara su nombre, su cadencia y su vuelta; el tic corre las que tocan y no están en curso. Una vuelta a la vez por tarea: si la anterior sigue, se salta. Una tarea lenta o caída no frena a las otras.
- **Las tareas se registran, no se abren.** `tareasDeOpsrun()` (`src/lib/ciclo/arranque.ts`) es la lista. La primera es `entrada_correo` (cada 15 s, `src/lib/entrada/`). El registrador de alertas de OPR-34 y el observador suman la suya ahí.
- **Los errores no tumban el ciclo.** El error de una tarea se registra una vez (y de nuevo solo si cambia) y se reintenta en su turno; al volver a salir bien, un aviso. Una caída de BzzzBX no es un error de la tarea: la entrada la maneja y avisa una vez.
- **Nunca bajo pruebas.** `iniciarCicloDeFondo` no arranca con `VITEST` (Vitest), durante `next build` ni con `OPSRUN_CICLO_DE_FONDO=0`. Una prueba que lo necesite arranca `crearCiclo()` explícitamente, con su reloj y su temporizador.
- **Una lectura nunca escribe.** Una ruta de lectura (`/api/tablero/cambios` y las demás) no llama a la entrada ni arranca el ciclo.
- **Seguro con el falso de BzzzBX.** Con `BZZZBX_MODO=falso` la tarea lee el puerto del falso como cualquier otra capa; con el real inexistente (hasta OPR-6) la lectura responde siempre "no disponible" y la entrada se comporta como con BzzzBX caído.
- **Dos procesos a la vez** (el cruce de un deploy, `next dev` con recarga) no rompen nada: cada uno corre su ciclo y la base deduplica con su candado por hilo. No hace falta un candado global.
- **Guard G16** (`src/lib/ciclo/un-solo-ciclo.test.ts`): descubre en `src/` cualquier `setInterval` fuera del ciclo y de los componentes de cliente, y cualquier ruta de lectura que importe la entrada o el ciclo. Se ve fallar en cada corrida.

Las rutas de lectura que hoy escriben (el despacho de OPR-27 cuelga la reconciliación del sondeo del tablero) quedan como están en esta decisión; moverlas al ciclo como una tarea más es el siguiente paso natural y queda como pregunta abierta en el PR de OPR-15.

## Consecuencias
- **Se gana:**
  - un lugar para el trabajo de fondo, con cadencia, exclusión y manejo de errores iguales para todos;
  - la entrada de correo funciona sin que nadie abra el tablero;
  - sin otra imagen, contenedor ni secreto.
- **Se pierde:**
  - el trabajo de fondo comparte proceso con las páginas: una tarea que se cuelga sin soltar el hilo afectaría al servidor (las tareas son asíncronas y de E/S; ninguna debe hacer cálculo pesado);
  - con varios servidores de Next cada uno corre su ciclo: hoy es uno solo, y la base lo soporta por la deduplicación, pero una tarea futura que no sea idempotente necesita su propio candado;
  - el ciclo vive y muere con el proceso: no hay reintento si el servidor está caído.
- **Qué vigilar:**
  - que las tareas nuevas sean idempotentes, por si dos procesos corren a la vez;
  - que ninguna tarjeta abra un `setInterval` (G16 lo hace fallar);
  - que el tic de 1 s siga siendo barato: si llegan muchas tareas, medir antes de bajarlo;
  - que `instrumentation` siga cargándose solo en el runtime `nodejs`.
