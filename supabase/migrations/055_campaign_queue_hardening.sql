begin;

alter table public.zelochat_outbound_jobs
  add column if not exists instance_key text not null default '';

create index if not exists zelochat_outbound_jobs_instance_due_idx
  on public.zelochat_outbound_jobs (instance_key, status, next_attempt_at);

-- Campaign jobs are claimable only while the campaign is running, or after a
-- scheduled campaign reaches its time. Paused/cancelled campaigns stay queued
-- for audit but cannot be sent. Recipients must still be queued at claim time.
create or replace function public.claim_zelochat_outbound_job(p_worker text, p_lease_seconds integer default 120)
returns setof public.zelochat_outbound_jobs
language sql security invoker set search_path = public, pg_temp
as $$
  with candidate as (
    select j.id
      from public.zelochat_outbound_jobs j
      left join public.zelochat_campaigns c on c.id = j.campaign_id
      left join public.zelochat_campaign_recipients r on r.id = j.recipient_id
     where j.attempts < j.max_attempts
       and ((j.status = 'queued' and j.next_attempt_at <= now())
         or (j.status = 'sending' and j.lease_expires_at < now()))
       and (j.campaign_id is null or (c.status in ('running', 'scheduled') and (c.status = 'running' or c.scheduled_at <= now())))
       and (j.recipient_id is null or j.job_type = 'automation' or r.status in ('queued', 'sending'))
     order by j.next_attempt_at, j.created_at, j.id
     for update of j skip locked limit 1
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
