-- Transactional runtime verification for the CRM relationship foundation.
--
-- This script must run as a disposable/staging database administrator after
-- migration 048. It creates two owners and two tenants, exercises the real
-- tables/constraints/policies, and rolls every fixture back before returning.
-- No production IDs or persistent rows are used.

begin;

create temporary table crm_relationship_fixture (
  owner_a uuid not null,
  owner_b uuid not null,
  empresa_a uuid not null,
  empresa_b uuid not null,
  pessoa_a uuid not null,
  pessoa_b uuid not null,
  pessoa_c uuid not null,
  tag_a uuid not null,
  tag_b uuid not null,
  session_a uuid,
  relationship_a uuid,
  conflict_a uuid
) on commit drop;

insert into crm_relationship_fixture (owner_a, owner_b, empresa_a, empresa_b, pessoa_a, pessoa_b, pessoa_c, tag_a, tag_b)
values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
        gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid());

insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select actor_id,
       'codex-crm-schema-' || actor_id::text || '@invalid.local',
       'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()
  from crm_relationship_fixture f
 cross join lateral (values (f.owner_a), (f.owner_b)) actors(actor_id);

insert into public.empresa_perfil (id, user_id, nome_exibicao)
select empresa_id, owner_id, case when owner_id = owner_a then 'CRM Fixture A' else 'CRM Fixture B' end
  from crm_relationship_fixture
 cross join lateral (values (empresa_a, owner_a), (empresa_b, owner_b)) companies(empresa_id, owner_id);

insert into public.pessoas (id, id_usuario, nome, tipo, contato)
select pessoa_a, owner_a, 'Pessoa CRM A', 'cliente', '5511999000001' from crm_relationship_fixture
union all
select pessoa_b, owner_b, 'Pessoa CRM B', 'cliente', '5511999000002' from crm_relationship_fixture
union all
select pessoa_c, owner_a, 'Pessoa CRM C', 'cliente', '5511999000003' from crm_relationship_fixture;

insert into public.zelochat_tags (id, empresa_id, name)
select tag_a, empresa_a, 'Tag CRM A' from crm_relationship_fixture
union all
select tag_b, empresa_b, 'Tag CRM B' from crm_relationship_fixture;

do $$
declare
  f crm_relationship_fixture%rowtype;
  table_name text;
  policy_record record;
begin
  select * into f from crm_relationship_fixture;

  if (select count(*) from auth.users where id in (f.owner_a, f.owner_b)) <> 2
     or (select count(*) from public.empresa_perfil where id in (f.empresa_a, f.empresa_b)) <> 2
     or (select count(*) from public.pessoas where id in (f.pessoa_a, f.pessoa_b, f.pessoa_c)) <> 3
     or (select count(*) from public.zelochat_tags where id in (f.tag_a, f.tag_b)) <> 2 then
    raise exception 'fixture counts are incomplete';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'zelochat_sessions'
       and column_name = 'pessoa_id' and is_nullable = 'YES'
  ) then
    raise exception 'pessoa_id is not nullable on sessions';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'zelochat_sessions'
       and column_name = 'owner_user_id' and is_nullable = 'NO'
  ) then
    raise exception 'owner_user_id is not required on sessions';
  end if;

  foreach table_name in array array[
    'zelochat_customer_relationships',
    'zelochat_person_tags',
    'zelochat_person_match_conflicts'
  ] loop
    if not exists (
      select 1 from pg_class
       where oid = ('public.' || table_name)::regclass and relrowsecurity
    ) then
      raise exception 'RLS is disabled: %', table_name;
    end if;
  end loop;

  for policy_record in
    select * from (values
      ('zelochat_customer_relationships', 'SELECT', 'zelochat_customer_relationships_browser_select_denied'),
      ('zelochat_customer_relationships', 'INSERT', 'zelochat_customer_relationships_browser_insert_denied'),
      ('zelochat_customer_relationships', 'UPDATE', 'zelochat_customer_relationships_browser_update_denied'),
      ('zelochat_customer_relationships', 'DELETE', 'zelochat_customer_relationships_browser_delete_denied'),
      ('zelochat_person_tags', 'SELECT', 'zelochat_person_tags_browser_select_denied'),
      ('zelochat_person_tags', 'INSERT', 'zelochat_person_tags_browser_insert_denied'),
      ('zelochat_person_tags', 'UPDATE', 'zelochat_person_tags_browser_update_denied'),
      ('zelochat_person_tags', 'DELETE', 'zelochat_person_tags_browser_delete_denied'),
      ('zelochat_person_match_conflicts', 'SELECT', 'zelochat_person_match_conflicts_browser_select_denied'),
      ('zelochat_person_match_conflicts', 'INSERT', 'zelochat_person_match_conflicts_browser_insert_denied'),
      ('zelochat_person_match_conflicts', 'UPDATE', 'zelochat_person_match_conflicts_browser_update_denied'),
      ('zelochat_person_match_conflicts', 'DELETE', 'zelochat_person_match_conflicts_browser_delete_denied')
    ) as expected(table_name, command_name, policy_name)
  loop
    if not exists (
      select 1
        from pg_policies p
       where p.schemaname = 'public'
         and p.tablename = policy_record.table_name
         and p.policyname = policy_record.policy_name
         and p.cmd = policy_record.command_name
         and 'anon' = any (p.roles)
         and 'authenticated' = any (p.roles)
         and position('false' in lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''))) > 0
    ) then
      raise exception 'missing deny policy %.%', policy_record.table_name, policy_record.command_name;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.zelochat_customer_relationships', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.zelochat_customer_relationships', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'public.zelochat_person_tags', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.zelochat_person_tags', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'public.zelochat_person_match_conflicts', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.zelochat_person_match_conflicts', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'browser roles unexpectedly have CRM table privileges';
  end if;
  if not has_table_privilege('service_role', 'public.zelochat_customer_relationships', 'SELECT,INSERT,UPDATE,DELETE')
     or not has_table_privilege('service_role', 'public.zelochat_person_tags', 'SELECT,INSERT,UPDATE,DELETE')
     or not has_table_privilege('service_role', 'public.zelochat_person_match_conflicts', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'service_role is missing CRM table privileges';
  end if;
end;
$$;

-- Grants are intentionally temporary: they isolate the policy behavior from
-- table ACL behavior, and the enclosing rollback removes them with fixtures.
grant select, insert, update, delete on table
  public.zelochat_customer_relationships,
  public.zelochat_person_tags,
  public.zelochat_person_match_conflicts
  to anon, authenticated;
grant select on crm_relationship_fixture to anon, authenticated;

create temporary function crm_assert_browser_crm_denied()
returns void
language plpgsql
set search_path = pg_temp, public
as $$
declare
  f crm_relationship_fixture%rowtype;
  target record;
  visible_rows bigint;
  affected_rows bigint;
begin
  select * into f from crm_relationship_fixture;

  for target in
    select * from (values
      ('zelochat_customer_relationships', f.relationship_a),
      ('zelochat_person_tags', f.tag_a),
      ('zelochat_person_match_conflicts', f.conflict_a)
    ) as targets(table_name, row_id)
  loop
    execute format('select count(*) from public.%I', target.table_name)
      into visible_rows;
    if visible_rows <> 0 then
      raise exception '% can see CRM rows through SELECT', current_user;
    end if;

    if target.table_name = 'zelochat_customer_relationships' then
      execute 'update public.zelochat_customer_relationships set internal_notes = internal_notes where id = $1'
        using target.row_id;
    elsif target.table_name = 'zelochat_person_tags' then
      execute 'update public.zelochat_person_tags set tag_id = tag_id where id = $1'
        using target.row_id;
    else
      execute 'update public.zelochat_person_match_conflicts set state = state where id = $1'
        using target.row_id;
    end if;
    get diagnostics affected_rows = row_count;
    if affected_rows <> 0 then
      raise exception '% changed CRM rows through UPDATE', current_user;
    end if;

    execute format('delete from public.%I where id = $1', target.table_name)
      using target.row_id;
    get diagnostics affected_rows = row_count;
    if affected_rows <> 0 then
      raise exception '% deleted CRM rows through DELETE', current_user;
    end if;
  end loop;

  begin
    insert into public.zelochat_customer_relationships (empresa_id, id_usuario, pessoa_id)
    values (f.empresa_a, f.owner_a, f.pessoa_a);
    raise exception '% inserted a CRM relationship through INSERT', current_user;
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.zelochat_person_tags (empresa_id, id_usuario, pessoa_id, tag_id)
    values (f.empresa_a, f.owner_a, f.pessoa_a, f.tag_a);
    raise exception '% inserted a CRM tag through INSERT', current_user;
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.zelochat_person_match_conflicts (empresa_id, id_usuario, phone)
    values (f.empresa_a, f.owner_a, '5511999000009');
    raise exception '% inserted a CRM conflict through INSERT', current_user;
  exception when insufficient_privilege then null;
  end;
end;
$$;
grant execute on function crm_assert_browser_crm_denied() to anon, authenticated;

-- A valid session, relationship, person tag and open conflict for tenant A.
create temporary table session_id_sink (id uuid) on commit drop;
with f as (select * from crm_relationship_fixture)
 , inserted as (
   insert into public.zelochat_sessions (id, empresa_id, pessoa_id, remote_jid)
   select gen_random_uuid(), empresa_a, pessoa_a, '5511999000001@s.whatsapp.net' from f
   returning id
 )
insert into session_id_sink select id from inserted;

update crm_relationship_fixture
   set session_a = (select id from session_id_sink);

create temporary table relationship_id_sink (id uuid) on commit drop;
with f as (select * from crm_relationship_fixture)
 , inserted as (
   insert into public.zelochat_customer_relationships (empresa_id, id_usuario, pessoa_id, internal_notes, ai_summary)
   select empresa_a, owner_a, pessoa_a, 'nota de fixture', 'resumo de fixture' from f
   returning id
 )
insert into relationship_id_sink select id from inserted;

update crm_relationship_fixture
   set relationship_a = (select id from relationship_id_sink);

with f as (select * from crm_relationship_fixture)
insert into public.zelochat_person_tags (empresa_id, id_usuario, pessoa_id, tag_id)
select empresa_a, owner_a, pessoa_a, tag_a from f;

create temporary table conflict_id_sink (id uuid) on commit drop;
with f as (select * from crm_relationship_fixture)
 , inserted as (
   insert into public.zelochat_person_match_conflicts (empresa_id, id_usuario, phone, whatsapp_jid, candidate_person_ids, reason)
   select empresa_a, owner_a, '5511999000001', '5511999000001@s.whatsapp.net', jsonb_build_array(pessoa_a), 'duplicate legacy contact' from f
   returning id
 )
insert into conflict_id_sink select id from inserted;

update crm_relationship_fixture
   set conflict_a = (select id from conflict_id_sink);

do $$
declare
  f crm_relationship_fixture%rowtype;
begin
  select * into f from crm_relationship_fixture;
  if (select count(*) from public.zelochat_sessions where id = f.session_a) <> 1
     or (select count(*) from public.zelochat_customer_relationships where id = f.relationship_a) <> 1
     or (select count(*) from public.zelochat_person_tags where empresa_id = f.empresa_a and pessoa_id = f.pessoa_a) <> 1
     or (select count(*) from public.zelochat_person_match_conflicts where id = f.conflict_a) <> 1 then
    raise exception 'valid tenant A fixture was not persisted';
  end if;
  if (select owner_user_id from public.zelochat_sessions where id = f.session_a) <> f.owner_a then
    raise exception 'legacy session insert did not derive owner_user_id';
  end if;

  begin
    insert into public.zelochat_customer_relationships (empresa_id, id_usuario, pessoa_id)
    values (f.empresa_a, f.owner_a, f.pessoa_a);
    raise exception 'relationship unique constraint did not reject duplicate';
  exception when unique_violation then null;
  end;

  begin
    insert into public.zelochat_customer_relationships (empresa_id, id_usuario, pessoa_id)
    values (f.empresa_a, f.owner_a, f.pessoa_b);
    raise exception 'cross-tenant relationship was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.zelochat_person_tags (empresa_id, id_usuario, pessoa_id, tag_id)
    values (f.empresa_a, f.owner_a, f.pessoa_a, f.tag_b);
    raise exception 'cross-tenant tag was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.zelochat_sessions (empresa_id, owner_user_id, pessoa_id, remote_jid)
    values (f.empresa_a, f.owner_b, f.pessoa_b, '5511999000002@s.whatsapp.net');
    raise exception 'cross-tenant session was accepted';
  exception when foreign_key_violation then null;
  end;

  update public.zelochat_sessions
     set owner_user_id = f.owner_b
   where id = f.session_a;
  if (select owner_user_id from public.zelochat_sessions where id = f.session_a) <> f.owner_a then
    raise exception 'session trigger trusted a caller-provided owner';
  end if;

  begin
    update public.zelochat_sessions
       set empresa_id = f.empresa_b
     where id = f.session_a;
    raise exception 'cross-tenant session empresa reassignment was accepted';
    exception when foreign_key_violation then null;
  end;

  begin
    insert into public.zelochat_customer_relationships (empresa_id, id_usuario, pessoa_id, internal_notes)
    values (f.empresa_a, f.owner_a, f.pessoa_c, repeat('x', 4001));
    raise exception '4001-character notes were accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.zelochat_customer_relationships (empresa_id, id_usuario, pessoa_id, ai_summary)
    values (f.empresa_a, f.owner_a, f.pessoa_c, repeat('x', 601));
    raise exception '601-character summary was accepted';
  exception when check_violation then null;
  end;

  begin
    update public.zelochat_person_match_conflicts
       set state = 'invalid'
     where id = f.conflict_a;
    raise exception 'invalid conflict state was accepted';
  exception when check_violation then null;
  end;

  update public.zelochat_person_match_conflicts
     set state = 'resolved', resolved_at = now(), resolved_by = f.owner_a,
         resolution_reason = 'revisado pelo operador'
   where id = f.conflict_a;

  if not exists (
    select 1 from public.zelochat_person_match_conflicts
     where id = f.conflict_a and state = 'resolved'
       and resolved_at is not null and resolved_by = f.owner_a
       and resolution_reason = 'revisado pelo operador'
  ) then
    raise exception 'conflict resolution audit was not persisted';
  end if;

  begin
    update public.pessoas set id_usuario = f.owner_b where id = f.pessoa_a;
    raise exception 'person owner change broke no existing references';
  exception when foreign_key_violation then null;
  end;
end;
$$;

set local role anon;
select crm_assert_browser_crm_denied();
reset role;
set local role authenticated;
select crm_assert_browser_crm_denied();
reset role;

-- A session is disposable; deleting it must not delete the canonical person.
delete from public.zelochat_sessions where id = (select session_a from crm_relationship_fixture);
do $$
begin
  if not exists (select 1 from public.pessoas where id = (select pessoa_a from crm_relationship_fixture)) then
    raise exception 'deleting a session cascaded into its person';
  end if;
end;
$$;

insert into public.zelochat_sessions (empresa_id, pessoa_id, remote_jid)
select empresa_a, pessoa_a, '5511999000001@s.whatsapp.net' from crm_relationship_fixture;
update crm_relationship_fixture
   set session_a = (
     select s.id from public.zelochat_sessions s
      where s.empresa_id = (select empresa_a from crm_relationship_fixture)
        and s.remote_jid = '5511999000001@s.whatsapp.net'
   );

-- Deleting a person removes live CRM links/sessions but retains the other
-- tenant/person and never cascades from session to pessoa.
delete from public.pessoas where id = (select pessoa_a from crm_relationship_fixture);

do $$
declare
  f crm_relationship_fixture%rowtype;
begin
  select * into f from crm_relationship_fixture;
  if exists (select 1 from public.zelochat_sessions where id = f.session_a)
     or exists (select 1 from public.zelochat_customer_relationships where id = f.relationship_a)
     or exists (select 1 from public.zelochat_person_tags where empresa_id = f.empresa_a and pessoa_id = f.pessoa_a)
     or exists (select 1 from public.pessoas where id = f.pessoa_a) then
    raise exception 'person delete did not cascade CRM links';
  end if;
  if not exists (select 1 from public.pessoas where id = f.pessoa_b)
     or not exists (select 1 from public.empresa_perfil where id = f.empresa_b) then
    raise exception 'person/session cascade removed unrelated tenant data';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.zelochat_person_match_conflicts_open_identity_uq') is null then
    raise exception 'missing atomic open-conflict unique index';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('record_zelochat_person_match_conflict', 'list_zelochat_customers', 'list_zelochat_customer_timeline')
  ) then
    raise exception 'missing CRM server RPC contract';
  end if;
end;
$$;

rollback;

select 'customer_relationship_authz verification rolled back successfully' as result;
