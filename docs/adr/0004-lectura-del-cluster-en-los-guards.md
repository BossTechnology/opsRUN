# 0004 — La lectura del clúster (`pg_read_all_data`) no cuenta en G3 ni en G7

- **Fecha:** 2026-11-24
- **Estado:** aceptada por Henry el 2026-11-24, para G3 y G7
- **Tarjeta:** OPR-20

## Contexto
G3 exige que, de los roles ajenos, solo el lector del write-back tenga algo en los esquemas de opsRUN, y solo USAGE en `opsrun_writeback` y SELECT en sus vistas `v1_*`. Además, a lo sumo un rol ajeno puede tener algún privilegio. G7 exige que nadie salvo el dueño alcance `opsrun_private`.

En el Supabase de la caja, `postgres` y algunos roles de la plataforma heredan el rol predefinido `pg_read_all_data`. Ese rol da USAGE en todo esquema y SELECT en toda tabla, vista y secuencia de la base, también en `opsrun` y `opsrun_private`. opsRUN no se lo da y no se lo puede quitar: la migración solo concede dentro de `opsrun*`. Con la regla tal cual, G3 y G7 fallaban en la base real sin que opsRUN hubiera concedido nada de más.

## Opciones consideradas
1. **(a) Lectura global.** Lo que un rol tiene solo por heredar `pg_read_all_data` no cuenta. Todo lo demás sí.
2. **(b) Excluir por nombre** a los roles de la plataforma. Rompe la regla de que los guards descubren en vez de enumerar, y un rol nuevo de la plataforma volvería a romper G3.
3. **(c) Relajar el límite de un rol ajeno.** Deja pasar un SELECT de más a cualquier rol, que es justo lo que el límite quiere frenar.

## Decisión
Henry eligió (a). Los guards hallan a esos roles por membresía (`pg_has_role(rol, 'pg_read_all_data', 'USAGE')`), sin listar nombres.

Para un rol así, USAGE sobre un esquema o SELECT sobre una relación de opsRUN no cuenta cuando ningún ACL de opsRUN lo concede: ni al rol, ni a un rol del que hereda, ni a `PUBLIC`. Esos roles no cuentan para el límite de un rol ajeno. Cualquier otro privilegio cuenta, y también cuenta un USAGE o un SELECT concedido a mano: escribir, ejecutar o crear sigue fallando.

G3 y G7 se ven fallar en su propio test en los dos sentidos:
- un rol de prueba ajeno que no es miembro de `pg_read_all_data` y tiene privilegios cuenta como segundo lector;
- un rol de prueba miembro de `pg_read_all_data` con SELECT, INSERT o USAGE en `opsrun_private` concedidos a mano se detecta.

## Consecuencias
- G3 y G7 pasan en la base de Supabase sin nombrar roles de la plataforma, y siguen frenando todo grant que haga opsRUN.
- Esos roles leen opsRUN como leen el resto de la caja. Hoy tienen además BYPASSRLS, así que la RLS de respaldo (G4) no los frena. Es el alcance que ya tiene quien administra la caja; si eso no se acepta, el tema es de la caja, no de opsRUN.
- Si algún día se concede `pg_read_all_data` a un rol nuevo, G3 no lo verá. Vigilarlo es parte del alta de la caja.
