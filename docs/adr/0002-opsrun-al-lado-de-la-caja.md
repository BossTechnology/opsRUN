# 0002 — opsRUN corre al lado de BzzzBX, en el mismo servidor y con todo propio

- **Fecha:** 2026-11-24
- **Estado:** aceptada por Henry; la parte del Supabase propio la reemplaza la [0003](0003-supabase-de-la-caja.md)
- **Tarjeta:** OPR-1

## Contexto
OPR-1 pide un repositorio propio de opsRUN, un Supabase autohospedado *junto a* BzzzBX en el servidor dedicado de PINCH, y su propio deploy a staging y producción. Surgió la duda de si opsRUN debía vivir *dentro* de la caja BzzzBX, como las aplicaciones de la etapa 4 de BzzzBX (por ejemplo BOb), que usan el Supabase de la caja, se instalan con su actualizador y entran por su puerta.

## Opciones consideradas
1. **Al lado de la caja, en el mismo servidor, con todo propio.** Lo que dice OPR-1.
2. **Dentro de la caja, con repo propio.** Imagen instalada por BzzzBX, Supabase de la caja, puerta de la caja.
3. **Código dentro del repo de BzzzBX.**

## Decisión
La opción 1, aclarada por Henry el 2026-11-24: opsRUN corre en el mismo servidor que BzzzBX pero no dentro de él. Tiene su propio repo, su propio Supabase autohospedado, su propio deploy y su propia vuelta atrás. Con BzzzBX solo habla por el contrato de OPR-6: lecturas, instrucciones y write-back.

## Consecuencias
- **Se gana:**
  - opsRUN se despliega y se revierte sin esperar el calendario ni el actualizador de la caja;
  - un fallo de opsRUN no toca la caja, y una actualización de la caja no toca opsRUN;
  - el plan, el spec de OPR-20 (tablas en `public` de su propio Supabase) y lo montado en OPR-1 siguen como están.
- **Se pierde:**
  - opsRUN tiene que resolver lo suyo: su Supabase, sus backups, sus secretos, su TLS y su ruta de entrada;
  - comparte servidor con la caja, así que compite por memoria y disco con ella.
- **Qué vigilar:**
  - los techos de memoria y disco de opsRUN en el servidor, para no quitarle recursos a la caja;
  - que la red entre opsRUN y BzzzBX quede limitada al contrato de OPR-6, sin acceso directo a las bases de la caja;
  - que nadie confunda opsRUN con una aplicación de la caja: no la instala ni la actualiza BzzzBX.
