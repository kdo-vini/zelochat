begin;

-- Task 4: one leased sender per canonical conversation across replicas.
-- Migration 064's rollout gate remains the first lock while legacy session
-- writers coexist; do not narrow/remove it until the rolling-deploy bridge is retired.

alter table public.zelochat_outbound_jobs
  drop constraint if exists zelochat_outbound_jobs_payload_no_data_url;
alter table public.zelochat_outbound_jobs
  add constraint zelochat_outbound_jobs_payload_no_data_url
  check (
    payload is null
    or not jsonb_path_exists(
      payload,
      '$.** ? (@.type() == "string" && @ like_regex "^data:[^,]+," flag "i")'
    )
  );

create or replace function public.release_zelochat_expired_leases()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  v_now timestamptz := now();
begin
  perform public.zelochat_conversation_control_rollout_gate();

  with uncertain as (
    update public.zelochat_outbound_jobs j
       set status = 'delivery_uncertain',
           last_error = 'A reserva expirou depois do início do transporte.',
           lease_owner = null,
           lease_expires_at = null,
           updated_at = v_now
     where j.status = 'dispatch_started'
       and j.lease_expires_at < v_now
     returning j.id, j.empresa_id, j.conversation_control_id, j.message_id
  ), held as (
    update public.zelochat_conversation_ai_control c
       set hold_reason = 'delivery_uncertain',
           hold_job_id = u.id,
           changed_at = v_now
      from uncertain u
     where u.conversation_control_id = c.id
       and u.empresa_id = c.empresa_id
     returning c.id
  ), messages as (
    update public.zelochat_messages m
       set outbound_status = 'delivery_uncertain',
           outbound_error = 'Não foi possível confirmar a entrega.'
      from uncertain u
     where u.message_id = m.id
       and u.empresa_id = m.empresa_id
     returning m.id
  )
  select count(*) into v_count from uncertain;

  with terminal as (
    update public.zelochat_outbound_jobs j
       set status = 'failed_before_dispatch',
           last_error = 'Limite de tentativas atingido antes do transporte.',
           lease_owner = null,
           lease_expires_at = null,
           updated_at = v_now
     where j.status = 'sending'
       and j.lease_expires_at < v_now
       and j.attempts >= j.max_attempts
     returning j.id, j.empresa_id, j.recipient_id, j.automation_dispatch_id, j.job_type, j.message_id
  ), campaign_terminal as (
    update public.zelochat_campaign_recipients r
       set status = 'failed', last_error = 'Limite de tentativas atingido antes do transporte.', updated_at = v_now
      from terminal t
     where t.job_type = 'campaign' and t.recipient_id = r.id and t.empresa_id = r.empresa_id
     returning r.id
  ), automation_terminal as (
    update public.zelochat_automation_dispatches d
       set status = 'failed', last_error = 'Limite de tentativas atingido antes do transporte.', updated_at = v_now
      from terminal t
     where t.job_type = 'automation' and t.automation_dispatch_id = d.id and t.empresa_id = d.empresa_id
     returning d.id
  ), message_terminal as (
    update public.zelochat_messages m
       set outbound_status = 'failed_before_dispatch', outbound_error = 'Mensagem não enviada.'
      from terminal t
     where t.message_id = m.id and t.empresa_id = m.empresa_id
     returning m.id
  )
  select v_count + count(*) into v_count from terminal;

  update public.zelochat_outbound_jobs j
     set status = 'queued',
         lease_owner = null,
         lease_expires_at = null,
         updated_at = v_now
   where j.status = 'sending'
     and j.lease_expires_at < v_now
     and j.attempts < j.max_attempts;

  return v_count;
end;
$$;

revoke all on function public.release_zelochat_expired_leases() from public, anon, authenticated;
grant execute on function public.release_zelochat_expired_leases() to service_role;

create or replace function public.claim_zelochat_outbound_job(
  p_worker text,
  p_lease_seconds integer default 120
)
returns setof public.zelochat_outbound_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate record;
  v_control public.zelochat_conversation_ai_control%rowtype;
  v_claimed public.zelochat_outbound_jobs%rowtype;
  v_now timestamptz := now();
begin
  if nullif(trim(p_worker), '') is null then raise exception 'INVALID_LEASE_OWNER'; end if;
  perform public.zelochat_conversation_control_rollout_gate();
  perform public.release_zelochat_expired_leases();

  loop
    -- Candidate discovery is deliberately non-locking. For conversation jobs,
    -- the canonical control row is locked before the job row is selected FOR UPDATE.
    select j.id, j.conversation_control_id, j.empresa_id
      into v_candidate
      from public.zelochat_outbound_jobs j
      left join public.zelochat_campaigns c on c.id = j.campaign_id and c.empresa_id = j.empresa_id
      left join public.zelochat_campaign_recipients r on r.id = j.recipient_id and r.empresa_id = j.empresa_id
      left join public.zelochat_automation_dispatches d on d.id = j.automation_dispatch_id and d.empresa_id = j.empresa_id
     where j.status = 'queued'
       and j.next_attempt_at <= v_now
       and j.attempts < j.max_attempts
       and (
         j.job_type <> 'conversation'
         or (
           not exists (
             select 1
               from public.zelochat_conversation_ai_control blocked_control
              where blocked_control.id = j.conversation_control_id
                and blocked_control.empresa_id = j.empresa_id
                and blocked_control.hold_job_id is not null
           )
           and not exists (
             select 1
               from public.zelochat_outbound_jobs active
              where active.conversation_control_id = j.conversation_control_id
                and active.id <> j.id
                and active.status in ('sending','dispatch_started')
           )
         )
       )
       and (
         j.job_type = 'conversation'
         or (
           j.job_type = 'campaign'
           and (j.campaign_id is null or (c.status in ('running','scheduled') and (c.status = 'running' or c.scheduled_at <= v_now)))
           and (j.recipient_id is null or r.status in ('queued','sending'))
         )
         or (j.job_type = 'automation' and (j.automation_dispatch_id is null or d.status in ('queued','sending')))
       )
     order by j.next_attempt_at, j.created_at, j.id
     limit 1;

    if not found then return; end if;

    if v_candidate.conversation_control_id is not null then
      select * into v_control
        from public.zelochat_conversation_ai_control c
       where c.id = v_candidate.conversation_control_id
         and c.empresa_id = v_candidate.empresa_id
       for update;
      if not found then
        update public.zelochat_outbound_jobs set status = 'cancelled', suppression_reason = 'control_missing', updated_at = v_now where id = v_candidate.id and empresa_id = v_candidate.empresa_id and status = 'queued';
        continue;
      end if;
    end if;

    select * into v_claimed
      from public.zelochat_outbound_jobs j
     where j.id = v_candidate.id
       and j.empresa_id = v_candidate.empresa_id
       and j.status = 'queued'
       and j.next_attempt_at <= v_now
     for update skip locked;
    if not found then continue; end if;

    if v_claimed.job_type = 'conversation' then
      if v_control.hold_job_id is not null or exists (
        select 1 from public.zelochat_outbound_jobs active
         where active.conversation_control_id = v_claimed.conversation_control_id
           and active.id <> v_claimed.id
           and active.status in ('sending','dispatch_started')
      ) then return; end if;

      if v_claimed.outbound_origin in ('ai_auto','ai_followup')
         and (v_control.mode <> 'ai' or v_claimed.control_epoch is distinct from v_control.epoch) then
        update public.zelochat_outbound_jobs
           set status = 'cancelled',
               suppression_reason = case when v_control.mode <> 'ai' then 'paused' else 'stale_epoch' end,
               updated_at = v_now
         where id = v_claimed.id and empresa_id = v_claimed.empresa_id and status = 'queued';
        insert into public.zelochat_conversation_control_events (
          empresa_id, conversation_control_id, remote_jid, event_type, epoch, source, message_id, job_id
        ) values (
          v_claimed.empresa_id, v_claimed.conversation_control_id, v_claimed.conversation_jid,
          'ai_job_suppressed', v_control.epoch, 'outbound_claim', v_claimed.message_id, v_claimed.id
        );
        continue;
      end if;
    end if;

    update public.zelochat_outbound_jobs j
       set status = 'sending',
           lease_owner = p_worker,
           lease_expires_at = v_now + make_interval(secs => greatest(p_lease_seconds, 15)),
           attempts = j.attempts + 1,
           updated_at = v_now
     where j.id = v_claimed.id
       and j.empresa_id = v_claimed.empresa_id
       and j.status = 'queued'
       and (
         j.conversation_control_id is null
         or not exists (
           select 1 from public.zelochat_outbound_jobs active
            where active.conversation_control_id = j.conversation_control_id
              and active.id <> j.id
              and active.status in ('sending','dispatch_started')
         )
       )
     returning j.* into v_claimed;
    if not found then return; end if;

    update public.zelochat_messages m
       set outbound_status = 'sending', outbound_error = null
     where m.id = v_claimed.message_id and m.empresa_id = v_claimed.empresa_id;
    if v_claimed.job_type = 'campaign' and v_claimed.recipient_id is not null then
      update public.zelochat_campaign_recipients set status = 'sending', updated_at = v_now where id = v_claimed.recipient_id and empresa_id = v_claimed.empresa_id and status in ('queued','sending');
    elsif v_claimed.job_type = 'automation' and v_claimed.automation_dispatch_id is not null then
      update public.zelochat_automation_dispatches set status = 'sending', updated_at = v_now where id = v_claimed.automation_dispatch_id and empresa_id = v_claimed.empresa_id and status in ('queued','sending');
    end if;
    return next v_claimed;
    return;
  end loop;
end;
$$;

revoke all on function public.claim_zelochat_outbound_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_zelochat_outbound_job(text, integer) to service_role;

create or replace function public.begin_zelochat_human_outbound(
  p_empresa_id uuid,
  p_remote_jid text,
  p_actor_user_id uuid,
  p_source text,
  p_idempotency_key text,
  p_payload jsonb,
  p_payload_fingerprint text,
  p_message_text text default ''
)
returns setof public.zelochat_outbound_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.zelochat_outbound_jobs%rowtype;
  v_snapshot record;
  v_control public.zelochat_conversation_ai_control%rowtype;
  v_session_id uuid;
  v_message_id uuid;
  v_job public.zelochat_outbound_jobs%rowtype;
  v_now timestamptz := now();
  v_initial_status text;
begin
  perform public.zelochat_conversation_control_rollout_gate();
  if p_source not in ('zelochat_operator','explicit_manual_toggle') then raise exception 'INVALID_TAKEOVER_SOURCE'; end if;
  if nullif(trim(p_idempotency_key), '') is null then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
  if nullif(trim(p_payload_fingerprint), '') is null then raise exception 'INVALID_PAYLOAD_FINGERPRINT'; end if;
  if not public.zelochat_actor_belongs_to_empresa(p_empresa_id, p_actor_user_id) then raise exception 'ACTOR_NOT_IN_TENANT'; end if;
  if p_payload is null or jsonb_path_exists(p_payload, '$.** ? (@.type() == "string" && @ like_regex "^data:[^,]+," flag "i")') then raise exception 'OUTBOUND_PAYLOAD_DATA_URL_FORBIDDEN'; end if;

  -- Reserve the tenant intent before takeover. The transaction advisory key
  -- makes concurrent retries wait, then the loser observes the committed job.
  perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || ':' || p_idempotency_key, 0));
  select * into v_existing from public.zelochat_outbound_jobs j where j.empresa_id = p_empresa_id and j.idempotency_key = p_idempotency_key;
  if found then return next v_existing; return; end if;

  select * into v_snapshot from public.ensure_zelochat_conversation_control(p_empresa_id, p_remote_jid);
  select * into v_control from public.zelochat_conversation_ai_control c
   where c.empresa_id = p_empresa_id and c.id = v_snapshot.conversation_control_id for update;
  select s.id into v_session_id from public.zelochat_sessions s
   where s.empresa_id = p_empresa_id and s.conversation_control_id = v_control.id
   order by (s.remote_jid = p_remote_jid) desc, s.updated_at desc, s.id limit 1;
  if v_session_id is null then raise exception 'CONVERSATION_SESSION_NOT_FOUND'; end if;

  if v_control.mode <> 'human' then v_control.epoch := v_control.epoch + 1; end if;
  update public.zelochat_conversation_ai_control c
     set mode = 'human', epoch = v_control.epoch, changed_by_actor = p_actor_user_id,
         changed_source = p_source, changed_at = v_now
   where c.id = v_control.id and c.empresa_id = p_empresa_id returning * into v_control;
  update public.zelochat_sessions set auto_reply = false, updated_at = v_now
   where empresa_id = p_empresa_id and conversation_control_id = v_control.id and auto_reply is distinct from false;
  update public.zelochat_outbound_jobs set status = 'cancelled', suppression_reason = 'human_takeover', updated_at = v_now
   where empresa_id = p_empresa_id and conversation_control_id = v_control.id and status = 'queued' and outbound_origin in ('ai_auto','ai_followup');

  v_initial_status := case when p_payload->>'kind' in ('media','audio','sticker') then 'preparing' else 'queued' end;
  insert into public.zelochat_messages (
    empresa_id, session_id, role, content, sent_at, outbound_status, outbound_origin, outbound_actor_user_id
  ) values (
    p_empresa_id, v_session_id, 'assistant', nullif(p_message_text, ''), v_now, v_initial_status, 'human_zelochat', p_actor_user_id
  ) returning id into v_message_id;

  insert into public.zelochat_outbound_jobs (
    empresa_id, job_type, idempotency_key, phone_snapshot, message, status, next_attempt_at,
    conversation_control_id, conversation_jid, message_id, outbound_origin, takeover_policy,
    payload, payload_fingerprint, control_epoch
  ) values (
    p_empresa_id, 'conversation', p_idempotency_key, split_part(p_remote_jid, '@', 1),
    coalesce(nullif(p_message_text, ''), '[' || coalesce(p_payload->>'kind', 'mensagem') || ']'),
    v_initial_status, v_now, v_control.id, p_remote_jid, v_message_id, 'human_zelochat', 'take_over',
    p_payload, p_payload_fingerprint, v_control.epoch
  ) returning * into v_job;

  update public.zelochat_messages set outbound_job_id = v_job.id where id = v_message_id and empresa_id = p_empresa_id;
  update public.zelochat_conversation_ai_control set latest_takeover_message_id = v_message_id where id = v_control.id and empresa_id = p_empresa_id;
  insert into public.zelochat_conversation_control_events (
    empresa_id, conversation_control_id, remote_jid, event_type, epoch, actor_user_id, source, message_id, job_id
  ) values (
    p_empresa_id, v_control.id, p_remote_jid, 'human_takeover', v_control.epoch, p_actor_user_id, p_source, v_message_id, v_job.id
  );
  return next v_job;
end;
$$;

revoke all on function public.begin_zelochat_human_outbound(uuid, text, uuid, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.begin_zelochat_human_outbound(uuid, text, uuid, text, text, jsonb, text, text) to service_role;

create or replace function public.start_zelochat_outbound_transport(p_id uuid, p_empresa_id uuid, p_lease_owner text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.zelochat_outbound_jobs%rowtype; v_now timestamptz := now();
begin
  update public.zelochat_outbound_jobs j set status = 'dispatch_started', transport_started_at = v_now, updated_at = v_now
   where j.id = p_id and j.empresa_id = p_empresa_id and j.lease_owner = p_lease_owner
     and j.status = 'sending' and j.lease_expires_at >= v_now returning * into v_job;
  if not found then return false; end if;
  update public.zelochat_messages set outbound_status = 'dispatch_started' where id = v_job.message_id and empresa_id = p_empresa_id;
  return true;
end $$;

create or replace function public.complete_zelochat_outbound_job(p_id uuid, p_empresa_id uuid, p_lease_owner text, p_provider_message_id text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.zelochat_outbound_jobs%rowtype; v_now timestamptz := now();
begin
  if nullif(trim(p_provider_message_id), '') is null then return false; end if;
  update public.zelochat_outbound_jobs j set status = 'sent', provider_message_id = p_provider_message_id, sent_at = v_now,
      lease_owner = null, lease_expires_at = null, last_error = null, updated_at = v_now
   where j.id = p_id and j.empresa_id = p_empresa_id and j.lease_owner = p_lease_owner and j.status = 'dispatch_started'
   returning * into v_job;
  if not found then return false; end if;
  update public.zelochat_messages set outbound_status = 'sent', outbound_error = null, wa_message_id = p_provider_message_id
   where id = v_job.message_id and empresa_id = p_empresa_id;
  if v_job.job_type = 'campaign' and v_job.recipient_id is not null then
    update public.zelochat_campaign_recipients set status = 'sent', provider_message_id = p_provider_message_id, sent_at = v_now, updated_at = v_now where id = v_job.recipient_id and empresa_id = p_empresa_id;
  elsif v_job.job_type = 'automation' and v_job.automation_dispatch_id is not null then
    update public.zelochat_automation_dispatches set status = 'sent', sent_at = v_now, updated_at = v_now where id = v_job.automation_dispatch_id and empresa_id = p_empresa_id;
  end if;
  return true;
end $$;

create or replace function public.fail_zelochat_outbound_job(
  p_id uuid, p_empresa_id uuid, p_lease_owner text, p_reason text,
  p_retry_at timestamptz default null, p_delivery_uncertain boolean default false
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.zelochat_outbound_jobs%rowtype; v_now timestamptz := now(); v_status text;
begin
  v_status := case when p_delivery_uncertain then 'delivery_uncertain' when p_retry_at is not null then 'queued' else 'failed_before_dispatch' end;
  update public.zelochat_outbound_jobs j set status = v_status, last_error = left(coalesce(p_reason, 'Falha ao enviar.'), 1000),
      next_attempt_at = coalesce(p_retry_at, j.next_attempt_at), lease_owner = null, lease_expires_at = null, updated_at = v_now
   where j.id = p_id and j.empresa_id = p_empresa_id and j.lease_owner = p_lease_owner
     and ((p_delivery_uncertain and j.status = 'dispatch_started') or (not p_delivery_uncertain and j.status = 'sending'))
   returning * into v_job;
  if not found then return false; end if;
  if p_delivery_uncertain and v_job.conversation_control_id is not null then
    update public.zelochat_conversation_ai_control set hold_reason = 'delivery_uncertain', hold_job_id = v_job.id, changed_at = v_now
     where id = v_job.conversation_control_id and empresa_id = p_empresa_id;
  end if;
  update public.zelochat_messages set outbound_status = v_status, outbound_error = case when p_delivery_uncertain then 'Não foi possível confirmar a entrega.' else 'Mensagem não enviada.' end
   where id = v_job.message_id and empresa_id = p_empresa_id;
  if v_job.job_type = 'campaign' and v_job.recipient_id is not null then
    update public.zelochat_campaign_recipients set status = case when v_status = 'queued' then 'queued' else 'failed' end, last_error = left(coalesce(p_reason, 'Falha ao enviar.'), 1000), updated_at = v_now where id = v_job.recipient_id and empresa_id = p_empresa_id;
  elsif v_job.job_type = 'automation' and v_job.automation_dispatch_id is not null then
    update public.zelochat_automation_dispatches set status = case when v_status = 'queued' then 'queued' else 'failed' end, last_error = left(coalesce(p_reason, 'Falha ao enviar.'), 1000), updated_at = v_now where id = v_job.automation_dispatch_id and empresa_id = p_empresa_id;
  end if;
  return true;
end $$;

create or replace function public.suppress_zelochat_outbound_job(p_id uuid, p_empresa_id uuid, p_lease_owner text, p_reason text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.zelochat_outbound_jobs%rowtype; v_now timestamptz := now();
begin
  update public.zelochat_outbound_jobs j set status = 'cancelled', suppression_reason = left(coalesce(p_reason, 'suppressed'), 200),
      lease_owner = null, lease_expires_at = null, updated_at = v_now
   where j.id = p_id and j.empresa_id = p_empresa_id and j.lease_owner = p_lease_owner and j.status = 'sending'
   returning * into v_job;
  if not found then return false; end if;
  update public.zelochat_messages set outbound_status = 'cancelled', outbound_error = null where id = v_job.message_id and empresa_id = p_empresa_id;
  if v_job.job_type = 'campaign' and v_job.recipient_id is not null then
    update public.zelochat_campaign_recipients set status = 'suppressed', suppression_reason = p_reason, updated_at = v_now where id = v_job.recipient_id and empresa_id = p_empresa_id;
  elsif v_job.job_type = 'automation' and v_job.automation_dispatch_id is not null then
    update public.zelochat_automation_dispatches set status = 'suppressed', suppression_reason = p_reason, updated_at = v_now where id = v_job.automation_dispatch_id and empresa_id = p_empresa_id;
  end if;
  return true;
end $$;

revoke all on function public.start_zelochat_outbound_transport(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_zelochat_outbound_job(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.fail_zelochat_outbound_job(uuid, uuid, text, text, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.suppress_zelochat_outbound_job(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.start_zelochat_outbound_transport(uuid, uuid, text) to service_role;
grant execute on function public.complete_zelochat_outbound_job(uuid, uuid, text, text) to service_role;
grant execute on function public.fail_zelochat_outbound_job(uuid, uuid, text, text, timestamptz, boolean) to service_role;
grant execute on function public.suppress_zelochat_outbound_job(uuid, uuid, text, text) to service_role;

commit;
