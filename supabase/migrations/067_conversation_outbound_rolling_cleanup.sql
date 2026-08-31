-- 067_conversation_outbound_rolling_cleanup.sql
-- FORWARD-ONLY cleanup for the canonical outbound engine.
-- Legacy writers must already be migrated because this retires the global
-- idempotency constraint, status='failed', and the compatibility bridge.

begin;

do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'zelochat_outbound_jobs'
       and indexname = 'zelochat_outbound_jobs_empresa_idempotency_key'
  ) then
    raise exception 'TENANT_IDEMPOTENCY_INDEX_MISSING';
  end if;
end
$$;

lock table public.zelochat_outbound_jobs in share row exclusive mode;
lock table public.zelochat_messages in share row exclusive mode;

update public.zelochat_outbound_jobs
   set status = 'failed_before_dispatch',
       updated_at = now()
 where status = 'failed';

update public.zelochat_messages
   set outbound_status = 'failed_before_dispatch'
 where outbound_status = 'failed';

alter table public.zelochat_outbound_jobs
  drop constraint if exists zelochat_outbound_jobs_idempotency_key_key;

alter table public.zelochat_outbound_jobs
  drop constraint if exists zelochat_outbound_jobs_status_check;
alter table public.zelochat_outbound_jobs
  add constraint zelochat_outbound_jobs_status_check
  check (status in ('preparing','queued','sending','dispatch_started','sent','failed_before_dispatch','delivery_uncertain','cancelled'));

alter table public.zelochat_messages
  drop constraint if exists zelochat_messages_outbound_status_check;
alter table public.zelochat_messages
  add constraint zelochat_messages_outbound_status_check
  check (outbound_status is null or outbound_status in ('preparing','queued','sending','dispatch_started','sent','failed_before_dispatch','delivery_uncertain','cancelled'));

drop trigger if exists trg_zelochat_outbound_job_rolling_bridge on public.zelochat_outbound_jobs;
drop function if exists public.zelochat_outbound_job_rolling_bridge();

comment on column public.zelochat_outbound_jobs.idempotency_key is
  'Idempotency is tenant-scoped by (empresa_id, idempotency_key).';
comment on column public.zelochat_outbound_jobs.status is
  'Canonical outbound lifecycle; the rolling legacy failed state is retired.';

commit;
