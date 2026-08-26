-- ZeloChat CRM — SQL único para aplicar em staging
-- Gerado a partir das migrations versionadas dos worktrees codex/clientes-crm.
--
-- ORDEM OBRIGATÓRIA: ZeloPDV (identidade/pedidos) antes de ZeloChat (CRM).
-- Este arquivo NÃO executa backfill, NÃO envia mensagens e mantém todas as
-- flags de rollout desligadas por padrão.
--
-- Execute as migrations até 059 como um único script em um projeto de staging.
-- O bloco VERIFICATION no final deve ser executado separadamente depois;
-- ele cria fixtures temporárias e termina com ROLLBACK.
-- A execução direta não registra automaticamente o histórico da CLI.


-- ============================================================================
-- 20260825120000_customer_identity_foundation.sql
-- ============================================================================

-- Canonical customer identity foundation.
-- pessoas remains the PDV-owned master record; this migration only adds CRM
-- identity links and the server-side WhatsApp resolution boundary.

begin;

alter table public.pessoas
  add column if not exists aniversario_dia smallint,
  add column if not exists aniversario_mes smallint,
  add column if not exists aniversario_ano smallint,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.pessoas'::regclass
       and conname = 'pessoas_aniversario_dia_mes_check'
  ) then
    alter table public.pessoas
      add constraint pessoas_aniversario_dia_mes_check
      check (
        (
          (aniversario_dia is null and aniversario_mes is null)
          or (
            aniversario_dia is not null
            and aniversario_mes is not null
            and aniversario_dia between 1 and 31
            and aniversario_mes between 1 and 12
          )
        )
        and (aniversario_ano is null or aniversario_ano between 1900 and 2100)
        and (aniversario_ano is null or (aniversario_dia is not null and aniversario_mes is not null))
      );
  end if;
end
$$;

create or replace function public.touch_pessoa_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pessoas_set_updated_at on public.pessoas;
create trigger pessoas_set_updated_at
before update on public.pessoas
for each row execute function public.touch_pessoa_updated_at();

create table if not exists public.pessoa_identities (
  id uuid primary key default gen_random_uuid(),
  id_usuario uuid not null references auth.users(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  kind text not null,
  value_normalized text not null,
  is_primary boolean not null default false,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pessoa_identities_kind_check check (kind in ('phone', 'email')),
  constraint pessoa_identities_value_check check (length(value_normalized) > 0),
  constraint pessoa_identities_owner_kind_value_unique
    unique (id_usuario, kind, value_normalized)
);

create index if not exists pessoa_identities_owner_kind_idx
  on public.pessoa_identities (id_usuario, kind, value_normalized);

create unique index if not exists pessoa_identities_primary_phone_unique
  on public.pessoa_identities (pessoa_id)
  where kind = 'phone' and is_primary;

create or replace function public.normalize_brazilian_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if v_digits = '' then
    return null;
  end if;

  -- Ten/eleven digits are always local, including DDD 55. Twelve/thirteen
  -- digits are accepted only when the explicit country prefix is 55.
  if length(v_digits) in (10, 11) then
    return '55' || v_digits;
  end if;
  if length(v_digits) in (12, 13) and left(v_digits, 2) = '55' then
    return v_digits;
  end if;
  return null;
end;
$$;

-- Revalidate and remove any identity that may have been produced by an earlier
-- interrupted version while the corresponding contato group is ambiguous. It
-- is safer to revalidate than to keep a guessed link.
delete from public.pessoa_identities pi
 where pi.kind = 'phone'
   and (
     select count(*)
       from public.pessoas p
      where p.id_usuario = pi.id_usuario
        and public.normalize_brazilian_phone(p.contato) = pi.value_normalized
   ) > 1;

-- Preserve existing contato values as identities before the server-side
-- resolver starts creating records. Only an unambiguous group is eligible;
-- duplicate legacy contacts remain identity-less until a human resolves them.
insert into public.pessoa_identities (
  id_usuario, pessoa_id, kind, value_normalized, is_primary, source
)
select candidate.id_usuario, (array_agg(candidate.pessoa_id))[1], 'phone',
       candidate.value_normalized, true, 'migration_backfill'
  from (
    select p.id_usuario,
           p.id as pessoa_id,
           public.normalize_brazilian_phone(p.contato) as value_normalized
      from public.pessoas p
     where public.normalize_brazilian_phone(p.contato) is not null
  ) candidate
 group by candidate.id_usuario, candidate.value_normalized
having count(*) = 1
on conflict (id_usuario, kind, value_normalized) do nothing;

alter table public.pessoa_identities enable row level security;

drop policy if exists pessoa_identities_owner_select on public.pessoa_identities;
create policy pessoa_identities_owner_select
  on public.pessoa_identities
  for select
  to authenticated
  using (public.get_owner_user_id(auth.uid()) = id_usuario);

drop policy if exists pessoa_identities_actor_insert on public.pessoa_identities;
create policy pessoa_identities_actor_insert
  on public.pessoa_identities
  for insert
  to authenticated
  with check (
    public.get_owner_user_id(auth.uid()) = id_usuario
    and public.fiado_actor_can('pessoas.gerenciar', id_usuario)
    and exists (
      select 1
        from public.pessoas p
       where p.id = pessoa_id
         and p.id_usuario = pessoa_identities.id_usuario
    )
  );

drop policy if exists pessoa_identities_actor_update on public.pessoa_identities;
create policy pessoa_identities_actor_update
  on public.pessoa_identities
  for update
  to authenticated
  using (
    public.get_owner_user_id(auth.uid()) = id_usuario
    and public.fiado_actor_can('pessoas.gerenciar', id_usuario)
  )
  with check (
    public.get_owner_user_id(auth.uid()) = id_usuario
    and public.fiado_actor_can('pessoas.gerenciar', id_usuario)
    and exists (
      select 1
        from public.pessoas p
       where p.id = pessoa_id
         and p.id_usuario = pessoa_identities.id_usuario
    )
  );

drop policy if exists pessoa_identities_actor_delete on public.pessoa_identities;
create policy pessoa_identities_actor_delete
  on public.pessoa_identities
  for delete
  to authenticated
  using (
    public.get_owner_user_id(auth.uid()) = id_usuario
    and public.fiado_actor_can('pessoas.gerenciar', id_usuario)
  );

revoke all on table public.pessoa_identities from anon;
grant select, insert, update, delete on table public.pessoa_identities to authenticated;
grant all on table public.pessoa_identities to service_role;

create or replace function public.ensure_customer_from_whatsapp(
  p_owner_user_id uuid,
  p_phone text,
  p_observed_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text;
  v_observed_name text := nullif(trim(coalesce(p_observed_name, '')), '');
  v_contact_pessoa_id uuid;
  v_identity_pessoa_id uuid;
  v_pessoa_nome text;
  v_pessoa_tipo text;
  v_contact_count integer;
  v_identity_count integer;
begin
  if coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'Esta operação é restrita ao serviço.' using errcode = '42501';
  end if;

  v_phone := public.normalize_brazilian_phone(p_phone);
  if p_owner_user_id is null or v_phone is null then
    return jsonb_build_object(
      'status', 'invalid',
      'pessoaId', null::uuid,
      'reason', 'owner_or_phone_invalid'
    );
  end if;

  -- All callers for one tenant/phone wait on the same transaction lock before
  -- reading or creating a person. This closes the check-then-insert race.
  perform pg_advisory_xact_lock(
    hashtextextended(p_owner_user_id::text || ':' || v_phone, 0)
  );

  -- Count every legacy contact before choosing a row. A phone shared by two
  -- people is ambiguous even if one of them already has an identity row.
  select count(*), (array_agg(p.id))[1]
    into v_contact_count, v_contact_pessoa_id
    from public.pessoas p
   where p.id_usuario = p_owner_user_id
     and public.normalize_brazilian_phone(p.contato) = v_phone;

  select count(*), (array_agg(pi.pessoa_id))[1]
    into v_identity_count, v_identity_pessoa_id
    from public.pessoa_identities pi
   where pi.id_usuario = p_owner_user_id
     and pi.kind = 'phone'
     and pi.value_normalized = v_phone;

  if v_contact_count > 1 or v_identity_count > 1 then
    return jsonb_build_object(
      'status', 'conflict',
      'pessoaId', null::uuid,
      'reason', case
        when v_contact_count > 1 then 'phone_contact_ambiguous'
        else 'phone_identity_ambiguous'
      end
    );
  end if;

  if v_identity_count = 1
     and not exists (
       select 1
         from public.pessoas p
        where p.id = v_identity_pessoa_id
          and p.id_usuario = p_owner_user_id
     ) then
    return jsonb_build_object(
      'status', 'conflict',
      'pessoaId', null::uuid,
      'reason', 'phone_identity_mismatch'
    );
  end if;

  if v_contact_count = 1 and v_identity_count = 1
     and v_contact_pessoa_id <> v_identity_pessoa_id then
    return jsonb_build_object(
      'status', 'conflict',
      'pessoaId', null::uuid,
      'reason', 'phone_identity_mismatch'
    );
  end if;

  if v_contact_count = 1 then
    select p.nome, p.tipo
      into v_pessoa_nome, v_pessoa_tipo
      from public.pessoas p
     where p.id = v_contact_pessoa_id
       and p.id_usuario = p_owner_user_id
     for update;
    v_identity_pessoa_id := v_contact_pessoa_id;
  elsif v_identity_count = 1 then
    select p.nome, p.tipo
      into v_pessoa_nome, v_pessoa_tipo
      from public.pessoas p
     where p.id = v_identity_pessoa_id
       and p.id_usuario = p_owner_user_id
     for update;
  end if;

  if v_contact_count = 1 or v_identity_count = 1 then
    if v_pessoa_tipo = 'funcionario' then
      return jsonb_build_object(
        'status', 'conflict',
        'pessoaId', v_identity_pessoa_id,
        'reason', 'phone_belongs_to_employee'
      );
    end if;

    -- Observed WhatsApp names are hints only. A blank name or a name that is
    -- still the phone may be filled; a manually chosen name is never replaced.
    if (nullif(trim(coalesce(v_pessoa_nome, '')), '') is null
        or public.normalize_brazilian_phone(v_pessoa_nome) = v_phone)
       and v_observed_name is not null then
      update public.pessoas
         set nome = v_observed_name
       where id = v_identity_pessoa_id
         and id_usuario = p_owner_user_id;
    end if;

    if v_identity_count = 0 then
      insert into public.pessoa_identities (
        id_usuario, pessoa_id, kind, value_normalized, is_primary, source
      ) values (
        p_owner_user_id, v_identity_pessoa_id, 'phone', v_phone, true, 'whatsapp'
      );
    end if;

    return jsonb_build_object(
      'status', 'linked',
      'pessoaId', v_identity_pessoa_id,
      'reason', null::text
    );
  end if;

  if public.normalize_brazilian_phone(v_observed_name) = v_phone then
    v_observed_name := null;
  end if;

  insert into public.pessoas (id_usuario, nome, tipo, contato)
  values (
    p_owner_user_id,
    coalesce(v_observed_name, v_phone),
    'cliente',
    v_phone
  )
  returning id into v_identity_pessoa_id;

  insert into public.pessoa_identities (
    id_usuario, pessoa_id, kind, value_normalized, is_primary, source
  ) values (
    p_owner_user_id, v_identity_pessoa_id, 'phone', v_phone, true, 'whatsapp'
  );

  return jsonb_build_object(
    'status', 'created',
    'pessoaId', v_identity_pessoa_id,
    'reason', null::text
  );
end;
$$;

revoke all on function public.ensure_customer_from_whatsapp(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.ensure_customer_from_whatsapp(uuid, text, text)
  to service_role;

commit;

-- ============================================================================
-- 20260825123000_customer_order_links.sql
-- ============================================================================

-- Customer links for canonical orders and CRM-safe person deletion.
-- Forward-only: the already applied order and fiado migrations remain intact.
begin;

do $$
begin
  if to_regclass('public.zelo_orders') is null
     or to_regclass('public.pessoas') is null
     or to_regclass('public.fiado_lancamentos') is null then
    raise exception 'PRECONDITION_FAILED: CRM order dependencies are missing';
  end if;
  if to_regprocedure('public.create_zelo_order(uuid,integer,text,jsonb)') is null then
    raise exception 'PRECONDITION_FAILED: legacy create_zelo_order signature is missing';
  end if;
  if to_regprocedure('public.zelo_order_result(public.zelo_orders)') is null then
    raise exception 'PRECONDITION_FAILED: zelo_order_result is missing';
  end if;
  if to_regprocedure('public.fiado_excluir_pessoa(uuid)') is null then
    raise exception 'PRECONDITION_FAILED: fiado_excluir_pessoa is missing';
  end if;
end
$$;

-- The customer snapshot is an immutable checkout boundary. It remains required
-- even when a canonical pessoa link is present, so historical orders retain
-- the name/phone/address used at checkout.
do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'zelomenu_cart_sessions'
       and column_name = 'customer_snapshot'
       and is_nullable = 'NO'
  ) then
    raise exception 'PRECONDITION_FAILED: customer_snapshot must remain NOT NULL';
  end if;
end
$$;

alter table public.zelo_orders
  add column if not exists pessoa_id uuid
  references public.pessoas(id) on delete set null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.zelo_orders'::regclass
       and conname = 'zelo_orders_pessoa_id_fkey'
  ) then
    alter table public.zelo_orders
      add constraint zelo_orders_pessoa_id_fkey
      foreign key (pessoa_id) references public.pessoas(id) on delete set null;
  end if;
end
$$;

create index if not exists zelo_orders_empresa_pessoa_created_idx
  on public.zelo_orders (empresa_id, pessoa_id, created_at desc);

-- Keep the financial ledger when a zero-balance person is removed. The person
-- link is historical metadata, not a reason to erase a financial event.
alter table public.fiado_lancamentos
  alter column id_pessoa drop not null;
alter table public.fiado_lancamentos
  drop constraint if exists fiado_lancamentos_id_pessoa_fkey;
alter table public.fiado_lancamentos
  add constraint fiado_lancamentos_id_pessoa_fkey
  foreign key (id_pessoa) references public.pessoas(id) on delete set null;

-- Canonical creation with the current table-order behavior plus an optional
-- CRM link. The single public signature keeps p_pessoa_id defaulted so legacy
-- four-argument callers resolve to this function without an ambiguous overload.
drop function if exists public.create_zelo_order(uuid, integer, text, jsonb);

create or replace function public.create_zelo_order(
  p_session_id uuid,
  p_expected_revision integer,
  p_idempotency_key text,
  p_snapshots jsonb,
  p_pessoa_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.zelomenu_cart_sessions;
  o public.zelo_orders;
  v_empresa uuid;
  v_item jsonb;
  v_source text;
  v_subtotal numeric(14,2);
  v_fee numeric(14,2);
  v_discount numeric(14,2);
  v_total numeric(14,2);
  v_stock_already_committed boolean;
begin
  if nullif(trim(p_idempotency_key), '') is null then
    raise exception using errcode = 'ZL400', message = 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  if p_session_id is not null then
    select * into s
      from public.zelomenu_cart_sessions
     where id = p_session_id
     for update;
    if not found then
      raise exception using errcode = 'ZL404', message = 'CART_NOT_FOUND';
    end if;
    if s.revision <> p_expected_revision then
      raise exception using errcode = 'ZL409', message = 'REVISION_CONFLICT';
    end if;
    if s.context not in ('public_order', 'table_order') then
      raise exception using errcode = 'ZL400', message = 'TABLE_ORDER_NOT_CANONICAL';
    end if;

    v_empresa := s.empresa_id;
    v_source := case when s.context = 'table_order' then 'mesa' else 'zelomenu' end;
    v_stock_already_committed := false;
    p_snapshots := jsonb_build_object(
      'customer', coalesce(s.customer_snapshot, '{}'::jsonb),
      'fulfillment', coalesce(s.fulfillment_snapshot, '{}'::jsonb) || case
        when s.context = 'table_order' then jsonb_build_object(
          'type', 'mesa',
          'mesaId', s.metadata->>'mesa_id',
          'comandaId', s.metadata->>'comanda_id'
        )
        else '{}'::jsonb
      end,
      'payment', coalesce(s.payment_snapshot, '{}'::jsonb),
      'pricing', coalesce(s.pricing_snapshot, '{}'::jsonb),
      'cart', coalesce(s.cart_snapshot, '{}'::jsonb),
      'source', v_source
    );

    if s.context = 'table_order' then
      perform 1
        from public.comandas c
        join public.mesas m on m.id = c.id_mesa
       where c.id = (s.metadata->>'comanda_id')::uuid
         and c.id_mesa = (s.metadata->>'mesa_id')::uuid
         and c.id_usuario = (select ep.user_id from public.empresa_perfil ep where ep.id = s.empresa_id)
         and c.status = 'aberta'
         and m.ativa = true
       for update of c;
      if not found then
        raise exception using errcode = 'ZL409', message = 'COMANDA_CLOSED';
      end if;

      if s.capability_id is not null then
        perform 1
          from public.zelomenu_table_capabilities c
         where c.id = s.capability_id
           and c.comanda_id = (s.metadata->>'comanda_id')::uuid
           and c.mesa_id = (s.metadata->>'mesa_id')::uuid
           and c.revoked_at is null
           and c.expires_at > now()
         for update;
        if not found then
          raise exception using errcode = 'ZL410', message = 'TABLE_SESSION_EXPIRED';
        end if;
      end if;
    end if;
  else
    v_empresa := nullif(p_snapshots->>'empresaId', '')::uuid;
    v_source := coalesce(nullif(p_snapshots->>'source', ''), 'manual');
    v_stock_already_committed := v_source = 'mesa'
      and nullif(p_snapshots#>>'{fulfillment,comandaItemId}', '') is not null;
  end if;

  if v_empresa is null then
    raise exception using errcode = 'ZL400', message = 'EMPRESA_REQUIRED';
  end if;
  if v_source not in ('zelomenu', 'zelochat', 'manual', 'legacy_zelochat', 'legacy_pedido', 'mesa') then
    raise exception using errcode = 'ZL400', message = 'INVALID_ORDER_SOURCE';
  end if;

  -- A CRM link is accepted only for this company's owner. The canonical
  -- snapshot is deliberately retained separately from this live relationship.
  if p_pessoa_id is not null and not exists (
    select 1
      from public.pessoas p
      join public.empresa_perfil ep on ep.id = v_empresa
     where p.id = p_pessoa_id
       and p.id_usuario = ep.user_id
  ) then
    raise exception using errcode = 'ZL404', message = 'CUSTOMER_NOT_FOUND';
  end if;

  select * into o
    from public.zelo_orders
   where zelomenu_session_id = p_session_id
      or (empresa_id = v_empresa and idempotency_key = p_idempotency_key)
   order by created_at
   limit 1
   for update;
  if found then
    return jsonb_build_object(
      'orderId', o.id,
      'orderStatus', o.status,
      'sessionState', case o.status when 'pending_payment' then 'confirmed_waiting_payment' else 'confirmed_waiting_review' end,
      'alreadyConfirmed', true,
      'revision', o.revision
    );
  end if;

  if p_session_id is not null and s.state <> 'cart_open' then
    raise exception using errcode = 'ZL409', message = 'CART_ALREADY_CLOSED';
  end if;
  if jsonb_typeof(p_snapshots#>'{cart,items}') <> 'array'
     or jsonb_array_length(p_snapshots#>'{cart,items}') not between 1 and 50 then
    raise exception using errcode = 'ZL400', message = 'INVALID_ITEMS';
  end if;

  v_subtotal := coalesce((p_snapshots#>>'{pricing,subtotal}')::numeric, 0);
  v_fee := coalesce((p_snapshots#>>'{pricing,deliveryFee}')::numeric, 0);
  v_discount := coalesce((p_snapshots#>>'{pricing,discount}')::numeric, 0);
  v_total := v_subtotal + v_fee - v_discount;
  if v_total < 0 or v_total > 1000000 then
    raise exception using errcode = 'ZL400', message = 'INVALID_TOTAL';
  end if;

  insert into public.zelo_orders(
    empresa_id, source, status, zelomenu_session_id, idempotency_key, pessoa_id,
    customer, fulfillment, payment, subtotal, delivery_fee, discount, total,
    observations, stock_committed_at
  )
  values (
    v_empresa,
    v_source,
    case when coalesce((p_snapshots#>>'{payment,pixReceiptRequired}')::boolean, false)
              and not coalesce((p_snapshots#>>'{payment,pixReceiptApproved}')::boolean, false)
         then 'pending_payment' else 'pending_review' end,
    p_session_id,
    p_idempotency_key,
    p_pessoa_id,
    coalesce(p_snapshots->'customer', '{}'::jsonb),
    coalesce(p_snapshots->'fulfillment', '{}'::jsonb),
    coalesce(p_snapshots->'payment', '{}'::jsonb),
    v_subtotal,
    v_fee,
    v_discount,
    v_total,
    p_snapshots#>>'{cart,observations}',
    case when v_stock_already_committed then now() else null end
  )
  returning * into o;

  for v_item in select value from jsonb_array_elements(p_snapshots#>'{cart,items}') loop
    if coalesce((v_item->>'quantity')::integer, 0) not between 1 and 999 then
      raise exception using errcode = 'ZL400', message = 'INVALID_QUANTITY';
    end if;
    if nullif(v_item->>'productId', '') is not null and not exists (
      select 1
        from public.produtos p
        join public.empresa_perfil ep on ep.id = v_empresa and ep.user_id = p.id_usuario
       where p.id = (v_item->>'productId')::bigint
    ) then
      raise exception using errcode = 'ZL404', message = 'PRODUCT_NOT_FOUND';
    end if;
    insert into public.zelo_order_items(
      order_id, product_id, name, unit_price, quantity, subtotal, modifiers, position
    )
    values (
      o.id,
      nullif(v_item->>'productId', '')::bigint,
      coalesce(nullif(v_item->>'productName', ''), 'Produto'),
      coalesce((v_item->>'unitPrice')::numeric, 0),
      (v_item->>'quantity')::integer,
      coalesce((v_item->>'lineTotal')::numeric, (v_item->>'unitPrice')::numeric * (v_item->>'quantity')::integer),
      coalesce(v_item->'selectedModifiers', v_item->'modifiers', '[]'),
      coalesce((v_item->>'position')::integer, 0)
    );
  end loop;

  if (select coalesce(sum(subtotal), 0) from public.zelo_order_items where order_id = o.id) <> v_subtotal then
    raise exception using errcode = 'ZL400', message = 'TOTAL_MISMATCH';
  end if;

  insert into public.zelo_order_events(order_id, empresa_id, event_type, to_status, detail)
    values (o.id, o.empresa_id, 'created', o.status, jsonb_build_object('source', o.source));
  insert into public.zelo_order_outbox(order_id, empresa_id, topic, payload, idempotency_key)
    values (o.id, o.empresa_id, 'order.created', public.zelo_order_result(o), 'order.created:' || o.id);

  if p_session_id is not null then
    update public.zelomenu_cart_sessions
       set state = case o.status when 'pending_payment' then 'confirmed_waiting_payment' else 'confirmed_waiting_review' end,
           confirmed_at = coalesce(confirmed_at, now()),
           updated_at = now(),
           metadata = coalesce(metadata, '{}'::jsonb)
             || jsonb_build_object('canonicalOrderId', o.id, 'idempotencyKey', p_idempotency_key)
     where id = p_session_id;
  end if;

  return jsonb_build_object(
    'orderId', o.id,
    'orderStatus', o.status,
    'sessionState', case o.status when 'pending_payment' then 'confirmed_waiting_payment' else 'confirmed_waiting_review' end,
    'alreadyConfirmed', false,
    'revision', o.revision
  );
exception when unique_violation then
  select * into o
    from public.zelo_orders
   where zelomenu_session_id = p_session_id
      or (empresa_id = v_empresa and idempotency_key = p_idempotency_key)
   order by created_at
   limit 1;
  if found then
    return jsonb_build_object(
      'orderId', o.id,
      'orderStatus', o.status,
      'sessionState', case o.status when 'pending_payment' then 'confirmed_waiting_payment' else 'confirmed_waiting_review' end,
      'alreadyConfirmed', true,
      'revision', o.revision
    );
  end if;
  raise;
end
$$;

revoke all on function public.create_zelo_order(uuid, integer, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.create_zelo_order(uuid, integer, text, jsonb, uuid)
  to service_role;

-- A deleted person must not erase sales, orders, snapshots or the fiado ledger.
-- Only the live relationship is cleared; all historical amounts remain.
create or replace function public.fiado_excluir_pessoa(p_id_pessoa uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_pessoa public.pessoas%rowtype;
  v_lancamentos_desvinculados integer := 0;
  v_vendas_desvinculadas integer := 0;
  v_pedidos_desvinculados integer := 0;
begin
  if v_actor is null then
    raise exception 'Nao autenticado.' using errcode = '28000';
  end if;

  v_owner := public.get_owner_user_id(v_actor);
  if not public.fiado_actor_can('pessoas.gerenciar', v_owner) then
    raise exception 'Voce nao tem permissao para excluir pessoas.' using errcode = '42501';
  end if;

  select * into v_pessoa
    from public.pessoas
   where id = p_id_pessoa
     and id_usuario = v_owner
   for update;
  if not found then
    raise exception 'Pessoa nao encontrada.' using errcode = 'P0002';
  end if;

  if coalesce(v_pessoa.saldo_fiado, 0) <> 0 then
    raise exception 'Nao e possivel excluir uma pessoa com saldo de fiado diferente de zero.' using errcode = '23514';
  end if;

  -- Preserve sales and their totals; only remove the CRM person link.
  update public.vendas
     set id_cliente = null,
         id_pessoa = null
   where id_usuario = v_owner
     and (id_cliente = v_pessoa.id or id_pessoa = v_pessoa.id);
  get diagnostics v_vendas_desvinculadas = row_count;

  -- Preserve canonical orders and their immutable customer snapshots.
  update public.zelo_orders
     set pessoa_id = null
   where empresa_id in (select ep.id from public.empresa_perfil ep where ep.user_id = v_owner)
     and pessoa_id = v_pessoa.id;
  get diagnostics v_pedidos_desvinculados = row_count;

  -- Preserve the financial history while allowing the person row to go away.
  update public.fiado_lancamentos
     set id_pessoa = null
   where id_usuario = v_owner
     and id_pessoa = v_pessoa.id;
  get diagnostics v_lancamentos_desvinculados = row_count;

  delete from public.pessoas
   where id = v_pessoa.id
     and id_usuario = v_owner;

  return jsonb_build_object(
    'excluida', true,
    'pessoa_id', v_pessoa.id,
    -- Kept for callers of the previous RPC response; no financial row is deleted.
    'lancamentos_excluidos', 0,
    'lancamentos_desvinculados', v_lancamentos_desvinculados,
    'vendas_desvinculadas', v_vendas_desvinculadas,
    'pedidos_desvinculados', v_pedidos_desvinculados
  );
end;
$$;

revoke all on function public.fiado_excluir_pessoa(uuid) from public, anon;
grant execute on function public.fiado_excluir_pessoa(uuid) to authenticated, service_role;

commit;

-- ============================================================================
-- 048_customer_relationship_foundation.sql
-- ============================================================================

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

-- ============================================================================
-- 049_customer_backfill_state.sql
-- ============================================================================

begin;

create table if not exists public.zelochat_customer_backfill_state (
  empresa_id uuid primary key references public.empresa_perfil(id) on delete cascade,
  cursor text,
  counts jsonb not null default '{"linked":0,"created":0,"incomplete":0,"conflict":0,"failed":0}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.zelochat_customer_backfill_state enable row level security;
revoke all on table public.zelochat_customer_backfill_state from public, anon, authenticated;
grant all on table public.zelochat_customer_backfill_state to service_role;
drop policy if exists zelochat_customer_backfill_state_browser_denied on public.zelochat_customer_backfill_state;
create policy zelochat_customer_backfill_state_browser_denied on public.zelochat_customer_backfill_state
  for all to anon, authenticated using (false) with check (false);

comment on table public.zelochat_customer_backfill_state is
  'Checkpoint server-only do backfill CRM; não dispara mensagens e pode ser retomado com segurança.';
commit;

-- ============================================================================
-- 050_customer_read_aggregates_and_conflict_dedupe.sql
-- ============================================================================

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
  select s.pessoa_id,
         max(case
           when nullif(trim(s.last_message_time), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
             then nullif(trim(s.last_message_time), '')::timestamptz
           else null
         end) last_conversation_at
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
  select s.pessoa_id,
         max(case
           when nullif(trim(s.last_message_time), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
             then nullif(trim(s.last_message_time), '')::timestamptz
           else null
         end) last_conversation_at
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

-- ============================================================================
-- 051_customer_merge_coordinator.sql
-- ============================================================================

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

-- ============================================================================
-- 052_customer_campaigns.sql
-- ============================================================================

begin;

-- Segmentos e campanhas são dados do ZeloChat, mas a identidade continua
-- sendo validada no servidor contra pessoas.id_usuario. O navegador não tem
-- acesso às tabelas: toda leitura/escrita passa pela API autenticada.
create table if not exists public.zelochat_segments (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  id_usuario uuid not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  definition jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zelochat_segments_empresa_name_unique unique (empresa_id, name),
  constraint zelochat_segments_empresa_owner_fk foreign key (empresa_id, id_usuario)
    references public.empresa_perfil(id, user_id) on delete cascade
);

create table if not exists public.zelochat_campaigns (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  id_usuario uuid not null,
  segment_id uuid null references public.zelochat_segments(id) on delete set null,
  name text not null check (length(btrim(name)) between 1 and 160),
  message text not null check (length(btrim(message)) between 1 and 4096),
  status text not null default 'draft' check (status in ('draft','scheduled','running','paused','completed','cancelled')),
  scheduled_at timestamptz,
  daily_limit integer not null default 50 check (daily_limit between 1 and 200),
  audience_version integer not null default 0,
  preview_version integer,
  tested_version integer,
  metrics jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zelochat_campaigns_empresa_owner_fk foreign key (empresa_id, id_usuario)
    references public.empresa_perfil(id, user_id) on delete cascade
);

create table if not exists public.zelochat_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.zelochat_campaigns(id) on delete cascade,
  empresa_id uuid not null,
  pessoa_id uuid not null,
  phone_snapshot text,
  name_snapshot text,
  status text not null default 'eligible' check (status in ('eligible','suppressed','queued','sending','sent','failed','cancelled')),
  suppression_reason text,
  idempotency_key text not null,
  attempts integer not null default 0 check (attempts >= 0),
  provider_message_id text,
  last_error text,
  queued_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zelochat_campaign_recipients_campaign_person_unique unique (campaign_id, pessoa_id),
  constraint zelochat_campaign_recipients_idempotency_unique unique (idempotency_key),
  constraint zelochat_campaign_recipients_empresa_fk foreign key (empresa_id)
    references public.empresa_perfil(id) on delete cascade
);

create table if not exists public.zelochat_customer_optouts (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  pessoa_id uuid not null,
  reason text not null default 'opt_out',
  source text not null default 'whatsapp' check (source in ('whatsapp','manual','campaign')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zelochat_customer_optouts_unique unique (empresa_id, pessoa_id),
  constraint zelochat_customer_optouts_empresa_fk foreign key (empresa_id) references public.empresa_perfil(id) on delete cascade
);

create index if not exists zelochat_campaigns_empresa_status_idx on public.zelochat_campaigns (empresa_id, status, scheduled_at);
create index if not exists zelochat_campaign_recipients_campaign_status_idx on public.zelochat_campaign_recipients (campaign_id, status, created_at);
create index if not exists zelochat_customer_optouts_empresa_person_idx on public.zelochat_customer_optouts (empresa_id, pessoa_id);

do $$ declare t text; begin
  foreach t in array array['zelochat_segments','zelochat_campaigns','zelochat_campaign_recipients','zelochat_customer_optouts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- Keep the grants explicit for migration inspection and least-privilege review.
revoke all on table public.zelochat_segments from public, anon, authenticated;
revoke all on table public.zelochat_campaigns from public, anon, authenticated;
revoke all on table public.zelochat_campaign_recipients from public, anon, authenticated;
revoke all on table public.zelochat_customer_optouts from public, anon, authenticated;
grant all on table public.zelochat_segments to service_role;
grant all on table public.zelochat_campaigns to service_role;
grant all on table public.zelochat_campaign_recipients to service_role;
grant all on table public.zelochat_customer_optouts to service_role;

-- Defense in depth. A service-role request still requires the API actor to
-- hold pessoas.visualizar or clientes.comunicar before using these tables.
comment on table public.zelochat_campaigns is 'CRM: preview exige pessoas.visualizar; teste/agendamento exige clientes.comunicar.';
comment on table public.zelochat_campaign_recipients is 'Audiência congelada no agendamento; nunca recalcular uma campanha já agendada.';

commit;

-- ============================================================================
-- 053_customer_outbound_jobs.sql
-- ============================================================================

begin;

create table if not exists public.zelochat_outbound_jobs (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa_perfil(id) on delete cascade,
  campaign_id uuid references public.zelochat_campaigns(id) on delete set null,
  recipient_id uuid references public.zelochat_campaign_recipients(id) on delete set null,
  pessoa_id uuid,
  job_type text not null default 'campaign' check (job_type in ('campaign','automation')),
  idempotency_key text not null unique,
  phone_snapshot text,
  message text not null check (length(message) between 1 and 4096),
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists zelochat_outbound_jobs_due_idx on public.zelochat_outbound_jobs (empresa_id, status, next_attempt_at);
create index if not exists zelochat_outbound_jobs_lease_idx on public.zelochat_outbound_jobs (status, lease_expires_at);
alter table public.zelochat_outbound_jobs enable row level security;
revoke all on table public.zelochat_outbound_jobs from public, anon, authenticated;
grant all on table public.zelochat_outbound_jobs to service_role;

-- Atomic claim: expired leases become available again and only one worker gets
-- each row. The worker still enforces one active sender per WhatsApp instance.
create or replace function public.claim_zelochat_outbound_job(p_worker text, p_lease_seconds integer default 120)
returns setof public.zelochat_outbound_jobs
language sql security invoker set search_path = public, pg_temp
as $$
  with candidate as (
    select id from public.zelochat_outbound_jobs
     where (status = 'queued' and next_attempt_at <= now())
        or (status = 'sending' and lease_expires_at < now())
     order by next_attempt_at, created_at, id
     for update skip locked limit 1
  )
  update public.zelochat_outbound_jobs j
     set status = 'sending', lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 15)),
         attempts = j.attempts + 1, updated_at = now()
    from candidate c where j.id = c.id returning j.*;
$$;
revoke all on function public.claim_zelochat_outbound_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_zelochat_outbound_job(text, integer) to service_role;

commit;

-- ============================================================================
-- 054_customer_automations.sql
-- ============================================================================

begin;

create table if not exists public.zelochat_automation_rules (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa_perfil(id) on delete cascade,
  id_usuario uuid not null,
  kind text not null check (kind in ('birthday','reactivation','post_purchase','vip','abandoned_cart')),
  enabled boolean not null default false,
  message text not null default '' check (length(message) <= 4096),
  timezone text not null default 'America/Sao_Paulo' check (timezone = 'America/Sao_Paulo'),
  send_start time not null default '09:00',
  send_end time not null default '20:00',
  config jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zelochat_automation_rules_empresa_owner_fk foreign key (empresa_id, id_usuario)
    references public.empresa_perfil(id, user_id) on delete cascade,
  constraint zelochat_automation_rules_empresa_kind_unique unique (empresa_id, kind),
  constraint zelochat_automation_rules_enabled_message check (not enabled or length(btrim(message)) > 0)
);

create table if not exists public.zelochat_automation_dispatches (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa_perfil(id) on delete cascade,
  rule_id uuid not null references public.zelochat_automation_rules(id) on delete cascade,
  pessoa_id uuid,
  cart_id uuid,
  event_key text not null,
  status text not null default 'eligible' check (status in ('eligible','suppressed','queued','sending','sent','failed','cancelled')),
  message text,
  phone_snapshot text,
  suppression_reason text,
  outbound_job_id uuid references public.zelochat_outbound_jobs(id) on delete set null,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  queued_at timestamptz,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint zelochat_automation_dispatches_event_unique unique (rule_id, event_key)
);

create index if not exists zelochat_automation_rules_empresa_enabled_idx on public.zelochat_automation_rules (empresa_id, enabled, kind);
create index if not exists zelochat_automation_dispatches_empresa_status_idx on public.zelochat_automation_dispatches (empresa_id, status, created_at desc);
create index if not exists zelochat_automation_dispatches_person_idx on public.zelochat_automation_dispatches (empresa_id, pessoa_id, created_at desc);

alter table public.zelochat_automation_rules enable row level security;
alter table public.zelochat_automation_dispatches enable row level security;
revoke all on table public.zelochat_automation_rules, public.zelochat_automation_dispatches from public, anon, authenticated;
grant all on table public.zelochat_automation_rules, public.zelochat_automation_dispatches to service_role;

comment on table public.zelochat_automation_dispatches is 'Ledger idempotente; o avaliador aprova/suprime e o worker apenas envia jobs queued.';

commit;

-- ============================================================================
-- 055_campaign_queue_hardening.sql
-- ============================================================================

begin;

alter table public.zelochat_outbound_jobs
  add column if not exists instance_key text not null default '';

create index if not exists zelochat_outbound_jobs_instance_due_idx
  on public.zelochat_outbound_jobs (instance_key, status, next_attempt_at);

-- Campaign jobs are claimable only while the campaign is running, or after a
-- scheduled campaign reaches its time. Paused/cancelled campaigns stay queued
-- for audit but cannot be sent. Recipients must still be queued at claim time.
create or replace function public.claim_zelochat_outbound_job(p_worker text, p_lease_seconds integer default 120)
returns setof public.zelochat_outbound_jobs
language sql security invoker set search_path = public, pg_temp
as $$
  with candidate as (
    select j.id
      from public.zelochat_outbound_jobs j
      left join public.zelochat_campaigns c on c.id = j.campaign_id
      left join public.zelochat_campaign_recipients r on r.id = j.recipient_id
     where j.attempts < j.max_attempts
       and ((j.status = 'queued' and j.next_attempt_at <= now())
         or (j.status = 'sending' and j.lease_expires_at < now()))
       and (j.campaign_id is null or (c.status in ('running', 'scheduled') and (c.status = 'running' or c.scheduled_at <= now())))
       and (j.recipient_id is null or j.job_type = 'automation' or r.status in ('queued', 'sending'))
     order by j.next_attempt_at, j.created_at, j.id
     for update of j skip locked limit 1
  )
  update public.zelochat_outbound_jobs j
     set status = 'sending', lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 15)),
         attempts = j.attempts + 1, updated_at = now()
    from candidate c where j.id = c.id returning j.*;
$$;

revoke all on function public.claim_zelochat_outbound_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_zelochat_outbound_job(text, integer) to service_role;

commit;

-- ============================================================================
-- 056_automation_limits_and_lease_terminal.sql
-- ============================================================================

begin;

alter table public.zelochat_automation_rules
  add column if not exists daily_limit integer not null default 50;
alter table public.zelochat_automation_rules
  drop constraint if exists zelochat_automation_rules_daily_limit_check;
alter table public.zelochat_automation_rules
  add constraint zelochat_automation_rules_daily_limit_check check (daily_limit between 1 and 200);

create or replace function public.release_zelochat_expired_leases()
returns integer language plpgsql security invoker set search_path = public, pg_temp as $$
declare terminal_count integer;
begin
  with terminal as (
    update public.zelochat_outbound_jobs
       set status = 'failed', last_error = 'Limite de tentativas atingido após expiração da reserva.',
           lease_owner = null, lease_expires_at = null, updated_at = now()
     where status = 'sending' and lease_expires_at < now() and attempts >= max_attempts
     returning id, recipient_id, job_type
  ), campaigns as (
    update public.zelochat_campaign_recipients r
       set status = 'failed', last_error = 'Limite de tentativas atingido após expiração da reserva.', updated_at = now()
      from terminal t where t.recipient_id = r.id and t.job_type = 'campaign'
      returning r.id
  ), automations as (
    update public.zelochat_automation_dispatches d
       set status = 'failed', last_error = 'Limite de tentativas atingido após expiração da reserva.', updated_at = now()
      from terminal t where t.recipient_id = d.id and t.job_type = 'automation'
      returning d.id
  )
  select count(*) into terminal_count from terminal;
  update public.zelochat_outbound_jobs set status = 'queued', lease_owner = null, lease_expires_at = null, updated_at = now()
   where status = 'sending' and lease_expires_at < now() and attempts < max_attempts;
  return terminal_count;
end $$;
revoke all on function public.release_zelochat_expired_leases() from public, anon, authenticated;
grant execute on function public.release_zelochat_expired_leases() to service_role;
commit;

-- ============================================================================
-- 057_customer_crm_rollout.sql
-- ============================================================================

begin;

create table if not exists public.zelochat_crm_rollout_flags (
  empresa_id uuid primary key references public.empresa_perfil(id) on delete cascade,
  crm_enabled boolean not null default false,
  campaigns_enabled boolean not null default false,
  automations_enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.zelochat_crm_metrics_daily (
  empresa_id uuid not null references public.empresa_perfil(id) on delete cascade,
  metric_date date not null default current_date,
  customers_total integer not null default 0, customers_with_phone integer not null default 0, customers_conflicts integer not null default 0,
  profile_views integer not null default 0, filter_uses integer not null default 0,
  campaigns_created integer not null default 0, campaigns_sent integer not null default 0, campaigns_paused integer not null default 0, campaigns_failed integer not null default 0,
  automations_enabled integer not null default 0, jobs_sent integer not null default 0, jobs_failed integer not null default 0, jobs_suppressed integer not null default 0,
  responses_attributed integer not null default 0, orders_attributed integer not null default 0, optouts integer not null default 0,
  queue_size integer not null default 0, queue_oldest_seconds integer not null default 0, leases_stuck integer not null default 0, disconnected integer not null default 0,
  updated_at timestamptz not null default now(), primary key (empresa_id, metric_date)
);

create or replace function public.increment_zelochat_crm_metric(p_empresa_id uuid, p_metric text, p_value integer)
returns void language plpgsql security definer set search_path = public as $$
declare col text := lower(trim(p_metric));
begin
  if col not in ('customers_total','customers_with_phone','customers_conflicts','profile_views','filter_uses','campaigns_created','campaigns_sent','campaigns_paused','campaigns_failed','automations_enabled','jobs_sent','jobs_failed','jobs_suppressed','responses_attributed','orders_attributed','optouts','queue_size','queue_oldest_seconds','leases_stuck','disconnected') then raise exception 'invalid CRM metric'; end if;
  insert into public.zelochat_crm_metrics_daily (empresa_id, metric_date) values (p_empresa_id, current_date) on conflict do nothing;
  execute format('update public.zelochat_crm_metrics_daily set %I = greatest(0, %I + $1), updated_at = now() where empresa_id = $2 and metric_date = current_date', col, col) using greatest(p_value, 0), p_empresa_id;
end $$;

alter table public.zelochat_crm_rollout_flags enable row level security;
alter table public.zelochat_crm_metrics_daily enable row level security;
revoke all on table public.zelochat_crm_rollout_flags, public.zelochat_crm_metrics_daily from public, anon, authenticated;
grant all on table public.zelochat_crm_rollout_flags, public.zelochat_crm_metrics_daily to service_role;
grant all on table public.zelochat_crm_rollout_flags to service_role;
grant all on table public.zelochat_crm_metrics_daily to service_role;
revoke all on function public.increment_zelochat_crm_metric(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.increment_zelochat_crm_metric(uuid, text, integer) to service_role;

commit;

-- ============================================================================
-- 058_automation_dispatch_jobs.sql
-- ============================================================================

begin;

alter table public.zelochat_outbound_jobs
  add column if not exists automation_dispatch_id uuid references public.zelochat_automation_dispatches(id) on delete set null;
create index if not exists zelochat_outbound_jobs_automation_dispatch_idx
  on public.zelochat_outbound_jobs (automation_dispatch_id) where automation_dispatch_id is not null;
comment on column public.zelochat_outbound_jobs.recipient_id is 'Campaign recipient only; automation jobs use automation_dispatch_id.';

commit;

-- ============================================================================
-- 059_automation_dispatch_lease_terminal.sql
-- ============================================================================

begin;

-- Migration 058 split campaign recipients from automation dispatches. Recreate
-- the lease recovery RPC so terminal automation jobs update the dispatch FK,
-- never the campaign-only recipient_id column.
create or replace function public.release_zelochat_expired_leases()
returns integer language plpgsql security invoker set search_path = public, pg_temp as $$
declare terminal_count integer;
begin
  with terminal as (
    update public.zelochat_outbound_jobs
       set status = 'failed', last_error = 'Limite de tentativas atingido após expiração da reserva.',
           lease_owner = null, lease_expires_at = null, updated_at = now()
     where status = 'sending' and lease_expires_at < now() and attempts >= max_attempts
     returning id, recipient_id, automation_dispatch_id, job_type
  ), campaigns as (
    update public.zelochat_campaign_recipients r
       set status = 'failed', last_error = 'Limite de tentativas atingido após expiração da reserva.', updated_at = now()
      from terminal t where t.recipient_id = r.id and t.job_type = 'campaign'
      returning r.id
  ), automations as (
    update public.zelochat_automation_dispatches d
       set status = 'failed', last_error = 'Limite de tentativas atingido após expiração da reserva.', updated_at = now()
      from terminal t where t.automation_dispatch_id = d.id and t.job_type = 'automation'
      returning d.id
  )
  select count(*) into terminal_count from terminal;

  update public.zelochat_outbound_jobs
     set status = 'queued', lease_owner = null, lease_expires_at = null, updated_at = now()
   where status = 'sending' and lease_expires_at < now() and attempts < max_attempts;
  return terminal_count;
end $$;

revoke all on function public.release_zelochat_expired_leases() from public, anon, authenticated;
grant execute on function public.release_zelochat_expired_leases() to service_role;

-- ============================================================================
-- MIGRATION 060 — índices FK/search do CRM
-- ============================================================================

create index if not exists zelochat_sessions_empresa_owner_idx
  on public.zelochat_sessions (empresa_id, owner_user_id);
create index if not exists zelochat_sessions_owner_person_idx
  on public.zelochat_sessions (owner_user_id, pessoa_id)
  where pessoa_id is not null;
create index if not exists zelochat_customer_relationships_empresa_owner_idx
  on public.zelochat_customer_relationships (empresa_id, id_usuario);
create index if not exists zelochat_customer_relationships_person_owner_idx
  on public.zelochat_customer_relationships (id_usuario, pessoa_id);
create index if not exists zelochat_customer_relationships_updated_by_idx
  on public.zelochat_customer_relationships (updated_by)
  where updated_by is not null;
create index if not exists zelochat_person_tags_empresa_owner_idx
  on public.zelochat_person_tags (empresa_id, id_usuario);
create index if not exists zelochat_person_tags_person_owner_idx
  on public.zelochat_person_tags (id_usuario, pessoa_id);
create index if not exists zelochat_person_match_conflicts_resolved_by_idx
  on public.zelochat_person_match_conflicts (resolved_by)
  where resolved_by is not null;
create index if not exists zelochat_segments_empresa_owner_idx
  on public.zelochat_segments (empresa_id, id_usuario);
create index if not exists zelochat_segments_created_by_idx
  on public.zelochat_segments (created_by)
  where created_by is not null;
create index if not exists zelochat_campaigns_empresa_owner_idx
  on public.zelochat_campaigns (empresa_id, id_usuario);
create index if not exists zelochat_campaigns_segment_idx
  on public.zelochat_campaigns (segment_id)
  where segment_id is not null;
create index if not exists zelochat_campaigns_created_by_idx
  on public.zelochat_campaigns (created_by)
  where created_by is not null;
create index if not exists zelochat_campaign_recipients_empresa_person_idx
  on public.zelochat_campaign_recipients (empresa_id, pessoa_id, status, created_at desc);
create index if not exists zelochat_outbound_jobs_campaign_idx
  on public.zelochat_outbound_jobs (campaign_id)
  where campaign_id is not null;
create index if not exists zelochat_outbound_jobs_recipient_idx
  on public.zelochat_outbound_jobs (recipient_id)
  where recipient_id is not null;
create index if not exists zelochat_automation_rules_empresa_owner_idx
  on public.zelochat_automation_rules (empresa_id, id_usuario);
create index if not exists zelochat_automation_dispatches_outbound_job_idx
  on public.zelochat_automation_dispatches (outbound_job_id)
  where outbound_job_id is not null;
create index if not exists zelochat_crm_rollout_flags_updated_by_idx
  on public.zelochat_crm_rollout_flags (updated_by)
  where updated_by is not null;

commit;

-- ============================================================================
-- VERIFICAÇÃO PÓS-MIGRATIONS — não misturar ao bloco de migrations
-- ============================================================================


-- ============================================================================
-- VERIFICATION — execute separately after migrations
-- ============================================================================

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
    select 1 from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'zelochat_sessions'
       and c.column_name = 'pessoa_id' and c.is_nullable = 'YES'
  ) then
    raise exception 'pessoa_id is not nullable on sessions';
  end if;
  if not exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'zelochat_sessions'
       and c.column_name = 'owner_user_id' and c.is_nullable = 'NO'
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

create or replace function pg_temp.crm_assert_browser_crm_denied()
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
      execute 'update public.zelochat_person_tags set tag_id = tag_id where empresa_id = $1 and pessoa_id = $2 and tag_id = $3'
        using f.empresa_a, f.pessoa_a, f.tag_a;
    else
      execute 'update public.zelochat_person_match_conflicts set state = state where id = $1'
        using target.row_id;
    end if;
    get diagnostics affected_rows = row_count;
    if affected_rows <> 0 then
      raise exception '% changed CRM rows through UPDATE', current_user;
    end if;

    if target.table_name = 'zelochat_person_tags' then
      execute 'delete from public.zelochat_person_tags where empresa_id = $1 and pessoa_id = $2 and tag_id = $3'
        using f.empresa_a, f.pessoa_a, f.tag_a;
    else
      execute format('delete from public.%I where id = $1', target.table_name)
        using target.row_id;
    end if;
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
select pg_temp.crm_assert_browser_crm_denied();
reset role;
set local role authenticated;
select pg_temp.crm_assert_browser_crm_denied();
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
