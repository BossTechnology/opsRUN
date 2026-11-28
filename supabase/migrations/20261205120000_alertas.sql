-- OPR-34 · Alertas: el registro del historial de alertas (pestaña Alerts y panel de la barra).
--
-- Spec: docs/spec/opr-34-alerts.md §8 (aprobado por Henry el 2026-11-27, P-0 a
-- P-13, con P-2 dentro del único ciclo de fondo de opsRUN). Sin tablas, columnas
-- ni vistas nuevas: `opsrun.alert_occurrence` ya tiene todo (OPR-20 §3.8) y
-- `opsrun_writeback.v1_alert_occurrence` ya la expone. Esta migración agrega:
--
--   * `opsrun.upsert_alert_occurrence(...)`: la función del sistema que escribe
--     cada apertura, cambio de nivel y resolución de una alerta, y su Audit en la
--     misma transacción. La llama el registrador de alertas (tarea del ciclo de
--     fondo, src/lib/alertas/), como el actor de sistema `registrador_alertas`.
--   * `opsrun_private.alert_fixing_events()` y `opsrun_private.alert_fix_for(...)`:
--     el reparto regla -> eventos de Audit que arreglan esa regla (P-1) y la
--     búsqueda del último evento de un operador entre la apertura y el cierre.
--   * El trigger `alert_occurrence_resolved_frozen`: una ocurrencia resuelta no se
--     toca (OPR-20 §3.8). Lo exige a toda función, incluida `clear_alert`, que ya
--     comprueba OP022 antes y no se ve afectada. Lo vigila el guard G17.
--
-- Corre como opsrun_migrador, después de 20261204120000_entrada_correo.sql.
-- Solo hacia adelante.
--
-- La función es security definer con search_path vacío, llama a
-- opsrun_private.require_system() en su cuerpo (G6), solo opsrun_app la ejecuta
-- (G5, G6, G7) y deja el Audit en la misma transacción que la ocurrencia: si un
-- paso falla, no queda ninguno.
--
-- Códigos de error (siguen a OP034, de entrada de correo). OPR-34 reserva OP035
-- a OP039 y usa dos:
--   OP006  la request no existe (reutilizado)                      upsert_alert_occurrence
--   OP035  la ocurrencia ya existe con otra request u otra regla   upsert_alert_occurrence
--   OP036  se intenta cambiar una ocurrencia resuelta              alert_occurrence_resolved_frozen
--   22023  argumento inválido                                      upsert_alert_occurrence
--   42501  sin actor de sistema, con un operador o con los dos     require_system()
--   (OP037 a OP039 quedan reservados.)

-- ---------------------------------------------------------------------------
-- 1. Helpers privados (§8.3)
-- ---------------------------------------------------------------------------
-- Sin EXECUTE para nadie más que el dueño (G7): los llama upsert_alert_occurrence,
-- que corre como opsrun_migrador.

-- Qué eventos de Audit arreglan cada regla (§4.1). Es el único lugar de la tabla.
-- Delayed (OPS-010) y Running long (MEC-003) no tienen ninguno: las limpia el
-- check-in, el fin del job o Clear alert. 'MSG-001' es el id provisional de
-- Message not delivered hasta OPR-33 (P-12); src/lib/alertas/reglas.ts lo repite.
create function opsrun_private.alert_fixing_events()
returns table (rule_id text, event_type text)
language sql
immutable
set search_path = ''
as $$
  select t.rule_id, t.event_type
  from (values
    ('OPS-001', 'request_assigned'),
    ('OPS-001', 'request_reassigned'),
    ('OPS-002', 'request_scheduled'),
    ('OPS-020', 'cleaner_confirmed'),
    ('ORG-002', 'oss_marked'),
    ('ORG-003', 'oss_marked'),
    ('TRN-005', 'po_entered'),
    ('MSG-001', 'email_sent'),
    ('MSG-001', 'text_sent')
  ) as t (rule_id, event_type)
$$;
comment on function opsrun_private.alert_fixing_events() is
  'Eventos de Audit que arreglan cada regla de alerta (OPR-34 §4.1, P-1). Cada event_type existe en audit_event_type (lo prueba alertas.test.sql).';

-- El último evento de un operador de esa request, de un tipo que arregla esa
-- regla, entre la apertura y el cierre (inclusive). null si no hay ninguno.
create function opsrun_private.alert_fix_for(
  p_request_id uuid,
  p_rule_id text,
  p_from timestamptz,
  p_to timestamptz
)
returns opsrun.audit_event
language sql
stable
set search_path = ''
as $$
  select e.*
  from opsrun.audit_event as e
  where e.request_id = p_request_id
    and e.actor_kind = 'operator'
    and e.occurred_at between p_from and p_to
    and exists (
      select 1
      from opsrun_private.alert_fixing_events() as f
      where f.rule_id = p_rule_id and f.event_type = e.event_type
    )
  order by e.occurred_at desc, e.id desc
  limit 1
$$;
comment on function opsrun_private.alert_fix_for(uuid, text, timestamptz, timestamptz) is
  'Último evento de un operador que arregla la regla, entre la apertura y el cierre de la alerta; null si no hubo (OPR-34 §4.1).';

-- ---------------------------------------------------------------------------
-- 2. Trigger: una ocurrencia resuelta no se reabre ni se cambia (§8.1)
-- ---------------------------------------------------------------------------
create function opsrun_private.alert_occurrence_resolved_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.resolved_at is not null then
    raise exception 'opsRUN: la alerta % ya está resuelta y no se cambia', old.bzzzbx_alert_id
      using errcode = 'OP036';
  end if;
  return new;
end;
$$;
comment on function opsrun_private.alert_occurrence_resolved_frozen() is
  'Una alert_occurrence resuelta es de solo lectura: cualquier UPDATE lanza OP036 (OPR-34 §8.1). Corre antes de touch_row por orden de nombre.';

create trigger alert_occurrence_resolved_frozen before update on opsrun.alert_occurrence
  for each row execute function opsrun_private.alert_occurrence_resolved_frozen();

-- ---------------------------------------------------------------------------
-- 3. upsert_alert_occurrence (§8.2)
-- ---------------------------------------------------------------------------
-- La request la resuelve el servidor desde el sujeto de la alerta (§3.2). Lo que
-- BzzzBX dijo al abrirse (regla, versión, texto y hora) es la instantánea y no se
-- actualiza después; el nivel sí, mientras la alerta está abierta. Quién la
-- resolvió y cómo sale de opsRUN (§4.1), no de BzzzBX. Llamarla dos veces con lo
-- mismo no escribe nada la segunda (ni change_seq ni Audit).
create function opsrun.upsert_alert_occurrence(
  p_bzzzbx_alert_id text,
  p_request_id uuid,
  p_rule_id text,
  p_rule_version text,
  p_level opsrun.alert_level,
  p_reason_text text,
  p_bzzzbx_message_id text,
  p_opened_at timestamptz,
  p_cleared_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert opsrun.alert_occurrence;
  v_fix opsrun.audit_event;
  v_id uuid;
  v_resolution opsrun.alert_resolution;
begin
  perform opsrun_private.require_system();

  if nullif(btrim(p_bzzzbx_alert_id), '') is null
     or p_request_id is null
     or nullif(btrim(p_rule_id), '') is null
     or nullif(btrim(p_rule_version), '') is null
     or p_level is null
     or nullif(btrim(p_reason_text), '') is null
     or p_opened_at is null then
    raise exception 'opsRUN: la alerta necesita id, request, regla, versión, nivel, texto y hora de apertura'
      using errcode = '22023';
  end if;
  if p_cleared_at is not null and p_cleared_at < p_opened_at then
    raise exception 'opsRUN: la alerta no puede cerrarse antes de abrirse'
      using errcode = '22023';
  end if;
  if not exists (select 1 from opsrun.request as r where r.id = p_request_id) then
    raise exception 'opsRUN: la request no existe'
      using errcode = 'OP006';
  end if;

  select a.* into v_alert
    from opsrun.alert_occurrence as a
   where a.bzzzbx_alert_id = p_bzzzbx_alert_id
     for update;

  if not found then
    -- Si dos procesos la insertan a la vez, uno recibe 23505 y la siguiente vuelta la ve (S-12).
    insert into opsrun.alert_occurrence (
      bzzzbx_alert_id, request_id, rule_id, rule_version, level, reason_text, bzzzbx_message_id, opened_at
    ) values (
      btrim(p_bzzzbx_alert_id), p_request_id, btrim(p_rule_id), btrim(p_rule_version), p_level,
      btrim(p_reason_text), nullif(btrim(p_bzzzbx_message_id), ''), p_opened_at
    )
    returning * into v_alert;

    insert into opsrun.audit_event (request_id, event_type, actor_kind, occurred_at, alert_occurrence_id, details)
    values (p_request_id, 'alert_opened', 'bzzzbx', p_opened_at, v_alert.id,
            jsonb_build_object('bzzzbx_alert_id', v_alert.bzzzbx_alert_id, 'rule_id', v_alert.rule_id, 'level', v_alert.level));
  else
    if v_alert.request_id <> p_request_id or v_alert.rule_id <> btrim(p_rule_id) then
      raise exception 'opsRUN: la alerta % ya existe con otra request u otra regla', p_bzzzbx_alert_id
        using errcode = 'OP035';
    end if;
    -- Resuelta en opsRUN (por ejemplo con Clear alert): no se reabre ni cambia de nivel.
    if v_alert.resolved_at is not null then
      return v_alert.id;
    end if;
    if v_alert.level <> p_level then
      update opsrun.alert_occurrence set level = p_level where id = v_alert.id;
      insert into opsrun.audit_event (request_id, event_type, actor_kind, occurred_at, alert_occurrence_id, details)
      values (v_alert.request_id, 'alert_level_changed', 'bzzzbx', now(), v_alert.id,
              jsonb_build_object('from', v_alert.level, 'to', p_level));
      v_alert.level := p_level;
    end if;
  end if;

  if p_cleared_at is not null then
    v_fix := opsrun_private.alert_fix_for(v_alert.request_id, v_alert.rule_id, v_alert.opened_at, p_cleared_at);
    v_resolution := case when v_fix.id is null then 'auto_cleared' else 'fixed_by_action' end;

    update opsrun.alert_occurrence
       set resolved_at = p_cleared_at,
           resolution = v_resolution,
           resolved_by = v_fix.actor_operator_id,
           resolving_instruction_id = v_fix.instruction_id
     where id = v_alert.id;

    -- Arreglada por una acción: el actor es el operador que la arregló (P-11); si no, BzzzBX, que la cerró.
    insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at,
                                    alert_occurrence_id, instruction_id, details)
    values (v_alert.request_id, 'alert_resolved',
            case when v_fix.id is null then 'bzzzbx'::opsrun.actor_kind else 'operator'::opsrun.actor_kind end,
            v_fix.actor_operator_id, p_cleared_at, v_alert.id, v_fix.instruction_id,
            jsonb_build_object('resolution', v_resolution,
                               'fixing_audit_event_id', v_fix.id,
                               'fixing_event_type', v_fix.event_type));
  end if;

  return v_alert.id;
end;
$$;
comment on function opsrun.upsert_alert_occurrence(text, uuid, text, text, opsrun.alert_level, text, text, timestamptz, timestamptz) is
  'OPR-34: escribe la apertura, el cambio de nivel y la resolución de una alerta con su Audit, en una transacción. Idempotente. Escritura del sistema (registrador_alertas); provisional hasta la read layer de OPR-22.';

-- ---------------------------------------------------------------------------
-- 4. Permisos: solo opsrun_app ejecuta la función
-- ---------------------------------------------------------------------------
-- Los helpers de opsrun_private nacen sin EXECUTE para nadie más que el dueño
-- (default privileges de 20261124120000_esquema_opsrun.sql, G7).
revoke all on function opsrun.upsert_alert_occurrence(text, uuid, text, text, opsrun.alert_level, text, text, timestamptz, timestamptz) from public;
grant execute on function opsrun.upsert_alert_occurrence(text, uuid, text, text, opsrun.alert_level, text, text, timestamptz, timestamptz) to opsrun_app;
