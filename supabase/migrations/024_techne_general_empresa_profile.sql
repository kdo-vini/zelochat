-- Idempotent internal setup for the Techne ZeloChat company profile.
-- Existing customer companies stay untouched.
insert into public.empresa_perfil (
  user_id,
  nome_exibicao,
  timezone,
  zelochat_onboarding_done,
  ai_enabled,
  ai_mode,
  zelochat_mode,
  updated_at
)
select
  u.id,
  'Téchne',
  'America/Sao_Paulo',
  true,
  true,
  'always_on',
  'general',
  now()
from auth.users u
where lower(u.email) = lower('techne.br@gmail.com')
on conflict (user_id) do update
set
  zelochat_mode = 'general',
  zelochat_onboarding_done = true,
  updated_at = now();
