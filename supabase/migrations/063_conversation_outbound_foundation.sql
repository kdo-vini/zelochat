begin;

-- Foundation for canonical conversation control and durable conversational
-- outbound. This migration is intentionally additive: legacy auto_reply,
-- message lifecycle values, and the global outbound idempotency constraint
-- remain in place during rolling deploy.

do $$
begin
  if to_regclass('public.zelochat_conversation_ai_control') is null then
    execute $sql$
      create table public.zelochat_conversation_ai_control (
        id uuid primary key default gen_random_uuid(),
        empresa_id uuid not null references public.empresa_perfil(id) on delete cascade,
        identity_key text not null,
        mode text not null default 'ai' check (mode in ('ai','human')),
        epoch bigint not null default 0 check (epoch >= 0),
        hold_reason text,
        hold_job_id uuid,
        latest_inbound_message_id uuid references public.zelochat_messages(id) on delete set null,
        latest_takeover_message_id uuid references public.zelochat_messages(id) on delete set null,
        changed_by_actor uuid references auth.users(id) on delete set null,
        changed_source text not null default 'bootstrap',
        changed_at timestamptz not null default now(),
        unique (empresa_id, identity_key)
      );
    $sql$;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.zelochat_conversation_ai_control'::regclass
       and conname = 'zelochat_conversation_ai_control_empresa_id_id_key'
  ) then
    alter table public.zelochat_conversation_ai_control
      add constraint zelochat_conversation_ai_control_empresa_id_id_key
      unique (empresa_id, id);
  end if;
end
$$;

create index if not exists zelochat_conversation_ai_control_empresa_mode_idx
  on public.zelochat_conversation_ai_control (empresa_id, mode, changed_at desc);

comment on table public.zelochat_conversation_ai_control is
  'Canonical tenant-scoped AI/manual conversation mode; auto_reply remains the legacy session projection during rolling deploy.';

create or replace function public.zelochat_conversation_identity_key(
  p_pessoa_id uuid,
  p_customer_phone text,
  p_remote_jid text
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  normalized text := regexp_replace(
    coalesce(nullif(trim(p_customer_phone), ''), split_part(coalesce(p_remote_jid, ''), '@', 1)),
    '\D',
    '',
    'g'
  );
  fallback_value text := lower(trim(coalesce(p_remote_jid, p_customer_phone, '')));
begin
  if p_pessoa_id is not null then
    return 'person:' || p_pessoa_id::text;
  end if;

  if normalized like '55%' and char_length(normalized) >= 12 then
    normalized := substr(normalized, 3);
  end if;

  if char_length(normalized) = 11 and substr(normalized, 3, 1) = '9' then
    normalized := substr(normalized, 1, 2) || substr(normalized, 4);
  end if;

  if normalized <> '' then
    return 'phone:' || normalized;
  end if;

  return 'phone:' || coalesce(nullif(fallback_value, ''), 'unknown');
end;
$$;

revoke all on function public.zelochat_conversation_identity_key(uuid, text, text) from public, anon, authenticated;
grant execute on function public.zelochat_conversation_identity_key(uuid, text, text) to service_role;

do $$
begin
  if to_regclass('public.zelochat_conversation_control_events') is null then
    execute $sql$
      create table public.zelochat_conversation_control_events (
        id uuid primary key default gen_random_uuid(),
        empresa_id uuid not null,
        conversation_control_id uuid not null,
        remote_jid text,
        event_type text not null,
        epoch bigint not null check (epoch >= 0),
        actor_user_id uuid references auth.users(id) on delete set null,
        source text not null,
        message_id uuid references public.zelochat_messages(id) on delete set null,
        job_id uuid,
        created_at timestamptz not null default now(),
        constraint zelochat_conversation_control_events_control_fk
          foreign key (empresa_id, conversation_control_id)
          references public.zelochat_conversation_ai_control(empresa_id, id)
          on update cascade on delete cascade
      );
    $sql$;
  end if;
end
$$;

create index if not exists zelochat_conversation_control_events_control_created_idx
  on public.zelochat_conversation_control_events (conversation_control_id, created_at desc);

create index if not exists zelochat_conversation_control_events_empresa_created_idx
  on public.zelochat_conversation_control_events (empresa_id, created_at desc);

comment on table public.zelochat_conversation_control_events is
  'Server-only audit trail for takeover, resume, suppression and future control merges.';

alter table public.zelochat_messages
  add column if not exists outbound_origin text,
  add column if not exists outbound_actor_user_id uuid references auth.users(id) on delete set null,
  add column if not exists outbound_job_id uuid;

alter table public.zelochat_messages
  drop constraint if exists zelochat_messages_outbound_status_check;

alter table public.zelochat_messages
  add constraint zelochat_messages_outbound_status_check
  check (
    outbound_status is null
    or outbound_status in (
      'preparing',
      'queued',
      'sending',
      'dispatch_started',
      'sent',
      'failed_before_dispatch',
      'delivery_uncertain',
      'failed',
      'cancelled'
    )
  );

alter table public.zelochat_messages
  drop constraint if exists zelochat_messages_outbound_origin_check;

alter table public.zelochat_messages
  add constraint zelochat_messages_outbound_origin_check
  check (
    outbound_origin is null
    or outbound_origin in (
      'human_zelochat',
      'human_native_whatsapp',
      'ai_auto',
      'ai_followup',
      'system_handoff',
      'system_transactional',
      'campaign',
      'automation',
      'internal_system'
    )
  );

create index if not exists idx_zelochat_messages_outbound_job_id
  on public.zelochat_messages (outbound_job_id)
  where outbound_job_id is not null;

create index if not exists idx_zelochat_messages_outbound_origin
  on public.zelochat_messages (empresa_id, outbound_origin, sent_at desc)
  where outbound_origin is not null;

comment on column public.zelochat_messages.outbound_status is
  'Durable lifecycle for operator, AI and system sends. Legacy failed stays accepted during rolling deploy only.';

comment on column public.zelochat_messages.outbound_origin is
  'Stable origin discriminator for conversational, transactional and CRM outbound.';

alter table public.zelochat_sessions
  add column if not exists conversation_control_id uuid;

with session_families as (
  select
    s.empresa_id,
    public.zelochat_conversation_identity_key(s.pessoa_id, s.customer_phone, s.remote_jid) as identity_key,
    bool_or(not coalesce(s.auto_reply, true)) as any_manual_projection,
    max(s.updated_at) as changed_at
  from public.zelochat_sessions s
  group by
    s.empresa_id,
    public.zelochat_conversation_identity_key(s.pessoa_id, s.customer_phone, s.remote_jid)
)
insert into public.zelochat_conversation_ai_control (
  empresa_id,
  identity_key,
  mode,
  epoch,
  changed_source,
  changed_at
)
select
  f.empresa_id,
  f.identity_key,
  case when f.any_manual_projection then 'human' else 'ai' end,
  0,
  'bootstrap',
  coalesce(f.changed_at, now())
from session_families f
on conflict (empresa_id, identity_key) do update
set mode = case
             when public.zelochat_conversation_ai_control.mode = 'human' or excluded.mode = 'human' then 'human'
             else 'ai'
           end,
    epoch = greatest(public.zelochat_conversation_ai_control.epoch, excluded.epoch),
    changed_at = greatest(public.zelochat_conversation_ai_control.changed_at, excluded.changed_at);

update public.zelochat_sessions s
   set conversation_control_id = c.id,
       auto_reply = (c.mode = 'ai')
  from public.zelochat_conversation_ai_control c
 where c.empresa_id = s.empresa_id
   and c.identity_key = public.zelochat_conversation_identity_key(s.pessoa_id, s.customer_phone, s.remote_jid)
   and (
     s.conversation_control_id is distinct from c.id
     or s.auto_reply is distinct from (c.mode = 'ai')
   );

do $$
begin
  if exists (
    select 1
      from public.zelochat_sessions
     where conversation_control_id is null
  ) then
    raise exception 'PRECONDITION_FAILED: zelochat_sessions missing conversation_control_id after backfill';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.zelochat_sessions'::regclass
       and conname = 'zelochat_sessions_conversation_control_fk'
  ) then
    alter table public.zelochat_sessions
      add constraint zelochat_sessions_conversation_control_fk
      foreign key (empresa_id, conversation_control_id)
      references public.zelochat_conversation_ai_control(empresa_id, id)
      on update cascade on delete restrict;
  end if;
end
$$;

create index if not exists zelochat_sessions_conversation_control_idx
  on public.zelochat_sessions (conversation_control_id);

comment on column public.zelochat_sessions.conversation_control_id is
  'Canonical conversation family id. Backfilled for existing rows in migration 063, but left nullable for rolling deploy because legacy ensureSession writers do not set it until Task 3 / migration 064. auto_reply remains the compatibility projection.';

alter table public.zelochat_outbound_jobs
  add column if not exists conversation_control_id uuid,
  add column if not exists conversation_jid text,
  add column if not exists message_id uuid,
  add column if not exists outbound_origin text,
  add column if not exists takeover_policy text,
  add column if not exists payload jsonb,
  add column if not exists payload_fingerprint text,
  add column if not exists control_epoch bigint,
  add column if not exists transport_started_at timestamptz,
  add column if not exists suppression_reason text;

alter table public.zelochat_outbound_jobs
  drop constraint if exists zelochat_outbound_jobs_job_type_check;

alter table public.zelochat_outbound_jobs
  add constraint zelochat_outbound_jobs_job_type_check
  check (job_type in ('campaign', 'automation', 'conversation'));

alter table public.zelochat_outbound_jobs
  drop constraint if exists zelochat_outbound_jobs_status_check;

alter table public.zelochat_outbound_jobs
  add constraint zelochat_outbound_jobs_status_check
  check (
    status in (
      'preparing',
      'queued',
      'sending',
      'dispatch_started',
      'sent',
      'failed_before_dispatch',
      'delivery_uncertain',
      'failed',
      'cancelled'
    )
  );

alter table public.zelochat_outbound_jobs
  drop constraint if exists zelochat_outbound_jobs_outbound_origin_check;

alter table public.zelochat_outbound_jobs
  add constraint zelochat_outbound_jobs_outbound_origin_check
  check (
    outbound_origin is null
    or outbound_origin in (
      'human_zelochat',
      'human_native_whatsapp',
      'ai_auto',
      'ai_followup',
      'system_handoff',
      'system_transactional',
      'campaign',
      'automation',
      'internal_system'
    )
  );

alter table public.zelochat_outbound_jobs
  drop constraint if exists zelochat_outbound_jobs_takeover_policy_check;

alter table public.zelochat_outbound_jobs
  add constraint zelochat_outbound_jobs_takeover_policy_check
  check (
    takeover_policy is null
    or takeover_policy in ('take_over', 'preserve_ai')
  );

alter table public.zelochat_outbound_jobs
  drop constraint if exists zelochat_outbound_jobs_control_epoch_check;

alter table public.zelochat_outbound_jobs
  add constraint zelochat_outbound_jobs_control_epoch_check
  check (control_epoch is null or control_epoch >= 0);

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.zelochat_messages'::regclass
       and conname = 'zelochat_messages_outbound_job_id_fkey'
  ) then
    alter table public.zelochat_messages
      add constraint zelochat_messages_outbound_job_id_fkey
      foreign key (outbound_job_id)
      references public.zelochat_outbound_jobs(id)
      on delete set null;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.zelochat_outbound_jobs'::regclass
       and conname = 'zelochat_outbound_jobs_conversation_control_fk'
  ) then
    alter table public.zelochat_outbound_jobs
      add constraint zelochat_outbound_jobs_conversation_control_fk
      foreign key (empresa_id, conversation_control_id)
      references public.zelochat_conversation_ai_control(empresa_id, id)
      on update cascade on delete restrict;
  end if;
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.zelochat_outbound_jobs'::regclass
       and conname = 'zelochat_outbound_jobs_message_id_fkey'
  ) then
    alter table public.zelochat_outbound_jobs
      add constraint zelochat_outbound_jobs_message_id_fkey
      foreign key (message_id)
      references public.zelochat_messages(id)
      on delete set null;
  end if;
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.zelochat_conversation_ai_control'::regclass
       and conname = 'zelochat_conversation_ai_control_hold_job_fk'
  ) then
    alter table public.zelochat_conversation_ai_control
      add constraint zelochat_conversation_ai_control_hold_job_fk
      foreign key (hold_job_id)
      references public.zelochat_outbound_jobs(id)
      on delete set null;
  end if;
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.zelochat_conversation_control_events'::regclass
       and conname = 'zelochat_conversation_control_events_job_id_fkey'
  ) then
    alter table public.zelochat_conversation_control_events
      add constraint zelochat_conversation_control_events_job_id_fkey
      foreign key (job_id)
      references public.zelochat_outbound_jobs(id)
      on delete set null;
  end if;
end
$$;

create index if not exists zelochat_outbound_jobs_conversation_due_idx
  on public.zelochat_outbound_jobs (conversation_control_id, status, next_attempt_at)
  where conversation_control_id is not null;

create unique index if not exists zelochat_outbound_jobs_empresa_idempotency_key
  on public.zelochat_outbound_jobs (empresa_id, idempotency_key);

create unique index if not exists zelochat_outbound_jobs_one_sending_conversation
  on public.zelochat_outbound_jobs (conversation_control_id)
  where status in ('sending','dispatch_started') and conversation_control_id is not null;

create unique index if not exists zelochat_outbound_jobs_message_unique
  on public.zelochat_outbound_jobs (message_id)
  where message_id is not null;

update public.zelochat_outbound_jobs
   set outbound_origin = case
                           when job_type = 'automation' then 'automation'
                           else 'campaign'
                         end,
       takeover_policy = coalesce(takeover_policy, 'preserve_ai'),
       payload = coalesce(payload, jsonb_build_object('kind', 'text', 'text', message))
 where job_type in ('campaign', 'automation')
   and (
     outbound_origin is null
     or takeover_policy is null
     or payload is null
   );

comment on column public.zelochat_outbound_jobs.idempotency_key is
  'Legacy global unique remains active during rolling deploy; new tenant-scoped uniqueness is additive until cleanup migration removes the global constraint.';

comment on column public.zelochat_outbound_jobs.status is
  'Canonical outbound lifecycle. Legacy failed remains accepted only while old replicas still write it.';

comment on column public.zelochat_outbound_jobs.payload is
  'Conversation payload ledger. Never persist Data URL bytes here; media must reference immutable storage paths.';

alter table public.zelochat_conversation_ai_control enable row level security;
alter table public.zelochat_conversation_control_events enable row level security;

revoke all on table public.zelochat_conversation_ai_control, public.zelochat_conversation_control_events from public, anon, authenticated;
grant all on table public.zelochat_conversation_ai_control, public.zelochat_conversation_control_events to service_role;

commit;
