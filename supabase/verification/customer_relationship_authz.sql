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

-- A valid session, relationship, person tag and open conflict for tenant A.
create temporary table session_id_sink (id uuid) on commit drop;
with f as (select * from crm_relationship_fixture)
 , inserted as (
   insert into public.zelochat_sessions (id, empresa_id, owner_user_id, pessoa_id, remote_jid)
   select gen_random_uuid(), empresa_a, owner_a, pessoa_a, '5511999000001@s.whatsapp.net' from f
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
    values (f.empresa_a, f.owner_a, f.pessoa_b, '5511999000002@s.whatsapp.net');
    raise exception 'cross-tenant session was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    update public.zelochat_sessions
       set owner_user_id = f.owner_b
     where id = f.session_a;
    raise exception 'session owner reassignment was accepted';
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

-- A session is disposable; deleting it must not delete the canonical person.
delete from public.zelochat_sessions where id = (select session_a from crm_relationship_fixture);
do $$
begin
  if not exists (select 1 from public.pessoas where id = (select pessoa_a from crm_relationship_fixture)) then
    raise exception 'deleting a session cascaded into its person';
  end if;
end;
$$;

insert into public.zelochat_sessions (empresa_id, owner_user_id, pessoa_id, remote_jid)
select empresa_a, owner_a, pessoa_a, '5511999000001@s.whatsapp.net' from crm_relationship_fixture;
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

rollback;

select 'customer_relationship_authz verification rolled back successfully' as result;
