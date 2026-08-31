-- Task 11 verification probe for migrations 063-066.
-- Run only against an isolated local/staging database with psql -v ON_ERROR_STOP=1.
-- Every data mutation below is enclosed by this transaction and is rolled back.

begin;

do $$
declare
  v_empresa uuid;
  v_actor uuid;
  v_jid text;
  v_control uuid;
  v_epoch bigint;
  v_after bigint;
  v_job uuid;
  v_native_first jsonb;
  v_native_second jsonb;
  v_key text := 'verify-task11-' || txid_current()::text;
begin
  if exists (
    select 1 from public.zelochat_outbound_jobs
    where status = 'queued' and next_attempt_at <= now() and attempts < max_attempts
  ) then
    raise exception 'ISOLATED_DATABASE_REQUIRED: claimable outbound jobs already exist';
  end if;

  select s.empresa_id, ep.user_id, s.remote_jid, s.conversation_control_id
    into v_empresa, v_actor, v_jid, v_control
    from public.zelochat_sessions s
    join public.empresa_perfil ep on ep.id = s.empresa_id
   where s.conversation_control_id is not null
     and ep.user_id is not null
   order by s.updated_at desc, s.id
   limit 1;
  if v_empresa is null then
    raise exception 'FIXTURE_REQUIRED: one mapped session with an empresa owner is required';
  end if;

  if has_function_privilege('anon', 'public.pause_zelochat_ai_for_human(uuid,text,uuid,text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.pause_zelochat_ai_for_human(uuid,text,uuid,text,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.pause_zelochat_ai_for_human(uuid,text,uuid,text,uuid)', 'EXECUTE') then
    raise exception 'GRANT_VERIFICATION_FAILED';
  end if;

  begin
    perform public.pause_zelochat_ai_for_human(v_empresa, v_jid, gen_random_uuid(), 'zelochat_operator', null);
    raise exception 'ACTOR_NOT_IN_TENANT was not enforced';
  exception when others then
    if sqlerrm not like '%ACTOR_NOT_IN_TENANT%' then raise; end if;
  end;

  perform public.resume_zelochat_ai(v_empresa, v_jid, v_actor);
  select epoch into v_epoch from public.zelochat_conversation_ai_control
   where empresa_id = v_empresa and id = v_control;

  perform public.enqueue_zelochat_ai_outbound(
    v_empresa, v_jid, v_control, v_epoch, 'ai_auto', v_key || '-stale-ai',
    '{"kind":"text","text":"probe stale"}'::jsonb, repeat('a', 64), 'probe stale'
  );
  perform public.pause_zelochat_ai_for_human(v_empresa, v_jid, v_actor, 'zelochat_operator', null);
  select epoch into v_after from public.zelochat_conversation_ai_control
   where empresa_id = v_empresa and id = v_control;
  if v_after <> v_epoch + 1 then raise exception 'EPOCH_DID_NOT_ADVANCE_ON_TAKEOVER'; end if;
  if exists (
    select 1 from public.zelochat_sessions
    where empresa_id = v_empresa and conversation_control_id = v_control and auto_reply is distinct from false
  ) then raise exception 'FAMILY_PROJECTION_NOT_PAUSED'; end if;
  if not exists (
    select 1 from public.zelochat_outbound_jobs
    where empresa_id = v_empresa and idempotency_key = v_key || '-stale-ai'
      and status = 'cancelled' and suppression_reason = 'human_takeover'
  ) then raise exception 'STALE_AI_NOT_CANCELLED'; end if;

  perform public.resume_zelochat_ai(v_empresa, v_jid, v_actor);
  perform public.begin_zelochat_human_outbound(
    v_empresa, v_jid, v_actor, 'zelochat_operator', v_key || '-human',
    '{"kind":"text","text":"probe human"}'::jsonb, repeat('b', 64), 'probe human'
  );
  perform public.begin_zelochat_human_outbound(
    v_empresa, v_jid, v_actor, 'zelochat_operator', v_key || '-human',
    '{"kind":"text","text":"probe human"}'::jsonb, repeat('b', 64), 'probe human'
  );
  if (select count(*) from public.zelochat_outbound_jobs where empresa_id = v_empresa and idempotency_key = v_key || '-human') <> 1
     or (select count(*) from public.zelochat_conversation_control_events where empresa_id = v_empresa and job_id = (
       select id from public.zelochat_outbound_jobs where empresa_id = v_empresa and idempotency_key = v_key || '-human'
     )) <> 1 then
    raise exception 'HUMAN_IDEMPOTENCY_FAILED';
  end if;

  select id into v_job from public.claim_zelochat_outbound_job('task11-worker-a', 120);
  if v_job is null then raise exception 'FIRST_WORKER_DID_NOT_CLAIM'; end if;
  if exists (select 1 from public.claim_zelochat_outbound_job('task11-worker-b', 120)) then
    raise exception 'SECOND_WORKER_CLAIMED_SAME_DESTINATION';
  end if;

  perform public.resume_zelochat_ai(v_empresa, v_jid, v_actor);
  select result into v_native_first from public.record_zelochat_native_outbound_takeover(
    v_empresa, v_jid, v_key || '-native-wa', '{"kind":"text","text":"probe native"}'::jsonb,
    'probe native', now()
  );
  select result into v_native_second from public.record_zelochat_native_outbound_takeover(
    v_empresa, v_jid, v_key || '-native-wa', '{"kind":"text","text":"probe native"}'::jsonb,
    'probe native', now()
  );
  if coalesce((v_native_first->>'inserted')::boolean, false) is not true
     or coalesce((v_native_second->>'inserted')::boolean, true) is not false
     or v_native_first->>'message_id' is distinct from v_native_second->>'message_id'
     or v_native_first->>'job_id' is distinct from v_native_second->>'job_id' then
    raise exception 'NATIVE_REDELIVERY_IDEMPOTENCY_FAILED';
  end if;
end
$$;

rollback;
