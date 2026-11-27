-- OPR-30, OPR-31 y OPR-32 · In Progress, Complete y Validation hasta Paid (Fase A).
--
-- Spec: docs/spec/opr-30-31-32-etapas.md §8 (aprobado por Henry el 2026-11-27,
-- P-0 a P-15, con P-9 dentro del único ciclo de fondo de opsRUN). Cinco columnas
-- nuevas en opsrun.request, cinco funciones del operador, una del sistema, tres
-- helpers privados, las constraints de los hechos del job y v1_request ampliada.
-- Los tipos de Audit que usa (alert_cleared, oss_marked, job_approved,
-- po_entered, job_validated, job_checked_in, job_started, job_completed y
-- job_paid) ya están en OPR-20.
--
-- Corre como opsrun_migrador, después de 20261201120000_requests_assign_confirm.sql.
-- Solo hacia adelante.
--
-- Las cinco funciones del operador (clear_alert, mark_oss, approve_job, enter_po
-- y validate_job) llaman a opsrun_private.require_operator() en su propio cuerpo
-- (G6 lo busca en prosrc), son security definer con search_path vacío y solo
-- opsrun_app las ejecuta (G5, G6, G7). Cada una bloquea la request con
-- opsrun_private.lock_scheduled_request (for update y comparación de change_seq
-- dentro de la transacción) y deja su Audit en la misma transacción: si falla
-- cualquier paso, no queda ni el dato ni su evento. G14 exige el candado a toda
-- función que escriba una columna de hechos del job (etiqueta opsrun:job).
--
-- record_observed_event es del sistema (require_system()): la llama el observador
-- mínimo (P-9), provisional hasta la read layer de OPR-22.
--
-- Fase A no manda instrucciones: ninguna función crea filas en opsrun.instruction.
-- En Fase B las mismas funciones agregarán la instrucción en su transacción sin
-- cambiar su firma.
--
-- Códigos de error (siguen a OP018, de assign-confirm):
--   OP006  la request no existe (reutilizado)
--   OP013  p_version no es el change_seq actual de la request (reutilizado)
--   OP019  la request no está programada: no tiene job
--   OP020  la regla de la alerta no se puede limpiar con Clear alert
--   OP021  la ocurrencia es de otra request
--   OP022  la ocurrencia ya está resuelta
--   OP023  el job ya está aprobado (approve_job y mark_oss)
--   OP024  sin cambios: la marca OSS o el PO ya tienen ese valor
--   OP025  el job ya está validado (enter_po y validate_job)
--   OP026  el job no está aprobado (validate_job)
--   OP027  el cliente exige PO y no hay PO vigente (validate_job)
--   OP002  falta el motivo de alert_cleared (trigger de OPR-20)
--   22023  argumento inválido: motivo, PO, alerta o tipo de evento
--   42501  sin actor o con los dos (require_operator() / require_system())

-- ---------------------------------------------------------------------------
-- 1. Columnas, constraints y comentarios (§8.1)
-- ---------------------------------------------------------------------------
alter table opsrun.request
  add column entered_po_number text,
  add column entered_po_at timestamptz,
  add column entered_po_by uuid references opsrun.operator (id) on delete restrict,
  add column validated_at timestamptz,
  add column validated_by uuid references opsrun.operator (id) on delete restrict;

alter table opsrun.request
  add constraint request_entered_po_together check (num_nulls(entered_po_number, entered_po_at, entered_po_by) in (0, 3)),
  add constraint request_entered_po_not_blank check (entered_po_number is null or length(btrim(entered_po_number)) between 1 and 64),
  add constraint request_validated_pair check ((validated_at is null) = (validated_by is null)),
  add constraint request_validated_needs_approval check (validated_at is null or approved_at is not null);

-- Los hechos del job solo existen con el job: ahora también el PO capturado y la validación.
alter table opsrun.request drop constraint request_job_facts_need_job;
alter table opsrun.request
  add constraint request_job_facts_need_job check (
    status = 'scheduled'
    or num_nonnulls(ended_manually_at, oss_mark, approved_at, entered_po_at, validated_at) = 0
  );

-- P-15: las columnas de hechos del job llevan la etiqueta opsrun:job. G14 las
-- descubre por ella; G9 la acepta junto a :draft.
comment on column opsrun.request.ended_manually_at is 'opsrun:job · End manually (OPR-30). Provisional (spec §11.2).';
comment on column opsrun.request.ended_manually_by is 'opsrun:job · Quién hizo End manually.';
comment on column opsrun.request.oss_mark is 'opsrun:job · Mark as OSS / Not OSS (OPR-31).';
comment on column opsrun.request.oss_marked_at is 'opsrun:job · Cuándo se marcó OSS.';
comment on column opsrun.request.oss_marked_by is 'opsrun:job · Quién marcó OSS; null si se marcó sola (oss_source = auto).';
comment on column opsrun.request.oss_source is 'opsrun:job · operator, o auto si salió de End manually sin fotos.';
comment on column opsrun.request.approved_at is 'opsrun:job · Approve & confirm (OPR-31).';
comment on column opsrun.request.approved_by is 'opsrun:job · Quién aprobó.';
comment on column opsrun.request.entered_po_number is
  'opsrun:job · El PO que el operador capturó en opsRUN después de programar (OPR-32). No es el PO del job en PINCH, que se lee del puerto.';
comment on column opsrun.request.entered_po_at is 'opsrun:job · Cuándo se capturó el PO.';
comment on column opsrun.request.entered_po_by is 'opsrun:job · Quién capturó el PO.';
comment on column opsrun.request.validated_at is 'opsrun:job · Validate (OPR-32).';
comment on column opsrun.request.validated_by is 'opsrun:job · Quién validó.';

-- P-4: las columnas nuevas, al final de v1_request. El resto de v1 no cambia.
create or replace view opsrun_writeback.v1_request as
  select r.id, r.r_number, r.status, r.received_at, r.owner_operator_id,
         r.bzzzbx_customer_id, r.bzzzbx_contact_id, r.bzzzbx_property_id, r.bzzzbx_space_id,
         r.unit, r.beds, r.bzzzbx_service_id, r.service_date, r.window_start, r.window_end,
         r.access_notes, r.po_number, r.bzzzbx_team_id,
         r.bzzzbx_job_id, r.job_number, r.scheduled_at,
         r.ended_manually_at, r.ended_manually_by,
         r.oss_mark, r.oss_marked_at, r.oss_marked_by, r.oss_source,
         r.approved_at, r.approved_by,
         r.created_at, r.updated_at, r.change_seq,
         r.entered_po_number, r.entered_po_at, r.entered_po_by,
         r.validated_at, r.validated_by
  from opsrun.request as r;

-- ---------------------------------------------------------------------------
-- 2. Helpers privados (§8.4)
-- ---------------------------------------------------------------------------
-- Sin EXECUTE para nadie más que el dueño (G7): los llaman las funciones de
-- abajo, que corren como opsrun_migrador.

-- Bloquea la request del job y exige que esté programada y en la versión que vio
-- el operador. Lo exige G14 a toda función que escribe un hecho del job.
create function opsrun_private.lock_scheduled_request(p_request_id uuid, p_version bigint)
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
  if v_request.status <> 'scheduled' then
    raise exception 'opsRUN: la request no tiene job todavía'
      using errcode = 'OP019';
  end if;
  if v_request.change_seq is distinct from p_version then
    raise exception 'opsRUN: la request cambió desde que se leyó (versión % y ahora %)', p_version, v_request.change_seq
      using errcode = 'OP013';
  end if;
  return v_request;
end;
$$;
comment on function opsrun_private.lock_scheduled_request(uuid, bigint) is
  'Bloquea la request y exige que esté scheduled y en la versión que vio el operador: OP006, OP019, OP013 (OPR-30 a OPR-32 §8.4).';

-- Las reglas que Clear alert puede limpiar (P-6). Es el único lugar de la lista.
create function opsrun_private.clearable_rules()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['MEC-003']::text[] $$;
comment on function opsrun_private.clearable_rules() is
  'Reglas de alerta que se pueden limpiar con Clear alert: solo MEC-003 Running long (OPR-30, P-6).';

-- El PO vigente (P-2): el capturado en opsRUN, si no el del job en PINCH (que
-- pasa el servidor) y si no el del borrador. null en po_number si no hay ninguno.
create function opsrun_private.current_po(p_request opsrun.request, p_job_po text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(btrim(p_request.entered_po_number), '') is not null
      then jsonb_build_object('po_number', btrim(p_request.entered_po_number), 'po_source', 'opsrun')
    when nullif(btrim(p_job_po), '') is not null
      then jsonb_build_object('po_number', btrim(p_job_po), 'po_source', 'pinch')
    when nullif(btrim(p_request.po_number), '') is not null
      then jsonb_build_object('po_number', btrim(p_request.po_number), 'po_source', 'draft')
    else jsonb_build_object('po_number', null, 'po_source', null)
  end
$$;
comment on function opsrun_private.current_po(opsrun.request, text) is
  'PO vigente de un job: opsrun, pinch o draft, en ese orden (OPR-32, P-2). Lo usa validate_job.';

-- ---------------------------------------------------------------------------
-- 3. clear_alert (OPR-30, §4.3)
-- ---------------------------------------------------------------------------
-- La instantánea de la alerta (regla, nivel, texto y hora de apertura) la lee el
-- servidor en BzzzBX y la pasa aquí: la frontera de confianza es el servidor, no
-- el navegador. Crea la ocurrencia si todavía no existe (nadie la escribe hasta
-- OPR-34) y la resuelve cleared_by_operator. Si la creó esta función no hay
-- alert_opened antes (S-15).
create function opsrun.clear_alert(
  p_request_id uuid,
  p_version bigint,
  p_bzzzbx_alert_id text,
  p_rule_id text,
  p_rule_version text,
  p_level opsrun.alert_level,
  p_reason_text text,
  p_opened_at timestamptz,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := opsrun_private.require_operator();
  v_request opsrun.request;
  v_reason text := nullif(btrim(p_reason), '');
  v_alert opsrun.alert_occurrence;
  v_id uuid;
begin
  v_request := opsrun_private.lock_scheduled_request(p_request_id, p_version);

  if v_reason is null then
    raise exception 'opsRUN: Clear alert exige un motivo'
      using errcode = '22023';
  end if;
  if nullif(btrim(p_bzzzbx_alert_id), '') is null
     or nullif(btrim(p_rule_id), '') is null
     or nullif(btrim(p_rule_version), '') is null
     or nullif(btrim(p_reason_text), '') is null
     or p_level is null
     or p_opened_at is null then
    raise exception 'opsRUN: Clear alert exige la alerta completa (id, regla, versión, nivel, texto y hora de apertura)'
      using errcode = '22023';
  end if;
  if not (p_rule_id = any (opsrun_private.clearable_rules())) then
    raise exception 'opsRUN: la regla % no se puede limpiar con Clear alert', p_rule_id
      using errcode = 'OP020';
  end if;

  select a.* into v_alert
    from opsrun.alert_occurrence as a
   where a.bzzzbx_alert_id = p_bzzzbx_alert_id
     for update;
  if found then
    if v_alert.request_id <> p_request_id then
      raise exception 'opsRUN: esa alerta es de otra request'
        using errcode = 'OP021';
    end if;
    if v_alert.resolved_at is not null then
      raise exception 'opsRUN: esa alerta ya está resuelta'
        using errcode = 'OP022';
    end if;
    -- Manda la regla guardada, no la que llegó.
    if not (v_alert.rule_id = any (opsrun_private.clearable_rules())) then
      raise exception 'opsRUN: la regla % no se puede limpiar con Clear alert', v_alert.rule_id
        using errcode = 'OP020';
    end if;
    update opsrun.alert_occurrence
       set resolved_at = greatest(now(), opened_at),
           resolution = 'cleared_by_operator',
           resolved_by = v_operator_id,
           resolution_reason = v_reason
     where id = v_alert.id;
    v_id := v_alert.id;
  else
    insert into opsrun.alert_occurrence (
      bzzzbx_alert_id, request_id, rule_id, rule_version, level, reason_text, opened_at,
      resolved_at, resolution, resolved_by, resolution_reason
    ) values (
      p_bzzzbx_alert_id, p_request_id, p_rule_id, p_rule_version, p_level, p_reason_text, p_opened_at,
      greatest(now(), p_opened_at), 'cleared_by_operator', v_operator_id, v_reason
    )
    returning id into v_id;
  end if;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, reason, occurred_at,
                                  alert_occurrence_id, details)
  values (p_request_id, 'alert_cleared', 'operator', v_operator_id, v_reason, now(),
          v_id, jsonb_build_object('bzzzbx_alert_id', p_bzzzbx_alert_id, 'rule_id', p_rule_id));

  return v_id;
end;
$$;
comment on function opsrun.clear_alert(uuid, bigint, text, text, text, opsrun.alert_level, text, timestamptz, text) is
  'OPR-30: Clear alert. Resuelve cleared_by_operator una alerta limpiable del job (crea la ocurrencia si falta) y deja alert_cleared con motivo. Escritura del operador.';

-- ---------------------------------------------------------------------------
-- 4. mark_oss y approve_job (OPR-31, §5.1 y §5.2)
-- ---------------------------------------------------------------------------
create function opsrun.mark_oss(
  p_request_id uuid,
  p_mark opsrun.oss_mark,
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
  v_request := opsrun_private.lock_scheduled_request(p_request_id, p_version);

  if p_mark is null then
    raise exception 'opsRUN: Mark as OSS exige una marca (oss o not_oss)'
      using errcode = '22023';
  end if;
  if v_request.approved_at is not null then
    raise exception 'opsRUN: el job ya está aprobado: la marca OSS no cambia'
      using errcode = 'OP023';
  end if;
  if v_request.oss_mark is not distinct from p_mark then
    raise exception 'opsRUN: la marca OSS ya es %', p_mark
      using errcode = 'OP024';
  end if;

  update opsrun.request
     set oss_mark = p_mark,
         oss_marked_at = now(),
         oss_marked_by = v_operator_id,
         oss_source = 'operator'
   where id = p_request_id;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, reason, occurred_at, details)
  values (p_request_id, 'oss_marked', 'operator', v_operator_id, nullif(btrim(p_reason), ''), now(),
          jsonb_build_object('mark', p_mark, 'previous_mark', v_request.oss_mark));
end;
$$;
comment on function opsrun.mark_oss(uuid, opsrun.oss_mark, bigint, text) is
  'OPR-31: Mark as OSS / Not OSS. Pone la marca del operador (cambia una auto) hasta Approve y deja oss_marked. Escritura del operador.';

create function opsrun.approve_job(p_request_id uuid, p_version bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := opsrun_private.require_operator();
  v_request opsrun.request;
begin
  v_request := opsrun_private.lock_scheduled_request(p_request_id, p_version);

  if v_request.approved_at is not null then
    raise exception 'opsRUN: el job ya está aprobado'
      using errcode = 'OP023';
  end if;

  update opsrun.request
     set approved_at = now(),
         approved_by = v_operator_id
   where id = p_request_id;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at)
  values (p_request_id, 'job_approved', 'operator', v_operator_id, now());
end;
$$;
comment on function opsrun.approve_job(uuid, bigint) is
  'OPR-31: Approve & confirm. Pone approved_at y approved_by (el job pasa a Validation) y deja job_approved. No avisa al requester (S-9). Escritura del operador.';

-- ---------------------------------------------------------------------------
-- 5. enter_po y validate_job (OPR-32, §5.3 y §5.4)
-- ---------------------------------------------------------------------------
create function opsrun.enter_po(p_request_id uuid, p_po_number text, p_version bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := opsrun_private.require_operator();
  v_request opsrun.request;
  v_po text := btrim(p_po_number);
begin
  v_request := opsrun_private.lock_scheduled_request(p_request_id, p_version);

  if v_po is null or length(v_po) not between 1 and 64 then
    raise exception 'opsRUN: el PO es texto de 1 a 64 caracteres'
      using errcode = '22023';
  end if;
  if v_request.validated_at is not null then
    raise exception 'opsRUN: el job ya está validado: el PO no cambia'
      using errcode = 'OP025';
  end if;
  if v_request.entered_po_number is not distinct from v_po then
    raise exception 'opsRUN: el PO capturado ya es ese'
      using errcode = 'OP024';
  end if;

  update opsrun.request
     set entered_po_number = v_po,
         entered_po_at = now(),
         entered_po_by = v_operator_id
   where id = p_request_id;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at, details)
  values (p_request_id, 'po_entered', 'operator', v_operator_id, now(),
          jsonb_build_object('po_number', v_po, 'previous_po_number', v_request.entered_po_number));
end;
$$;
comment on function opsrun.enter_po(uuid, text, bigint) is
  'OPR-32: Enter PO. Guarda el PO que escribió el operador en opsRUN (hasta Validate) y deja po_entered. En Fase A no sale a PINCH. Escritura del operador.';

-- p_po_required y p_job_po_number los lee el servidor en BzzzBX (Customer.po_required
-- y Job.po_number): la función no confía en el navegador. El PO de PINCH sirve para
-- desbloquear pero no se copia al Audit (solo valores de opsRUN): details.po_number
-- va solo con el PO de opsRUN o el del borrador.
create function opsrun.validate_job(
  p_request_id uuid,
  p_version bigint,
  p_po_required boolean,
  p_job_po_number text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := opsrun_private.require_operator();
  v_request opsrun.request;
  v_po jsonb;
begin
  v_request := opsrun_private.lock_scheduled_request(p_request_id, p_version);

  if p_po_required is null then
    raise exception 'opsRUN: Validate exige saber si el cliente exige PO'
      using errcode = '22023';
  end if;
  if v_request.approved_at is null then
    raise exception 'opsRUN: aprueba el job primero'
      using errcode = 'OP026';
  end if;
  if v_request.validated_at is not null then
    raise exception 'opsRUN: el job ya está validado'
      using errcode = 'OP025';
  end if;

  v_po := opsrun_private.current_po(v_request, p_job_po_number);
  if p_po_required and (v_po ->> 'po_number') is null then
    raise exception 'opsRUN: el cliente exige PO y el job no tiene'
      using errcode = 'OP027';
  end if;

  update opsrun.request
     set validated_at = now(),
         validated_by = v_operator_id
   where id = p_request_id;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at, details)
  values (p_request_id, 'job_validated', 'operator', v_operator_id, now(),
          jsonb_build_object(
            'po_required', p_po_required,
            'po_source', v_po -> 'po_source',
            'po_number', case when v_po ->> 'po_source' in ('opsrun', 'draft') then v_po -> 'po_number' else 'null'::jsonb end
          ));
end;
$$;
comment on function opsrun.validate_job(uuid, bigint, boolean, text) is
  'OPR-32: Validate. Exige el job aprobado y, si el cliente exige PO, un PO vigente (opsRUN, PINCH o borrador); pone validated_at y validated_by y deja job_validated. Escritura del operador.';

-- ---------------------------------------------------------------------------
-- 6. record_observed_event: hechos observados en Audit (P-9, §8.3)
-- ---------------------------------------------------------------------------
-- Solo el tipo, la hora de BzzzBX y el crosswalk ID (OPR-20, "Observed event"):
-- details vacío. Deduplica por bzzzbx_event_id. No toca request ni change_seq.
-- Devuelve el id del evento, o null si ya estaba o el job no es de ninguna request.
create function opsrun.record_observed_event(
  p_bzzzbx_job_id text,
  p_event_type text,
  p_bzzzbx_event_id text,
  p_occurred_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_id bigint;
begin
  perform opsrun_private.require_system();

  if nullif(btrim(p_bzzzbx_job_id), '') is null
     or nullif(btrim(p_bzzzbx_event_id), '') is null
     or p_occurred_at is null then
    raise exception 'opsRUN: un hecho observado exige job, evento y hora'
      using errcode = '22023';
  end if;
  if p_event_type is null or not exists (
    select 1 from opsrun.audit_event_type as t
     where t.code = p_event_type and t.source = 'bzzzbx_observed'
  ) then
    raise exception 'opsRUN: % no es un tipo de evento observado', p_event_type
      using errcode = '22023';
  end if;

  select r.id into v_request_id
    from opsrun.request as r
   where r.bzzzbx_job_id = p_bzzzbx_job_id;
  if not found then
    return null;
  end if;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, occurred_at, source, bzzzbx_event_id)
  values (v_request_id, p_event_type, 'bzzzbx', p_occurred_at, 'bzzzbx_observed', p_bzzzbx_event_id)
  on conflict (bzzzbx_event_id) do nothing
  returning id into v_id;

  return v_id;
end;
$$;
comment on function opsrun.record_observed_event(text, text, text, timestamptz) is
  'OPR-30 a OPR-32 (P-9): escribe un hecho observado en PINCH (checked in, started, completed, paid) en Audit, deduplicado por bzzzbx_event_id. Escritura del sistema; provisional hasta OPR-22.';

-- ---------------------------------------------------------------------------
-- 7. Permisos: solo opsrun_app ejecuta las funciones nuevas
-- ---------------------------------------------------------------------------
-- Los helpers de opsrun_private nacen sin EXECUTE para nadie más que el dueño
-- (default privileges de 20261124120000_esquema_opsrun.sql, G7).
revoke all on function opsrun.clear_alert(uuid, bigint, text, text, text, opsrun.alert_level, text, timestamptz, text) from public;
revoke all on function opsrun.mark_oss(uuid, opsrun.oss_mark, bigint, text) from public;
revoke all on function opsrun.approve_job(uuid, bigint) from public;
revoke all on function opsrun.enter_po(uuid, text, bigint) from public;
revoke all on function opsrun.validate_job(uuid, bigint, boolean, text) from public;
revoke all on function opsrun.record_observed_event(text, text, text, timestamptz) from public;
grant execute on function opsrun.clear_alert(uuid, bigint, text, text, text, opsrun.alert_level, text, timestamptz, text) to opsrun_app;
grant execute on function opsrun.mark_oss(uuid, opsrun.oss_mark, bigint, text) to opsrun_app;
grant execute on function opsrun.approve_job(uuid, bigint) to opsrun_app;
grant execute on function opsrun.enter_po(uuid, text, bigint) to opsrun_app;
grant execute on function opsrun.validate_job(uuid, bigint, boolean, text) to opsrun_app;
grant execute on function opsrun.record_observed_event(text, text, text, timestamptz) to opsrun_app;
