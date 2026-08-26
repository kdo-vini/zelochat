begin;

-- Canonical identity key is computed from the already-normalized phone/JID
-- supplied by the server. Existing duplicate open rows are closed before the
-- unique index is installed so rollout is deterministic.
alter table public.zelochat_person_match_conflicts
  add column if not exists identity_key text generated always as (
    nullif(case when nullif(phone, '') is not null
      then regexp_replace(phone, '[^0-9]', '', 'g')
      else lower(trim(coalesce(whatsapp_jid, '')))
    end, '')
  ) stored;

with ranked as (
  select id, row_number() over (
    partition by empresa_id, id_usuario, identity_key
    order by created_at asc, id asc
  ) as duplicate_rank
  from public.zelochat_person_match_conflicts
  where state = 'open'
)
update public.zelochat_person_match_conflicts c
   set state = 'dismissed',
       resolution_reason = 'Duplicata consolidada durante a instalação do CRM',
       resolved_at = now(),
       updated_at = now()
  from ranked r
 where c.id = r.id and r.duplicate_rank > 1;

create unique index if not exists zelochat_person_match_conflicts_open_identity_uq
  on public.zelochat_person_match_conflicts (empresa_id, id_usuario, identity_key)
  where state = 'open';

create or replace function public.record_zelochat_person_match_conflict(
  p_empresa_id uuid,
  p_owner_user_id uuid,
  p_phone text,
  p_whatsapp_jid text,
  p_candidate_person_ids jsonb,
  p_reason text
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  insert into public.zelochat_person_match_conflicts (
    empresa_id, id_usuario, phone, whatsapp_jid, candidate_person_ids, reason, state, updated_at
  ) values (
    p_empresa_id, p_owner_user_id, nullif(p_phone, ''), nullif(lower(trim(p_whatsapp_jid)), ''),
    coalesce(p_candidate_person_ids, '[]'::jsonb), p_reason, 'open', now()
  )
  on conflict (empresa_id, id_usuario, identity_key) where state = 'open'
  do update set candidate_person_ids = excluded.candidate_person_ids,
                reason = excluded.reason,
                updated_at = now();
end;
$$;
revoke all on function public.record_zelochat_person_match_conflict(uuid, uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_zelochat_person_match_conflict(uuid, uuid, text, text, jsonb, text) to service_role;

-- Server-side customer aggregation: activity, tags and keyset filtering all
-- happen before limit. The function is deliberately service-role-only.
create or replace function public.list_zelochat_customers(
  p_empresa_id uuid,
  p_owner_user_id uuid,
  p_search text default null,
  p_activity_state text default null,
  p_has_phone boolean default null,
  p_tag_id uuid default null,
  p_birthday_month integer default null,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null,
  p_inactive_after_days integer default 30,
  p_limit integer default 31
) returns table (
  id uuid, nome text, contato text, updated_at timestamptz,
  total_orders bigint, total_value numeric, last_activity_at timestamptz,
  activity_state text, has_whatsapp boolean
)
language sql
security invoker
set search_path = public, pg_temp
as $$
with order_agg as (
  select o.pessoa_id, count(*)::bigint total_orders, coalesce(sum(o.total), 0)::numeric total_value,
         max(coalesce(o.closed_at, o.created_at)) last_delivered_at
    from public.zelo_orders o
   where o.empresa_id = p_empresa_id and o.status = 'delivered' and o.pessoa_id is not null
   group by o.pessoa_id
), conversation_agg as (
  select s.pessoa_id, max(s.last_message_time) last_conversation_at
    from public.zelochat_sessions s
   where s.empresa_id = p_empresa_id and s.pessoa_id is not null
   group by s.pessoa_id
), enriched as (
  select p.id, p.nome, p.contato, p.updated_at,
         coalesce(o.total_orders, 0)::bigint total_orders,
         coalesce(o.total_value, 0)::numeric total_value,
         coalesce(o.last_delivered_at, c.last_conversation_at) last_activity_at,
         case when coalesce(o.last_delivered_at, c.last_conversation_at) >= now() - make_interval(days => greatest(p_inactive_after_days, 0)) then 'active' else 'inactive' end activity_state,
         (nullif(p.contato, '') is not null) has_whatsapp
    from public.pessoas p
    left join order_agg o on o.pessoa_id = p.id
    left join conversation_agg c on c.pessoa_id = p.id
   where p.id_usuario = p_owner_user_id and p.tipo = 'cliente'
     and exists (select 1 from public.empresa_perfil ep where ep.id = p_empresa_id and ep.user_id = p_owner_user_id)
     and (p_search is null or p.nome ilike '%' || p_search || '%' or p.contato ilike '%' || p_search || '%')
     and (p_has_phone is null or (nullif(p.contato, '') is not null) = p_has_phone)
     and (p_birthday_month is null or p.aniversario_mes = p_birthday_month)
     and (p_tag_id is null or exists (select 1 from public.zelochat_person_tags pt where pt.empresa_id = p_empresa_id and pt.pessoa_id = p.id and pt.tag_id = p_tag_id))
)
select e.id, e.nome, e.contato, e.updated_at, e.total_orders, e.total_value, e.last_activity_at, e.activity_state, e.has_whatsapp
  from enriched e
 where (p_activity_state is null or e.activity_state = p_activity_state)
   and (p_cursor_updated_at is null or e.updated_at < p_cursor_updated_at or (e.updated_at = p_cursor_updated_at and e.id < p_cursor_id))
 order by e.updated_at desc, e.id desc
 limit least(greatest(p_limit, 1), 101);
$$;
revoke all on function public.list_zelochat_customers(uuid, uuid, text, text, boolean, uuid, integer, timestamptz, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.list_zelochat_customers(uuid, uuid, text, text, boolean, uuid, integer, timestamptz, uuid, integer, integer) to service_role;

-- Filter-complete overload used by the CRM UI. It keeps all predicates inside
-- the RPC, before keyset pagination, so aliases cannot produce an unfiltered
-- page. `to_jsonb(p)` keeps origin compatible with PDV-owned schema variants.
create or replace function public.list_zelochat_customers(
  p_empresa_id uuid, p_owner_user_id uuid, p_search text default null,
  p_activity_state text default null, p_has_phone boolean default null,
  p_tag_id uuid default null, p_tag_ids uuid[] default null,
  p_birthday_month integer default null, p_status text default null,
  p_birthday_only boolean default false, p_origin text default null,
  p_vip boolean default false, p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null, p_inactive_after_days integer default 30,
  p_limit integer default 31
) returns table (id uuid, nome text, contato text, updated_at timestamptz,
  total_orders bigint, total_value numeric, last_activity_at timestamptz,
  activity_state text, has_whatsapp boolean)
language sql security invoker set search_path = public, pg_temp as $$
with order_agg as (
  select o.pessoa_id, count(*)::bigint total_orders, coalesce(sum(o.total), 0)::numeric total_value,
         max(coalesce(o.closed_at, o.created_at)) last_delivered_at
    from public.zelo_orders o where o.empresa_id = p_empresa_id and o.status = 'delivered' and o.pessoa_id is not null group by o.pessoa_id
), conversation_agg as (
  select s.pessoa_id, max(s.last_message_time) last_conversation_at
    from public.zelochat_sessions s where s.empresa_id = p_empresa_id and s.pessoa_id is not null group by s.pessoa_id
), enriched as (
  select p.id, p.nome, p.contato, p.updated_at, coalesce(o.total_orders, 0)::bigint total_orders,
    coalesce(o.total_value, 0)::numeric total_value, coalesce(o.last_delivered_at, c.last_conversation_at) last_activity_at,
    case when coalesce(o.last_delivered_at, c.last_conversation_at) is null then 'never'
         when coalesce(o.last_delivered_at, c.last_conversation_at) >= now() - make_interval(days => greatest(p_inactive_after_days, 0)) then 'active' else 'inactive' end activity_state,
    (nullif(p.contato, '') is not null) has_whatsapp
  from public.pessoas p left join order_agg o on o.pessoa_id = p.id left join conversation_agg c on c.pessoa_id = p.id
  where p.id_usuario = p_owner_user_id and p.tipo = 'cliente'
    and exists (select 1 from public.empresa_perfil ep where ep.id = p_empresa_id and ep.user_id = p_owner_user_id)
    and (p_search is null or p.nome ilike '%' || p_search || '%' or p.contato ilike '%' || p_search || '%')
    and (p_has_phone is null or (nullif(p.contato, '') is not null) = p_has_phone)
    and (p_birthday_month is null or p.aniversario_mes = p_birthday_month)
    and (not p_birthday_only or p.aniversario_mes is not null)
    and (p_origin is null or lower(coalesce(to_jsonb(p)->>'origem', to_jsonb(p)->>'origin', '')) = lower(p_origin))
    and (p_tag_id is null or exists (select 1 from public.zelochat_person_tags pt where pt.empresa_id = p_empresa_id and pt.pessoa_id = p.id and pt.tag_id = p_tag_id))
    and (p_tag_ids is null or not exists (select 1 from unnest(p_tag_ids) wanted where not exists (select 1 from public.zelochat_person_tags pt where pt.empresa_id = p_empresa_id and pt.pessoa_id = p.id and pt.tag_id = wanted)))
    and (not p_vip or exists (select 1 from public.zelochat_person_tags pt join public.zelochat_tags t on t.id = pt.tag_id and t.empresa_id = pt.empresa_id where pt.empresa_id = p_empresa_id and pt.pessoa_id = p.id and lower(t.name) = 'vip'))
)
select e.id, e.nome, e.contato, e.updated_at, e.total_orders, e.total_value, e.last_activity_at, e.activity_state, e.has_whatsapp from enriched e
where (coalesce(p_status, p_activity_state) is null or e.activity_state = coalesce(p_status, p_activity_state))
  and (p_cursor_updated_at is null or e.updated_at < p_cursor_updated_at or (e.updated_at = p_cursor_updated_at and e.id < p_cursor_id))
order by e.updated_at desc, e.id desc limit least(greatest(p_limit, 1), 101);
$$;
revoke all on function public.list_zelochat_customers(uuid, uuid, text, text, boolean, uuid, uuid[], integer, text, boolean, text, boolean, timestamptz, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.list_zelochat_customers(uuid, uuid, text, text, boolean, uuid, uuid[], integer, text, boolean, text, boolean, timestamptz, uuid, integer, integer) to service_role;

create or replace function public.list_zelochat_customer_timeline(
  p_empresa_id uuid,
  p_owner_user_id uuid,
  p_pessoa_id uuid,
  p_after_at timestamptz default null,
  p_after_kind text default null,
  p_after_id uuid default null,
  p_limit integer default 31
) returns table (
  kind text, id uuid, occurred_at timestamptz, session_id uuid,
  direction text, preview text, order_status text, order_total numeric
)
language sql
security invoker
set search_path = public, pg_temp
as $$
with events as (
  select 'message'::text kind, m.id, m.sent_at occurred_at, m.session_id,
         case when m.role = 'user' then 'inbound' else 'outbound' end direction,
         left(coalesce(m.content, ''), 240) preview, null::text order_status, null::numeric order_total
    from public.zelochat_messages m
    join public.zelochat_sessions s on s.id = m.session_id and s.empresa_id = p_empresa_id and s.pessoa_id = p_pessoa_id
   where m.empresa_id = p_empresa_id
  union all
  select 'order'::text, o.id, o.created_at, null::uuid, null::text, null::text, o.status::text, o.total::numeric
    from public.zelo_orders o
   where o.empresa_id = p_empresa_id and o.pessoa_id = p_pessoa_id
     and exists (select 1 from public.empresa_perfil ep where ep.id = p_empresa_id and ep.user_id = p_owner_user_id)
)
select e.kind, e.id, e.occurred_at, e.session_id, e.direction, e.preview, e.order_status, e.order_total
  from events e
 where (p_after_at is null
     or e.occurred_at < p_after_at
     or (e.occurred_at = p_after_at and e.kind < p_after_kind)
     or (e.occurred_at = p_after_at and e.kind = p_after_kind and e.id < p_after_id))
 order by e.occurred_at desc, e.kind desc, e.id desc
 limit least(greatest(p_limit, 1), 101);
$$;
revoke all on function public.list_zelochat_customer_timeline(uuid, uuid, uuid, timestamptz, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.list_zelochat_customer_timeline(uuid, uuid, uuid, timestamptz, text, uuid, integer) to service_role;

commit;
