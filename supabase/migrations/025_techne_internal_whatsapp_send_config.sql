-- Internal server-to-server WhatsApp send key for Techne.
-- Stores only a SHA-256 hash; the plaintext key lives outside the database.
alter table public.empresa_perfil
  add column if not exists zelochat_internal_send_key_hash text;

comment on column public.empresa_perfil.zelochat_internal_send_key_hash is
  'SHA-256 hex hash for Techne server-to-server WhatsApp send API key.';

with techne_user as (
  select id as user_id
  from auth.users
  where lower(email) = lower('techne.br@gmail.com')
), techne_empresa as (
  update public.empresa_perfil ep
  set
    nome_exibicao = 'Téchne',
    contato = '+5514991537503',
    manager_phone = '+5514991537503',
    zelochat_mode = 'general',
    zelochat_onboarding_done = true,
    ai_enabled = true,
    ai_mode = 'always_on',
    zelochat_internal_send_key_hash = '16716647e7d453a15d8f41fd3f7b967ac4216422ecb30e362a5cf144e2aa54f1',
    updated_at = now()
  from techne_user u
  where ep.user_id = u.user_id
  returning ep.user_id
), latest_subscription as (
  select s.id
  from public.subscriptions s
  join techne_user u on u.user_id = s.user_id
  order by s.updated_at desc nulls last, s.created_at desc nulls last
  limit 1
), updated_subscription as (
  update public.subscriptions s
  set
    status = 'active',
    plan_tier = 'chat',
    payment_provider = 'internal',
    billing_type = 'INTERNAL',
    current_period_end = now() + interval '10 years',
    manually_extended_until = now() + interval '10 years',
    cancel_at_period_end = false,
    admin_notes = concat_ws(E'\n', nullif(s.admin_notes, ''), 'Internal Techne ZeloChat access configured by Codex on 2026-05-07.'),
    updated_at = now(),
    last_modified_at = now()
  from latest_subscription ls
  where s.id = ls.id
  returning s.id
)
insert into public.subscriptions (
  user_id,
  status,
  plan_tier,
  payment_provider,
  billing_type,
  current_period_end,
  manually_extended_until,
  cancel_at_period_end,
  admin_notes,
  created_at,
  updated_at,
  last_modified_at
)
select
  u.user_id,
  'active',
  'chat',
  'internal',
  'INTERNAL',
  now() + interval '10 years',
  now() + interval '10 years',
  false,
  'Internal Techne ZeloChat access configured by Codex on 2026-05-07.',
  now(),
  now(),
  now()
from techne_user u
where not exists (select 1 from updated_subscription);
