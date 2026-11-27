-- OPR-27 · Conversación: notas, envíos de correo y texto, decisión sobre los
-- borradores de IA y resultado de las instrucciones.
--
-- Spec: docs/spec/opr-27-conversacion.md §8 (aprobado por Henry el 2026-11-27,
-- P-0). Solo funciones: no cambia tablas, tipos, triggers, catálogos ni vistas
-- del write-back. Los tipos de Audit que usa (note_added, email_sent,
-- text_sent, instruction_failed, ai_suggestion_*) y las columnas ya están en
-- OPR-20.
--
-- Corre como opsrun_migrador, después de 20261125120000_fase_a_enlace.sql.
-- Solo hacia adelante.
--
-- Los cuerpos se recortan de cualquier espacio en blanco (también saltos de línea
-- y tabuladores), no solo de espacios: la tabla note solo recorta espacios.
--
-- Cuatro funciones son del operador (add_note, send_email, send_text,
-- discard_ai_draft) y llaman a opsrun_private.require_operator(); las otras dos
-- son del sistema (record_instruction_delivery, resolve_instruction) y llaman a
-- opsrun_private.require_system(). Todas son security definer, con
-- search_path vacío, y solo opsrun_app las ejecuta (G5, G6, G7).
--
-- Códigos de error propios (además de OP004 a OP008, de OPR-20 y OPR-28):
--   OP009  el hilo no es de la request
--   OP010  el borrador de IA no sirve para este envío (otra request, otro
--          campo o ya decidido)
--   OP011  la instrucción no existe
--   OP012  la clave de idempotencia ya es de otra instrucción
--   22023  argumento inválido (cuerpo vacío o pasado del límite, estado que
--          no se puede pedir)

-- ---------------------------------------------------------------------------
-- 1. add_note: una nota interna
-- ---------------------------------------------------------------------------
-- No sale nada a BzzzBX. Append-only (spec OPR-20 §11.8): no hay editar ni
-- borrar. Devuelve el id de la nota.
create function opsrun.add_note(p_request_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := opsrun_private.require_operator();
  v_body text := regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_note_id uuid;
begin
  if v_body is null or v_body = '' then
    raise exception 'opsRUN: la nota no puede estar vacía'
      using errcode = '22023';
  end if;
  if length(v_body) > 4000 then
    raise exception 'opsRUN: la nota pasa de 4000 caracteres'
      using errcode = '22023';
  end if;
  if not exists (select 1 from opsrun.request as r where r.id = p_request_id) then
    raise exception 'opsRUN: la request no existe'
      using errcode = 'OP006';
  end if;

  insert into opsrun.note (request_id, author_operator_id, body)
  values (p_request_id, v_operator_id, v_body)
  returning id into v_note_id;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at, details)
  values (p_request_id, 'note_added', 'operator', v_operator_id, now(),
          jsonb_build_object('note_id', v_note_id));

  return v_note_id;
end;
$$;
comment on function opsrun.add_note(uuid, text) is
  'OPR-27: escribe una nota interna de la request y su Audit note_added. Escritura del operador.';

-- ---------------------------------------------------------------------------
-- 2. send_email: un correo al cliente, como instrucción pendiente
-- ---------------------------------------------------------------------------
-- El payload lleva el crosswalk ID del hilo y lo que escribió el operador;
-- BzzzBX responde en ese hilo y resuelve el asunto y los destinatarios (P-2).
-- Nada leído de PINCH. La entrega a BzzzBX la hace el servidor después de
-- confirmar esta transacción (record_instruction_delivery). Con la misma
-- clave de idempotencia devuelve la misma instrucción sin crear nada más.
create function opsrun.send_email(
  p_request_id uuid,
  p_bzzzbx_thread_id text,
  p_body text,
  p_idempotency_key text,
  p_ai_suggestion_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := opsrun_private.require_operator();
  v_body text := regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_key text := btrim(p_idempotency_key);
  v_existente opsrun.instruction%rowtype;
  v_instruction_id uuid;
  v_sugerencia opsrun.ai_suggestion%rowtype;
  v_igual boolean;
begin
  if v_body is null or v_body = '' then
    raise exception 'opsRUN: el correo no puede estar vacío'
      using errcode = '22023';
  end if;
  if length(v_body) > 10000 then
    raise exception 'opsRUN: el correo pasa de 10000 caracteres'
      using errcode = '22023';
  end if;
  if v_key is null or v_key = '' or nullif(btrim(p_bzzzbx_thread_id), '') is null then
    raise exception 'opsRUN: el envío exige el hilo y la clave de idempotencia'
      using errcode = '22023';
  end if;

  perform 1 from opsrun.request as r where r.id = p_request_id for share;
  if not found then
    raise exception 'opsRUN: la request no existe'
      using errcode = 'OP006';
  end if;

  -- Un reintento con la misma clave (doble clic, red lenta) no duplica nada.
  select i.* into v_existente from opsrun.instruction as i where i.idempotency_key = v_key;
  if found then
    if v_existente.request_id is distinct from p_request_id or v_existente.type <> 'send_email' then
      raise exception 'opsRUN: esa clave de idempotencia ya es de otra instrucción'
        using errcode = 'OP012';
    end if;
    return v_existente.id;
  end if;

  if not exists (
    select 1 from opsrun.request_message as rm
     where rm.request_id = p_request_id and rm.bzzzbx_thread_id = p_bzzzbx_thread_id
  ) then
    raise exception 'opsRUN: el hilo no es de la request'
      using errcode = 'OP009';
  end if;

  insert into opsrun.instruction (request_id, type, idempotency_key, payload, actor_kind, actor_operator_id, status)
  values (p_request_id, 'send_email', v_key,
          jsonb_build_object('bzzzbx_thread_id', p_bzzzbx_thread_id, 'body', v_body),
          'operator', v_operator_id, 'pending')
  returning id into v_instruction_id;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at,
                                  instruction_id, details)
  values (p_request_id, 'email_sent', 'operator', v_operator_id, now(), v_instruction_id,
          jsonb_build_object('bzzzbx_thread_id', p_bzzzbx_thread_id));

  if p_ai_suggestion_id is not null then
    -- El borrador debe ser de la request, de este canal y estar sin decidir; si
    -- no, error y no se crea la instrucción (la transacción se deshace).
    select s.* into v_sugerencia
      from opsrun.ai_suggestion as s
     where s.id = p_ai_suggestion_id
       for update;
    if not found
       or v_sugerencia.request_id <> p_request_id
       or v_sugerencia.field <> 'draft_customer_reply'
       or v_sugerencia.decision is not null then
      raise exception 'opsRUN: el borrador de IA no es de esta request, no es de este canal o ya se decidió'
        using errcode = 'OP010';
    end if;
    -- accepted si el cuerpo es igual al propuesto; corrected, con el cuerpo final, si no.
    v_igual := v_body = regexp_replace(coalesce(v_sugerencia.value ->> 'body', ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
    update opsrun.ai_suggestion
       set decision = case when v_igual then 'accepted'::opsrun.ai_decision else 'corrected'::opsrun.ai_decision end,
           final_value = case when v_igual then null else jsonb_build_object('body', v_body) end,
           decided_by = v_operator_id,
           decided_at = now()
     where id = p_ai_suggestion_id;
    insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at,
                                    ai_suggestion_id, instruction_id)
    values (p_request_id,
            case when v_igual then 'ai_suggestion_accepted' else 'ai_suggestion_corrected' end,
            'operator', v_operator_id, now(), p_ai_suggestion_id, v_instruction_id);
  end if;

  return v_instruction_id;
end;
$$;
comment on function opsrun.send_email(uuid, text, text, text, uuid) is
  'OPR-27: guarda un correo al cliente como instrucción pending, con su Audit email_sent y la decisión del borrador de IA. Escritura del operador.';

-- ---------------------------------------------------------------------------
-- 3. send_text: un texto al cleaner, como instrucción pendiente
-- ---------------------------------------------------------------------------
-- Igual que send_email, con el crosswalk ID del equipo y el límite de 1600.
-- Que el equipo sea el del job lo valida el servidor con el puerto de BzzzBX:
-- la base no lee BzzzBX.
create function opsrun.send_text(
  p_request_id uuid,
  p_bzzzbx_team_id text,
  p_body text,
  p_idempotency_key text,
  p_ai_suggestion_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := opsrun_private.require_operator();
  v_body text := regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_key text := btrim(p_idempotency_key);
  v_existente opsrun.instruction%rowtype;
  v_instruction_id uuid;
  v_sugerencia opsrun.ai_suggestion%rowtype;
  v_igual boolean;
begin
  if v_body is null or v_body = '' then
    raise exception 'opsRUN: el texto no puede estar vacío'
      using errcode = '22023';
  end if;
  if length(v_body) > 1600 then
    raise exception 'opsRUN: el texto pasa de 1600 caracteres'
      using errcode = '22023';
  end if;
  if v_key is null or v_key = '' or nullif(btrim(p_bzzzbx_team_id), '') is null then
    raise exception 'opsRUN: el envío exige el equipo y la clave de idempotencia'
      using errcode = '22023';
  end if;

  perform 1 from opsrun.request as r where r.id = p_request_id for share;
  if not found then
    raise exception 'opsRUN: la request no existe'
      using errcode = 'OP006';
  end if;

  select i.* into v_existente from opsrun.instruction as i where i.idempotency_key = v_key;
  if found then
    if v_existente.request_id is distinct from p_request_id or v_existente.type <> 'send_text' then
      raise exception 'opsRUN: esa clave de idempotencia ya es de otra instrucción'
        using errcode = 'OP012';
    end if;
    return v_existente.id;
  end if;

  insert into opsrun.instruction (request_id, type, idempotency_key, payload, actor_kind, actor_operator_id, status)
  values (p_request_id, 'send_text', v_key,
          jsonb_build_object('bzzzbx_team_id', p_bzzzbx_team_id, 'body', v_body),
          'operator', v_operator_id, 'pending')
  returning id into v_instruction_id;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at,
                                  instruction_id, details)
  values (p_request_id, 'text_sent', 'operator', v_operator_id, now(), v_instruction_id,
          jsonb_build_object('bzzzbx_team_id', p_bzzzbx_team_id));

  if p_ai_suggestion_id is not null then
    -- El borrador debe ser de la request, de este canal y estar sin decidir; si
    -- no, error y no se crea la instrucción (la transacción se deshace).
    select s.* into v_sugerencia
      from opsrun.ai_suggestion as s
     where s.id = p_ai_suggestion_id
       for update;
    if not found
       or v_sugerencia.request_id <> p_request_id
       or v_sugerencia.field <> 'draft_cleaner_text'
       or v_sugerencia.decision is not null then
      raise exception 'opsRUN: el borrador de IA no es de esta request, no es de este canal o ya se decidió'
        using errcode = 'OP010';
    end if;
    -- accepted si el cuerpo es igual al propuesto; corrected, con el cuerpo final, si no.
    v_igual := v_body = regexp_replace(coalesce(v_sugerencia.value ->> 'body', ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
    update opsrun.ai_suggestion
       set decision = case when v_igual then 'accepted'::opsrun.ai_decision else 'corrected'::opsrun.ai_decision end,
           final_value = case when v_igual then null else jsonb_build_object('body', v_body) end,
           decided_by = v_operator_id,
           decided_at = now()
     where id = p_ai_suggestion_id;
    insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at,
                                    ai_suggestion_id, instruction_id)
    values (p_request_id,
            case when v_igual then 'ai_suggestion_accepted' else 'ai_suggestion_corrected' end,
            'operator', v_operator_id, now(), p_ai_suggestion_id, v_instruction_id);
  end if;

  return v_instruction_id;
end;
$$;
comment on function opsrun.send_text(uuid, text, text, text, uuid) is
  'OPR-27: guarda un texto al cleaner como instrucción pending, con su Audit text_sent y la decisión del borrador de IA. Escritura del operador.';

-- ---------------------------------------------------------------------------
-- 4. discard_ai_draft: el operador descarta un borrador sin enviarlo
-- ---------------------------------------------------------------------------
create function opsrun.discard_ai_draft(p_ai_suggestion_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := opsrun_private.require_operator();
  v_sugerencia opsrun.ai_suggestion%rowtype;
begin
  select s.* into v_sugerencia
    from opsrun.ai_suggestion as s
   where s.id = p_ai_suggestion_id
     for update;
  if not found
     or v_sugerencia.field not in ('draft_customer_reply', 'draft_cleaner_text')
     or v_sugerencia.decision is not null then
    raise exception 'opsRUN: no hay un borrador de IA sin decidir con ese id'
      using errcode = 'OP010';
  end if;

  update opsrun.ai_suggestion
     set decision = 'rejected',
         decided_by = v_operator_id,
         decided_at = now()
   where id = p_ai_suggestion_id;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at, ai_suggestion_id)
  values (v_sugerencia.request_id, 'ai_suggestion_rejected', 'operator', v_operator_id, now(), p_ai_suggestion_id);
end;
$$;
comment on function opsrun.discard_ai_draft(uuid) is
  'OPR-27: descarta un borrador de IA (rejected) con su Audit. No envía nada. Escritura del operador.';

-- ---------------------------------------------------------------------------
-- 5. record_instruction_delivery: BzzzBX acusó recibo
-- ---------------------------------------------------------------------------
-- La llama el servidor como sistema (despacho de instrucciones). pending →
-- sent; repetirla no cambia nada. No distingue el tipo: la usarán también
-- OPR-23 y las tarjetas de etapa.
create function opsrun.record_instruction_delivery(p_idempotency_key text, p_bzzzbx_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proceso text := opsrun_private.require_system();
  v_estado opsrun.instruction_status;
begin
  if nullif(btrim(p_bzzzbx_reference), '') is null then
    raise exception 'opsRUN: el acuse exige la referencia de BzzzBX'
      using errcode = '22023';
  end if;

  select i.status into v_estado
    from opsrun.instruction as i
   where i.idempotency_key = p_idempotency_key
     for update;
  if not found then
    raise exception 'opsRUN: la instrucción no existe'
      using errcode = 'OP011';
  end if;
  if v_estado <> 'pending' then
    return;
  end if;

  update opsrun.instruction
     set status = 'sent',
         sent_at = now(),
         attempts = attempts + 1,
         bzzzbx_reference = p_bzzzbx_reference
   where idempotency_key = p_idempotency_key;
end;
$$;
comment on function opsrun.record_instruction_delivery(text, text) is
  'OPR-27: BzzzBX acusó una instrucción: pending → sent con su referencia. Repetirla no cambia nada. Escritura del sistema.';

-- ---------------------------------------------------------------------------
-- 6. resolve_instruction: el avance o el cierre de una instrucción
-- ---------------------------------------------------------------------------
-- Avanza el estado (el trigger instruction_status_forward impide volver
-- atrás). Con failed escribe Audit instruction_failed. Con confirmed y un
-- send_email o send_text que trae el ID del mensaje, crea el request_message
-- saliente. Repetir el mismo cierre no cambia nada.
create function opsrun.resolve_instruction(
  p_idempotency_key text,
  p_status opsrun.instruction_status,
  p_bzzzbx_reference text,
  p_error_code text,
  p_error_message text,
  p_bzzzbx_message_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proceso text := opsrun_private.require_system();
  v_instruccion opsrun.instruction%rowtype;
begin
  if p_status = 'pending' then
    raise exception 'opsRUN: una instrucción no vuelve a pending'
      using errcode = '22023';
  end if;

  select i.* into v_instruccion
    from opsrun.instruction as i
   where i.idempotency_key = p_idempotency_key
     for update;
  if not found then
    raise exception 'opsRUN: la instrucción no existe'
      using errcode = 'OP011';
  end if;

  -- Repetir el mismo estado no cambia nada.
  if v_instruccion.status = p_status then
    return;
  end if;

  -- Si va hacia atrás (de un cierre a sent, por ejemplo) el trigger lo rechaza.
  update opsrun.instruction
     set status = p_status,
         bzzzbx_reference = coalesce(nullif(btrim(p_bzzzbx_reference), ''), bzzzbx_reference),
         sent_at = coalesce(sent_at, now()),
         attempts = case when attempts = 0 then 1 else attempts end,
         error_code = case when p_status in ('failed', 'timed_out') then nullif(btrim(p_error_code), '') else error_code end,
         error_message = case when p_status in ('failed', 'timed_out') then nullif(btrim(p_error_message), '') else error_message end,
         resolved_at = case when p_status in ('confirmed', 'failed', 'timed_out') then now() else resolved_at end
   where id = v_instruccion.id;

  if p_status = 'failed' then
    insert into opsrun.audit_event (request_id, event_type, actor_kind, occurred_at, instruction_id, details)
    values (v_instruccion.request_id, 'instruction_failed', 'system', now(), v_instruccion.id,
            jsonb_build_object('type', v_instruccion.type, 'error_code', nullif(btrim(p_error_code), '')));
  end if;

  if p_status = 'confirmed'
     and v_instruccion.type in ('send_email', 'send_text')
     and v_instruccion.request_id is not null
     and nullif(btrim(p_bzzzbx_message_id), '') is not null then
    insert into opsrun.request_message (request_id, bzzzbx_message_id, bzzzbx_thread_id, channel, direction,
                                        instruction_id, actor_kind)
    values (v_instruccion.request_id, p_bzzzbx_message_id,
            case when v_instruccion.type = 'send_email' then v_instruccion.payload ->> 'bzzzbx_thread_id' end,
            case when v_instruccion.type = 'send_email' then 'email'::opsrun.message_channel else 'text'::opsrun.message_channel end,
            'outbound', v_instruccion.id, 'system')
    on conflict (bzzzbx_message_id) do nothing;
  end if;
end;
$$;
comment on function opsrun.resolve_instruction(text, opsrun.instruction_status, text, text, text, text) is
  'OPR-27: avanza o cierra una instrucción (sent, confirmed, failed o timed_out); con confirmed y un envío crea el request_message saliente. Escritura del sistema.';

-- ---------------------------------------------------------------------------
-- 7. Permisos: solo opsrun_app ejecuta las funciones de opsrun
-- ---------------------------------------------------------------------------
revoke all on function opsrun.add_note(uuid, text) from public;
revoke all on function opsrun.send_email(uuid, text, text, text, uuid) from public;
revoke all on function opsrun.send_text(uuid, text, text, text, uuid) from public;
revoke all on function opsrun.discard_ai_draft(uuid) from public;
revoke all on function opsrun.record_instruction_delivery(text, text) from public;
revoke all on function opsrun.resolve_instruction(text, opsrun.instruction_status, text, text, text, text) from public;
grant execute on function opsrun.add_note(uuid, text) to opsrun_app;
grant execute on function opsrun.send_email(uuid, text, text, text, uuid) to opsrun_app;
grant execute on function opsrun.send_text(uuid, text, text, text, uuid) to opsrun_app;
grant execute on function opsrun.discard_ai_draft(uuid) to opsrun_app;
grant execute on function opsrun.record_instruction_delivery(text, text) to opsrun_app;
grant execute on function opsrun.resolve_instruction(text, opsrun.instruction_status, text, text, text, text) to opsrun_app;
