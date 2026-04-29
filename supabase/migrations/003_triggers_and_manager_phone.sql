-- Migration: manager phone on empresa_perfil + natural-language triggers table
-- Run this in the Supabase SQL Editor for the Zelo project.

alter table public.empresa_perfil
  add column if not exists manager_phone text;

create table if not exists public.zelochat_triggers (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa_perfil(id) on delete cascade,
  kind text not null check (kind in ('notify_manager', 'escalate_human')),
  name text not null,
  condition_description text not null,
  natural_input text not null,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_zelochat_triggers_empresa_active
  on public.zelochat_triggers (empresa_id, active);

alter table public.zelochat_triggers enable row level security;

drop policy if exists "zelochat_triggers_select_own_empresa" on public.zelochat_triggers;
create policy "zelochat_triggers_select_own_empresa"
  on public.zelochat_triggers
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.empresa_perfil ep
      where ep.id = empresa_id
        and ep.user_id = auth.uid()
    )
  );

drop policy if exists "zelochat_triggers_insert_own_empresa" on public.zelochat_triggers;
create policy "zelochat_triggers_insert_own_empresa"
  on public.zelochat_triggers
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.empresa_perfil ep
      where ep.id = empresa_id
        and ep.user_id = auth.uid()
    )
  );

drop policy if exists "zelochat_triggers_update_own_empresa" on public.zelochat_triggers;
create policy "zelochat_triggers_update_own_empresa"
  on public.zelochat_triggers
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.empresa_perfil ep
      where ep.id = empresa_id
        and ep.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.empresa_perfil ep
      where ep.id = empresa_id
        and ep.user_id = auth.uid()
    )
  );

drop policy if exists "zelochat_triggers_delete_own_empresa" on public.zelochat_triggers;
create policy "zelochat_triggers_delete_own_empresa"
  on public.zelochat_triggers
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.empresa_perfil ep
      where ep.id = empresa_id
        and ep.user_id = auth.uid()
    )
  );
