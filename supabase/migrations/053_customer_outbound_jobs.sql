begin;

create table if not exists public.zelochat_outbound_jobs (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa_perfil(id) on delete cascade,
  campaign_id uuid references public.zelochat_campaigns(id) on delete set null,
  recipient_id uuid references public.zelochat_campaign_recipients(id) on delete set null,
  pessoa_id uuid,
  job_type text not null default 'campaign' check (job_type in ('campaign','automation')),
  idempotency_key text not null unique,
  phone_snapshot text,
  message text not null check (length(message) between 1 and 4096),
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists zelochat_outbound_jobs_due_idx on public.zelochat_outbound_jobs (empresa_id, status, next_attempt_at);
create index if not exists zelochat_outbound_jobs_lease_idx on public.zelochat_outbound_jobs (status, lease_expires_at);
alter table public.zelochat_outbound_jobs enable row level security;
revoke all on table public.zelochat_outbound_jobs from public, anon, authenticated;
grant all on table public.zelochat_outbound_jobs to service_role;

-- Atomic claim: expired leases become available again and only one worker gets
-- each row. The worker still enforces one active sender per WhatsApp instance.
create or replace function public.claim_zelochat_outbound_job(p_worker text, p_lease_seconds integer default 120)
returns setof public.zelochat_outbound_jobs
language sql security invoker set search_path = public, pg_temp
as $$
  with candidate as (
    select id from public.zelochat_outbound_jobs
     where (status = 'queued' and next_attempt_at <= now())
        or (status = 'sending' and lease_expires_at < now())
     order by next_attempt_at, created_at, id
     for update skip locked limit 1
  )
  update public.zelochat_outbound_jobs j
     set status = 'sending', lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 15)),
         attempts = j.attempts + 1, updated_at = now()
    from candidate c where j.id = c.id returning j.*;
$$;
revoke all on function public.claim_zelochat_outbound_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_zelochat_outbound_job(text, integer) to service_role;

commit;
