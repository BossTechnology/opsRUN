# Changelog

Una línea por cambio entregado, en lenguaje de usuario.

## Sin publicar
- OPR-1: la app lee su base directo en Postgres con un rol propio de mínimo privilegio, en sus esquemas del Supabase de la caja, y no arranca en el servidor si su configuración está incompleta o trae llaves que no debe tener.
- OPR-1: proyecto base de opsRUN que se levanta en local con un comando (`pnpm local`) y muestra si la app llega a su base de datos; tests y CI en cada PR.
