begin;

alter table public.zelochat_webhook_events_raw
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists auth_status text not null default 'token_missing',
  add column if not exists correlation_state text;

alter table public.zelochat_webhook_events_raw
  drop constraint if exists zelochat_webhook_events_raw_auth_status_check;
alter table public.zelochat_webhook_events_raw
  add constraint zelochat_webhook_events_raw_auth_status_check
  check (auth_status in ('token_match','token_missing','token_mismatch'));

create index if not exists zelochat_webhook_events_raw_replay_due_idx
  on public.zelochat_webhook_events_raw (next_attempt_at, received_at, id)
  where processed_at is null and dead_lettered_at is null and processing_error is not null;

-- The RPC below relies on this exact tenant-scoped arbiter. Re-declaring it
-- here makes migration 066 fail closed if the production ledger skipped 015.
create unique index if not exists zelochat_messages_empresa_wa_msg_uniq
  on public.zelochat_messages (empresa_id, wa_message_id)
  where wa_message_id is not null;

create or replace function public.record_zelochat_native_outbound_takeover(
  p_empresa_id uuid,
  p_remote_jid text,
  p_wa_message_id text,
  p_payload jsonb,
  p_preview text,
  p_sent_at timestamptz
)
returns table(result jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot record;
  v_control public.zelochat_conversation_ai_control%rowtype;
  v_session_id uuid;
  v_message_id uuid;
  v_job_id uuid;
  v_inserted boolean := false;
  v_takeover_applied boolean := false;
  v_now timestamptz := now();
begin
  perform public.zelochat_conversation_control_rollout_gate();
  if p_empresa_id is null
     or nullif(trim(coalesce(p_remote_jid, '')), '') is null
     or nullif(trim(coalesce(p_wa_message_id, '')), '') is null
     or p_payload is null then
    raise exception 'INVALID_NATIVE_FROM_ME_ARGUMENTS';
  end if;
  if p_payload::text ~* '"[^" ]+"\s*:\s*"data:[^,]+,' then
    raise exception 'NATIVE_FROM_ME_DATA_URL_FORBIDDEN';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || ':native:' || p_wa_message_id, 0));
  select m.id, m.outbound_job_id
    into v_message_id, v_job_id
    from public.zelochat_messages m
   where m.empresa_id = p_empresa_id and m.wa_message_id = p_wa_message_id;
  if found then
    if v_job_id is null then
      select j.id into v_job_id from public.zelochat_outbound_jobs j
       where j.empresa_id = p_empresa_id and j.provider_message_id = p_wa_message_id
       order by j.created_at, j.id limit 1;
    end if;
    if v_job_id is null then raise exception 'NATIVE_FROM_ME_EXISTING_MESSAGE_AMBIGUOUS'; end if;
    select * into v_snapshot from public.ensure_zelochat_conversation_control(p_empresa_id, p_remote_jid);
    result := jsonb_build_object(
      'inserted', false, 'takeover_applied', false, 'message_id', v_message_id,
      'job_id', v_job_id, 'conversation_control_id', v_snapshot.conversation_control_id,
      'mode', v_snapshot.mode, 'epoch', v_snapshot.epoch, 'remote_jids', v_snapshot.remote_jids
    );
    return next; return;
  end if;

  select * into v_snapshot from public.ensure_zelochat_conversation_control(p_empresa_id, p_remote_jid);
  select * into v_control from public.zelochat_conversation_ai_control c
   where c.empresa_id = p_empresa_id and c.id = v_snapshot.conversation_control_id for update;
  select s.id into v_session_id from public.zelochat_sessions s
   where s.empresa_id = p_empresa_id and s.conversation_control_id = v_control.id
   order by (s.remote_jid = p_remote_jid) desc, s.updated_at desc, s.id limit 1;
  if v_session_id is null then raise exception 'CONVERSATION_SESSION_NOT_FOUND'; end if;

  insert into public.zelochat_messages (
    empresa_id, session_id, role, content, wa_message_id, sent_at,
    outbound_status, outbound_origin, outbound_actor_user_id
  ) values (
    p_empresa_id, v_session_id, 'assistant', coalesce(nullif(trim(p_preview), ''), '[Mensagem enviada]'),
    p_wa_message_id, coalesce(p_sent_at, v_now), 'sent', 'human_native_whatsapp', null
  )
  on conflict (empresa_id, wa_message_id) where wa_message_id is not null do nothing
  returning id into v_message_id;
  v_inserted := found;
  if not v_inserted then
    select m.id, m.outbound_job_id into v_message_id, v_job_id from public.zelochat_messages m
     where m.empresa_id = p_empresa_id and m.wa_message_id = p_wa_message_id;
    if v_job_id is null then raise exception 'NATIVE_FROM_ME_CONCURRENT_INSERT_AMBIGUOUS'; end if;
    result := jsonb_build_object(
      'inserted', false, 'takeover_applied', false, 'message_id', v_message_id,
      'job_id', v_job_id, 'conversation_control_id', v_control.id,
      'mode', v_control.mode, 'epoch', v_control.epoch::text, 'remote_jids', v_snapshot.remote_jids
    );
    return next; return;
  end if;

  v_takeover_applied := v_control.mode <> 'human';
  update public.zelochat_conversation_ai_control c
     set mode = 'human',
         epoch = case when v_takeover_applied then c.epoch + 1 else c.epoch end,
         latest_takeover_message_id = v_message_id,
         changed_by_actor = null,
         changed_source = 'native_whatsapp',
         changed_at = v_now
   where c.empresa_id = p_empresa_id and c.id = v_control.id
   returning * into v_control;
  perform public.zelochat_project_conversation_control(p_empresa_id, v_control.id, false, v_now);
  update public.zelochat_outbound_jobs j
     set status = 'cancelled', suppression_reason = 'human_takeover', updated_at = v_now
   where j.empresa_id = p_empresa_id and j.conversation_control_id = v_control.id
     and j.status = 'queued' and j.outbound_origin in ('ai_auto','ai_followup');

  insert into public.zelochat_outbound_jobs (
    empresa_id, job_type, idempotency_key, phone_snapshot, message, status, attempts,
    max_attempts, next_attempt_at, provider_message_id, created_at, sent_at, updated_at,
    conversation_control_id, conversation_jid, message_id, outbound_origin, takeover_policy,
    payload, payload_fingerprint, intent_payload_fingerprint, control_epoch
  ) values (
    p_empresa_id, 'conversation', 'native:' || p_empresa_id::text || ':' || p_wa_message_id, split_part(p_remote_jid, '@', 1),
    coalesce(nullif(trim(p_preview), ''), '[Mensagem enviada]'), 'sent', 0, 1, v_now,
    p_wa_message_id, v_now, coalesce(p_sent_at, v_now), v_now, v_control.id, p_remote_jid,
    v_message_id, 'human_native_whatsapp', 'take_over', p_payload,
    null, null, v_control.epoch
  ) returning id into v_job_id;

  update public.zelochat_messages set outbound_job_id = v_job_id
   where empresa_id = p_empresa_id and id = v_message_id;
  if v_takeover_applied then
    insert into public.zelochat_conversation_control_events (
      empresa_id, conversation_control_id, remote_jid, event_type, epoch,
      actor_user_id, source, message_id, job_id
    ) values (
      p_empresa_id, v_control.id, p_remote_jid, 'human_takeover', v_control.epoch,
      null, 'native_whatsapp', v_message_id, v_job_id
    );
  end if;

  select * into v_snapshot from public.zelochat_conversation_control_snapshot(p_empresa_id, v_control.id);
  result := jsonb_build_object(
    'inserted', true, 'takeover_applied', v_takeover_applied, 'message_id', v_message_id,
    'job_id', v_job_id, 'conversation_control_id', v_control.id,
    'mode', v_control.mode, 'epoch', v_control.epoch::text, 'remote_jids', v_snapshot.remote_jids
  );
  return next;
end;
$$;

create or replace function public.hold_zelochat_from_me_correlation(
  p_empresa_id uuid, p_job_id uuid, p_wa_message_id text,
  p_payload_fingerprint text, p_raw_event_id uuid default null
)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_job public.zelochat_outbound_jobs%rowtype;
begin
  perform public.zelochat_conversation_control_rollout_gate();
  select * into v_job from public.zelochat_outbound_jobs j
   where j.id = p_job_id and j.empresa_id = p_empresa_id for update;
  if not found or v_job.status <> 'dispatch_started' or v_job.provider_message_id is not null
     or v_job.payload_fingerprint is distinct from p_payload_fingerprint then return false; end if;
  perform 1 from public.zelochat_conversation_ai_control c
   where c.id = v_job.conversation_control_id and c.empresa_id = p_empresa_id for update;
  update public.zelochat_conversation_ai_control c
     set hold_reason = 'from_me_pending_correlation', hold_job_id = v_job.id
   where c.id = v_job.conversation_control_id and c.empresa_id = p_empresa_id
     and (c.hold_job_id is null or c.hold_job_id = v_job.id);
  if not found then raise exception 'CONVERSATION_ALREADY_HELD'; end if;
  if p_raw_event_id is not null then
    update public.zelochat_webhook_events_raw r set correlation_state = 'pending_correlation'
     where r.id = p_raw_event_id and r.empresa_id = p_empresa_id;
  end if;
  return true;
end;
$$;

create or replace function public.reconcile_zelochat_from_me_server_echo(
  p_empresa_id uuid, p_remote_jid text, p_wa_message_id text, p_job_id uuid,
  p_payload jsonb, p_preview text, p_sent_at timestamptz
)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_job public.zelochat_outbound_jobs%rowtype; v_snapshot record; v_session_id uuid; v_message_id uuid;
begin
  perform public.zelochat_conversation_control_rollout_gate();
  if p_job_id is not null then
    select * into v_job from public.zelochat_outbound_jobs j
     where j.id = p_job_id and j.empresa_id = p_empresa_id for update;
    if not found or (v_job.provider_message_id is not null and v_job.provider_message_id <> p_wa_message_id) then return false; end if;
    update public.zelochat_outbound_jobs set provider_message_id = p_wa_message_id,
      status = case when status = 'dispatch_started' then 'sent' else status end,
      sent_at = coalesce(sent_at, p_sent_at, now()), lease_owner = null, lease_expires_at = null,
      updated_at = now() where id = p_job_id and empresa_id = p_empresa_id;
    update public.zelochat_messages set wa_message_id = p_wa_message_id,
      outbound_status = case when outbound_status = 'dispatch_started' then 'sent' else outbound_status end,
      outbound_error = null where id = v_job.message_id and empresa_id = p_empresa_id;
    update public.zelochat_conversation_ai_control set hold_reason = null, hold_job_id = null
     where empresa_id = p_empresa_id and id = v_job.conversation_control_id and hold_job_id = p_job_id;
    return true;
  end if;

  select * into v_snapshot from public.ensure_zelochat_conversation_control(p_empresa_id, p_remote_jid);
  select s.id into v_session_id from public.zelochat_sessions s
   where s.empresa_id = p_empresa_id and s.conversation_control_id = v_snapshot.conversation_control_id
   order by (s.remote_jid = p_remote_jid) desc, s.updated_at desc, s.id limit 1;
  if v_session_id is null then return false; end if;
  insert into public.zelochat_messages (
    empresa_id, session_id, role, content, wa_message_id, sent_at, outbound_status
  ) values (
    p_empresa_id, v_session_id, 'assistant', coalesce(nullif(trim(p_preview), ''), '[Mensagem enviada]'),
    p_wa_message_id, coalesce(p_sent_at, now()), 'sent'
  ) on conflict (empresa_id, wa_message_id) where wa_message_id is not null do nothing
  returning id into v_message_id;
  return v_message_id is not null;
end;
$$;

create or replace function public.claim_zelochat_webhook_replay(
  p_worker text, p_lease_seconds integer default 120
)
returns setof public.zelochat_webhook_events_raw
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_row public.zelochat_webhook_events_raw%rowtype;
begin
  if nullif(trim(coalesce(p_worker, '')), '') is null then raise exception 'INVALID_REPLAY_WORKER'; end if;
  select * into v_row from public.zelochat_webhook_events_raw r
   where r.processed_at is null and r.dead_lettered_at is null
     and r.processing_error is not null and r.next_attempt_at <= now()
     and r.auth_status = 'token_match' and r.event_type = 'messages.upsert'
     and r.payload #>> '{data,key,fromMe}' = 'true'
     and (r.lease_owner is null or r.lease_expires_at < now())
   order by r.next_attempt_at, r.received_at, r.id
   for update skip locked limit 1;
  if not found then return; end if;
  update public.zelochat_webhook_events_raw r set
    lease_owner = p_worker,
    lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 15)),
    attempt_count = r.attempt_count + 1,
    correlation_state = coalesce(r.correlation_state, 'processing')
   where r.id = v_row.id returning * into v_row;
  return next v_row;
end;
$$;

create or replace function public.complete_zelochat_webhook_replay(p_id uuid, p_worker text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.zelochat_webhook_events_raw set processed_at = now(), processing_error = null,
    lease_owner = null, lease_expires_at = null,
    correlation_state = case when correlation_state = 'pending_correlation' then 'server_echo' else coalesce(correlation_state, 'processed') end
   where id = p_id and lease_owner = p_worker and processed_at is null;
  return found;
end $$;

create or replace function public.fail_zelochat_webhook_replay(
  p_id uuid, p_worker text, p_error text, p_retry_at timestamptz, p_dead_letter boolean
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.zelochat_webhook_events_raw set processing_error = left(coalesce(p_error, 'REPLAY_FAILED'), 2000),
    next_attempt_at = coalesce(p_retry_at, next_attempt_at), lease_owner = null, lease_expires_at = null,
    dead_lettered_at = case when p_dead_letter then now() else dead_lettered_at end,
    correlation_state = case when p_dead_letter then 'dead_letter' else correlation_state end
   where id = p_id and lease_owner = p_worker and processed_at is null;
  return found;
end $$;

revoke all on function public.record_zelochat_native_outbound_takeover(uuid, text, text, jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.hold_zelochat_from_me_correlation(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.reconcile_zelochat_from_me_server_echo(uuid, text, text, uuid, jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_zelochat_webhook_replay(text, integer) from public, anon, authenticated;
revoke all on function public.complete_zelochat_webhook_replay(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_zelochat_webhook_replay(uuid, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.record_zelochat_native_outbound_takeover(uuid, text, text, jsonb, text, timestamptz) to service_role;
grant execute on function public.hold_zelochat_from_me_correlation(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.reconcile_zelochat_from_me_server_echo(uuid, text, text, uuid, jsonb, text, timestamptz) to service_role;
grant execute on function public.claim_zelochat_webhook_replay(text, integer) to service_role;
grant execute on function public.complete_zelochat_webhook_replay(uuid, text) to service_role;
grant execute on function public.fail_zelochat_webhook_replay(uuid, text, text, timestamptz, boolean) to service_role;

commit;
