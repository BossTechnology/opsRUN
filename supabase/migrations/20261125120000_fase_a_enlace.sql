-- OPR-28 · Fase A: enlace de una request con el job observado.
--
-- Spec: docs/spec/fase-a-enlace.md (aprobado por Henry el 2026-11-25).
--
-- En la Fase A el job se crea en las herramientas de PINCH; opsRUN lo observa
-- por BzzzBX y el operador confirma cuál es el de la request. Esta migración
-- agrega las dos escrituras del operador de ese paso y un tipo de Audit. No
-- cambia tablas, triggers ni vistas del write-back.
--
-- Corre como opsrun_migrador, después de 20261124130000_modelo_de_datos.sql.
-- Solo hacia adelante.

-- ---------------------------------------------------------------------------
-- 1. Audit: rechazo de un candidato
-- ---------------------------------------------------------------------------
-- El enlace confirmado usa request_scheduled con details.mode = 'linked'
-- (spec §9, P-3). El rechazo es un tipo nuevo; el motivo es opcional (P-2).
insert into opsrun.audit_event_type (code, label, requires_reason, source, sort_order) values
  ('job_link_rejected', 'Job link rejected', false, 'opsrun', 85);

-- ---------------------------------------------------------------------------
-- 2. link_observed_job: el operador confirma que el job es el de la request
-- ---------------------------------------------------------------------------
-- El servidor ya leyó el job en BzzzBX (existe y no está cancelado) y pasa su
-- crosswalk ID y su job number: la base no puede leer BzzzBX. La request queda
-- Scheduled; el trigger request_schedule_gate exige dueño y las tres
-- confirmaciones vigentes (P-1). No se crea ninguna instrucción: en la Fase A
-- no sale nada hacia BzzzBX.
create function opsrun.link_observed_job(p_request_id uuid, p_bzzzbx_job_id text, p_job_number text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := opsrun_private.require_operator();
  v_status opsrun.request_status;
begin
  if nullif(btrim(p_bzzzbx_job_id), '') is null or nullif(btrim(p_job_number), '') is null then
    raise exception 'opsRUN: el enlace exige el crosswalk ID y el job number del job'
      using errcode = '22023';
  end if;

  select r.status into v_status
    from opsrun.request as r
   where r.id = p_request_id
     for update;
  if not found then
    raise exception 'opsRUN: la request no existe'
      using errcode = 'OP006';
  end if;
  if v_status <> 'open' then
    raise exception 'opsRUN: la request ya está programada'
      using errcode = 'OP007';
  end if;

  if exists (
    select 1 from opsrun.request as r
     where (r.bzzzbx_job_id = p_bzzzbx_job_id or r.job_number = p_job_number)
       and r.id <> p_request_id
  ) then
    raise exception 'opsRUN: ese job ya está enlazado a otra request'
      using errcode = 'OP008';
  end if;

  update opsrun.request
     set bzzzbx_job_id = p_bzzzbx_job_id,
         job_number = p_job_number,
         scheduled_at = now(),
         status = 'scheduled'
   where id = p_request_id;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at, details)
  values (p_request_id, 'request_scheduled', 'operator', v_operator_id, now(),
          jsonb_build_object('mode', 'linked', 'bzzzbx_job_id', p_bzzzbx_job_id, 'job_number', p_job_number));
end;
$$;
comment on function opsrun.link_observed_job(uuid, text, text) is
  'Fase A (OPR-28): enlaza la request con el job observado en BzzzBX y la deja Scheduled, con su Audit. Escritura del operador.';

-- ---------------------------------------------------------------------------
-- 3. reject_job_link: el operador dice que ese job no es el de la request
-- ---------------------------------------------------------------------------
-- Solo deja el evento en Audit; la propuesta no vuelve a ofrecer ese job para
-- esa request (spec §6). No toca la request.
create function opsrun.reject_job_link(p_request_id uuid, p_bzzzbx_job_id text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := opsrun_private.require_operator();
  v_status opsrun.request_status;
begin
  if nullif(btrim(p_bzzzbx_job_id), '') is null then
    raise exception 'opsRUN: el rechazo exige el crosswalk ID del job'
      using errcode = '22023';
  end if;

  select r.status into v_status
    from opsrun.request as r
   where r.id = p_request_id;
  if not found then
    raise exception 'opsRUN: la request no existe'
      using errcode = 'OP006';
  end if;
  if v_status <> 'open' then
    raise exception 'opsRUN: la request ya está programada'
      using errcode = 'OP007';
  end if;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, reason, occurred_at, details)
  values (p_request_id, 'job_link_rejected', 'operator', v_operator_id, nullif(btrim(p_reason), ''), now(),
          jsonb_build_object('bzzzbx_job_id', p_bzzzbx_job_id));
end;
$$;
comment on function opsrun.reject_job_link(uuid, text, text) is
  'Fase A (OPR-28): registra en Audit que un job propuesto no es el de la request. Escritura del operador.';

-- ---------------------------------------------------------------------------
-- 4. Permisos: solo opsrun_app las ejecuta
-- ---------------------------------------------------------------------------
revoke all on function opsrun.link_observed_job(uuid, text, text) from public;
revoke all on function opsrun.reject_job_link(uuid, text, text) from public;
grant execute on function opsrun.link_observed_job(uuid, text, text) to opsrun_app;
grant execute on function opsrun.reject_job_link(uuid, text, text) to opsrun_app;
