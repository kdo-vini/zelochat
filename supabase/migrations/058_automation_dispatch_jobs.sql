begin;

alter table public.zelochat_outbound_jobs
  add column if not exists automation_dispatch_id uuid references public.zelochat_automation_dispatches(id) on delete set null;
create index if not exists zelochat_outbound_jobs_automation_dispatch_idx
  on public.zelochat_outbound_jobs (automation_dispatch_id) where automation_dispatch_id is not null;
comment on column public.zelochat_outbound_jobs.recipient_id is 'Campaign recipient only; automation jobs use automation_dispatch_id.';

commit;
