begin;

create table if not exists public.zelochat_crm_rollout_flags (
  empresa_id uuid primary key references public.empresa_perfil(id) on delete cascade,
  crm_enabled boolean not null default false,
  campaigns_enabled boolean not null default false,
  automations_enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.zelochat_crm_metrics_daily (
  empresa_id uuid not null references public.empresa_perfil(id) on delete cascade,
  metric_date date not null default current_date,
  customers_total integer not null default 0, customers_with_phone integer not null default 0, customers_conflicts integer not null default 0,
  profile_views integer not null default 0, filter_uses integer not null default 0,
  campaigns_created integer not null default 0, campaigns_sent integer not null default 0, campaigns_paused integer not null default 0, campaigns_failed integer not null default 0,
  automations_enabled integer not null default 0, jobs_sent integer not null default 0, jobs_failed integer not null default 0, jobs_suppressed integer not null default 0,
  responses_attributed integer not null default 0, orders_attributed integer not null default 0, optouts integer not null default 0,
  queue_size integer not null default 0, queue_oldest_seconds integer not null default 0, leases_stuck integer not null default 0, disconnected integer not null default 0,
  updated_at timestamptz not null default now(), primary key (empresa_id, metric_date)
);

create or replace function public.increment_zelochat_crm_metric(p_empresa_id uuid, p_metric text, p_value integer)
returns void language plpgsql security definer set search_path = public as $$
declare col text := lower(trim(p_metric));
begin
  if col not in ('customers_total','customers_with_phone','customers_conflicts','profile_views','filter_uses','campaigns_created','campaigns_sent','campaigns_paused','campaigns_failed','automations_enabled','jobs_sent','jobs_failed','jobs_suppressed','responses_attributed','orders_attributed','optouts','queue_size','queue_oldest_seconds','leases_stuck','disconnected') then raise exception 'invalid CRM metric'; end if;
  insert into public.zelochat_crm_metrics_daily (empresa_id, metric_date) values (p_empresa_id, current_date) on conflict do nothing;
  execute format('update public.zelochat_crm_metrics_daily set %I = greatest(0, %I + $1), updated_at = now() where empresa_id = $2 and metric_date = current_date', col, col) using greatest(p_value, 0), p_empresa_id;
end $$;

alter table public.zelochat_crm_rollout_flags enable row level security;
alter table public.zelochat_crm_metrics_daily enable row level security;
revoke all on table public.zelochat_crm_rollout_flags, public.zelochat_crm_metrics_daily from public, anon, authenticated;
grant all on table public.zelochat_crm_rollout_flags, public.zelochat_crm_metrics_daily to service_role;
grant all on table public.zelochat_crm_rollout_flags to service_role;
grant all on table public.zelochat_crm_metrics_daily to service_role;
revoke all on function public.increment_zelochat_crm_metric(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.increment_zelochat_crm_metric(uuid, text, integer) to service_role;

commit;
