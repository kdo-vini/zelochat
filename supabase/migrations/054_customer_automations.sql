begin;

create table if not exists public.zelochat_automation_rules (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa_perfil(id) on delete cascade,
  id_usuario uuid not null,
  kind text not null check (kind in ('birthday','reactivation','post_purchase','vip','abandoned_cart')),
  enabled boolean not null default false,
  message text not null default '' check (length(message) <= 4096),
  timezone text not null default 'America/Sao_Paulo' check (timezone = 'America/Sao_Paulo'),
  send_start time not null default '09:00',
  send_end time not null default '20:00',
  config jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zelochat_automation_rules_empresa_owner_fk foreign key (empresa_id, id_usuario)
    references public.empresa_perfil(id, user_id) on delete cascade,
  constraint zelochat_automation_rules_empresa_kind_unique unique (empresa_id, kind),
  constraint zelochat_automation_rules_enabled_message check (not enabled or length(btrim(message)) > 0)
);

create table if not exists public.zelochat_automation_dispatches (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa_perfil(id) on delete cascade,
  rule_id uuid not null references public.zelochat_automation_rules(id) on delete cascade,
  pessoa_id uuid,
  cart_id uuid,
  event_key text not null,
  status text not null default 'eligible' check (status in ('eligible','suppressed','queued','sending','sent','failed','cancelled')),
  message text,
  phone_snapshot text,
  suppression_reason text,
  outbound_job_id uuid references public.zelochat_outbound_jobs(id) on delete set null,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  queued_at timestamptz,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint zelochat_automation_dispatches_event_unique unique (rule_id, event_key)
);

create index if not exists zelochat_automation_rules_empresa_enabled_idx on public.zelochat_automation_rules (empresa_id, enabled, kind);
create index if not exists zelochat_automation_dispatches_empresa_status_idx on public.zelochat_automation_dispatches (empresa_id, status, created_at desc);
create index if not exists zelochat_automation_dispatches_person_idx on public.zelochat_automation_dispatches (empresa_id, pessoa_id, created_at desc);

alter table public.zelochat_automation_rules enable row level security;
alter table public.zelochat_automation_dispatches enable row level security;
revoke all on table public.zelochat_automation_rules, public.zelochat_automation_dispatches from public, anon, authenticated;
grant all on table public.zelochat_automation_rules, public.zelochat_automation_dispatches to service_role;

comment on table public.zelochat_automation_dispatches is 'Ledger idempotente; o avaliador aprova/suprime e o worker apenas envia jobs queued.';

commit;
