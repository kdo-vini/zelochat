alter table public.empresa_perfil
  add column if not exists ai_mode text not null default 'always_on',
  add column if not exists ai_schedule_start text,
  add column if not exists ai_schedule_end text;
