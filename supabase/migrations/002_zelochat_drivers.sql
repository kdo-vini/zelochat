-- Migration: create multi-tenant drivers table for ZeloChat
-- Run this in the Supabase SQL Editor for the Zelo project.

create table if not exists public.zelochat_drivers (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa_perfil(id) on delete cascade,
  name text not null,
  phone text not null,
  status text not null default 'available' check (status in ('available', 'busy', 'offline')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (empresa_id, phone)
);

create index if not exists idx_zelochat_drivers_empresa_id
  on public.zelochat_drivers (empresa_id);

alter table public.zelochat_drivers enable row level security;

drop policy if exists "zelochat_drivers_select_own_empresa" on public.zelochat_drivers;
create policy "zelochat_drivers_select_own_empresa"
  on public.zelochat_drivers
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

drop policy if exists "zelochat_drivers_insert_own_empresa" on public.zelochat_drivers;
create policy "zelochat_drivers_insert_own_empresa"
  on public.zelochat_drivers
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

drop policy if exists "zelochat_drivers_update_own_empresa" on public.zelochat_drivers;
create policy "zelochat_drivers_update_own_empresa"
  on public.zelochat_drivers
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

drop policy if exists "zelochat_drivers_delete_own_empresa" on public.zelochat_drivers;
create policy "zelochat_drivers_delete_own_empresa"
  on public.zelochat_drivers
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
