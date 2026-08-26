-- CRM merge coordinator. Deploy after 048-050 and before enabling the merge UI.
-- The function is service-role-only because pessoas/zelo_orders are PDV-owned;
-- it validates both people in the same empresa before moving CRM links.
create or replace function public.merge_zelochat_customers(
  p_source_id uuid,
  p_target_id uuid,
  p_empresa_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_source_owner uuid;
  v_target_owner uuid;
begin
  if p_source_id is null or p_target_id is null or p_source_id = p_target_id then
    raise exception 'CUSTOMER_MERGE_INVALID' using errcode = '22023';
  end if;

  select ep.user_id into v_owner from public.empresa_perfil ep where ep.id = p_empresa_id;
  if v_owner is null then raise exception 'CUSTOMER_TENANT_NOT_FOUND' using errcode = 'P0002'; end if;

  select id_usuario into v_source_owner from public.pessoas where id = p_source_id and tipo = 'cliente';
  select id_usuario into v_target_owner from public.pessoas where id = p_target_id and tipo = 'cliente';
  if v_source_owner is null or v_target_owner is null or v_source_owner <> v_owner or v_target_owner <> v_owner then
    raise exception 'CUSTOMER_MERGE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- All link moves happen in this transaction. Existing target profile data,
  -- including its manually confirmed name, remains authoritative.
  update public.zelochat_sessions set pessoa_id = p_target_id where empresa_id = p_empresa_id and pessoa_id = p_source_id;
  update public.zelo_orders set pessoa_id = p_target_id where empresa_id = p_empresa_id and pessoa_id = p_source_id;

  insert into public.zelochat_person_tags (empresa_id, id_usuario, pessoa_id, tag_id)
  select empresa_id, id_usuario, p_target_id, tag_id
    from public.zelochat_person_tags
   where empresa_id = p_empresa_id and pessoa_id = p_source_id
  on conflict (empresa_id, pessoa_id, tag_id) do nothing;
  delete from public.zelochat_person_tags where empresa_id = p_empresa_id and pessoa_id = p_source_id;
  delete from public.zelochat_customer_relationships where empresa_id = p_empresa_id and pessoa_id = p_source_id;

  -- PDV-owned delete constraints are intentionally allowed to abort the whole
  -- transaction rather than silently orphaning an identity or financial link.
  delete from public.pessoas where id = p_source_id and id_usuario = v_owner and tipo = 'cliente';
  if not found then raise exception 'CUSTOMER_MERGE_NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.merge_zelochat_customers(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_zelochat_customers(uuid, uuid, uuid) to service_role;
