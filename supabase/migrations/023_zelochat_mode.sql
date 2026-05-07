-- Internal ZeloChat product mode.
-- Default keeps every existing customer on the restaurant experience.
alter table public.empresa_perfil
  add column if not exists zelochat_mode text not null default 'restaurant';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'empresa_perfil_zelochat_mode_check'
  ) then
    alter table public.empresa_perfil
      add constraint empresa_perfil_zelochat_mode_check
      check (zelochat_mode in ('restaurant', 'general'));
  end if;
end $$;

comment on column public.empresa_perfil.zelochat_mode is
  'ZeloChat UI/AI mode. restaurant is the public default; general is opt-in for internal/support-style companies.';

update public.empresa_perfil ep
set
  zelochat_mode = 'general',
  updated_at = now()
from auth.users u
where ep.user_id = u.id
  and lower(u.email) = lower('techne.br@gmail.com');
