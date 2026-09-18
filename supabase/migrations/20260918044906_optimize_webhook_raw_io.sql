-- Bound raw-webhook retention work so a cleanup cannot monopolize Disk IO.
-- This migration intentionally does not perform a one-shot historical delete;
-- the application drains expired rows in small serial batches after deploy.

alter table public.zelochat_webhook_events_raw
  add column if not exists dedupe_fingerprint text;

-- Keep index builds outside a transaction so CONCURRENTLY does not block the
-- webhook write path while production is serving traffic.
create index concurrently if not exists zelochat_webhook_events_raw_processed_retention_idx
  on public.zelochat_webhook_events_raw (processed_at, id)
  where processed_at is not null;

create index concurrently if not exists zelochat_webhook_events_raw_update_stragglers_idx
  on public.zelochat_webhook_events_raw (id)
  where event_type = 'messages.update';

-- Migration 028 and the CRM foundation both created the same activity index.
-- Keep zelochat_sessions_empresa_activity_idx and remove the older, bloated copy.
drop index concurrently if exists public.idx_zelochat_sessions_empresa_updated;

create unique index concurrently if not exists zelochat_webhook_events_raw_message_fingerprint_uidx
  on public.zelochat_webhook_events_raw (empresa_id, event_type, dedupe_fingerprint)
  where event_type = 'messages.upsert' and dedupe_fingerprint is not null;

begin;

create or replace function public.record_zelochat_raw_webhook(
  p_instance text,
  p_empresa_id uuid,
  p_event_type text,
  p_wa_message_id text,
  p_payload jsonb,
  p_auth_status text,
  p_dedupe_fingerprint text default null
)
returns table (id uuid, inserted boolean)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if p_event_type = 'messages.upsert' and p_dedupe_fingerprint is not null then
    insert into public.zelochat_webhook_events_raw (
      instance, empresa_id, event_type, wa_message_id, payload, auth_status, dedupe_fingerprint
    ) values (
      p_instance, p_empresa_id, p_event_type, p_wa_message_id, p_payload, p_auth_status, p_dedupe_fingerprint
    )
    on conflict (empresa_id, event_type, dedupe_fingerprint)
      where event_type = 'messages.upsert' and dedupe_fingerprint is not null
    do nothing
    returning zelochat_webhook_events_raw.id into v_id;

    if v_id is not null then
      return query select v_id, true;
      return;
    end if;

    return query
      select existing.id, false
      from public.zelochat_webhook_events_raw as existing
      where existing.empresa_id = p_empresa_id
        and existing.event_type = p_event_type
        and existing.dedupe_fingerprint = p_dedupe_fingerprint
      limit 1;
    return;
  end if;

  insert into public.zelochat_webhook_events_raw (
    instance, empresa_id, event_type, wa_message_id, payload, auth_status, dedupe_fingerprint
  ) values (
    p_instance, p_empresa_id, p_event_type, p_wa_message_id, p_payload, p_auth_status, null
  ) returning zelochat_webhook_events_raw.id into v_id;

  return query select v_id, true;
end;
$$;

revoke all on function public.record_zelochat_raw_webhook(text, uuid, text, text, jsonb, text, text) from public;
revoke all on function public.record_zelochat_raw_webhook(text, uuid, text, text, jsonb, text, text) from anon;
revoke all on function public.record_zelochat_raw_webhook(text, uuid, text, text, jsonb, text, text) from authenticated;
grant execute on function public.record_zelochat_raw_webhook(text, uuid, text, text, jsonb, text, text) to service_role;

drop function if exists public.zelochat_apply_inbound_session_activity(uuid, text, timestamptz);

create or replace function public.zelochat_apply_inbound_session_activity(
  p_session_id uuid,
  p_last_message text,
  p_last_message_time text
)
returns void
language sql
security invoker
set search_path = pg_catalog, public
as $$
  update public.zelochat_sessions
     set last_message = p_last_message,
         last_message_time = p_last_message_time,
         unread_count = coalesce(unread_count, 0) + 1,
         updated_at = now()
   where id = p_session_id;
$$;

revoke all on function public.zelochat_apply_inbound_session_activity(uuid, text, text) from public;
revoke all on function public.zelochat_apply_inbound_session_activity(uuid, text, text) from anon;
revoke all on function public.zelochat_apply_inbound_session_activity(uuid, text, text) from authenticated;
grant execute on function public.zelochat_apply_inbound_session_activity(uuid, text, text) to service_role;

create or replace function public.purge_zelochat_webhook_events_raw_batch(
  p_processed_before timestamptz,
  p_unprocessed_before timestamptz,
  p_batch_size integer default 500
)
returns table (
  processed_deleted integer,
  unprocessed_deleted integer,
  update_stragglers_deleted integer
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_batch_size integer;
begin
  if p_processed_before is null or p_unprocessed_before is null then
    raise exception 'retention cutoffs are required' using errcode = '22004';
  end if;

  v_batch_size := least(greatest(coalesce(p_batch_size, 500), 1), 5000);

  -- Only one retention DELETE may run across all application replicas. A
  -- caller that loses the lock gets an empty result and retries next sweep.
  if not pg_try_advisory_xact_lock(hashtextextended('zelochat_webhook_events_raw_retention', 0)) then
    return query select 0, 0, 0;
    return;
  end if;

  return query
  with update_candidates as materialized (
    select r.id, r.event_type, r.processed_at
      from public.zelochat_webhook_events_raw as r
     where r.event_type = 'messages.update'
     order by r.id
     for update skip locked
     limit v_batch_size
  ), processed_candidates as materialized (
    select r.id, r.event_type, r.processed_at
      from public.zelochat_webhook_events_raw as r
     where r.event_type is distinct from 'messages.update'
       and r.processed_at < p_processed_before
     order by r.processed_at, r.id
     for update skip locked
     limit greatest(v_batch_size - (select count(*) from update_candidates), 0)
  ), unprocessed_candidates as materialized (
    select r.id, r.event_type, r.processed_at
      from public.zelochat_webhook_events_raw as r
     where r.event_type is distinct from 'messages.update'
       and r.processed_at is null
       and r.received_at < p_unprocessed_before
     order by r.received_at
     for update skip locked
     limit greatest(
       v_batch_size
         - (select count(*) from update_candidates)
         - (select count(*) from processed_candidates),
       0
     )
  ), candidates as materialized (
    select * from update_candidates
    union all
    select * from processed_candidates
    union all
    select * from unprocessed_candidates
  ), deleted as (
    delete from public.zelochat_webhook_events_raw as target
     using candidates
     where target.id = candidates.id
    returning candidates.event_type, candidates.processed_at
  )
  select
    count(*) filter (
      where deleted.event_type is distinct from 'messages.update'
        and deleted.processed_at is not null
    )::integer,
    count(*) filter (
      where deleted.event_type is distinct from 'messages.update'
        and deleted.processed_at is null
    )::integer,
    count(*) filter (where deleted.event_type = 'messages.update')::integer
  from deleted;
end;
$$;

comment on function public.purge_zelochat_webhook_events_raw_batch(timestamptz, timestamptz, integer) is
  'Deletes one bounded raw-webhook retention batch. Serialized globally with an advisory xact lock.';

revoke all on function public.purge_zelochat_webhook_events_raw_batch(timestamptz, timestamptz, integer) from public;
revoke all on function public.purge_zelochat_webhook_events_raw_batch(timestamptz, timestamptz, integer) from anon;
revoke all on function public.purge_zelochat_webhook_events_raw_batch(timestamptz, timestamptz, integer) from authenticated;
grant execute on function public.purge_zelochat_webhook_events_raw_batch(timestamptz, timestamptz, integer) to service_role;

commit;
