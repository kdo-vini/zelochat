begin;

-- Migration 058 split campaign recipients from automation dispatches. Recreate
-- the lease recovery RPC so terminal automation jobs update the dispatch FK,
-- never the campaign-only recipient_id column.
create or replace function public.release_zelochat_expired_leases()
returns integer language plpgsql security invoker set search_path = public, pg_temp as $$
declare terminal_count integer;
begin
  with terminal as (
    update public.zelochat_outbound_jobs
       set status = 'failed', last_error = 'Limite de tentativas atingido após expiração da reserva.',
           lease_owner = null, lease_expires_at = null, updated_at = now()
     where status = 'sending' and lease_expires_at < now() and attempts >= max_attempts
     returning id, recipient_id, automation_dispatch_id, job_type
  ), campaigns as (
    update public.zelochat_campaign_recipients r
       set status = 'failed', last_error = 'Limite de tentativas atingido após expiração da reserva.', updated_at = now()
      from terminal t where t.recipient_id = r.id and t.job_type = 'campaign'
      returning r.id
  ), automations as (
    update public.zelochat_automation_dispatches d
       set status = 'failed', last_error = 'Limite de tentativas atingido após expiração da reserva.', updated_at = now()
      from terminal t where t.automation_dispatch_id = d.id and t.job_type = 'automation'
      returning d.id
  )
  select count(*) into terminal_count from terminal;

  update public.zelochat_outbound_jobs
     set status = 'queued', lease_owner = null, lease_expires_at = null, updated_at = now()
   where status = 'sending' and lease_expires_at < now() and attempts < max_attempts;
  return terminal_count;
end $$;

revoke all on function public.release_zelochat_expired_leases() from public, anon, authenticated;
grant execute on function public.release_zelochat_expired_leases() to service_role;

commit;
