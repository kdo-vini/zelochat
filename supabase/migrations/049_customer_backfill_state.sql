begin;

create table if not exists public.zelochat_customer_backfill_state (
  empresa_id uuid primary key references public.empresa_perfil(id) on delete cascade,
  cursor text,
  counts jsonb not null default '{"linked":0,"created":0,"incomplete":0,"conflict":0,"failed":0}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.zelochat_customer_backfill_state enable row level security;
revoke all on table public.zelochat_customer_backfill_state from public, anon, authenticated;
grant all on table public.zelochat_customer_backfill_state to service_role;
drop policy if exists zelochat_customer_backfill_state_browser_denied on public.zelochat_customer_backfill_state;
create policy zelochat_customer_backfill_state_browser_denied on public.zelochat_customer_backfill_state
  for all to anon, authenticated using (false) with check (false);

comment on table public.zelochat_customer_backfill_state is
  'Checkpoint server-only do backfill CRM; não dispara mensagens e pode ser retomado com segurança.';
commit;
