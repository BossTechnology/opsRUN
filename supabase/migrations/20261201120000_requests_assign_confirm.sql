-- OPR-28 · Requests: Assign / Reassign y Confirm details, sender y cleaner.
--
-- Spec: docs/spec/opr-28-assign-confirm.md §5 y §8 (aprobado por Henry el
-- 2026-11-27, P-0 a P-11). Solo funciones y un trigger: no cambia tablas,
-- tipos, catálogos ni vistas del write-back. Los tipos de Audit que usa
-- (request_assigned, request_reassigned, details_confirmed, sender_confirmed,
-- cleaner_confirmed, confirmation_superseded y ai_suggestion_accepted /
-- corrected) y las columnas ya están en OPR-20.
--
-- Corre como opsrun_migrador, después de 20261130120000_conversacion.sql.
-- Solo hacia adelante.
--
-- Cuatro funciones son del operador y llaman a opsrun_private.require_operator()
-- en su propio cuerpo (G6 lo busca en prosrc): assign_request, confirm_details,
-- confirm_sender y confirm_cleaner. Todas son security definer, con
-- search_path vacío, y solo opsrun_app las ejecuta (G5, G6, G7). Cada una deja
-- su Audit en la misma transacción: si falla cualquier paso, no queda ni el
-- cambio ni su evento.
--
-- Una confirmación guarda solo valores del borrador y crosswalk IDs, que la base
-- calcula de la fila bloqueada: el navegador no manda ningún valor. Nunca un
-- nombre, una dirección, un teléfono ni un precio de PINCH.
--
-- confirm_cleaner reemplaza a decide_cleaner_reply y confirm_cleaner_by_phone de
-- OPR-20 §4 (P-6): una sola acción con dos métodos, phone y cleaner_text.
--
-- Códigos de error (siguen a OP012, de la conversación):
--   OP006  la request no existe (reutilizado)
--   OP007  la request no está open (reutilizado)
--   OP013  p_version no es el change_seq actual de la request
--   OP014  el operador destino no existe o está inactivo
--   OP015  el operador destino ya es el dueño
--   OP016  falta un dato obligatorio del borrador; el mensaje dice cuáles
--   OP017  ya hay una confirmación vigente de ese tipo (una carrera entre dos
--          operadores la atrapa también request_confirmation_current_key, 23505)
--   OP018  la respuesta del cleaner no es de la request, no es initial, no está
--          replied o es de otro equipo
--   22023  argumento inválido: operador destino nulo, método que no es phone ni
--          cleaner_text, cleaner_text sin respuesta o phone con respuesta
--   42501  sin operador, con operador y sistema a la vez (de require_operator()),
--          o cambio del borrador sin actor (el trigger)

-- ---------------------------------------------------------------------------
-- 1. Helpers privados: el reparto del borrador (§5.1 y §5.4)
-- ---------------------------------------------------------------------------
-- Sin EXECUTE para nadie más que el dueño (G7). Los llaman las funciones de
-- abajo y el trigger, que corren como opsrun_migrador. G13 comprueba el
-- reparto contra las columnas :draft y contra opsrun.ai_field.

-- Las columnas que guarda confirmed_value, por tipo.
create function opsrun_private.draft_fields(p_kind opsrun.confirmation_kind)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'details' then array[
      'bzzzbx_property_id', 'bzzzbx_space_id', 'unit', 'beds', 'bzzzbx_service_id',
      'service_date', 'window_start', 'window_end', 'access_notes', 'po_number'
    ]
    when 'sender' then array['bzzzbx_customer_id', 'bzzzbx_contact_id']
    when 'cleaner' then array['bzzzbx_team_id', 'service_date', 'window_start', 'window_end']
  end
$$;
comment on function opsrun_private.draft_fields(opsrun.confirmation_kind) is
  'Columnas del borrador que guarda confirmed_value de cada tipo de confirmación (OPR-28 §5.1). G13 las compara con las columnas :draft.';

-- Las columnas que invalidan la confirmación al cambiar. El cleaner confirmó ese
-- día y esa ventana; y un cambio de propiedad es otro trabajo, aunque la
-- propiedad no viaje en su valor.
create function opsrun_private.draft_invalidating_fields(p_kind opsrun.confirmation_kind)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'cleaner' then array['bzzzbx_team_id', 'service_date', 'window_start', 'window_end', 'bzzzbx_property_id']
    else opsrun_private.draft_fields(p_kind)
  end
$$;
comment on function opsrun_private.draft_invalidating_fields(opsrun.confirmation_kind) is
  'Columnas del borrador cuyo cambio invalida la confirmación vigente de ese tipo (OPR-28 §5.1).';

-- Los campos de IA (opsrun.ai_field.code) que cierra cada confirmación. La
-- lectura de la respuesta (cleaner_reply) la cierra confirm_cleaner con
-- cleaner_text; multiple_jobs y los draft_* no son del borrador.
create function opsrun_private.ai_fields_of(p_kind opsrun.confirmation_kind)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'details' then array[
      'property', 'space', 'unit', 'beds', 'service', 'service_date', 'time_window', 'access_notes', 'po_number'
    ]
    when 'sender' then array['sender']
    when 'cleaner' then array['cleaner_team']
  end
$$;
comment on function opsrun_private.ai_fields_of(opsrun.confirmation_kind) is
  'Campos de IA (ai_field.code) de cada tipo de confirmación (OPR-28 §5.4). G13 comprueba que todo campo de borrador esté repartido.';

-- El confirmed_value: solo valores del borrador y crosswalk IDs, también los
-- nulos (un null confirmado es un dato: "sin espacio").
create function opsrun_private.draft_value(p_request opsrun.request, p_kind opsrun.confirmation_kind)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(f, to_jsonb(p_request) -> f), '{}'::jsonb)
    from unnest(opsrun_private.draft_fields(p_kind)) as f
$$;
comment on function opsrun_private.draft_value(opsrun.request, opsrun.confirmation_kind) is
  'confirmed_value de una confirmación: las columnas de draft_fields(kind) de la fila de la request (OPR-28 §5.2).';

-- ---------------------------------------------------------------------------
-- 2. lock_open_request: la fila que vio el operador (§5.3)
-- ---------------------------------------------------------------------------
-- Bloquea la fila y comprueba que sigue abierta y que es la versión que vio el
-- operador (P-10): el valor confirmado se calcula de esta fila.
create function opsrun_private.lock_open_request(p_request_id uuid, p_version bigint)
returns opsrun.request
language plpgsql
set search_path = ''
as $$
declare
  v_request opsrun.request;
begin
  select r.* into v_request
    from opsrun.request as r
   where r.id = p_request_id
     for update;
  if not found then
    raise exception 'opsRUN: la request no existe'
      using errcode = 'OP006';
  end if;
  if v_request.status <> 'open' then
    raise exception 'opsRUN: la request ya está programada'
      using errcode = 'OP007';
  end if;
  if v_request.change_seq is distinct from p_version then
    raise exception 'opsRUN: la request cambió desde que se leyó (versión % y ahora %)', p_version, v_request.change_seq
      using errcode = 'OP013';
  end if;
  return v_request;
end;
$$;
comment on function opsrun_private.lock_open_request(uuid, bigint) is
  'Bloquea la request y exige que esté open y en la versión que vio el operador: OP006, OP007, OP013 (OPR-28 §5.3).';

-- ---------------------------------------------------------------------------
-- 3. confirm_request: lo común de las tres confirmaciones (§4.5, §5.4)
-- ---------------------------------------------------------------------------
-- Una confirmación vigente por tipo (OP017), el insert con el valor del
-- borrador, el cierre de las sugerencias de IA de esos campos y el Audit. Es de
-- opsrun_private: solo la llaman confirm_details, confirm_sender y
-- confirm_cleaner, que ya comprobaron su actor y sus datos.
create function opsrun_private.confirm_request(
  p_request opsrun.request,
  p_kind opsrun.confirmation_kind,
  p_method opsrun.confirmation_method,
  p_operator_id uuid,
  p_cleaner_confirmation_id uuid,
  p_reason text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_confirmation_id uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_sugerencia opsrun.ai_suggestion;
  v_borrador jsonb;
  v_igual boolean;
begin
  if exists (
    select 1 from opsrun.request_confirmation as c
     where c.request_id = p_request.id and c.kind = p_kind and c.superseded_at is null
  ) then
    raise exception 'opsRUN: ya hay una confirmación vigente de %', p_kind
      using errcode = 'OP017';
  end if;

  insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, cleaner_confirmation_id, actor_operator_id)
  values (p_request.id, p_kind, p_method, opsrun_private.draft_value(p_request, p_kind), p_cleaner_confirmation_id, p_operator_id)
  returning id into v_confirmation_id;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, reason, occurred_at,
                                  cleaner_confirmation_id, details)
  values (p_request.id, p_kind::text || '_confirmed', 'operator', p_operator_id, v_reason, now(),
          p_cleaner_confirmation_id,
          jsonb_build_object('method', p_method, 'confirmation_id', v_confirmation_id));

  -- Las sugerencias de IA de lo que se acaba de confirmar: rank 1 y sin decidir.
  -- Igual al borrador, accepted; distinta (alguien lo cambió por un camino que
  -- no la cerró), corrected con el valor del borrador. Las alternativas (rank > 1)
  -- se quedan sin decidir. La forma de value es la de la seed hasta que OPR-36
  -- la fije (S-8).
  for v_sugerencia in
    select s.*
      from opsrun.ai_suggestion as s
     where s.request_id = p_request.id
       and s.rank = 1
       and s.decision is null
       and (
         s.field = any (opsrun_private.ai_fields_of(p_kind))
         or (p_method = 'cleaner_text' and s.field = 'cleaner_reply' and s.cleaner_confirmation_id = p_cleaner_confirmation_id)
       )
     order by s.created_at, s.id
       for update
  loop
    if v_sugerencia.field = 'cleaner_reply' then
      -- La lectura de la IA que el operador aceptó al confirmar [S-5].
      v_igual := true;
      v_borrador := null;
    else
      v_borrador := case v_sugerencia.field
        when 'property' then to_jsonb(p_request) -> 'bzzzbx_property_id'
        when 'space' then to_jsonb(p_request) -> 'bzzzbx_space_id'
        when 'unit' then to_jsonb(p_request) -> 'unit'
        when 'beds' then to_jsonb(p_request) -> 'beds'
        when 'service' then to_jsonb(p_request) -> 'bzzzbx_service_id'
        when 'service_date' then to_jsonb(p_request) -> 'service_date'
        when 'time_window' then jsonb_build_object('start', to_char(p_request.window_start, 'HH24:MI'),
                                                   'end', to_char(p_request.window_end, 'HH24:MI'))
        when 'access_notes' then to_jsonb(p_request) -> 'access_notes'
        when 'po_number' then to_jsonb(p_request) -> 'po_number'
        when 'sender' then opsrun_private.draft_value(p_request, 'sender')
        when 'cleaner_team' then to_jsonb(p_request) -> 'bzzzbx_team_id'
      end;
      v_igual := v_sugerencia.value is not distinct from v_borrador;
    end if;

    update opsrun.ai_suggestion
       set decision = case when v_igual then 'accepted'::opsrun.ai_decision else 'corrected'::opsrun.ai_decision end,
           final_value = case when v_igual then null else coalesce(v_borrador, 'null'::jsonb) end,
           decided_by = p_operator_id,
           decided_at = now()
     where id = v_sugerencia.id;

    insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at, ai_suggestion_id)
    values (p_request.id,
            case when v_igual then 'ai_suggestion_accepted' else 'ai_suggestion_corrected' end,
            'operator', p_operator_id, now(), v_sugerencia.id);
  end loop;

  return v_confirmation_id;
end;
$$;
comment on function opsrun_private.confirm_request(opsrun.request, opsrun.confirmation_kind, opsrun.confirmation_method, uuid, uuid, text) is
  'Lo común de confirm_details, confirm_sender y confirm_cleaner: OP017, la fila de request_confirmation, el cierre de las sugerencias de IA y el Audit (OPR-28 §8.1).';

-- ---------------------------------------------------------------------------
-- 4. assign_request: Assign / Reassign (§4.1)
-- ---------------------------------------------------------------------------
-- El primero de la request es Assign (request_assigned, el que Audit marca
-- Original); con dueño es Reassign (request_reassigned, con from y to). Quitar el
-- dueño no existe en V1.1 beta (P-8). Reasignar no invalida confirmaciones: son
-- sobre el borrador, no sobre el dueño. Cambia el change_seq de la request (S-7).
create function opsrun.assign_request(
  p_request_id uuid,
  p_operator_id uuid,
  p_version bigint,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := opsrun_private.require_operator();
  v_request opsrun.request;
begin
  if p_operator_id is null then
    raise exception 'opsRUN: la asignación exige un operador (quitar el dueño no existe en V1.1 beta)'
      using errcode = '22023';
  end if;

  v_request := opsrun_private.lock_open_request(p_request_id, p_version);

  if not exists (select 1 from opsrun.operator as o where o.id = p_operator_id and o.active) then
    raise exception 'opsRUN: el operador destino no existe o está inactivo'
      using errcode = 'OP014';
  end if;
  if v_request.owner_operator_id = p_operator_id then
    raise exception 'opsRUN: ese operador ya es el dueño de la request'
      using errcode = 'OP015';
  end if;

  update opsrun.request
     set owner_operator_id = p_operator_id
   where id = p_request_id;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, reason, occurred_at, details)
  values (p_request_id,
          case when v_request.owner_operator_id is null then 'request_assigned' else 'request_reassigned' end,
          'operator', v_operator_id, nullif(btrim(p_reason), ''), now(),
          case when v_request.owner_operator_id is null
               then jsonb_build_object('to_operator_id', p_operator_id)
               else jsonb_build_object('from_operator_id', v_request.owner_operator_id, 'to_operator_id', p_operator_id)
          end);
end;
$$;
comment on function opsrun.assign_request(uuid, uuid, bigint, text) is
  'OPR-28: Assign / Reassign. Pone el dueño de una request open y deja request_assigned o request_reassigned. Escritura del operador.';

-- ---------------------------------------------------------------------------
-- 5. confirm_details y confirm_sender (§4.2, §4.3)
-- ---------------------------------------------------------------------------
create function opsrun.confirm_details(p_request_id uuid, p_version bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := opsrun_private.require_operator();
  v_request opsrun.request;
  v_faltan text[];
begin
  v_request := opsrun_private.lock_open_request(p_request_id, p_version);

  -- Obligatorios (P-3): propiedad, servicio, fecha y ventana. El resto es opcional.
  v_faltan := array_remove(array[
    case when v_request.bzzzbx_property_id is null then 'bzzzbx_property_id' end,
    case when v_request.bzzzbx_service_id is null then 'bzzzbx_service_id' end,
    case when v_request.service_date is null then 'service_date' end,
    case when v_request.window_start is null then 'window_start' end,
    case when v_request.window_end is null then 'window_end' end
  ], null);
  if cardinality(v_faltan) > 0 then
    raise exception 'opsRUN: faltan datos del borrador para confirmar los detalles: %', array_to_string(v_faltan, ', ')
      using errcode = 'OP016';
  end if;

  return opsrun_private.confirm_request(v_request, 'details', 'operator', v_operator_id, null, null);
end;
$$;
comment on function opsrun.confirm_details(uuid, bigint) is
  'OPR-28: Confirm details. Confirma lo que el borrador pide (propiedad, servicio, fecha y ventana obligatorios) y cierra las sugerencias de IA de esos campos. Escritura del operador.';

create function opsrun.confirm_sender(p_request_id uuid, p_version bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := opsrun_private.require_operator();
  v_request opsrun.request;
begin
  v_request := opsrun_private.lock_open_request(p_request_id, p_version);

  -- El cliente es obligatorio [S-4]; el representante es opcional.
  if v_request.bzzzbx_customer_id is null then
    raise exception 'opsRUN: faltan datos del borrador para confirmar quién la envía: bzzzbx_customer_id'
      using errcode = 'OP016';
  end if;

  return opsrun_private.confirm_request(v_request, 'sender', 'operator', v_operator_id, null, null);
end;
$$;
comment on function opsrun.confirm_sender(uuid, bigint) is
  'OPR-28: Confirm sender. Confirma el cliente (obligatorio) y el representante del borrador y cierra la sugerencia sender. Escritura del operador.';

-- ---------------------------------------------------------------------------
-- 6. confirm_cleaner: por teléfono o aceptando la respuesta por texto (§4.4)
-- ---------------------------------------------------------------------------
-- No acepta 'operator' (P-6). Declined (OPS-020) y elegir otro equipo son de OPR-17.
create function opsrun.confirm_cleaner(
  p_request_id uuid,
  p_method opsrun.confirmation_method,
  p_version bigint,
  p_cleaner_confirmation_id uuid default null,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := opsrun_private.require_operator();
  v_request opsrun.request;
  v_pregunta opsrun.cleaner_confirmation;
  v_enlazada uuid := p_cleaner_confirmation_id;
begin
  if p_method is null or p_method not in ('phone', 'cleaner_text') then
    raise exception 'opsRUN: el cleaner se confirma por teléfono (phone) o aceptando su respuesta (cleaner_text)'
      using errcode = '22023';
  end if;
  if p_method = 'cleaner_text' and p_cleaner_confirmation_id is null then
    raise exception 'opsRUN: cleaner_text exige la respuesta del cleaner (p_cleaner_confirmation_id)'
      using errcode = '22023';
  end if;
  if p_method = 'phone' and p_cleaner_confirmation_id is not null then
    raise exception 'opsRUN: la confirmación por teléfono no lleva una respuesta del cleaner'
      using errcode = '22023';
  end if;

  v_request := opsrun_private.lock_open_request(p_request_id, p_version);

  if v_request.bzzzbx_team_id is null then
    raise exception 'opsRUN: faltan datos del borrador para confirmar el cleaner: bzzzbx_team_id'
      using errcode = 'OP016';
  end if;

  if p_method = 'cleaner_text' then
    -- La respuesta tiene que ser de esta request, la pregunta inicial, ya
    -- contestada y del mismo equipo que el borrador.
    select cc.* into v_pregunta
      from opsrun.cleaner_confirmation as cc
     where cc.id = p_cleaner_confirmation_id
       and cc.request_id = p_request_id
       for update;
    if not found
       or v_pregunta.purpose <> 'initial'
       or v_pregunta.status <> 'replied'
       or v_pregunta.bzzzbx_team_id is distinct from v_request.bzzzbx_team_id then
      raise exception 'opsRUN: esa respuesta no sirve para confirmar el cleaner de la request'
        using errcode = 'OP018';
    end if;

    update opsrun.cleaner_confirmation
       set status = 'confirmed', decided_by = v_operator_id, decided_at = now()
     where id = v_pregunta.id;
  else
    -- Por teléfono: el cleaner contestó fuera de opsRUN. La pregunta abierta al
    -- mismo equipo queda confirmed (sale de Waiting) y se enlaza; las abiertas a
    -- otro equipo se retiran (P-9).
    select cc.id into v_enlazada
      from opsrun.cleaner_confirmation as cc
     where cc.request_id = p_request_id
       and cc.purpose = 'initial'
       and cc.status in ('asked', 'replied')
       and cc.bzzzbx_team_id = v_request.bzzzbx_team_id
     order by cc.asked_at desc, cc.id desc
     limit 1;

    update opsrun.cleaner_confirmation
       set status = case when bzzzbx_team_id = v_request.bzzzbx_team_id
                         then 'confirmed'::opsrun.cleaner_confirmation_status
                         else 'withdrawn'::opsrun.cleaner_confirmation_status end,
           decided_by = v_operator_id,
           decided_at = now()
     where request_id = p_request_id
       and purpose = 'initial'
       and status in ('asked', 'replied');
  end if;

  return opsrun_private.confirm_request(v_request, 'cleaner', p_method, v_operator_id, v_enlazada, p_reason);
end;
$$;
comment on function opsrun.confirm_cleaner(uuid, opsrun.confirmation_method, bigint, uuid, text) is
  'OPR-28: Confirm cleaner, por teléfono (phone) o aceptando la respuesta por texto (cleaner_text). Cierra la pregunta al cleaner y la sugerencia cleaner_team. Escritura del operador.';

-- ---------------------------------------------------------------------------
-- 7. Trigger: el borrador cambió, la confirmación deja de valer (§5.5, P-5)
-- ---------------------------------------------------------------------------
-- Después de cualquier UPDATE de una request open, sin lista de columnas en la
-- cabecera: para cada tipo compara draft_invalidating_fields entre old y new. Si
-- alguna cambió y hay una confirmación vigente de ese tipo, la marca superseded
-- (la fila queda en la tabla y en el write-back, ya no cuenta para el gate) y
-- escribe confirmation_superseded con el actor de la transacción: el operador si
-- lo hay y, si no, system (un proceso como la intake o la IA). Sin ninguno de los
-- dos no escribe Audit con un actor inventado: lanza 42501, porque un cambio del
-- borrador sin actor no debería existir. Solo lo lanza cuando hay algo que
-- invalidar.
--
-- Lo que no invalida: reasignar, notas, mensajes, rechazar un candidato, cambiar
-- una alternativa de IA y cualquier cambio con la request ya scheduled (el
-- borrador está congelado, OP003).
create function opsrun_private.supersede_confirmations()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_kind opsrun.confirmation_kind;
  v_cambiaron text[];
  v_confirmation_id uuid;
  v_operator_id uuid;
  v_actor opsrun.actor_kind;
begin
  foreach v_kind in array enum_range(null::opsrun.confirmation_kind) loop
    select coalesce(array_agg(f order by f), '{}'::text[])
      into v_cambiaron
      from unnest(opsrun_private.draft_invalidating_fields(v_kind)) as f
     where v_old -> f is distinct from v_new -> f;
    if cardinality(v_cambiaron) = 0 then
      continue;
    end if;

    select c.id into v_confirmation_id
      from opsrun.request_confirmation as c
     where c.request_id = new.id and c.kind = v_kind and c.superseded_at is null;
    if not found then
      continue;
    end if;

    v_operator_id := opsrun_private.current_operator_id();
    if v_operator_id is not null then
      v_actor := 'operator';
    elsif opsrun_private.setting('opsrun.system_actor') is not null then
      v_actor := 'system';
    else
      raise exception 'opsRUN: el borrador cambió con una confirmación vigente y la transacción no declara actor'
        using errcode = '42501';
    end if;

    update opsrun.request_confirmation
       set superseded_at = now()
     where id = v_confirmation_id;

    insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at, details)
    values (new.id, 'confirmation_superseded', v_actor, v_operator_id, now(),
            jsonb_build_object('kind', v_kind, 'confirmation_id', v_confirmation_id, 'fields', to_jsonb(v_cambiaron)));
  end loop;
  return null;
end;
$$;
comment on function opsrun_private.supersede_confirmations() is
  'Trigger de opsrun.request: invalida las confirmaciones vigentes cuyo borrador cambió y lo deja en Audit (OPR-28 §5.5).';

create trigger request_confirmation_supersede
  after update on opsrun.request
  for each row when (old.status = 'open')
  execute function opsrun_private.supersede_confirmations();

-- ---------------------------------------------------------------------------
-- 8. Permisos: solo opsrun_app ejecuta las funciones del operador
-- ---------------------------------------------------------------------------
-- Los helpers de opsrun_private nacen sin EXECUTE para nadie más que el dueño
-- (default privileges de 20261124120000_esquema_opsrun.sql, G7).
revoke all on function opsrun.assign_request(uuid, uuid, bigint, text) from public;
revoke all on function opsrun.confirm_details(uuid, bigint) from public;
revoke all on function opsrun.confirm_sender(uuid, bigint) from public;
revoke all on function opsrun.confirm_cleaner(uuid, opsrun.confirmation_method, bigint, uuid, text) from public;
grant execute on function opsrun.assign_request(uuid, uuid, bigint, text) to opsrun_app;
grant execute on function opsrun.confirm_details(uuid, bigint) to opsrun_app;
grant execute on function opsrun.confirm_sender(uuid, bigint) to opsrun_app;
grant execute on function opsrun.confirm_cleaner(uuid, opsrun.confirmation_method, bigint, uuid, text) to opsrun_app;
