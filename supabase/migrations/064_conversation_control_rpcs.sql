begin;

-- Canonical conversation control RPCs. Callers pass only empresa_id +
-- remote_jid; the database resolves and locks the canonical control row.

create or replace function public.zelochat_conversation_control_snapshot(
  p_empresa_id uuid,
  p_conversation_control_id uuid
)
returns table (
  conversation_control_id uuid,
  mode text,
  epoch text,
  remote_jids text[],
  changed_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    c.mode,
    c.epoch::text,
    coalesce(
      array_agg(s.remote_jid order by s.updated_at desc, s.remote_jid)
        filter (where s.remote_jid is not null),
      array[]::text[]
    ),
    c.changed_at
  from public.zelochat_conversation_ai_control c
  left join public.zelochat_sessions s
    on s.empresa_id = c.empresa_id
   and s.conversation_control_id = c.id
  where c.empresa_id = p_empresa_id
    and c.id = p_conversation_control_id
  group by c.id, c.mode, c.epoch, c.changed_at
$$;

revoke all on function public.zelochat_conversation_control_snapshot(uuid, uuid) from public, anon, authenticated;
grant execute on function public.zelochat_conversation_control_snapshot(uuid, uuid) to service_role;

create or replace function public.ensure_zelochat_conversation_control(
  p_empresa_id uuid,
  p_remote_jid text
)
returns table (
  conversation_control_id uuid,
  mode text,
  epoch text,
  remote_jids text[],
  changed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_key text;
  v_existing_control_id uuid;
  v_winner_control_id uuid;
  v_duplicate_control_ids uuid[] := array[]::uuid[];
  v_duplicate_count integer := 0;
  v_any_human boolean := false;
  v_next_epoch bigint := 0;
  v_now timestamptz := now();
begin
  if p_empresa_id is null or nullif(trim(coalesce(p_remote_jid, '')), '') is null then
    raise exception 'INVALID_CONVERSATION_CONTROL_ARGUMENTS';
  end if;

  select public.zelochat_conversation_identity_key(s.pessoa_id, s.customer_phone, s.remote_jid)
    into v_identity_key
  from public.zelochat_sessions s
  where s.empresa_id = p_empresa_id
    and s.remote_jid = p_remote_jid
  order by s.updated_at desc
  limit 1;

  v_identity_key := coalesce(
    v_identity_key,
    public.zelochat_conversation_identity_key(null, null, p_remote_jid)
  );

  perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || ':' || v_identity_key, 0));

  select c.id
    into v_existing_control_id
  from public.zelochat_conversation_ai_control c
  where c.empresa_id = p_empresa_id
    and c.identity_key = v_identity_key
  for update;

  if v_existing_control_id is null then
    insert into public.zelochat_conversation_ai_control (
      empresa_id,
      identity_key,
      mode,
      epoch,
      changed_source,
      changed_at
    )
    values (
      p_empresa_id,
      v_identity_key,
      case
        when exists (
          select 1
          from public.zelochat_sessions s
          where s.empresa_id = p_empresa_id
            and public.zelochat_conversation_identity_key(s.pessoa_id, s.customer_phone, s.remote_jid) = v_identity_key
            and coalesce(s.auto_reply, true) = false
        ) then 'human'
        else 'ai'
      end,
      0,
      'ensure',
      v_now
    )
    returning id into v_existing_control_id;
  end if;

  select coalesce(array_agg(distinct id order by id), array[]::uuid[])
    into v_duplicate_control_ids
  from (
    select v_existing_control_id as id
    union
    select s.conversation_control_id as id
    from public.zelochat_sessions s
    where s.empresa_id = p_empresa_id
      and s.conversation_control_id is not null
      and (
        s.remote_jid = p_remote_jid
        or public.zelochat_conversation_identity_key(s.pessoa_id, s.customer_phone, s.remote_jid) = v_identity_key
      )
  ) candidates
  where id is not null;

  select count(*)
    into v_duplicate_count
  from unnest(v_duplicate_control_ids) as ids(id);

  -- Lock every control in deterministic order before choosing the winner.
  perform 1
  from public.zelochat_conversation_ai_control c
  where c.empresa_id = p_empresa_id
    and c.id = any(v_duplicate_control_ids)
  order by c.id
  for update;

  v_winner_control_id := coalesce(v_existing_control_id, v_duplicate_control_ids[1]);

  select
    bool_or(c.mode = 'human'),
    greatest(coalesce(max(c.epoch), 0), 0)
  into v_any_human, v_next_epoch
  from public.zelochat_conversation_ai_control c
  where c.empresa_id = p_empresa_id
    and c.id = any(v_duplicate_control_ids);

  v_any_human := coalesce(v_any_human, false) or exists (
    select 1
    from public.zelochat_sessions s
    where s.empresa_id = p_empresa_id
      and public.zelochat_conversation_identity_key(s.pessoa_id, s.customer_phone, s.remote_jid) = v_identity_key
      and coalesce(s.auto_reply, true) = false
  );

  if v_duplicate_count > 1 then
    v_next_epoch := v_next_epoch + 1;

    update public.zelochat_sessions s
       set conversation_control_id = v_winner_control_id
     where s.empresa_id = p_empresa_id
       and s.conversation_control_id = any(v_duplicate_control_ids)
       and s.conversation_control_id <> v_winner_control_id;

    update public.zelochat_outbound_jobs j
       set conversation_control_id = v_winner_control_id
     where j.empresa_id = p_empresa_id
       and j.conversation_control_id = any(v_duplicate_control_ids)
       and j.conversation_control_id <> v_winner_control_id;

    update public.zelochat_conversation_control_events e
       set conversation_control_id = v_winner_control_id
     where e.empresa_id = p_empresa_id
       and e.conversation_control_id = any(v_duplicate_control_ids)
       and e.conversation_control_id <> v_winner_control_id;

    delete from public.zelochat_conversation_ai_control c
     where c.empresa_id = p_empresa_id
       and c.id = any(v_duplicate_control_ids)
       and c.id <> v_winner_control_id;

    insert into public.zelochat_conversation_control_events (
      empresa_id,
      conversation_control_id,
      remote_jid,
      event_type,
      epoch,
      actor_user_id,
      source,
      message_id
    )
    values (
      p_empresa_id,
      v_winner_control_id,
      p_remote_jid,
      'controls_merged',
      v_next_epoch,
      null,
      'ensure',
      null
    );
  end if;

  update public.zelochat_conversation_ai_control c
     set identity_key = v_identity_key,
         mode = case when v_any_human then 'human' else 'ai' end,
         epoch = case when v_duplicate_count > 1 then v_next_epoch else c.epoch end,
         changed_source = case when v_duplicate_count > 1 then 'controls_merged' else c.changed_source end,
         changed_at = case when v_duplicate_count > 1 then v_now else c.changed_at end
   where c.empresa_id = p_empresa_id
     and c.id = v_winner_control_id;

  update public.zelochat_sessions s
     set conversation_control_id = v_winner_control_id,
         auto_reply = not v_any_human,
         updated_at = v_now
   where s.empresa_id = p_empresa_id
     and public.zelochat_conversation_identity_key(s.pessoa_id, s.customer_phone, s.remote_jid) = v_identity_key
     and (
       s.conversation_control_id is distinct from v_winner_control_id
       or s.auto_reply is distinct from not v_any_human
     );

  return query
  select *
  from public.zelochat_conversation_control_snapshot(p_empresa_id, v_winner_control_id);
end;
$$;

revoke all on function public.ensure_zelochat_conversation_control(uuid, text) from public, anon, authenticated;
grant execute on function public.ensure_zelochat_conversation_control(uuid, text) to service_role;

create or replace function public.advance_zelochat_ai_epoch_for_inbound(
  p_empresa_id uuid,
  p_remote_jid text,
  p_message_id uuid
)
returns table (
  conversation_control_id uuid,
  mode text,
  epoch text,
  remote_jids text[],
  changed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot record;
  v_control public.zelochat_conversation_ai_control%rowtype;
  v_now timestamptz := now();
begin
  if p_message_id is null then
    raise exception 'INVALID_AI_TURN_MESSAGE_ID';
  end if;

  select *
    into v_snapshot
  from public.ensure_zelochat_conversation_control(p_empresa_id, p_remote_jid);

  select *
    into v_control
  from public.zelochat_conversation_ai_control c
  where c.empresa_id = p_empresa_id
    and c.id = v_snapshot.conversation_control_id
  for update;

  if v_control.mode = 'ai' and not exists (
    select 1
    from public.zelochat_conversation_control_events e
    where e.empresa_id = p_empresa_id
      and e.conversation_control_id = v_control.id
      and e.event_type = 'ai_turn_started'
      and e.message_id = p_message_id
  ) then
    update public.zelochat_conversation_ai_control c
       set epoch = c.epoch + 1,
           latest_inbound_message_id = p_message_id,
           changed_source = 'ai_turn_started',
           changed_at = v_now
     where c.empresa_id = p_empresa_id
       and c.id = v_control.id
     returning * into v_control;

    insert into public.zelochat_conversation_control_events (
      empresa_id,
      conversation_control_id,
      remote_jid,
      event_type,
      epoch,
      actor_user_id,
      source,
      message_id
    )
    values (
      p_empresa_id,
      v_control.id,
      p_remote_jid,
      'ai_turn_started',
      v_control.epoch,
      null,
      'inbound',
      p_message_id
    );
  end if;

  return query
  select *
  from public.zelochat_conversation_control_snapshot(p_empresa_id, v_control.id);
end;
$$;

revoke all on function public.advance_zelochat_ai_epoch_for_inbound(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.advance_zelochat_ai_epoch_for_inbound(uuid, text, uuid) to service_role;

create or replace function public.pause_zelochat_ai_for_human(
  p_empresa_id uuid,
  p_remote_jid text,
  p_actor_user_id uuid,
  p_source text,
  p_message_id uuid default null
)
returns table (
  conversation_control_id uuid,
  mode text,
  epoch text,
  remote_jids text[],
  changed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot record;
  v_control public.zelochat_conversation_ai_control%rowtype;
  v_now timestamptz := now();
  v_increment boolean := false;
begin
  if p_source not in ('zelochat_operator','native_whatsapp','explicit_manual_toggle','escalation') then
    raise exception 'INVALID_TAKEOVER_SOURCE';
  end if;

  select *
    into v_snapshot
  from public.ensure_zelochat_conversation_control(p_empresa_id, p_remote_jid);

  select *
    into v_control
  from public.zelochat_conversation_ai_control c
  where c.empresa_id = p_empresa_id
    and c.id = v_snapshot.conversation_control_id
  for update;

  v_increment := v_control.mode <> 'human';

  update public.zelochat_conversation_ai_control c
     set mode = 'human',
         epoch = case when v_increment then c.epoch + 1 else c.epoch end,
         latest_takeover_message_id = coalesce(p_message_id, c.latest_takeover_message_id),
         changed_by_actor = p_actor_user_id,
         changed_source = p_source,
         changed_at = v_now
   where c.empresa_id = p_empresa_id
     and c.id = v_control.id
   returning * into v_control;

  update public.zelochat_sessions s
     set auto_reply = false,
         updated_at = v_now
   where s.empresa_id = p_empresa_id
     and s.conversation_control_id = v_control.id
     and s.auto_reply is distinct from false;

  update public.zelochat_outbound_jobs j
     set status = 'cancelled',
         suppression_reason = 'human_takeover',
         updated_at = v_now
   where j.empresa_id = p_empresa_id
     and j.conversation_control_id = v_control.id
     and j.status = 'queued'
     and j.outbound_origin in ('ai_auto','ai_followup');

  insert into public.zelochat_conversation_control_events (
    empresa_id,
    conversation_control_id,
    remote_jid,
    event_type,
    epoch,
    actor_user_id,
    source,
    message_id
  )
  values (
    p_empresa_id,
    v_control.id,
    p_remote_jid,
    'human_takeover',
    v_control.epoch,
    p_actor_user_id,
    p_source,
    p_message_id
  );

  return query
  select *
  from public.zelochat_conversation_control_snapshot(p_empresa_id, v_control.id);
end;
$$;

revoke all on function public.pause_zelochat_ai_for_human(uuid, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.pause_zelochat_ai_for_human(uuid, text, uuid, text, uuid) to service_role;

create or replace function public.resume_zelochat_ai(
  p_empresa_id uuid,
  p_remote_jid text,
  p_actor_user_id uuid
)
returns table (
  conversation_control_id uuid,
  mode text,
  epoch text,
  remote_jids text[],
  changed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot record;
  v_control public.zelochat_conversation_ai_control%rowtype;
  v_now timestamptz := now();
begin
  if p_actor_user_id is null then
    raise exception 'INVALID_RESUME_ACTOR';
  end if;

  select *
    into v_snapshot
  from public.ensure_zelochat_conversation_control(p_empresa_id, p_remote_jid);

  select *
    into v_control
  from public.zelochat_conversation_ai_control c
  where c.empresa_id = p_empresa_id
    and c.id = v_snapshot.conversation_control_id
  for update;

  update public.zelochat_conversation_ai_control c
     set mode = 'ai',
         epoch = c.epoch + 1,
         changed_by_actor = p_actor_user_id,
         changed_source = 'ai_resumed',
         changed_at = v_now
   where c.empresa_id = p_empresa_id
     and c.id = v_control.id
   returning * into v_control;

  update public.zelochat_sessions s
     set auto_reply = true,
         updated_at = v_now
   where s.empresa_id = p_empresa_id
     and s.conversation_control_id = v_control.id
     and s.auto_reply is distinct from true;

  insert into public.zelochat_conversation_control_events (
    empresa_id,
    conversation_control_id,
    remote_jid,
    event_type,
    epoch,
    actor_user_id,
    source,
    message_id
  )
  values (
    p_empresa_id,
    v_control.id,
    p_remote_jid,
    'ai_resumed',
    v_control.epoch,
    p_actor_user_id,
    'explicit_resume',
    null
  );

  return query
  select *
  from public.zelochat_conversation_control_snapshot(p_empresa_id, v_control.id);
end;
$$;

revoke all on function public.resume_zelochat_ai(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.resume_zelochat_ai(uuid, text, uuid) to service_role;

create or replace function public.check_zelochat_ai_epoch(
  p_empresa_id uuid,
  p_remote_jid text,
  p_expected_epoch bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot record;
  v_control public.zelochat_conversation_ai_control%rowtype;
begin
  if p_expected_epoch is null then
    return false;
  end if;

  select *
    into v_snapshot
  from public.ensure_zelochat_conversation_control(p_empresa_id, p_remote_jid);

  select *
    into v_control
  from public.zelochat_conversation_ai_control c
  where c.empresa_id = p_empresa_id
    and c.id = v_snapshot.conversation_control_id
  for update;

  return v_control.mode = 'ai' and v_control.epoch = p_expected_epoch;
exception
  when others then
    return false;
end;
$$;

revoke all on function public.check_zelochat_ai_epoch(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.check_zelochat_ai_epoch(uuid, text, bigint) to service_role;

comment on function public.ensure_zelochat_conversation_control(uuid, text) is
  'Resolves/locks the canonical conversation control for one tenant JID, merging duplicates with human mode winning.';
comment on function public.pause_zelochat_ai_for_human(uuid, text, uuid, text, uuid) is
  'Atomically switches the canonical conversation to human mode and cancels queued AI jobs for that control.';
comment on function public.resume_zelochat_ai(uuid, text, uuid) is
  'Explicitly resumes AI for a canonical conversation and advances epoch; old jobs are never restored.';
comment on function public.advance_zelochat_ai_epoch_for_inbound(uuid, text, uuid) is
  'Starts a deduplicated inbound AI generation by advancing epoch only for a new inbound message while mode is AI.';
comment on function public.check_zelochat_ai_epoch(uuid, text, bigint) is
  'Fail-closed epoch check used before AI side effects and enqueue.';

commit;
