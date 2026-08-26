begin;

-- Segmentos e campanhas são dados do ZeloChat, mas a identidade continua
-- sendo validada no servidor contra pessoas.id_usuario. O navegador não tem
-- acesso às tabelas: toda leitura/escrita passa pela API autenticada.
create table if not exists public.zelochat_segments (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  id_usuario uuid not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  definition jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zelochat_segments_empresa_name_unique unique (empresa_id, name),
  constraint zelochat_segments_empresa_owner_fk foreign key (empresa_id, id_usuario)
    references public.empresa_perfil(id, user_id) on delete cascade
);

create table if not exists public.zelochat_campaigns (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  id_usuario uuid not null,
  segment_id uuid null references public.zelochat_segments(id) on delete set null,
  name text not null check (length(btrim(name)) between 1 and 160),
  message text not null check (length(btrim(message)) between 1 and 4096),
  status text not null default 'draft' check (status in ('draft','scheduled','running','paused','completed','cancelled')),
  scheduled_at timestamptz,
  daily_limit integer not null default 50 check (daily_limit between 1 and 200),
  audience_version integer not null default 0,
  preview_version integer,
  tested_version integer,
  metrics jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zelochat_campaigns_empresa_owner_fk foreign key (empresa_id, id_usuario)
    references public.empresa_perfil(id, user_id) on delete cascade
);

create table if not exists public.zelochat_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.zelochat_campaigns(id) on delete cascade,
  empresa_id uuid not null,
  pessoa_id uuid not null,
  phone_snapshot text,
  name_snapshot text,
  status text not null default 'eligible' check (status in ('eligible','suppressed','queued','sending','sent','failed','cancelled')),
  suppression_reason text,
  idempotency_key text not null,
  attempts integer not null default 0 check (attempts >= 0),
  provider_message_id text,
  last_error text,
  queued_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zelochat_campaign_recipients_campaign_person_unique unique (campaign_id, pessoa_id),
  constraint zelochat_campaign_recipients_idempotency_unique unique (idempotency_key),
  constraint zelochat_campaign_recipients_empresa_fk foreign key (empresa_id)
    references public.empresa_perfil(id) on delete cascade
);

create table if not exists public.zelochat_customer_optouts (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  pessoa_id uuid not null,
  reason text not null default 'opt_out',
  source text not null default 'whatsapp' check (source in ('whatsapp','manual','campaign')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zelochat_customer_optouts_unique unique (empresa_id, pessoa_id),
  constraint zelochat_customer_optouts_empresa_fk foreign key (empresa_id) references public.empresa_perfil(id) on delete cascade
);

create index if not exists zelochat_campaigns_empresa_status_idx on public.zelochat_campaigns (empresa_id, status, scheduled_at);
create index if not exists zelochat_campaign_recipients_campaign_status_idx on public.zelochat_campaign_recipients (campaign_id, status, created_at);
create index if not exists zelochat_customer_optouts_empresa_person_idx on public.zelochat_customer_optouts (empresa_id, pessoa_id);

do $$ declare t text; begin
  foreach t in array array['zelochat_segments','zelochat_campaigns','zelochat_campaign_recipients','zelochat_customer_optouts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- Keep the grants explicit for migration inspection and least-privilege review.
revoke all on table public.zelochat_segments from public, anon, authenticated;
revoke all on table public.zelochat_campaigns from public, anon, authenticated;
revoke all on table public.zelochat_campaign_recipients from public, anon, authenticated;
revoke all on table public.zelochat_customer_optouts from public, anon, authenticated;
grant all on table public.zelochat_segments to service_role;
grant all on table public.zelochat_campaigns to service_role;
grant all on table public.zelochat_campaign_recipients to service_role;
grant all on table public.zelochat_customer_optouts to service_role;

-- Defense in depth. A service-role request still requires the API actor to
-- hold pessoas.visualizar or clientes.comunicar before using these tables.
comment on table public.zelochat_campaigns is 'CRM: preview exige pessoas.visualizar; teste/agendamento exige clientes.comunicar.';
comment on table public.zelochat_campaign_recipients is 'Audiência congelada no agendamento; nunca recalcular uma campanha já agendada.';

commit;
