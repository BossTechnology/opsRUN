-- OPR-29 · Scheduled: Change linked job y la cancelación observada (Fase A).
--
-- Spec: docs/spec/opr-29-scheduled.md §10 (aprobado por Henry el 2026-11-27,
-- P-0 a P-11). Sin tablas, columnas ni vistas nuevas. Esta migración agrega:
--
--   * dos tipos de Audit: `job_relinked` (opsRUN, motivo obligatorio) y
--     `job_cancel_observed` (observado en PINCH);
--   * `opsrun.relink_observed_job(...)`: la función del operador que cambia el
--     job enlazado de una request que sigue Scheduled, con su Audit en la misma
--     transacción.
--
-- Corre como opsrun_migrador, después de 20261205120000_alertas.sql. Solo hacia
-- adelante.
--
-- La función es security definer con search_path vacío, llama a
-- opsrun_private.require_operator() en su propio cuerpo (G6), solo opsrun_app la
-- ejecuta (G5, G6, G7) y toma el candado de la request con
-- opsrun_private.lock_scheduled_request (G14). Si falla cualquier paso, no queda
-- ni el cambio ni su Audit.
--
-- No hay función nueva del sistema: `opsrun.record_observed_event` (OPR-30)
-- escribe `job_cancel_observed` en cuanto el tipo está en el catálogo con
-- source = 'bzzzbx_observed'.
--
-- Fase A no manda instrucciones: ninguna función de esta migración crea filas en
-- opsrun.instruction (la Fase B agregará reschedule_job y cancel_job).
--
-- Códigos de error (siguen a OP039, de OPR-34). OPR-29 reserva OP040 a OP044 y
-- usa dos:
--   OP006  la request no existe (reutilizado de lock_scheduled_request)
--   OP008  el job nuevo ya es de otra request (reutilizado del enlace)
--   OP013  p_version no es el change_seq actual (reutilizado)
--   OP019  la request no está programada: no tiene job (reutilizado)
--   OP040  la request ya tiene hechos del job en opsRUN (End manually, OSS,
--          aprobación, PO capturado o validación): el job ya no se cambia
--   OP041  el job nuevo es el mismo que el actual
--   (OP042 a OP044 quedan reservados para Reschedule y Cancel job de la Fase B.)
--   22023  argumento inválido: motivo, job o job number vacío
--   42501  sin operador o con operador y sistema a la vez (require_operator())

-- ---------------------------------------------------------------------------
-- 1. Catálogo de Audit (§10.1)
-- ---------------------------------------------------------------------------
-- job_relinked queda junto a request_scheduled (80) y job_link_rejected (85);
-- job_cancel_observed, entre los observados (job_completed 210, job_paid 220).
insert into opsrun.audit_event_type (code, label, requires_reason, source, sort_order) values
  ('job_relinked',        'Linked job changed', true,  'opsrun',          87),
  ('job_cancel_observed', 'Job cancelled',      false, 'bzzzbx_observed', 215);

-- ---------------------------------------------------------------------------
-- 2. relink_observed_job: el operador cambia el job enlazado (§8 y §10.2)
-- ---------------------------------------------------------------------------
-- El servidor ya leyó el job nuevo en BzzzBX (existe y no está cancelado) y el
-- actual (sin check-in) y pasa el crosswalk ID y el job number del nuevo: la
-- base no puede leer BzzzBX. Cambia bzzzbx_job_id y job_number; scheduled_at, el
-- estado y el borrador no cambian, y las confirmaciones siguen vigentes (son
-- sobre el borrador, no sobre el job). La base comprueba lo de opsRUN: que la
-- request no tenga hechos del job (OP040).
create function opsrun.relink_observed_job(
  p_request_id uuid,
  p_version bigint,
  p_bzzzbx_job_id text,
  p_job_number text,
  p_reason text
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

  if nullif(btrim(p_reason), '') is null then
    raise exception 'opsRUN: cambiar el job enlazado exige un motivo'
      using errcode = '22023';
  end if;
  if nullif(btrim(p_bzzzbx_job_id), '') is null or nullif(btrim(p_job_number), '') is null then
    raise exception 'opsRUN: el job nuevo exige el crosswalk ID y el job number'
      using errcode = '22023';
  end if;

  -- Una request con hechos del job en opsRUN ya recorrió el job: no se cambia.
  if num_nonnulls(
       v_request.ended_manually_at, v_request.oss_mark, v_request.approved_at,
       v_request.entered_po_at, v_request.validated_at
     ) > 0 then
    raise exception 'opsRUN: la request ya tiene hechos del job; el job enlazado no se cambia'
      using errcode = 'OP040';
  end if;

  if v_request.bzzzbx_job_id = p_bzzzbx_job_id or v_request.job_number = p_job_number then
    raise exception 'opsRUN: ese ya es el job enlazado'
      using errcode = 'OP041';
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
         job_number = p_job_number
   where id = p_request_id;

  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, reason, occurred_at, details)
  values (p_request_id, 'job_relinked', 'operator', v_operator_id, btrim(p_reason), now(),
          jsonb_build_object(
            'from_bzzzbx_job_id', v_request.bzzzbx_job_id,
            'from_job_number', v_request.job_number,
            'to_bzzzbx_job_id', p_bzzzbx_job_id,
            'to_job_number', p_job_number));
end;
$$;
comment on function opsrun.relink_observed_job(uuid, bigint, text, text, text) is
  'OPR-29 (Fase A): cambia el job enlazado de una request Scheduled sin hechos del job, con motivo y su Audit. Escritura del operador.';

-- ---------------------------------------------------------------------------
-- 3. Permisos: solo opsrun_app la ejecuta
-- ---------------------------------------------------------------------------
revoke all on function opsrun.relink_observed_job(uuid, bigint, text, text, text) from public;
grant execute on function opsrun.relink_observed_job(uuid, bigint, text, text, text) to opsrun_app;
