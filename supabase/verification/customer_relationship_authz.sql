-- Read-only runtime verification for the CRM relationship foundation.
-- Run with psql against a disposable/staging database. Metadata checks do not
-- mutate rows; the transaction wrapper protects any catalog-adapter probes.

begin;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'zelochat_customer_relationships',
    'zelochat_person_tags',
    'zelochat_person_match_conflicts'
  ] loop
    if to_regclass('public.' || table_name) is null then
      raise exception 'CRM table is missing: %', table_name;
    end if;
    if not exists (
      select 1
        from pg_class
       where oid = ('public.' || table_name)::regclass
         and relrowsecurity
    ) then
      raise exception 'RLS is disabled: %', table_name;
    end if;
    if has_table_privilege('anon', 'public.' || table_name, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || table_name, 'SELECT') then
      raise exception 'Browser role can select CRM table: %', table_name;
    end if;
    if not has_table_privilege('service_role', 'public.' || table_name, 'SELECT') then
      raise exception 'service_role cannot select CRM table: %', table_name;
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.zelochat_customer_relationships'::regclass
       and conname = 'zelochat_customer_relationships_person_owner_fk'
  ) then
    raise exception 'relationship person FK is missing';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.zelochat_person_tags'::regclass
       and conname = 'zelochat_person_tags_person_owner_fk'
  ) then
    raise exception 'person tag person FK is missing';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.zelochat_person_tags'::regclass
       and conname = 'zelochat_person_tags_tag_empresa_fk'
  ) then
    raise exception 'person tag tag FK is missing';
  end if;
end;
$$;

rollback;
