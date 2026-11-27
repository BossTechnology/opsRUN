-- OPR-15 · Entrada de correo: un correo nuevo es una request.
--
-- Spec: docs/spec/opr-15-entrada-correo.md §5, §6 y §10 (aprobado por Henry el
-- 2026-11-27, P-0 a P-7). No cambia tablas, columnas, tipos, triggers ni vistas
-- v1_*. Agrega una función del sistema, dos índices de request_message y un
-- tipo de Audit.
--
-- Corre como opsrun_migrador, después de 20261201120000_requests_assign_confirm.sql.
-- Solo hacia adelante.
--
-- opsrun.ingest_request_email es del sistema (la entrada de correo del servidor,
-- actor `entrada_correo`): llama a opsrun_private.require_system() en su propio
-- cuerpo (G6 lo busca en prosrc), es security definer con search_path vacío, y
-- solo opsrun_app la ejecuta (G5, G6, G7). Ninguna función del operador acepta
-- al sistema. Es la única función que inserta en opsrun.request (G15).
--
-- Recibe solo el crosswalk ID del mensaje, el del hilo y la hora de llegada: el
-- remitente, el asunto y el cuerpo son de PINCH y no viajan a la base.
--
-- Códigos de error (OPR-15 se reserva OP030 a OP034; usa solo el primero):
--   OP030  el hilo ya tiene mensajes vinculados a más de una request: no se
--          elige una al azar
--   OP031 a OP034  reservados
--   22023  p_bzzzbx_message_id vacío o p_received_at nulo
--   42501  sin actor de sistema, o con operador además (de require_system())

-- ---------------------------------------------------------------------------
-- 1. Audit: la respuesta que llegó a una request que ya existe (P-4)
-- ---------------------------------------------------------------------------
-- En el grupo de mensajes, justo antes de email_sent (230).
insert into opsrun.audit_event_type (code, label, requires_reason, source, sort_order) values
  ('email_received', 'Email received', false, 'opsrun', 225);

-- ---------------------------------------------------------------------------
-- 2. Índices de request_message: "un hilo, una request" (§5.3)
-- ---------------------------------------------------------------------------
-- El respaldo de la función: aunque alguien escribiera sin pasar por ella (o
-- sin el candado), un segundo original del mismo hilo falla con 23505 en lugar
-- de crear dos requests. Un correo sin hilo no cuenta.
create unique index request_message_original_thread_key
  on opsrun.request_message (bzzzbx_thread_id)
  where is_original and bzzzbx_thread_id is not null;

-- Buscar la request de un hilo sin recorrer la tabla.
create index request_message_thread_idx
  on opsrun.request_message (bzzzbx_thread_id);

-- ---------------------------------------------------------------------------
-- 3. ingest_request_email
-- ---------------------------------------------------------------------------
-- Todo bajo un candado del hilo (o del mensaje, si no tiene hilo): dos llamadas
-- del mismo hilo, de dos procesos o de dos vueltas, se ordenan; las de hilos
-- distintos no se esperan. Si falla cualquier paso no queda nada: ni la
-- request, ni el vínculo, ni el Audit.
--
--   duplicate  el mensaje ya está vinculado: no escribe nada
--   linked     el hilo ya tiene request: vincula el mensaje (no original) y
--              deja email_received
--   created    request nueva, abierta, sin dueño y con el borrador vacío; el
--              mensaje es su original; deja request_received
--
-- received_at se guarda tal como llega; si viene más de 1 hora en el futuro se
-- guarda now() y el Audit lleva details.clock_skew = true (S-10).
create function opsrun.ingest_request_email(
  p_bzzzbx_message_id text,
  p_bzzzbx_thread_id text,
  p_received_at timestamptz
)
returns table (request_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_proceso text := opsrun_private.require_system();
  v_mensaje text := nullif(btrim(p_bzzzbx_message_id), '');
  v_hilo text := nullif(btrim(p_bzzzbx_thread_id), '');
  v_request_id uuid;
  v_requests int;
  v_sesgo boolean;
  v_recibida timestamptz;
  v_detalle jsonb;
begin
  if v_mensaje is null or p_received_at is null then
    raise exception 'opsRUN: la entrada de correo exige el ID del mensaje y la hora de llegada'
      using errcode = '22023';
  end if;

  -- El candado del hilo; sin hilo, el del mensaje. Se suelta al terminar la
  -- transacción.
  perform pg_advisory_xact_lock(hashtextextended('opsrun.entrada:' || coalesce(v_hilo, 'msg:' || v_mensaje), 0));

  -- Ya vinculado: nada que escribir.
  select m.request_id into v_request_id
    from opsrun.request_message as m
   where m.bzzzbx_message_id = v_mensaje;
  if found then
    return query select v_request_id, 'duplicate'::text;
    return;
  end if;

  v_sesgo := p_received_at > now() + interval '1 hour';
  v_recibida := case when v_sesgo then now() else p_received_at end;
  v_detalle := jsonb_build_object('bzzzbx_message_id', v_mensaje, 'bzzzbx_thread_id', v_hilo)
               || case when v_sesgo then jsonb_build_object('clock_skew', true) else '{}'::jsonb end;

  -- La request del hilo, si ya tiene una.
  if v_hilo is not null then
    select count(distinct m.request_id), min(m.request_id::text)::uuid
      into v_requests, v_request_id
      from opsrun.request_message as m
     where m.bzzzbx_thread_id = v_hilo;
    if v_requests > 1 then
      raise exception 'opsRUN: el hilo tiene mensajes vinculados a más de una request'
        using errcode = 'OP030';
    end if;
  else
    v_requests := 0;
  end if;

  if v_requests = 1 then
    insert into opsrun.request_message (request_id, bzzzbx_message_id, bzzzbx_thread_id, channel, direction,
                                        is_original, actor_kind)
    values (v_request_id, v_mensaje, v_hilo, 'email', 'inbound', false, 'system');

    insert into opsrun.audit_event (request_id, event_type, actor_kind, occurred_at, details)
    values (v_request_id, 'email_received', 'system', v_recibida, v_detalle);

    return query select v_request_id, 'linked'::text;
    return;
  end if;

  -- Hilo nuevo (o correo sin hilo): una request nueva. Solo received_at; lo
  -- demás por defecto, con el borrador vacío (la IA lo propone, OPR-36).
  insert into opsrun.request (received_at)
  values (v_recibida)
  returning id into v_request_id;

  insert into opsrun.request_message (request_id, bzzzbx_message_id, bzzzbx_thread_id, channel, direction,
                                      is_original, actor_kind)
  values (v_request_id, v_mensaje, v_hilo, 'email', 'inbound', true, 'system');

  insert into opsrun.audit_event (request_id, event_type, actor_kind, occurred_at, details)
  values (v_request_id, 'request_received', 'system', v_recibida, v_detalle);

  return query select v_request_id, 'created'::text;
end;
$$;
comment on function opsrun.ingest_request_email(text, text, timestamptz) is
  'OPR-15: un correo entrante crea una request (created), se vincula a la del hilo (linked) o ya estaba vinculado (duplicate). Bajo un candado del hilo, con Audit en la misma transacción. Escritura del sistema.';

-- ---------------------------------------------------------------------------
-- 4. Permisos: solo opsrun_app la ejecuta
-- ---------------------------------------------------------------------------
revoke all on function opsrun.ingest_request_email(text, text, timestamptz) from public;
grant execute on function opsrun.ingest_request_email(text, text, timestamptz) to opsrun_app;
