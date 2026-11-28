-- OPR-18 · Plantillas de mensajes y avisos: las seis plantillas como catálogo y el rastro de la plantilla usada
-- en el Audit de un envío.
--
-- Spec: docs/spec/opr-18-plantillas.md §6 (aprobado por Henry el 2026-11-27, P-0). No cambia tablas, columnas,
-- tipos, triggers, vistas ni catálogos de Audit (`email_sent` y `text_sent` ya existen). Tiene dos partes:
--
--   1. Las seis plantillas, versión 1, en `opsrun.message_template`. Hasta ahora solo las ponía supabase/seed.sql,
--      que no corre en staging ni en producción (el deploy aplica migraciones, nada más); los catálogos van en la
--      migración (OPR-20 §9). Se quita el bloque de la seed. `on conflict do nothing`: una base local que ya las
--      tenía de la seed no cambia.
--   2. `send_email` y `send_text` ganan dos parámetros con valor por defecto, `p_template_key` y
--      `p_template_version`. Cambiar la lista de parámetros crea una función nueva, no reemplaza la vieja: se
--      hace `drop function` de las dos firmas de cinco parámetros y se crean las de siete, con el mismo cuerpo.
--      Las llamadas de cinco parámetros que ya existen siguen resolviendo por los valores por defecto.
--
-- Con plantilla (`p_template_key` no nulo; la versión es obligatoria con la clave):
--   * la fila (key, version) debe existir y ser del canal de la función (correo para send_email, texto para
--     send_text): si no, OP055 y no se crea la instrucción. Una versión que ya no es la activa se acepta: el
--     operador pudo abrir el picker antes de un cambio de versión (spec §6, S-10);
--   * el cuerpo no puede traer un {{…}} sin llenar: si lo trae, OP056;
--   * el `details` del Audit (`email_sent` o `text_sent`) gana `template_key` y `template_version`. El payload de
--     la instrucción NO cambia (solo el crosswalk ID y el cuerpo): la plantilla no viaja a BzzzBX (P-4).
-- Con solo una de las dos (la clave sin la versión, o al revés): 22023.
-- Sin plantilla, las funciones se comportan exactamente como antes.
--
-- Corre como opsrun_migrador, después de 20261207120000_analisis_ia.sql (los archivos de OPR-19 y OPR-29, si
-- llegan antes, solo mueven el nombre de este). Solo hacia adelante.
--
-- Códigos de error propios (además de los de migraciones anteriores):
--   OP055  la plantilla no existe, o es de otro canal
--   OP056  el cuerpo trae un {{…}} sin llenar (solo con plantilla)
--   OP057 a OP059  reservados para la Fase B (aviso al requester como consecuencia de una acción); sin uso
--   22023  argumento inválido (también: la clave de la plantilla sin su versión, o al revés)
--
-- Las dos funciones siguen siendo del operador: security definer, search_path vacío, require_operator() en su
-- propio cuerpo; solo opsrun_app las ejecuta (G5, G6, G7). Ninguna función nueva: ningún camino crea un envío a
-- partir de una plantilla fuera de estas dos.

-- ---------------------------------------------------------------------------
-- 1. Las seis plantillas, versión 1
-- ---------------------------------------------------------------------------
-- Texto neutro e inventado (este repo es público): el texto real de PINCH entra como versión 2 por migración y se
-- activa (S-2). Textos de un solo SMS en GSM-7 las de texto (spec §4.4).
insert into opsrun.message_template (key, version, channel, subject, body, active) values
  ('cleaner_confirmation_request', 1, 'text', null,
   'New job: {{property}} {{space}} on {{date}}, {{window}}. Can you confirm?', true),
  ('reschedule_request', 1, 'text', null,
   'Can we move {{property}} {{space}} to {{date}}, {{window}}? Please confirm.', true),
  ('cancellation_cleaner', 1, 'text', null,
   'The job at {{property}} {{space}} on {{date}} is cancelled.', true),
  ('cancellation_requester', 1, 'email', 'Cleaning cancelled',
   'The cleaning at {{property}} {{space}} on {{date}} has been cancelled.', true),
  ('requester_scheduled', 1, 'email', 'Cleaning scheduled',
   'Your cleaning at {{property}} {{space}} is scheduled for {{date}}, {{window}}.', true),
  ('requester_done', 1, 'email', 'Cleaning done',
   'The cleaning at {{property}} {{space}} is done.', true)
on conflict (key, version) do nothing;

-- ---------------------------------------------------------------------------
-- 2. send_email y send_text con la plantilla usada
-- ---------------------------------------------------------------------------
drop function opsrun.send_email(uuid, text, text, text, uuid);
drop function opsrun.send_text(uuid, text, text, text, uuid);

-- send_email: un correo al cliente, como instrucción pendiente. Lo de OPR-27, más la plantilla (opcional).
create function opsrun.send_email(
  p_request_id uuid,
  p_bzzzbx_thread_id text,
  p_body text,
  p_idempotency_key text,
  p_ai_suggestion_id uuid default null,
  p_template_key text default null,
  p_template_version integer default null
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
  v_detalles jsonb;
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
  if (p_template_key is null) <> (p_template_version is null) then
    raise exception 'opsRUN: la clave y la versión de la plantilla van juntas'
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

  v_detalles := jsonb_build_object('bzzzbx_thread_id', p_bzzzbx_thread_id);
  if p_template_key is not null then
    -- La plantilla debe existir y ser de correo; la versión puede ya no ser la activa.
    if not exists (
      select 1 from opsrun.message_template as t
       where t.key = p_template_key and t.version = p_template_version and t.channel = 'email'
    ) then
      raise exception 'opsRUN: la plantilla no existe o no es de correo'
        using errcode = 'OP055';
    end if;
    -- Un mensaje no sale con un {{…}} sin llenar.
    if v_body ~ '\{\{[a-z_]+\}\}' then
      raise exception 'opsRUN: el cuerpo trae un {{…}} sin llenar'
        using errcode = 'OP056';
    end if;
    v_detalles := v_detalles || jsonb_build_object('template_key', p_template_key, 'template_version', p_template_version);
  end if;

  insert into opsrun.instruction (request_id, type, idempotency_key, payload, actor_kind, actor_operator_id, status)
  values (p_request_id, 'send_email', v_key,
          jsonb_build_object('bzzzbx_thread_id', p_bzzzbx_thread_id, 'body', v_body),
          'operator', v_operator_id, 'pending')
  returning id into v_instruction_id;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at,
                                  instruction_id, details)
  values (p_request_id, 'email_sent', 'operator', v_operator_id, now(), v_instruction_id, v_detalles);

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
comment on function opsrun.send_email(uuid, text, text, text, uuid, text, integer) is
  'OPR-27 y OPR-18: guarda un correo al cliente como instrucción pending, con su Audit email_sent (con la plantilla usada, si hubo) y la decisión del borrador de IA. Escritura del operador.';

-- send_text: un texto al cleaner, como instrucción pendiente. Lo de OPR-27, más la plantilla (opcional). Que el
-- equipo sea el del job lo valida el servidor con el puerto de BzzzBX: la base no lee BzzzBX.
create function opsrun.send_text(
  p_request_id uuid,
  p_bzzzbx_team_id text,
  p_body text,
  p_idempotency_key text,
  p_ai_suggestion_id uuid default null,
  p_template_key text default null,
  p_template_version integer default null
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
  v_detalles jsonb;
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
  if (p_template_key is null) <> (p_template_version is null) then
    raise exception 'opsRUN: la clave y la versión de la plantilla van juntas'
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

  v_detalles := jsonb_build_object('bzzzbx_team_id', p_bzzzbx_team_id);
  if p_template_key is not null then
    -- La plantilla debe existir y ser de texto; la versión puede ya no ser la activa.
    if not exists (
      select 1 from opsrun.message_template as t
       where t.key = p_template_key and t.version = p_template_version and t.channel = 'text'
    ) then
      raise exception 'opsRUN: la plantilla no existe o no es de texto'
        using errcode = 'OP055';
    end if;
    -- Un mensaje no sale con un {{…}} sin llenar.
    if v_body ~ '\{\{[a-z_]+\}\}' then
      raise exception 'opsRUN: el cuerpo trae un {{…}} sin llenar'
        using errcode = 'OP056';
    end if;
    v_detalles := v_detalles || jsonb_build_object('template_key', p_template_key, 'template_version', p_template_version);
  end if;

  insert into opsrun.instruction (request_id, type, idempotency_key, payload, actor_kind, actor_operator_id, status)
  values (p_request_id, 'send_text', v_key,
          jsonb_build_object('bzzzbx_team_id', p_bzzzbx_team_id, 'body', v_body),
          'operator', v_operator_id, 'pending')
  returning id into v_instruction_id;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at,
                                  instruction_id, details)
  values (p_request_id, 'text_sent', 'operator', v_operator_id, now(), v_instruction_id, v_detalles);

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
comment on function opsrun.send_text(uuid, text, text, text, uuid, text, integer) is
  'OPR-27 y OPR-18: guarda un texto al cleaner como instrucción pending, con su Audit text_sent (con la plantilla usada, si hubo) y la decisión del borrador de IA. Escritura del operador.';

-- ---------------------------------------------------------------------------
-- 3. Permisos: solo opsrun_app ejecuta las funciones de opsrun
-- ---------------------------------------------------------------------------
revoke all on function opsrun.send_email(uuid, text, text, text, uuid, text, integer) from public;
revoke all on function opsrun.send_text(uuid, text, text, text, uuid, text, integer) from public;
grant execute on function opsrun.send_email(uuid, text, text, text, uuid, text, integer) to opsrun_app;
grant execute on function opsrun.send_text(uuid, text, text, text, uuid, text, integer) to opsrun_app;
