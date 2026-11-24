# opsRUN — instrucciones para Claude Code

- Lee `PLAN.md` antes de cualquier cambio. Trabaja una tarjeta a la vez: una tarjeta empieza cuando sus dependencias cumplen su "Hecho cuando", y no se da por terminada hasta cumplir el suyo.
- El detalle de cada entrega vive en su tarjeta de Relevo (proyecto **OPR**). `PLAN.md` es el índice y el orden. Lee la tarjeta con `ver_tarea OPR-N` antes de empezarla; si el plan y la tarjeta no coinciden, manda la tarjeta y avisa.
- Respeta los principios de la sección 1 de `PLAN.md`, en especial:
  - Cada dato tiene un solo dueño. Lo del negocio de PINCH vive en sus sistemas y se lee por BzzzBX; opsRUN guarda solo lo suyo y apunta con crosswalk IDs.
  - Toda acción sale como instrucción a BzzzBX. opsRUN nunca llama directo a Gmail, al proveedor de SMS, a la base de PINCH ni a Claude.
  - Las IAs proponen, el operador confirma. Un campo de IA se ve marcado como tal hasta que una persona lo confirma o lo corrige.
  - Toda acción queda en Audit: quién, cuándo, qué y por qué.
  - Los guards de seguridad descubren en vez de enumerar, y se ven fallar una vez antes de darlos por buenos.
- Gestor de paquetes: pnpm.
- Ramas: `opr-N-descripcion`, con el número de la tarjeta de Relevo que se está construyendo.
- Base de datos: todo cambio va en una migración en `supabase/migrations/`. Nunca editar tablas desde el Studio.
- Antes de abrir un PR: `pnpm lint`, `pnpm typecheck`, `pnpm test` y `supabase test db` en verde.
- Si algo del plan es ambiguo o contradice lo que encuentras en el código o en la tarjeta, detente y pregunta en vez de suponer.

## Este repo es público
Cualquiera puede leer todo lo que se suba, incluido el historial de Git.
- Nada de datos reales de PINCH: ni clientes, ni propiedades, ni cleaners, ni correos, ni teléfonos, ni POs. Seeds, fixtures, tests y capturas usan datos inventados.
- Nada de infraestructura: ni hosts, ni IPs, ni puertos expuestos, ni nombres de servicios internos de BzzzBX. Eso va en variables de entorno del servidor; en el repo solo `.env.example` con nombres y comentarios, sin valores.
- Los documentos internos (Release Definition, User Guide, Runbook con detalles del servidor, prototipo) se quedan en Relevo. En `docs/` solo va lo que se pueda publicar.
- No nombrar a personas de PINCH en código, commits, PRs ni docs; usar el rol (Operations, Finance, el equipo de BzzzBX).
- Si dudas de si algo se puede publicar, no lo subas y pregunta.

## Seguridad
- Nunca leer, imprimir ni pegar `.env*`, llaves, tokens, dumps de BD ni datos reales de clientes. Usa `.env.example` como referencia de variables.
- Comandos destructivos (`rm -rf`, `git push --force`, migraciones, SQL en producción, deploys a prod) requieren confirmación explícita de Henry.
- Producción corre en el servidor de PINCH. Desde el agente solo local y staging; producción la ejecuta Henry.

## Git
- Sin atribución de IA en commits, PRs ni issues (nada de `Co-Authored-By` ni "Generated with").
- Commits en español. Staging por rutas explícitas; nunca `git add -A`.
- Una sesión = una tarea = una rama/PR. `/clear` entre tareas.

## Documentación
- `CONTEXT.md`: glosario del dominio. Usa esos términos en código, commits y respuestas. Si aparece un término nuevo, agrégalo.
- `ESTADO.md`: estado de la tarea actual. **Al terminar cada sesión (o con `/handoff`), actualiza Hecho / Pendiente / Bloqueado / Siguiente paso.**
- `docs/adr/`: una ADR por decisión de arquitectura o producto que costó tomar. Plantilla en `docs/adr/0000-plantilla.md`.
- `CHANGELOG.md`: una línea por cambio entregado, bajo "Sin publicar".
- Idioma: los documentos del repo van en español. Los términos del producto (etapas, acciones, pantallas) van en inglés, tal como los ve el operador, porque la interfaz es en inglés.

## Cómo trabajar
- Lee `ESTADO.md` y `CONTEXT.md` antes de empezar.
- Cambios no triviales: alinear primero (`/grill-with-docs` o preguntas), luego spec, luego implementar con tests.
- Antes de proponer una librería nueva, revisa si ya hay algo equivalente en el repo.

## Flujo de skills

Propón la skill en el momento indicado; no esperes a que Henry la recuerde. Si él dice que no, sigue sin ella.

| Fase | Skill | Cuándo proponerla |
|---|---|---|
| Idea / decisión | `/abogado-del-diablo` | Decisión cara o difícil de revertir: infraestructura, cliente, dinero, seguridad |
| Idea / decisión | `/grill-me` | Decisiones que no son de código |
| Diseño | `/grill-with-docs` | Cambio no trivial sin spec. Antes de escribir código |
| Plan | `/to-spec` → `/to-tickets` | Al terminar un grill, o cuando el trabajo no cabe en una sesión |
| Construcción | `/implement` (con `/tdd`) | Hay spec o tickets listos |
| Construcción | `/caveman` | Sesiones largas de código. Apagar (`/caveman off`) para grills, reviews y textos para clientes |
| Bugs | `/diagnosing-bugs` | Tras dos intentos fallidos con un bug. Detente y cámbiate a esta skill |
| Revisión | `/code-review` | Antes de abrir o fusionar un PR |
| Cierre | `/handoff` | Antes de terminar la sesión: deja `ESTADO.md` al día |
| Cualquiera | `/wait-what` | Si Henry dice que no entendió una respuesta |

Reglas:
- Una sesión = una fase. Si el trabajo salta de fase (por ejemplo, de diseño a construcción), sugiere `/handoff` y una sesión nueva.
- No uses skills de otros plugins (10x-Team, etc.) para estas fases si existe una de esta tabla.
