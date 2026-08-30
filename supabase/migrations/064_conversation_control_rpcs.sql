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

create or replace function public.zelochat_actor_belongs_to_empresa(
  p_empresa_id uuid,
  p_actor_user_id uuid
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select p_actor_user_id is null
    or exists (
      select 1
      from public.empresa_perfil ep
      where ep.id = p_empresa_id
        and ep.user_id = p_actor_user_id
    )
    or exists (
      select 1
      from public.empresa_perfil ep
      join public.access_users au
        on au.owner_user_id = ep.user_id
       and au.auth_user_id = p_actor_user_id
       and au.status = 'active'
      where ep.id = p_empresa_id
    )
$$;

revoke all on function public.zelochat_actor_belongs_to_empresa(uuid, uuid) from public, anon, authenticated;
grant execute on function public.zelochat_actor_belongs_to_empresa(uuid, uuid) to service_role;

create or replace function public.zelochat_conversation_control_rollout_gate()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- ROLLING DEPLOY GATE: this transaction-level advisory lock is deliberately
  -- global while legacy auto_reply writers and the compatibility bridge coexist.
  -- It serializes conversation-control RPCs with relevant zelochat_sessions
  -- INSERT/UPDATE statements before PostgreSQL takes arbitrary row locks.
  perform pg_advisory_xact_lock(
    hashtextextended('zelochat:conversation_control:rollout_gate:v1', 0)
  );
end;
$$;

revoke all on function public.zelochat_conversation_control_rollout_gate() from public, anon, authenticated;
grant execute on function public.zelochat_conversation_control_rollout_gate() to service_role;

create or replace function public.zelochat_project_conversation_control(
  p_empresa_id uuid,
  p_conversation_control_id uuid,
  p_auto_reply boolean,
  p_changed_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous text := current_setting('zelochat.projecting_control', true);
begin
  perform public.zelochat_conversation_control_rollout_gate();
  perform set_config('zelochat.projecting_control', '1', true);

  update public.zelochat_sessions s
     set auto_reply = p_auto_reply,
         updated_at = p_changed_at
   where s.empresa_id = p_empresa_id
     and s.conversation_control_id = p_conversation_control_id
     and s.auto_reply is distinct from p_auto_reply;

  perform set_config('zelochat.projecting_control', coalesce(v_previous, ''), true);
end;
$$;

revoke all on function public.zelochat_project_conversation_control(uuid, uuid, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.zelochat_project_conversation_control(uuid, uuid, boolean, timestamptz) to service_role;

create or replace function public.zelochat_lock_conversation_session_family(
  p_empresa_id uuid,
  p_remote_jid text,
  p_canonical_pessoa_id uuid,
  p_contact_key text,
  p_conversation_control_id uuid default null,
  p_identity_keys text[] default array[]::text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.zelochat_conversation_control_rollout_gate();

  -- LOCK ORDER STEP 1: session rows are the first durable locks for every
  -- conversation-control path. The legacy AFTER UPDATE bridge already starts
  -- with the touched session row locked by PostgreSQL; the statement-level
  -- rollout gate above is what prevents competing paths from entering with an
  -- arbitrary row lock before this deterministic family lock.
  perform 1
  from (
    select s.id
    from public.zelochat_sessions s
    where s.empresa_id = p_empresa_id
      and (
        s.remote_jid = p_remote_jid
        or (p_canonical_pessoa_id is not null and s.pessoa_id = p_canonical_pessoa_id)
        or (
          p_contact_key is not null
          and public.zelochat_conversation_identity_key(null, s.customer_phone, s.remote_jid) = p_contact_key
        )
        or (
          p_conversation_control_id is not null
          and s.conversation_control_id = p_conversation_control_id
        )
        or (
          coalesce(array_length(p_identity_keys, 1), 0) > 0
          and s.conversation_control_id in (
            select c.id
            from public.zelochat_conversation_ai_control c
            where c.empresa_id = p_empresa_id
              and c.identity_key = any(p_identity_keys)
          )
        )
      )
    order by s.id
    for update
  ) locked_sessions;
end;
$$;

revoke all on function public.zelochat_lock_conversation_session_family(uuid, text, uuid, text, uuid, text[]) from public, anon, authenticated;
grant execute on function public.zelochat_lock_conversation_session_family(uuid, text, uuid, text, uuid, text[]) to service_role;

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
  v_target_pessoa_id uuid;
  v_target_control_id uuid;
  v_canonical_pessoa_id uuid;
  v_target_contact_key text;
  v_identity_key text;
  v_identity_keys text[] := array[]::text[];
  v_existing_control_id uuid;
  v_winner_control_id uuid;
  v_duplicate_control_ids uuid[] := array[]::uuid[];
  v_duplicate_count integer := 0;
  v_any_human boolean := false;
  v_next_epoch bigint := 0;
  v_now timestamptz := now();
begin
  perform public.zelochat_conversation_control_rollout_gate();

  if p_empresa_id is null or nullif(trim(coalesce(p_remote_jid, '')), '') is null then
    raise exception 'INVALID_CONVERSATION_CONTROL_ARGUMENTS';
  end if;

  select
    s.pessoa_id,
    s.conversation_control_id,
    public.zelochat_conversation_identity_key(null, s.customer_phone, s.remote_jid)
    into v_target_pessoa_id, v_target_control_id, v_target_contact_key
  from public.zelochat_sessions s
  where s.empresa_id = p_empresa_id
    and s.remote_jid = p_remote_jid
  order by s.updated_at desc
  limit 1;

  v_target_contact_key := coalesce(
    v_target_contact_key,
    public.zelochat_conversation_identity_key(null, null, p_remote_jid)
  );

  select coalesce(v_target_pessoa_id, (
    select s.pessoa_id
    from public.zelochat_sessions s
    where s.empresa_id = p_empresa_id
      and s.pessoa_id is not null
      and public.zelochat_conversation_identity_key(null, s.customer_phone, s.remote_jid) = v_target_contact_key
    order by s.updated_at desc
    limit 1
  ))
    into v_canonical_pessoa_id;

  v_identity_key := case
    when v_canonical_pessoa_id is not null then 'person:' || v_canonical_pessoa_id::text
    else v_target_contact_key
  end;

  select coalesce(array_agg(distinct identity_key order by identity_key), array[]::text[])
    into v_identity_keys
  from (
    select v_identity_key as identity_key
    union
    select v_target_contact_key as identity_key
    union
    select public.zelochat_conversation_identity_key(s.pessoa_id, s.customer_phone, s.remote_jid) as identity_key
    from public.zelochat_sessions s
    where s.empresa_id = p_empresa_id
      and (
        s.remote_jid = p_remote_jid
        or (v_canonical_pessoa_id is not null and s.pessoa_id = v_canonical_pessoa_id)
        or public.zelochat_conversation_identity_key(null, s.customer_phone, s.remote_jid) = v_target_contact_key
      )
    union
    select public.zelochat_conversation_identity_key(null, s.customer_phone, s.remote_jid) as identity_key
    from public.zelochat_sessions s
    where s.empresa_id = p_empresa_id
      and (
        s.remote_jid = p_remote_jid
        or (v_canonical_pessoa_id is not null and s.pessoa_id = v_canonical_pessoa_id)
        or public.zelochat_conversation_identity_key(null, s.customer_phone, s.remote_jid) = v_target_contact_key
      )
  ) identities
  where identity_key is not null;

  -- LOCK ORDER: sessions -> identity advisory -> controls.
  perform public.zelochat_lock_conversation_session_family(
    p_empresa_id,
    p_remote_jid,
    v_canonical_pessoa_id,
    v_target_contact_key,
    v_target_control_id,
    v_identity_keys
  );

  -- LOCK ORDER STEP 2: identity advisory locks are taken only after the
  -- canonical family sessions have been locked, and always in sorted order.
  for v_identity_key in
    select unnest(v_identity_keys) order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || ':' || v_identity_key, 0));
  end loop;

  v_identity_key := case
    when v_canonical_pessoa_id is not null then 'person:' || v_canonical_pessoa_id::text
    else v_target_contact_key
  end;

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
          and (
            s.remote_jid = p_remote_jid
            or (v_canonical_pessoa_id is not null and s.pessoa_id = v_canonical_pessoa_id)
            or public.zelochat_conversation_identity_key(null, s.customer_phone, s.remote_jid) = v_target_contact_key
          )
          and coalesce(s.auto_reply, true) = false
      ) then 'human'
      else 'ai'
    end,
    0,
    'ensure',
    v_now
  )
  on conflict (empresa_id, identity_key) do nothing;

  select c.id
    into v_existing_control_id
  from public.zelochat_conversation_ai_control c
  where c.empresa_id = p_empresa_id
    and c.identity_key = v_identity_key;

  select coalesce(array_agg(distinct id order by id), array[]::uuid[])
    into v_duplicate_control_ids
  from (
    select v_existing_control_id as id
    union
    select c.id
    from public.zelochat_conversation_ai_control c
    where c.empresa_id = p_empresa_id
      and c.identity_key = any(v_identity_keys)
    union
    select s.conversation_control_id as id
    from public.zelochat_sessions s
    where s.empresa_id = p_empresa_id
      and s.conversation_control_id is not null
      and (
        s.remote_jid = p_remote_jid
        or (v_canonical_pessoa_id is not null and s.pessoa_id = v_canonical_pessoa_id)
        or public.zelochat_conversation_identity_key(null, s.customer_phone, s.remote_jid) = v_target_contact_key
      )
  ) candidates
  where id is not null;

  select count(*)
    into v_duplicate_count
  from unnest(v_duplicate_control_ids) as ids(id);

  -- LOCK ORDER STEP 3: control rows are locked last, in deterministic order,
  -- before choosing the winner.
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
      and (
        s.remote_jid = p_remote_jid
        or (v_canonical_pessoa_id is not null and s.pessoa_id = v_canonical_pessoa_id)
        or public.zelochat_conversation_identity_key(null, s.customer_phone, s.remote_jid) = v_target_contact_key
      )
      and coalesce(s.auto_reply, true) = false
  );

  if v_duplicate_count > 1 then
    v_next_epoch := v_next_epoch + 1;

    update public.zelochat_outbound_jobs j
       set status = 'delivery_uncertain',
           suppression_reason = 'controls_merged_active_job',
           lease_owner = null,
           lease_expires_at = null,
           updated_at = v_now
     where j.empresa_id = p_empresa_id
       and j.conversation_control_id = any(v_duplicate_control_ids)
       and j.conversation_control_id <> v_winner_control_id
       and j.status in ('sending','dispatch_started');

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

  perform set_config('zelochat.projecting_control', '1', true);

  update public.zelochat_sessions s
     set conversation_control_id = v_winner_control_id,
         auto_reply = not v_any_human,
         updated_at = v_now
   where s.empresa_id = p_empresa_id
     and (
       s.remote_jid = p_remote_jid
       or (v_canonical_pessoa_id is not null and s.pessoa_id = v_canonical_pessoa_id)
       or public.zelochat_conversation_identity_key(null, s.customer_phone, s.remote_jid) = v_target_contact_key
     )
     and (
       s.conversation_control_id is distinct from v_winner_control_id
       or s.auto_reply is distinct from not v_any_human
     );

  perform set_config('zelochat.projecting_control', '', true);

  if v_any_human then
    update public.zelochat_outbound_jobs j
       set status = 'cancelled',
           suppression_reason = 'human_takeover',
           updated_at = v_now
     where j.empresa_id = p_empresa_id
       and j.conversation_control_id = v_winner_control_id
       and j.status = 'queued'
       and j.outbound_origin in ('ai_auto','ai_followup');
  end if;

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
  perform public.zelochat_conversation_control_rollout_gate();

  if p_message_id is null then
    raise exception 'INVALID_AI_TURN_MESSAGE_ID';
  end if;
  if not exists (
    select 1
    from public.zelochat_messages m
    where m.empresa_id = p_empresa_id
      and m.id = p_message_id
  ) then
    raise exception 'MESSAGE_NOT_IN_TENANT';
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
  perform public.zelochat_conversation_control_rollout_gate();

  if p_source not in ('zelochat_operator','native_whatsapp','explicit_manual_toggle','escalation') then
    raise exception 'INVALID_TAKEOVER_SOURCE';
  end if;
  if not public.zelochat_actor_belongs_to_empresa(p_empresa_id, p_actor_user_id) then
    raise exception 'ACTOR_NOT_IN_TENANT';
  end if;
  if p_message_id is not null and not exists (
    select 1
    from public.zelochat_messages m
    where m.empresa_id = p_empresa_id
      and m.id = p_message_id
  ) then
    raise exception 'MESSAGE_NOT_IN_TENANT';
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
  perform public.zelochat_conversation_control_rollout_gate();

  if p_actor_user_id is null then
    raise exception 'INVALID_RESUME_ACTOR';
  end if;
  if not public.zelochat_actor_belongs_to_empresa(p_empresa_id, p_actor_user_id) then
    raise exception 'ACTOR_NOT_IN_TENANT';
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
  perform public.zelochat_conversation_control_rollout_gate();

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

create or replace function public.zelochat_conversation_control_session_statement_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- ROLLING DEPLOY GATE: BEFORE STATEMENT fires before PostgreSQL visits and
  -- locks arbitrary session rows, so legacy direct writes join the same
  -- serialization point as the RPCs before the AFTER ROW bridge runs.
  perform public.zelochat_conversation_control_rollout_gate();
  return null;
end;
$$;

revoke all on function public.zelochat_conversation_control_session_statement_gate() from public, anon, authenticated;
grant execute on function public.zelochat_conversation_control_session_statement_gate() to service_role;

create or replace function public.zelochat_conversation_control_session_bridge()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_control public.zelochat_conversation_ai_control%rowtype;
  v_now timestamptz := now();
begin
  if current_setting('zelochat.projecting_control', true) = '1' then
    return null;
  end if;

  if TG_OP = 'INSERT' then
    perform public.ensure_zelochat_conversation_control(NEW.empresa_id, NEW.remote_jid);
    return null;
  end if;

  if NEW.conversation_control_id is null
     or NEW.remote_jid is distinct from OLD.remote_jid
     or NEW.pessoa_id is distinct from OLD.pessoa_id
     or NEW.customer_phone is distinct from OLD.customer_phone then
    perform public.ensure_zelochat_conversation_control(NEW.empresa_id, NEW.remote_jid);
    return null;
  end if;

  if TG_OP = 'UPDATE' and NEW.auto_reply is distinct from OLD.auto_reply then
    -- LOCK ORDER: bridge already holds NEW's session row from the triggering
    -- UPDATE; lock the rest of the projected family before reading/updating the
    -- canonical control so rolling deploy paths all move session -> control.
    perform public.zelochat_lock_conversation_session_family(
      NEW.empresa_id,
      NEW.remote_jid,
      NEW.pessoa_id,
      public.zelochat_conversation_identity_key(null, NEW.customer_phone, NEW.remote_jid),
      NEW.conversation_control_id,
      array[]::text[]
    );

    select *
      into v_control
    from public.zelochat_conversation_ai_control c
    where c.empresa_id = NEW.empresa_id
      and c.id = NEW.conversation_control_id
    for update;

    if not found then
      perform public.ensure_zelochat_conversation_control(NEW.empresa_id, NEW.remote_jid);
      return null;
    end if;

    if NEW.auto_reply = false and v_control.mode <> 'human' then
      update public.zelochat_conversation_ai_control c
         set mode = 'human',
             epoch = c.epoch + 1,
             changed_by_actor = null,
             changed_source = 'legacy_auto_reply_update',
             changed_at = v_now
       where c.empresa_id = NEW.empresa_id
         and c.id = NEW.conversation_control_id
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
        NEW.empresa_id,
        NEW.conversation_control_id,
        NEW.remote_jid,
        'human_takeover',
        v_control.epoch,
        null,
        'legacy_auto_reply_update',
        null
      );

      update public.zelochat_outbound_jobs j
         set status = 'cancelled',
             suppression_reason = 'human_takeover',
             updated_at = v_now
       where j.empresa_id = NEW.empresa_id
         and j.conversation_control_id = NEW.conversation_control_id
         and j.status = 'queued'
         and j.outbound_origin in ('ai_auto','ai_followup');
    elsif NEW.auto_reply = true and v_control.mode <> 'ai' then
      update public.zelochat_conversation_ai_control c
         set mode = 'ai',
             epoch = c.epoch + 1,
             changed_by_actor = null,
             changed_source = 'legacy_auto_reply_update',
             changed_at = v_now
       where c.empresa_id = NEW.empresa_id
         and c.id = NEW.conversation_control_id
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
        NEW.empresa_id,
        NEW.conversation_control_id,
        NEW.remote_jid,
        'ai_resumed',
        v_control.epoch,
        null,
        'legacy_auto_reply_update',
        null
      );
    end if;

    perform public.zelochat_project_conversation_control(
      NEW.empresa_id,
      NEW.conversation_control_id,
      coalesce(NEW.auto_reply, true),
      v_now
    );
  end if;

  return null;
end;
$$;

revoke all on function public.zelochat_conversation_control_session_bridge() from public, anon, authenticated;
grant execute on function public.zelochat_conversation_control_session_bridge() to service_role;

drop trigger if exists trg_zelochat_conversation_control_session_statement_gate
  on public.zelochat_sessions;

create trigger trg_zelochat_conversation_control_session_statement_gate
before insert or update of auto_reply, pessoa_id, customer_phone, remote_jid, conversation_control_id
on public.zelochat_sessions
for each statement
execute function public.zelochat_conversation_control_session_statement_gate();

drop trigger if exists trg_zelochat_conversation_control_session_bridge
  on public.zelochat_sessions;

create trigger trg_zelochat_conversation_control_session_bridge
after insert or update of auto_reply, pessoa_id, customer_phone, remote_jid, conversation_control_id
on public.zelochat_sessions
for each row
execute function public.zelochat_conversation_control_session_bridge();

comment on function public.ensure_zelochat_conversation_control(uuid, text) is
  'Resolves/locks the canonical conversation control for one tenant JID, merging duplicates with human mode winning.';
comment on function public.zelochat_conversation_control_rollout_gate() is
  'Temporary rolling-deploy serialization gate. Uses one global transaction advisory lock so RPCs and legacy session writes cannot acquire arbitrary row locks before joining the conversation-control lock order.';
comment on function public.zelochat_conversation_control_session_statement_gate() is
  'BEFORE STATEMENT trigger gate for legacy session INSERT/UPDATE writes; intentionally serializes relevant session writes while the auto_reply compatibility bridge exists.';
comment on function public.pause_zelochat_ai_for_human(uuid, text, uuid, text, uuid) is
  'Atomically switches the canonical conversation to human mode and cancels queued AI jobs for that control.';
comment on function public.resume_zelochat_ai(uuid, text, uuid) is
  'Explicitly resumes AI for a canonical conversation and advances epoch; old jobs are never restored.';
comment on function public.advance_zelochat_ai_epoch_for_inbound(uuid, text, uuid) is
  'Starts a deduplicated inbound AI generation by advancing epoch only for a new inbound message while mode is AI.';
comment on function public.check_zelochat_ai_epoch(uuid, text, bigint) is
  'Fail-closed epoch check used before AI side effects and enqueue.';

commit;
