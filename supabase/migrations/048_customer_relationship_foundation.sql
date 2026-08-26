-- CRM relationship foundation for ZeloChat.
--
-- `pessoas`, `pessoa_identities` and `zelo_orders` are owned by ZeloPDV in the
-- shared database. This migration only adds the ZeloChat relationship layer;
-- it deliberately keeps `zelochat_sessions.customer_profile` as a temporary
-- read fallback while the identity backfill is rolled out.
--
-- CRM tables are server-only. The API resolves the actor and tenant first and
-- then uses service_role; browser roles receive no table grants.

begin;

-- Composite references need durable unique constraints containing the owner.
-- Older CRM attempts created indexes with these names; adopt those indexes as
-- constraints when present so this migration remains idempotent across a
-- partially rolled-out environment.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.pessoas'::regclass
       and conname = 'pessoas_id_usuario_id_key'
  ) then
    if to_regclass('public.pessoas_id_usuario_id_unique') is not null then
      alter table public.pessoas
        add constraint pessoas_id_usuario_id_key
        unique using index pessoas_id_usuario_id_unique;
    else
      alter table public.pessoas
        add constraint pessoas_id_usuario_id_key unique (id_usuario, id);
    end if;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.empresa_perfil'::regclass
       and conname = 'empresa_perfil_id_user_id_key'
  ) then
    if to_regclass('public.empresa_perfil_id_user_id_unique') is not null then
      alter table public.empresa_perfil
        add constraint empresa_perfil_id_user_id_key
        unique using index empresa_perfil_id_user_id_unique;
    else
      alter table public.empresa_perfil
        add constraint empresa_perfil_id_user_id_key unique (id, user_id);
    end if;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.zelochat_tags'::regclass
       and conname = 'zelochat_tags_empresa_id_key'
  ) then
    if to_regclass('public.zelochat_tags_empresa_id_unique') is not null then
      alter table public.zelochat_tags
        add constraint zelochat_tags_empresa_id_key
        unique using index zelochat_tags_empresa_id_unique;
    else
      alter table public.zelochat_tags
        add constraint zelochat_tags_empresa_id_key unique (empresa_id, id);
    end if;
  end if;
end
$$;

-- Sessions remain compatible with the webhook rollout: unresolved sessions
-- have NULL pessoa_id and continue to use the existing JID/phone heuristic.
-- owner_user_id is persisted so parent owner changes cannot silently turn a
-- valid session into a cross-tenant link.
alter table public.zelochat_sessions
  add column if not exists pessoa_id uuid,
  add column if not exists owner_user_id uuid;

update public.zelochat_sessions s
   set owner_user_id = ep.user_id
  from public.empresa_perfil ep
 where ep.id = s.empresa_id
   and s.owner_user_id is null;

do $$
begin
  if exists (
    select 1
      from public.zelochat_sessions s
     where s.owner_user_id is null
        or not exists (
          select 1 from public.empresa_perfil ep
           where ep.id = s.empresa_id
             and ep.user_id = s.owner_user_id
        )
  ) then
    raise exception 'PRECONDITION_FAILED: zelochat_sessions has an owner backfill orphan';
  end if;
end
$$;

alter table public.zelochat_sessions
  alter column owner_user_id set not null;

alter table public.zelochat_sessions
  drop constraint if exists zelochat_sessions_pessoa_id_fkey;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.zelochat_sessions'::regclass
       and conname = 'zelochat_sessions_empresa_owner_fk'
  ) then
    alter table public.zelochat_sessions
      add constraint zelochat_sessions_empresa_owner_fk
      foreign key (empresa_id, owner_user_id)
      references public.empresa_perfil(id, user_id)
      on update cascade on delete cascade;
  end if;
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.zelochat_sessions'::regclass
       and conname = 'zelochat_sessions_person_owner_fk'
  ) then
    alter table public.zelochat_sessions
      add constraint zelochat_sessions_person_owner_fk
      foreign key (owner_user_id, pessoa_id)
      references public.pessoas(id_usuario, id)
      on update cascade on delete cascade;
  end if;
end
$$;

-- Keep legacy session writers compatible after owner_user_id becomes required.
-- The caller-provided owner is deliberately ignored: the session owner always
-- comes from the empresa's current owner, while the composite FKs below keep
-- the person link tenant-safe.
create or replace function public.zelochat_derive_session_owner()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  select ep.user_id
    into new.owner_user_id
    from public.empresa_perfil as ep
   where ep.id = new.empresa_id;

  if not found then
    raise exception 'SESSION_EMPRESA_NOT_FOUND: empresa_id % does not exist', new.empresa_id
      using errcode = '23503';
  end if;

  return new;
end;
$$;

revoke all on function public.zelochat_derive_session_owner() from public, anon, authenticated;
grant execute on function public.zelochat_derive_session_owner() to service_role;

drop trigger if exists trg_zelochat_sessions_derive_owner
  on public.zelochat_sessions;
create trigger trg_zelochat_sessions_derive_owner
before insert or update of empresa_id, owner_user_id
on public.zelochat_sessions
for each row execute function public.zelochat_derive_session_owner();

create index if not exists zelochat_sessions_empresa_pessoa_activity_idx
  on public.zelochat_sessions (empresa_id, pessoa_id, updated_at desc);

create index if not exists zelochat_sessions_empresa_activity_idx
  on public.zelochat_sessions (empresa_id, updated_at desc);

-- Rollout note: these indexes intentionally use regular CREATE INDEX because
-- this migration is transactional. Apply during a maintenance window and
-- monitor lock time on active tenants; CONCURRENTLY cannot run in this
-- transaction/runner convention.

-- Remove the prior trigger-based attempt if it was applied in a disposable
-- environment; the composite FKs above are the durable invariant.
drop trigger if exists trg_zelochat_sessions_person_tenant
  on public.zelochat_sessions;
drop function if exists public.zelochat_validate_session_person_tenant();

comment on column public.zelochat_sessions.customer_profile is
  'Fallback temporário: relationship.ai_summary é a fonte preferencial durante o backfill do CRM.';

create table if not exists public.zelochat_customer_relationships (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  id_usuario uuid not null,
  pessoa_id uuid not null,
  internal_notes text,
  ai_summary text,
  whatsapp_blocked_at timestamptz,
  whatsapp_block_reason text,
  last_manual_contact_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zelochat_customer_relationships_notes_check
    check (internal_notes is null or length(internal_notes) <= 4000),
  constraint zelochat_customer_relationships_summary_check
    check (ai_summary is null or length(ai_summary) <= 600),
  constraint zelochat_customer_relationships_empresa_pessoa_unique
    unique (empresa_id, pessoa_id),
  constraint zelochat_customer_relationships_empresa_owner_fk
    foreign key (empresa_id, id_usuario)
    references public.empresa_perfil(id, user_id)
    on delete cascade,
  constraint zelochat_customer_relationships_person_owner_fk
    foreign key (id_usuario, pessoa_id)
    references public.pessoas(id_usuario, id)
    on delete cascade
);

create index if not exists zelochat_customer_relationships_empresa_updated_idx
  on public.zelochat_customer_relationships (empresa_id, updated_at desc);

create index if not exists zelochat_customer_relationships_empresa_pessoa_idx
  on public.zelochat_customer_relationships (empresa_id, pessoa_id);

create table if not exists public.zelochat_person_tags (
  empresa_id uuid not null,
  id_usuario uuid not null,
  pessoa_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (empresa_id, pessoa_id, tag_id),
  constraint zelochat_person_tags_empresa_owner_fk
    foreign key (empresa_id, id_usuario)
    references public.empresa_perfil(id, user_id)
    on delete cascade,
  constraint zelochat_person_tags_person_owner_fk
    foreign key (id_usuario, pessoa_id)
    references public.pessoas(id_usuario, id)
    on delete cascade,
  constraint zelochat_person_tags_tag_empresa_fk
    foreign key (empresa_id, tag_id)
    references public.zelochat_tags(empresa_id, id)
    on delete cascade
);

create index if not exists zelochat_person_tags_empresa_person_idx
  on public.zelochat_person_tags (empresa_id, pessoa_id, created_at desc);

create index if not exists zelochat_person_tags_empresa_tag_idx
  on public.zelochat_person_tags (empresa_id, tag_id, pessoa_id);

create table if not exists public.zelochat_person_match_conflicts (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  id_usuario uuid not null,
  phone text,
  whatsapp_jid text,
  candidate_person_ids jsonb not null default '[]'::jsonb,
  reason text not null,
  state text not null default 'open',
  resolution_reason text,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zelochat_person_match_conflicts_state_check
    check (state in ('open', 'resolved', 'dismissed')),
  constraint zelochat_person_match_conflicts_empresa_owner_fk
    foreign key (empresa_id, id_usuario)
    references public.empresa_perfil(id, user_id)
    on delete cascade
);

create index if not exists zelochat_person_match_conflicts_empresa_state_idx
  on public.zelochat_person_match_conflicts (empresa_id, state, created_at desc);

create index if not exists zelochat_person_match_conflicts_empresa_phone_idx
  on public.zelochat_person_match_conflicts (empresa_id, phone, created_at desc)
  where phone is not null;

create index if not exists zelochat_person_match_conflicts_empresa_jid_idx
  on public.zelochat_person_match_conflicts (empresa_id, whatsapp_jid, created_at desc)
  where whatsapp_jid is not null;

comment on table public.zelochat_customer_relationships is
  'Relationship data owned by ZeloChat; customer_profile remains a temporary session fallback during rollout.';

-- Defense in depth: CRM data is not exposed through the browser Data API.
-- service_role is the only database actor used by the server API.
alter table public.zelochat_customer_relationships enable row level security;
alter table public.zelochat_person_tags enable row level security;
alter table public.zelochat_person_match_conflicts enable row level security;

revoke all on table public.zelochat_customer_relationships from public, anon, authenticated;
revoke all on table public.zelochat_person_tags from public, anon, authenticated;
revoke all on table public.zelochat_person_match_conflicts from public, anon, authenticated;

grant all on table public.zelochat_customer_relationships to service_role;
grant all on table public.zelochat_person_tags to service_role;
grant all on table public.zelochat_person_match_conflicts to service_role;

drop policy if exists zelochat_customer_relationships_browser_select_denied
  on public.zelochat_customer_relationships;
create policy zelochat_customer_relationships_browser_select_denied
  on public.zelochat_customer_relationships for select to anon, authenticated
  using (false);
drop policy if exists zelochat_customer_relationships_browser_insert_denied
  on public.zelochat_customer_relationships;
create policy zelochat_customer_relationships_browser_insert_denied
  on public.zelochat_customer_relationships for insert to anon, authenticated
  with check (false);
drop policy if exists zelochat_customer_relationships_browser_update_denied
  on public.zelochat_customer_relationships;
create policy zelochat_customer_relationships_browser_update_denied
  on public.zelochat_customer_relationships for update to anon, authenticated
  using (false) with check (false);
drop policy if exists zelochat_customer_relationships_browser_delete_denied
  on public.zelochat_customer_relationships;
create policy zelochat_customer_relationships_browser_delete_denied
  on public.zelochat_customer_relationships for delete to anon, authenticated
  using (false);

drop policy if exists zelochat_person_tags_browser_select_denied
  on public.zelochat_person_tags;
create policy zelochat_person_tags_browser_select_denied
  on public.zelochat_person_tags for select to anon, authenticated
  using (false);
drop policy if exists zelochat_person_tags_browser_insert_denied
  on public.zelochat_person_tags;
create policy zelochat_person_tags_browser_insert_denied
  on public.zelochat_person_tags for insert to anon, authenticated
  with check (false);
drop policy if exists zelochat_person_tags_browser_update_denied
  on public.zelochat_person_tags;
create policy zelochat_person_tags_browser_update_denied
  on public.zelochat_person_tags for update to anon, authenticated
  using (false) with check (false);
drop policy if exists zelochat_person_tags_browser_delete_denied
  on public.zelochat_person_tags;
create policy zelochat_person_tags_browser_delete_denied
  on public.zelochat_person_tags for delete to anon, authenticated
  using (false);

drop policy if exists zelochat_person_match_conflicts_browser_select_denied
  on public.zelochat_person_match_conflicts;
create policy zelochat_person_match_conflicts_browser_select_denied
  on public.zelochat_person_match_conflicts for select to anon, authenticated
  using (false);
drop policy if exists zelochat_person_match_conflicts_browser_insert_denied
  on public.zelochat_person_match_conflicts;
create policy zelochat_person_match_conflicts_browser_insert_denied
  on public.zelochat_person_match_conflicts for insert to anon, authenticated
  with check (false);
drop policy if exists zelochat_person_match_conflicts_browser_update_denied
  on public.zelochat_person_match_conflicts;
create policy zelochat_person_match_conflicts_browser_update_denied
  on public.zelochat_person_match_conflicts for update to anon, authenticated
  using (false) with check (false);
drop policy if exists zelochat_person_match_conflicts_browser_delete_denied
  on public.zelochat_person_match_conflicts;
create policy zelochat_person_match_conflicts_browser_delete_denied
  on public.zelochat_person_match_conflicts for delete to anon, authenticated
  using (false);

commit;
