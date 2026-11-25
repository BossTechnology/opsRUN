# Changelog

Una línea por cambio entregado, en lenguaje de usuario.

## Sin publicar
- OPR-22: opsRUN lee de BzzzBX y le manda instrucciones por dos puertos con un stand-in en memoria y datos inventados, para construir las pantallas sin esperar el contrato real (provisional hasta OPR-6).
- OPR-20: el modelo de datos de opsRUN (requests, confirmaciones, instrucciones, alertas, IA, plantillas y Audit inmutable) con sus guards de seguridad y una seed inventada para local.
- OPR-1: la app lee su base directo en Postgres con un rol propio de mínimo privilegio, en sus esquemas del Supabase de la caja, y no arranca en el servidor si su configuración está incompleta o trae llaves que no debe tener.
- OPR-1: proyecto base de opsRUN que se levanta en local con un comando (`pnpm local`) y muestra si la app llega a su base de datos; tests y CI en cada PR.
