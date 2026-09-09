begin;

create or replace function public.list_zelochat_customers(
  p_empresa_id uuid,
  p_owner_user_id uuid,
  p_search text default null,
  p_buyers text default null,
  p_min_orders integer default null,
  p_max_orders integer default null,
  p_min_total_value numeric default null,
  p_min_days_since_last_order integer default null,
  p_max_days_since_last_order integer default null,
  p_has_phone boolean default null,
  p_tag_ids uuid[] default null,
  p_birthday_month integer default null,
  p_origin text default null,
  p_sort text default 'orders',
  p_cursor_orders bigint default null,
  p_cursor_value numeric default null,
  p_cursor_at timestamptz default null,
  p_cursor_name text default null,
  p_cursor_id uuid default null,
  p_inactive_after_days integer default 30,
  p_limit integer default 31
) returns table (
  id uuid,
  nome text,
  contato text,
  updated_at timestamptz,
  total_orders bigint,
  total_value numeric,
  last_order_at timestamptz,
  last_activity_at timestamptz,
  activity_state text,
  has_whatsapp boolean,
  total_count bigint
)
language sql
security invoker
set search_path = public, pg_temp
as $$
with order_agg as (
  select o.pessoa_id,
         count(*)::bigint total_orders,
         coalesce(sum(o.total), 0)::numeric total_value,
         max(coalesce(o.closed_at, o.created_at)) last_delivered_at
    from public.zelo_orders o
   where o.empresa_id = p_empresa_id
     and o.status = 'delivered'
     and o.pessoa_id is not null
   group by o.pessoa_id
), conversation_agg as (
  select s.pessoa_id,
         max(case
           when nullif(trim(s.last_message_time), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
             then nullif(trim(s.last_message_time), '')::timestamptz
           else null
         end) last_conversation_at
    from public.zelochat_sessions s
   where s.empresa_id = p_empresa_id
     and s.pessoa_id is not null
   group by s.pessoa_id
), enriched as (
  select p.id,
         p.nome,
         p.contato,
         p.updated_at,
         coalesce(o.total_orders, 0)::bigint total_orders,
         coalesce(o.total_value, 0)::numeric total_value,
         o.last_delivered_at last_order_at,
         coalesce(o.last_delivered_at, c.last_conversation_at) last_activity_at,
         case
           when coalesce(o.last_delivered_at, c.last_conversation_at) is null then 'never'
           when coalesce(o.last_delivered_at, c.last_conversation_at) >= now() - make_interval(days => greatest(coalesce(p_inactive_after_days, 30), 0)) then 'active'
           else 'inactive'
         end activity_state,
         (nullif(p.contato, '') is not null) has_whatsapp
    from public.pessoas p
    left join order_agg o on o.pessoa_id = p.id
    left join conversation_agg c on c.pessoa_id = p.id
   where p.id_usuario = p_owner_user_id
     and p.tipo = 'cliente'
     and exists (
       select 1
         from public.empresa_perfil ep
        where ep.id = p_empresa_id
          and ep.user_id = p_owner_user_id
     )
     and (p_search is null or p.nome ilike '%' || p_search || '%' or p.contato ilike '%' || p_search || '%')
     and (p_buyers is null or p_buyers = 'all' or (p_buyers = 'buyers' and coalesce(o.total_orders, 0) > 0) or (p_buyers = 'contacts' and coalesce(o.total_orders, 0) = 0))
     and (p_min_orders is null or coalesce(o.total_orders, 0) >= p_min_orders)
     and (p_max_orders is null or coalesce(o.total_orders, 0) <= p_max_orders)
     and (p_min_total_value is null or coalesce(o.total_value, 0) >= p_min_total_value)
     and (p_min_days_since_last_order is null or o.last_delivered_at is not null and o.last_delivered_at <= now() - make_interval(days => p_min_days_since_last_order))
     and (p_max_days_since_last_order is null or o.last_delivered_at is not null and o.last_delivered_at >= now() - make_interval(days => p_max_days_since_last_order))
     and (p_has_phone is null or (nullif(p.contato, '') is not null) = p_has_phone)
     and (p_birthday_month is null or p.aniversario_mes = p_birthday_month)
     and (p_origin is null or lower(coalesce(to_jsonb(p)->>'origem', to_jsonb(p)->>'origin', '')) = lower(p_origin))
     and (p_tag_ids is null or not exists (
       select 1
         from unnest(p_tag_ids) wanted
        where not exists (
          select 1
            from public.zelochat_person_tags pt
           where pt.empresa_id = p_empresa_id
             and pt.pessoa_id = p.id
             and pt.tag_id = wanted
        )
     ))
), filtered as (
  select e.*
    from enriched e
   where (p_cursor_id is null or case p_sort
     when 'orders' then (e.total_orders < p_cursor_orders or (e.total_orders = p_cursor_orders and e.id < p_cursor_id))
     when 'value' then (e.total_value < p_cursor_value or (e.total_value = p_cursor_value and e.id < p_cursor_id))
     when 'recent' then (coalesce(e.last_order_at, '-infinity'::timestamptz) < p_cursor_at or (coalesce(e.last_order_at, '-infinity'::timestamptz) = p_cursor_at and e.id < p_cursor_id))
     when 'name' then (lower(coalesce(e.nome, '')) > p_cursor_name or (lower(coalesce(e.nome, '')) = p_cursor_name and e.id > p_cursor_id))
     else true end)
)
select e.id,
       e.nome,
       e.contato,
       e.updated_at,
       e.total_orders,
       e.total_value,
       e.last_order_at,
       e.last_activity_at,
       e.activity_state,
       e.has_whatsapp,
       count(*) over ()::bigint total_count
  from filtered e
 order by
   case when p_sort = 'orders' then e.total_orders end desc,
   case when p_sort = 'value' then e.total_value end desc,
   case when p_sort = 'recent' then coalesce(e.last_order_at, '-infinity'::timestamptz) end desc,
   case when p_sort = 'name' then lower(coalesce(e.nome, '')) end asc,
   case when p_sort = 'name' then e.id end asc,
   e.id desc
 limit least(greatest(p_limit, 1), 101);
$$;

revoke all on function public.list_zelochat_customers(
  uuid, uuid, text, text, integer, integer, numeric, integer, integer,
  boolean, uuid[], integer, text, text, bigint, numeric, timestamptz,
  text, uuid, integer, integer
) from public, anon, authenticated;
grant execute on function public.list_zelochat_customers(
  uuid, uuid, text, text, integer, integer, numeric, integer, integer,
  boolean, uuid[], integer, text, text, bigint, numeric, timestamptz,
  text, uuid, integer, integer
) to service_role;

commit;
