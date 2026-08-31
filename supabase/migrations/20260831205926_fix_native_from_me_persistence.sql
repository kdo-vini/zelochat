begin;

-- Native WhatsApp sends are already terminal provider deliveries. Their job
-- payload only needs to satisfy the durable conversation ledger; the strong
-- fingerprint is passed separately so echoes can still be correlated. Media
-- content is persisted independently in zelochat_messages for UI rendering.
create or replace function public.record_zelochat_native_outbound_takeover(
  p_empresa_id uuid,
  p_remote_jid text,
  p_wa_message_id text,
  p_payload jsonb,
  p_payload_fingerprint text,
  p_message_content text,
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
  v_release_correlation_hold boolean := false;
  v_correlated_job_id uuid;
  v_correlated_provider_message_id text;
  v_now timestamptz := now();
begin
  perform public.zelochat_conversation_control_lock_gate();
  if p_empresa_id is null
     or nullif(trim(coalesce(p_remote_jid, '')), '') is null
     or nullif(trim(coalesce(p_wa_message_id, '')), '') is null
     or p_payload is null
     or nullif(trim(coalesce(p_payload_fingerprint, '')), '') is null then
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
  if v_control.hold_reason = 'from_me_pending_correlation'
     and v_control.hold_job_id is not null then
    select j.id, j.provider_message_id
      into v_correlated_job_id, v_correlated_provider_message_id
      from public.zelochat_outbound_jobs j
     where j.empresa_id = p_empresa_id
       and j.conversation_control_id = v_control.id
       and j.id = v_control.hold_job_id
     for update;
    v_release_correlation_hold := found
      and v_correlated_provider_message_id is not null
      and v_correlated_provider_message_id <> p_wa_message_id;
  end if;
  select s.id into v_session_id from public.zelochat_sessions s
   where s.empresa_id = p_empresa_id and s.conversation_control_id = v_control.id
   order by (s.remote_jid = p_remote_jid) desc, s.updated_at desc, s.id limit 1;
  if v_session_id is null then raise exception 'CONVERSATION_SESSION_NOT_FOUND'; end if;

  insert into public.zelochat_messages (
    empresa_id, session_id, role, content, wa_message_id, sent_at,
    outbound_status, outbound_origin, outbound_actor_user_id
  ) values (
    p_empresa_id, v_session_id, 'assistant',
    coalesce(nullif(p_message_content, ''), nullif(trim(p_preview), ''), '[Mensagem enviada]'),
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
         changed_at = v_now,
         hold_reason = case
           when v_release_correlation_hold
            and c.hold_reason = 'from_me_pending_correlation'
            and c.hold_job_id = v_correlated_job_id then null
           else c.hold_reason
         end,
         hold_job_id = case
           when v_release_correlation_hold
            and c.hold_reason = 'from_me_pending_correlation'
            and c.hold_job_id = v_correlated_job_id then null
           else c.hold_job_id
         end
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
    p_payload_fingerprint, p_payload_fingerprint, v_control.epoch
  ) returning id into v_job_id;

  update public.zelochat_messages set outbound_job_id = v_job_id
   where empresa_id = p_empresa_id and id = v_message_id;
  update public.zelochat_sessions
     set last_message = coalesce(nullif(trim(p_preview), ''), '[Mensagem enviada]'),
         updated_at = v_now
   where empresa_id = p_empresa_id and id = v_session_id;
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

-- Rolling compatibility for replicas that still call the six-argument RPC.
-- The core overload above is authoritative for new code.
create or replace function public.record_zelochat_native_outbound_takeover(
  p_empresa_id uuid,
  p_remote_jid text,
  p_wa_message_id text,
  p_payload jsonb,
  p_preview text,
  p_sent_at timestamptz
)
returns table(result jsonb)
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from public.record_zelochat_native_outbound_takeover(
    p_empresa_id,
    p_remote_jid,
    p_wa_message_id,
    case
      when p_payload->>'kind' in ('media','audio','sticker')
        then jsonb_build_object('kind', 'text', 'text', coalesce(nullif(trim(p_preview), ''), '[Mensagem enviada]'))
      else p_payload
    end,
    md5(coalesce(p_payload::text, '')) || md5('native:' || coalesce(p_payload::text, '')),
    coalesce(nullif(p_preview, ''), '[Mensagem enviada]'),
    p_preview,
    p_sent_at
  );
$$;

revoke all on function public.record_zelochat_native_outbound_takeover(uuid, text, text, jsonb, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_zelochat_native_outbound_takeover(uuid, text, text, jsonb, text, text, text, timestamptz) to service_role;

revoke all on function public.record_zelochat_native_outbound_takeover(uuid, text, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_zelochat_native_outbound_takeover(uuid, text, text, jsonb, text, timestamptz) to service_role;

commit;
