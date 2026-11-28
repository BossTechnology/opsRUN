-- OPR-36 · Análisis de la request por IA, por adelantado y con fallback.
--
-- Spec: docs/spec/opr-36-analisis-ia.md §8 (aprobado por Henry el 2026-11-27,
-- P-0 a P-12). Corre como opsrun_migrador, después de
-- 20261206120000_scheduled.sql. Solo hacia adelante.
--
-- Lo único que cambia de lo que ya existe: ai_analysis.instruction_id deja de
-- ser obligatorio (P-1: la IA sale por la capa de IA de BzzzBX, no por el
-- outbox, y la clave con BzzzBX es el ai_analysis.id). Agrega un check, un
-- índice único parcial, dos funciones del sistema, una del operador y los
-- helpers privados. Sin tablas, columnas, tipos ni entradas de catálogo nuevas:
-- los tipos de Audit ai_analysis_completed, ai_analysis_failed y
-- ai_suggestion_accepted / corrected / rejected ya están en OPR-20.
--
-- Las funciones del sistema (start_ai_analysis, record_ai_analysis) son de la
-- tarea `analisis_ia` del ciclo de fondo y llaman a opsrun_private.require_system()
-- en su propio cuerpo. La del operador (decide_ai_suggestion) llama a
-- require_operator(). Todas son security definer con search_path vacío y solo
-- opsrun_app las ejecuta (G5, G6, G7). Cada una deja su Audit en la misma
-- transacción que el dato.
--
-- Las IAs proponen, las personas firman: el análisis solo escribe sugerencias
-- sin decidir (o superseded) y llena columnas vacías del borrador. No crea
-- confirmaciones ni instrucciones, ni cambia el dueño, el estado ni el job de la
-- request, ni toca alertas. El guard G19 lo comprueba descubriendo las funciones
-- del sistema.
--
-- Códigos de error (OPR-36 se reserva OP045 a OP049; OPR-34 tiene OP035 a OP039
-- y OPR-29 OP040 a OP044):
--   OP045  el análisis o la sugerencia no existe
--   OP046  el resultado de la IA no es válido: campo no permitido, forma,
--          rango, duplicado o motivo largo
--   OP047  la sugerencia ya está decidida
--   OP048  la decisión no vale para esa sugerencia: accepted con el borrador
--          distinto, corrected sin final_value o con forma inválida
--   OP049  reservado, sin uso
--   OP006, OP007 y OP013 los lanza opsrun_private.lock_open_request (OPR-28)
--   22023  argumento inválido: p_status = pending en record_ai_analysis o
--          p_decision nulo o superseded en decide_ai_suggestion
--   42501  actor equivocado (de require_system() y require_operator())

-- ---------------------------------------------------------------------------
-- 1. ai_analysis: sin instrucción, un solo pending por request
-- ---------------------------------------------------------------------------
alter table opsrun.ai_analysis alter column instruction_id drop not null;
comment on column opsrun.ai_analysis.instruction_id is
  'opsrun · La instrucción que pidió el análisis; null cuando salió por la capa de IA de BzzzBX (OPR-36).';

-- Pending y sin hora de respuesta, o ya terminado y con ella.
alter table opsrun.ai_analysis
  add constraint ai_analysis_completed_at check ((status = 'pending') = (completed_at is null));

-- Un solo análisis en curso por request, también con dos procesos.
create unique index ai_analysis_one_pending_key on opsrun.ai_analysis (request_id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. Helpers privados (§8.1.6): sin EXECUTE para nadie más que el dueño (G7)
-- ---------------------------------------------------------------------------
-- Los campos que pide este análisis (§4.1). cleaner_team, cleaner_reply y los
-- draft_* son de OPR-37 y de OPR-17: la base los rechaza (OP046) hasta que esas
-- tarjetas amplíen esta lista. G13 comprueba que todos estén en ai_field.
create function opsrun_private.ai_analysis_fields()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'property', 'space', 'unit', 'beds', 'service', 'service_date', 'time_window',
    'access_notes', 'po_number', 'sender', 'multiple_jobs'
  ]
$$;
comment on function opsrun_private.ai_analysis_fields() is
  'Campos de IA (ai_field.code) que pide el análisis de la request (OPR-36 §4.1). G13 comprueba que existan en ai_field.';

-- Las columnas del borrador que llena cada campo. multiple_jobs es un aviso:
-- ninguna. G13 comprueba que todas sean :draft.
create function opsrun_private.ai_draft_columns(p_field text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_field
    when 'property' then array['bzzzbx_property_id']
    when 'space' then array['bzzzbx_space_id']
    when 'unit' then array['unit']
    when 'beds' then array['beds']
    when 'service' then array['bzzzbx_service_id']
    when 'service_date' then array['service_date']
    when 'time_window' then array['window_start', 'window_end']
    when 'access_notes' then array['access_notes']
    when 'po_number' then array['po_number']
    when 'sender' then array['bzzzbx_customer_id', 'bzzzbx_contact_id']
    else array[]::text[]
  end
$$;
comment on function opsrun_private.ai_draft_columns(text) is
  'Columnas del borrador que llena cada campo del análisis de IA (OPR-36 §4.1). multiple_jobs no llena ninguna. G13 las compara con las columnas :draft.';

-- Un crosswalk ID tiene la forma de un ID de BzzzBX: bx-<tipo>-<resto>. La base
-- no comprueba que exista: lo propone BzzzBX (S-3).
create function opsrun_private.ai_es_crosswalk(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'string'
     and (p_value #>> '{}') ~ '^bx-[a-z]{2,10}-[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
$$;
comment on function opsrun_private.ai_es_crosswalk(jsonb) is
  'La forma de un crosswalk ID de BzzzBX, sin comprobar que exista (OPR-36 S-3).';

-- Las formas de §4.1. Pura: no mira la base.
create function opsrun_private.ai_value_valid(p_field text, p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_texto text;
  v_inicio text;
  v_fin text;
  v_numero numeric;
  v_llaves text[];
  v_fecha date;
begin
  if p_value is null or p_field is null then
    return false;
  end if;

  case p_field
    when 'property', 'space', 'service' then
      return opsrun_private.ai_es_crosswalk(p_value);

    when 'unit', 'access_notes', 'po_number' then
      if jsonb_typeof(p_value) <> 'string' then
        return false;
      end if;
      v_texto := p_value #>> '{}';
      return length(btrim(v_texto)) > 0
         and length(v_texto) <= case p_field when 'unit' then 32 when 'access_notes' then 500 else 64 end;

    when 'beds' then
      if jsonb_typeof(p_value) <> 'number' then
        return false;
      end if;
      v_numero := (p_value #>> '{}')::numeric;
      return v_numero = trunc(v_numero) and v_numero between 0 and 50;

    when 'service_date' then
      if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
        return false;
      end if;
      begin
        v_fecha := (p_value #>> '{}')::date;
      exception when others then
        return false;
      end;
      return to_char(v_fecha, 'YYYY-MM-DD') = (p_value #>> '{}');

    when 'time_window' then
      if jsonb_typeof(p_value) <> 'object' then
        return false;
      end if;
      select array_agg(k order by k) into v_llaves from jsonb_object_keys(p_value) as k;
      if v_llaves is distinct from array['end', 'start'] then
        return false;
      end if;
      if jsonb_typeof(p_value -> 'start') <> 'string' or jsonb_typeof(p_value -> 'end') <> 'string' then
        return false;
      end if;
      v_inicio := p_value ->> 'start';
      v_fin := p_value ->> 'end';
      return v_inicio ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         and v_fin ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         and v_inicio < v_fin;

    when 'sender' then
      if jsonb_typeof(p_value) <> 'object' then
        return false;
      end if;
      if exists (select 1 from jsonb_object_keys(p_value) as k where k not in ('bzzzbx_customer_id', 'bzzzbx_contact_id')) then
        return false;
      end if;
      if not opsrun_private.ai_es_crosswalk(p_value -> 'bzzzbx_customer_id') then
        return false;
      end if;
      return coalesce(p_value -> 'bzzzbx_contact_id', 'null'::jsonb) = 'null'::jsonb
          or opsrun_private.ai_es_crosswalk(p_value -> 'bzzzbx_contact_id');

    when 'multiple_jobs' then
      if jsonb_typeof(p_value) <> 'object' then
        return false;
      end if;
      select array_agg(k order by k) into v_llaves from jsonb_object_keys(p_value) as k;
      if v_llaves is distinct from array['count'] or jsonb_typeof(p_value -> 'count') <> 'number' then
        return false;
      end if;
      v_numero := (p_value ->> 'count')::numeric;
      return v_numero = trunc(v_numero) and v_numero between 2 and 20;

    else
      return false;
  end case;
end;
$$;
comment on function opsrun_private.ai_value_valid(text, jsonb) is
  'Si value tiene la forma de ese campo del análisis de IA (OPR-36 §4.1). La usan record_ai_analysis y decide_ai_suggestion.';

-- sender se guarda siempre con sus dos claves, para que la comparación con
-- draft_value(…, ''sender'') (OPR-28) sea igual a igual.
create function opsrun_private.ai_normalizar(p_field text, p_value jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_field
    when 'sender' then jsonb_build_object(
      'bzzzbx_customer_id', p_value -> 'bzzzbx_customer_id',
      'bzzzbx_contact_id', coalesce(p_value -> 'bzzzbx_contact_id', 'null'::jsonb))
    else p_value
  end
$$;
comment on function opsrun_private.ai_normalizar(text, jsonb) is
  'La forma que se guarda de un valor de IA: sender siempre con cliente y contacto (OPR-36 §4.1).';

-- El valor que el borrador tiene hoy para ese campo, con la forma de §4.1
-- (la misma que compara confirm_request de OPR-28). multiple_jobs: null.
create function opsrun_private.ai_draft_value(p_request opsrun.request, p_field text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_field
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
    else null
  end
$$;
comment on function opsrun_private.ai_draft_value(opsrun.request, text) is
  'El valor del borrador de un campo del análisis de IA, con la forma de OPR-36 §4.1.';

-- ¿El borrador de la request tiene algo en las columnas de ese campo?
create function opsrun_private.ai_draft_filled(p_request opsrun.request, p_field text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1 from unnest(opsrun_private.ai_draft_columns(p_field)) as c
     where to_jsonb(p_request) -> c <> 'null'::jsonb
  )
$$;
comment on function opsrun_private.ai_draft_filled(opsrun.request, text) is
  'Si alguna columna del borrador de ese campo del análisis de IA tiene valor.';

-- ¿Una confirmación vigente cubre ese campo? Usa las columnas que invalidan, no
-- solo las que guarda: llenar la propiedad vacía de una request con el cleaner
-- confirmado invalidaría esa confirmación (OPR-28 §5.5), y la IA no puede.
create function opsrun_private.ai_covered_by_confirmation(p_request_id uuid, p_field text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from opsrun.request_confirmation as c
     where c.request_id = p_request_id
       and c.superseded_at is null
       and opsrun_private.ai_draft_columns(p_field) && opsrun_private.draft_invalidating_fields(c.kind)
  )
$$;
comment on function opsrun_private.ai_covered_by_confirmation(uuid, text) is
  'Si una confirmación vigente cubre las columnas del borrador de ese campo (OPR-36 §5.3).';

-- Escribe (o vacía, con p_value nulo) las columnas del borrador de un campo.
-- Es la única vía por la que el análisis y las decisiones del operador tocan la
-- request, y solo toca columnas :draft (G13 lo comprueba).
create function opsrun_private.ai_apply_to_draft(p_request opsrun.request, p_field text, p_value jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_field
    when 'property' then
      update opsrun.request set bzzzbx_property_id = p_value #>> '{}' where id = p_request.id;
    when 'space' then
      update opsrun.request set bzzzbx_space_id = p_value #>> '{}' where id = p_request.id;
    when 'unit' then
      update opsrun.request set unit = p_value #>> '{}' where id = p_request.id;
    when 'beds' then
      update opsrun.request set beds = (p_value #>> '{}')::smallint where id = p_request.id;
    when 'service' then
      update opsrun.request set bzzzbx_service_id = p_value #>> '{}' where id = p_request.id;
    when 'service_date' then
      update opsrun.request set service_date = (p_value #>> '{}')::date where id = p_request.id;
    when 'time_window' then
      update opsrun.request
         set window_start = (p_value ->> 'start')::time,
             window_end = (p_value ->> 'end')::time
       where id = p_request.id;
    when 'access_notes' then
      update opsrun.request set access_notes = p_value #>> '{}' where id = p_request.id;
    when 'po_number' then
      update opsrun.request set po_number = p_value #>> '{}' where id = p_request.id;
    when 'sender' then
      update opsrun.request
         set bzzzbx_customer_id = p_value ->> 'bzzzbx_customer_id',
             bzzzbx_contact_id = p_value ->> 'bzzzbx_contact_id'
       where id = p_request.id;
    else
      null; -- multiple_jobs: es un aviso, no tiene columnas
  end case;
end;
$$;
comment on function opsrun_private.ai_apply_to_draft(opsrun.request, text, jsonb) is
  'Escribe, o vacía con valor nulo, las columnas del borrador de un campo del análisis de IA (OPR-36 §8.1).';

-- ---------------------------------------------------------------------------
-- 3. start_ai_analysis (§5.2)
-- ---------------------------------------------------------------------------
-- Bloquea la request y decide si toca un análisis nuevo. Devuelve su id o null:
--   - la request no existe o no está open;
--   - ya hay uno pending o completed;
--   - ya hubo dos (el primero y un reintento);
--   - el último terminó failed o timed_out hace menos de 60 s, o fue un rechazo
--     definitivo de BzzzBX (S-8).
create function opsrun.start_ai_analysis(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proceso text := opsrun_private.require_system();
  v_request opsrun.request;
  v_ultimo opsrun.ai_analysis;
  v_id uuid;
begin
  select r.* into v_request
    from opsrun.request as r
   where r.id = p_request_id
     for update;
  if not found or v_request.status <> 'open' then
    return null;
  end if;

  if exists (
    select 1 from opsrun.ai_analysis as a
     where a.request_id = p_request_id and a.status in ('pending', 'completed')
  ) then
    return null;
  end if;

  if (select count(*) from opsrun.ai_analysis as a where a.request_id = p_request_id) >= 2 then
    return null;
  end if;

  select a.* into v_ultimo
    from opsrun.ai_analysis as a
   where a.request_id = p_request_id
   order by a.requested_at desc, a.id desc
   limit 1;
  if found then
    -- El reintento espera 60 s desde el fallo.
    if v_ultimo.completed_at > now() - interval '60 seconds' then
      return null;
    end if;
    -- Un rechazo definitivo de BzzzBX no se reintenta.
    if exists (
      select 1 from opsrun.audit_event as e
       where e.request_id = p_request_id
         and e.event_type = 'ai_analysis_failed'
         and e.details ->> 'ai_analysis_id' = v_ultimo.id::text
         and e.details -> 'definitive' = 'true'::jsonb
    ) then
      return null;
    end if;
  end if;

  insert into opsrun.ai_analysis (request_id, status)
  values (p_request_id, 'pending')
  returning id into v_id;

  return v_id;
end;
$$;
comment on function opsrun.start_ai_analysis(uuid) is
  'OPR-36: abre un análisis pending de una request open si toca (uno solo en curso, a lo sumo dos por request, reintento a los 60 s). Devuelve su id o null. Escritura del sistema.';

-- ---------------------------------------------------------------------------
-- 4. record_ai_analysis (§5.3)
-- ---------------------------------------------------------------------------
-- Cierra un análisis pending (completed, failed o timed_out) y, si completó,
-- guarda sus sugerencias y llena los campos vacíos del borrador. Todo o nada:
-- valida todo p_suggestions antes de escribir. Devuelve 'recorded' o
-- 'duplicate' (el análisis ya no estaba pending: un resultado tardío no escribe).
create function opsrun.record_ai_analysis(
  p_ai_analysis_id uuid,
  p_status opsrun.ai_analysis_status,
  p_model text default null,
  p_suggestions jsonb default '[]',
  p_error_code text default null,
  p_definitive boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proceso text := opsrun_private.require_system();
  v_request_id uuid;
  v_request opsrun.request;
  v_analysis opsrun.ai_analysis;
  v_item jsonb;
  v_field text;
  v_rank int;
  v_value jsonb;
  v_reason text;
  v_claves text[] := '{}';
  v_con_rank1 text[] := '{}';
  v_sin_rank1 text[];
  v_super boolean;
  v_campos text[] := '{}';
  v_llenos text[] := '{}';
  v_fila record;
  v_error text := left(nullif(btrim(p_error_code), ''), 64);
  v_modelo text := left(nullif(btrim(p_model), ''), 100);
begin
  if p_status is null or p_status = 'pending' then
    raise exception 'opsRUN: record_ai_analysis cierra un análisis: completed, failed o timed_out'
      using errcode = '22023';
  end if;
  if p_status <> 'completed' and coalesce(p_suggestions, '[]'::jsonb) <> '[]'::jsonb then
    raise exception 'opsRUN: un análisis % no lleva sugerencias', p_status
      using errcode = '22023';
  end if;

  -- La request primero y el análisis después, igual que start_ai_analysis.
  select a.request_id into v_request_id
    from opsrun.ai_analysis as a
   where a.id = p_ai_analysis_id;
  if not found then
    raise exception 'opsRUN: el análisis no existe'
      using errcode = 'OP045';
  end if;

  select r.* into v_request
    from opsrun.request as r
   where r.id = v_request_id
     for update;

  select a.* into v_analysis
    from opsrun.ai_analysis as a
   where a.id = p_ai_analysis_id
     for update;
  if v_analysis.status <> 'pending' then
    return 'duplicate';
  end if;

  -- Todo el resultado se valida antes de escribir nada (OP046).
  if p_status = 'completed' then
    if jsonb_typeof(p_suggestions) is distinct from 'array' then
      raise exception 'opsRUN: las sugerencias de la IA van en una lista'
        using errcode = 'OP046';
    end if;
    for v_item in select e.value from jsonb_array_elements(p_suggestions) as e loop
      if jsonb_typeof(v_item) <> 'object'
         or exists (select 1 from jsonb_object_keys(v_item) as k where k not in ('field', 'rank', 'value', 'reason')) then
        raise exception 'opsRUN: una sugerencia de la IA tiene claves de más'
          using errcode = 'OP046';
      end if;
      if jsonb_typeof(v_item -> 'field') is distinct from 'string'
         or not ((v_item ->> 'field') = any (opsrun_private.ai_analysis_fields())) then
        raise exception 'opsRUN: la IA propuso un campo que este análisis no pide'
          using errcode = 'OP046';
      end if;
      v_field := v_item ->> 'field';
      if jsonb_typeof(v_item -> 'rank') is distinct from 'number'
         or (v_item ->> 'rank')::numeric not in (1, 2, 3) then
        raise exception 'opsRUN: el rango de una sugerencia de la IA no es 1, 2 ni 3 (campo %)', v_field
          using errcode = 'OP046';
      end if;
      v_rank := (v_item ->> 'rank')::numeric::int;
      if not opsrun_private.ai_value_valid(v_field, v_item -> 'value') then
        raise exception 'opsRUN: la IA propuso un valor con forma inválida para %', v_field
          using errcode = 'OP046';
      end if;
      if v_item -> 'reason' is not null
         and jsonb_typeof(v_item -> 'reason') not in ('null', 'string') then
        raise exception 'opsRUN: el motivo de una sugerencia de la IA no es texto (campo %)', v_field
          using errcode = 'OP046';
      end if;
      if jsonb_typeof(v_item -> 'reason') = 'string' and length(v_item ->> 'reason') > 200 then
        raise exception 'opsRUN: el motivo de una sugerencia de la IA pasa de 200 caracteres (campo %)', v_field
          using errcode = 'OP046';
      end if;
      if (v_field || ':' || v_rank) = any (v_claves) then
        raise exception 'opsRUN: la IA repitió el rango % del campo %', v_rank, v_field
          using errcode = 'OP046';
      end if;
      v_claves := v_claves || (v_field || ':' || v_rank);
      if v_rank = 1 then
        v_con_rank1 := v_con_rank1 || v_field;
      end if;
    end loop;
    select array_agg(distinct split_part(c, ':', 1)) into v_sin_rank1
      from unnest(v_claves) as c
     where split_part(c, ':', 1) <> all (v_con_rank1);
    if v_sin_rank1 is not null then
      raise exception 'opsRUN: la IA dio alternativas sin propuesta principal para %', array_to_string(v_sin_rank1, ', ')
        using errcode = 'OP046';
    end if;
  end if;

  update opsrun.ai_analysis
     set status = p_status,
         model = case when p_status = 'completed' then v_modelo else model end,
         completed_at = now()
   where id = p_ai_analysis_id;

  if p_status <> 'completed' then
    insert into opsrun.audit_event (request_id, event_type, actor_kind, occurred_at, details)
    values (v_request_id, 'ai_analysis_failed', 'system', now(),
            jsonb_strip_nulls(jsonb_build_object(
              'ai_analysis_id', p_ai_analysis_id,
              'status', p_status,
              'error_code', v_error,
              'definitive', case when p_definitive then true end)));
    return 'recorded';
  end if;

  -- La request ya no está open: el borrador está congelado (G11). Se cierra el
  -- análisis sin guardar nada y el Audit lo dice.
  if v_request.status <> 'open' then
    insert into opsrun.audit_event (request_id, event_type, actor_kind, occurred_at, details)
    values (v_request_id, 'ai_analysis_completed', 'ai', now(),
            jsonb_build_object('ai_analysis_id', p_ai_analysis_id, 'fields', '[]'::jsonb, 'filled', '[]'::jsonb,
                               'discarded', 'request_not_open'));
    return 'recorded';
  end if;

  -- Las abiertas de un análisis anterior de la misma request (el primero, si
  -- este es el reintento) ya no valen.
  update opsrun.ai_suggestion
     set decision = 'superseded', decided_at = now()
   where request_id = v_request_id
     and ai_analysis_id is not null
     and ai_analysis_id <> p_ai_analysis_id
     and decision is null
     and field = any (opsrun_private.ai_analysis_fields());

  -- Primero las principales, para que llenen el borrador antes que se mire una alternativa.
  for v_fila in
    select e.value as item, (e.value ->> 'field') as field, (e.value ->> 'rank')::numeric::int as rank
      from jsonb_array_elements(p_suggestions) with ordinality as e(value, ordinality)
     order by (e.value ->> 'rank')::numeric, e.ordinality
  loop
    v_field := v_fila.field;
    v_rank := v_fila.rank;
    v_value := opsrun_private.ai_normalizar(v_field, v_fila.item -> 'value');
    v_reason := case when jsonb_typeof(v_fila.item -> 'reason') = 'string' then v_fila.item ->> 'reason' end;

    -- Superseded de entrada: el operador ya decidió ese campo (lo rechazó o lo
    -- corrigió) o una confirmación vigente lo cubre. Un resultado tardío nunca
    -- deshace lo que una persona firmó (P-8).
    v_super := exists (
                 select 1 from opsrun.ai_suggestion as s
                  where s.request_id = v_request_id
                    and s.field = v_field
                    and s.decision in ('rejected', 'corrected')
               )
               or opsrun_private.ai_covered_by_confirmation(v_request_id, v_field);

    insert into opsrun.ai_suggestion (request_id, ai_analysis_id, field, rank, value, reason, decision, decided_at)
    values (v_request_id, p_ai_analysis_id, v_field, v_rank, v_value, v_reason,
            case when v_super then 'superseded'::opsrun.ai_decision end,
            case when v_super then now() end);

    if not (v_field = any (v_campos)) then
      v_campos := v_campos || v_field;
    end if;

    -- Solo la principal llena el borrador, y solo si está vacío.
    if v_rank = 1 and not v_super and not opsrun_private.ai_draft_filled(v_request, v_field)
       and cardinality(opsrun_private.ai_draft_columns(v_field)) > 0 then
      perform opsrun_private.ai_apply_to_draft(v_request, v_field, v_value);
      v_llenos := v_llenos || v_field;
      select r.* into v_request from opsrun.request as r where r.id = v_request_id;
    end if;
  end loop;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, occurred_at, details)
  values (v_request_id, 'ai_analysis_completed', 'ai', now(),
          jsonb_build_object('ai_analysis_id', p_ai_analysis_id,
                             'fields', to_jsonb(v_campos),
                             'filled', to_jsonb(v_llenos)));
  return 'recorded';
end;
$$;
comment on function opsrun.record_ai_analysis(uuid, opsrun.ai_analysis_status, text, jsonb, text, boolean) is
  'OPR-36: cierra un análisis pending; si completó, guarda las sugerencias y llena los campos vacíos del borrador que nada cubre. Un resultado tardío no escribe (duplicate). Escritura del sistema.';

-- ---------------------------------------------------------------------------
-- 5. decide_ai_suggestion: Accept, Change y Reject por campo (§10.2)
-- ---------------------------------------------------------------------------
create function opsrun.decide_ai_suggestion(
  p_ai_suggestion_id uuid,
  p_decision opsrun.ai_decision,
  p_version bigint,
  p_final_value jsonb default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := opsrun_private.require_operator();
  v_sugerencia opsrun.ai_suggestion;
  v_request opsrun.request;
  v_borrador jsonb;
  v_final jsonb;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_decision is null or p_decision = 'superseded' then
    raise exception 'opsRUN: un operador acepta, corrige o rechaza una sugerencia (accepted, corrected o rejected)'
      using errcode = '22023';
  end if;

  select s.* into v_sugerencia
    from opsrun.ai_suggestion as s
   where s.id = p_ai_suggestion_id;
  if not found or not (v_sugerencia.field = any (opsrun_private.ai_analysis_fields())) then
    raise exception 'opsRUN: la sugerencia no existe'
      using errcode = 'OP045';
  end if;

  v_request := opsrun_private.lock_open_request(v_sugerencia.request_id, p_version);

  -- Con la request bloqueada se vuelve a leer: otro operador pudo decidirla.
  select s.* into v_sugerencia
    from opsrun.ai_suggestion as s
   where s.id = p_ai_suggestion_id
     for update;
  if v_sugerencia.decision is not null then
    raise exception 'opsRUN: la sugerencia ya está decidida'
      using errcode = 'OP047';
  end if;
  if v_sugerencia.rank <> 1 then
    raise exception 'opsRUN: solo se decide la propuesta principal de un campo'
      using errcode = 'OP048';
  end if;

  v_borrador := opsrun_private.ai_draft_value(v_request, v_sugerencia.field);

  if p_decision = 'accepted' then
    if p_final_value is not null then
      raise exception 'opsRUN: aceptar no lleva un valor final'
        using errcode = 'OP048';
    end if;
    -- Aceptar no cambia el valor: el borrador tiene que ser el de la IA.
    -- multiple_jobs no tiene borrador: se acepta como aviso visto.
    if v_sugerencia.field <> 'multiple_jobs' and v_borrador is distinct from v_sugerencia.value then
      raise exception 'opsRUN: el borrador ya no tiene el valor de la IA; corrígelo o recházalo'
        using errcode = 'OP048';
    end if;

  elsif p_decision = 'corrected' then
    if p_final_value is null or not opsrun_private.ai_value_valid(v_sugerencia.field, p_final_value) then
      raise exception 'opsRUN: corregir exige un valor final con la forma del campo'
        using errcode = 'OP048';
    end if;
    if v_sugerencia.field = 'multiple_jobs' then
      raise exception 'opsRUN: el aviso de varios jobs se acepta o se rechaza'
        using errcode = 'OP048';
    end if;
    v_final := opsrun_private.ai_normalizar(v_sugerencia.field, p_final_value);
    -- El trigger de OPR-28 invalida lo que cubra la columna, con el operador como actor.
    perform opsrun_private.ai_apply_to_draft(v_request, v_sugerencia.field, v_final);

  else
    if p_final_value is not null then
      raise exception 'opsRUN: rechazar no lleva un valor final'
        using errcode = 'OP048';
    end if;
    -- Si el borrador todavía tiene el valor de la IA, se vacía; si alguien ya lo
    -- cambió, se deja.
    if v_sugerencia.field <> 'multiple_jobs' and v_borrador is not distinct from v_sugerencia.value then
      perform opsrun_private.ai_apply_to_draft(v_request, v_sugerencia.field, null);
    end if;
  end if;

  update opsrun.ai_suggestion
     set decision = p_decision,
         final_value = v_final,
         decided_by = v_operator_id,
         decided_at = now()
   where id = p_ai_suggestion_id;

  -- Las alternativas del mismo campo y análisis ya no hacen falta.
  update opsrun.ai_suggestion
     set decision = 'superseded', decided_at = now()
   where request_id = v_sugerencia.request_id
     and field = v_sugerencia.field
     and ai_analysis_id is not distinct from v_sugerencia.ai_analysis_id
     and rank > 1
     and decision is null;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, reason, occurred_at, ai_suggestion_id)
  values (v_sugerencia.request_id, 'ai_suggestion_' || p_decision::text, 'operator', v_operator_id, v_reason, now(),
          p_ai_suggestion_id);
end;
$$;
comment on function opsrun.decide_ai_suggestion(uuid, opsrun.ai_decision, bigint, jsonb, text) is
  'OPR-36: Accept, Change o Reject de una sugerencia de la IA sobre un campo del borrador de una request open. Escribe la decisión, el borrador si toca y su Audit. Escritura del operador.';

-- ---------------------------------------------------------------------------
-- 6. Permisos: solo opsrun_app ejecuta las tres
-- ---------------------------------------------------------------------------
-- Los helpers de opsrun_private nacen sin EXECUTE para nadie más que el dueño
-- (default privileges de 20261124120000_esquema_opsrun.sql, G7).
revoke all on function opsrun.start_ai_analysis(uuid) from public;
revoke all on function opsrun.record_ai_analysis(uuid, opsrun.ai_analysis_status, text, jsonb, text, boolean) from public;
revoke all on function opsrun.decide_ai_suggestion(uuid, opsrun.ai_decision, bigint, jsonb, text) from public;
grant execute on function opsrun.start_ai_analysis(uuid) to opsrun_app;
grant execute on function opsrun.record_ai_analysis(uuid, opsrun.ai_analysis_status, text, jsonb, text, boolean) to opsrun_app;
grant execute on function opsrun.decide_ai_suggestion(uuid, opsrun.ai_decision, bigint, jsonb, text) to opsrun_app;
