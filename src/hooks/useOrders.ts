import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';
// WS_URL removido após P2.5 — websocket secundário deletado, realtime do
// Supabase cuida das atualizações de zelochat_orders.
import { updateOrderStatusApi } from '../services/waApi';
import type { Order } from '../types';

type NewOrder = Omit<Order, 'id' | 'createdAt'>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ORDER_LOOKBACK_DAYS = 14;
const ORDER_LIST_LIMIT = 1000;
const ORDER_COLUMNS = 'id, customer_name, customer_phone, items, pickup_date, pickup_time, delivery_address, driver_id, payment_method, observations, status, total, created_at';

function saoPauloDateKey(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * MS_PER_DAY);
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function rowToOrder(row: Record<string, unknown>): Order {
  return {
    id:              row.id as string,
    customerName:    row.customer_name as string,
    customerPhone:   (row.customer_phone as string | null) ?? '',
    items:           (row.items as Order['items']) ?? [],
    pickupDate:      row.pickup_date as string,
    pickupTime:      row.pickup_time as string,
    deliveryAddress: (row.delivery_address as string | null) ?? undefined,
    driverId:        (row.driver_id as string | null) ?? undefined,
    paymentMethod:   (row.payment_method as string | null) ?? undefined,
    observations:    (row.observations as string | null) ?? undefined,
    status:          row.status as Order['status'],
    total:           Number(row.total),
    createdAt:       row.created_at as string,
  };
}

export function useOrders(
  session: Session | null,
  onNewOrder?: (order: Order) => void,
  options: { enabled?: boolean } = {},
) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = options.enabled ?? true;
  // Cached per user — cleared when session.user.id changes to prevent stale cross-account inserts.
  const empresaIdRef = useRef<string | null>(null);
  const lastUserIdRef = useRef<string | null>(null);
  const onNewOrderRef = useRef(onNewOrder);
  useEffect(() => { onNewOrderRef.current = onNewOrder; }, [onNewOrder]);

  const fetchEmpresaId = useCallback(async (userId: string): Promise<string | null> => {
    const { data } = await supabase
      .from('empresa_perfil')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }, []);

  // P0.21 — every Supabase query in this hook explicitly scopes by empresa_id.
  // The frontend uses the ANON key so RLS already enforces the boundary, but
  // defense-in-depth matters here: if the `zelochat_orders` RLS policy is ever
  // weakened (or replaced with a permissive `authenticated` rule by mistake),
  // an explicit `.eq('empresa_id', empresaId)` ensures we still don't leak
  // other tenants' orders to this operator. Cost: one extra `empresa_perfil`
  // round-trip on first load if empresaIdRef isn't seeded yet.
  const refresh = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) {
      setOrders([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let empresaId = empresaIdRef.current;
      if (!empresaId) {
        empresaId = await fetchEmpresaId(userId);
        if (!empresaId) {
          setOrders([]);
          return;
        }
        empresaIdRef.current = empresaId;
      }

      const startDate = saoPauloDateKey(-ORDER_LOOKBACK_DAYS);
      const { data, error: dbError, count } = await supabase
        .from('zelochat_orders')
        .select(ORDER_COLUMNS, { count: 'exact' })
        .eq('empresa_id', empresaId)
        .or(`status.neq.delivered,pickup_date.gte.${startDate}`)
        .order('pickup_date', { ascending: true })
        .order('pickup_time', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(ORDER_LIST_LIMIT);

      if (dbError) throw dbError;
      if ((count ?? 0) > ORDER_LIST_LIMIT) {
        console.warn(`[orders] lista operacional limitada a ${ORDER_LIST_LIMIT}/${count} pedidos; histórico precisa de paginação.`);
      }
      setOrders((data ?? []).map(rowToOrder));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os pedidos.');
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id, fetchEmpresaId]);

  // Initial fetch + real-time subscription scoped to this empresa
  useEffect(() => {
    const userId = session?.user?.id ?? null;

    // Clear cached empresaId whenever the logged-in user changes
    if (userId !== lastUserIdRef.current) {
      empresaIdRef.current = null;
      lastUserIdRef.current = userId;
    }

    if (!userId) {
      setOrders([]);
      return;
    }
    if (!enabled) return;

    void refresh();

    // Resolve empresaId so we can filter the realtime subscription
    let channelSubscribed = false;
    let cleanup: (() => void) | null = null;

    fetchEmpresaId(userId).then((empresaId) => {
      if (!empresaId) return;
      empresaIdRef.current = empresaId;

      const channel = supabase
        .channel(`zelochat_orders_rt_${empresaId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'zelochat_orders',
            filter: `empresa_id=eq.${empresaId}`,
          },
          (payload) => {
            if (payload.eventType === 'INSERT') {
              const order = rowToOrder(payload.new as Record<string, unknown>);
              setOrders((prev) => [order, ...prev]);
              onNewOrderRef.current?.(order);
            } else if (payload.eventType === 'UPDATE') {
              setOrders((prev) =>
                prev.map((o) =>
                  o.id === (payload.new as { id: string }).id
                    ? rowToOrder(payload.new as Record<string, unknown>)
                    : o,
                ),
              );
            } else if (payload.eventType === 'DELETE') {
              setOrders((prev) =>
                prev.filter((o) => o.id !== (payload.old as { id: string }).id),
              );
            }
          },
        )
        .subscribe();

      channelSubscribed = true;
      cleanup = () => { void supabase.removeChannel(channel); };
    }).catch(() => {/* empresa not found — no realtime */});

    return () => {
      if (channelSubscribed && cleanup) cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, enabled]);

  const addOrder = useCallback(async (payload: NewOrder): Promise<Order> => {
    if (!session?.user?.id) throw new Error('Faça login para adicionar pedidos.');

    // Re-resolve if ref was cleared (e.g. after account switch)
    if (!empresaIdRef.current) {
      empresaIdRef.current = await fetchEmpresaId(session.user.id);
    }
    const empresaId = empresaIdRef.current;
    if (!empresaId) throw new Error('Perfil da empresa não encontrado.');

    const { data, error: dbError } = await supabase
      .from('zelochat_orders')
      .insert({
        empresa_id:       empresaId,
        customer_name:    payload.customerName,
        customer_phone:   payload.customerPhone || null,
        items:            payload.items,
        pickup_date:      payload.pickupDate,
        pickup_time:      payload.pickupTime,
        delivery_address: payload.deliveryAddress ?? null,
        driver_id:        payload.driverId ?? null,
        payment_method:   payload.paymentMethod ?? null,
        observations:     payload.observations ?? null,
        status:           payload.status,
        total:            payload.total,
        source:           'manual',
      })
      .select(ORDER_COLUMNS)
      .single();

    if (dbError) throw dbError;
    return rowToOrder(data as Record<string, unknown>);
  }, [session?.user?.id, fetchEmpresaId]);

  const updateOrderStatus = useCallback(async (id: string, status: Order['status']): Promise<void> => {
    const token = session?.access_token;
    if (!token) throw new Error('Faça login para atualizar pedidos.');
    await updateOrderStatusApi(token, id, status);
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
  }, [session?.access_token]);

  const deleteOrder = useCallback(async (id: string): Promise<void> => {
    // P0.21 — explicit empresa scope on DELETE. RLS would catch a wrong-tenant
    // delete via 0-rows-affected, but the frontend wouldn't notice (no error
    // is thrown). Adding the filter makes a misroute fail loud.
    const userId = session?.user?.id;
    if (!userId) throw new Error('Faça login para excluir pedidos.');
    let empresaId = empresaIdRef.current;
    if (!empresaId) {
      empresaId = await fetchEmpresaId(userId);
      if (!empresaId) throw new Error('Perfil da empresa não encontrado.');
      empresaIdRef.current = empresaId;
    }
    const { error: dbError } = await supabase
      .from('zelochat_orders')
      .delete()
      .eq('id', id)
      .eq('empresa_id', empresaId);

    if (dbError) throw dbError;
    setOrders((prev) => prev.filter((o) => o.id !== id));
  }, [session?.user?.id, fetchEmpresaId]);

  const updateOrder = useCallback(async (id: string, patch: Partial<Omit<Order, 'id' | 'createdAt'>>): Promise<void> => {
    const update: Record<string, unknown> = {};
    if (patch.customerName    !== undefined) update.customer_name     = patch.customerName;
    if (patch.customerPhone   !== undefined) update.customer_phone    = patch.customerPhone || null;
    if (patch.items           !== undefined) update.items             = patch.items;
    if (patch.pickupDate      !== undefined) update.pickup_date       = patch.pickupDate;
    if (patch.pickupTime      !== undefined) update.pickup_time       = patch.pickupTime;
    if (patch.deliveryAddress !== undefined) update.delivery_address  = patch.deliveryAddress ?? null;
    if (patch.status          !== undefined) update.status            = patch.status;
    if (patch.total           !== undefined) update.total             = patch.total;
    if (patch.driverId        !== undefined) update.driver_id         = patch.driverId ?? null;
    if (patch.paymentMethod   !== undefined) update.payment_method    = patch.paymentMethod ?? null;
    if (patch.observations    !== undefined) update.observations      = patch.observations ?? null;

    // P0.21 — explicit empresa scope on UPDATE (same rationale as deleteOrder).
    const userId = session?.user?.id;
    if (!userId) throw new Error('Faça login para atualizar pedidos.');
    let empresaId = empresaIdRef.current;
    if (!empresaId) {
      empresaId = await fetchEmpresaId(userId);
      if (!empresaId) throw new Error('Perfil da empresa não encontrado.');
      empresaIdRef.current = empresaId;
    }
    const { error: dbError } = await supabase
      .from('zelochat_orders')
      .update(update)
      .eq('id', id)
      .eq('empresa_id', empresaId);

    if (dbError) throw dbError;
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }, [session?.user?.id, fetchEmpresaId]);

  // P2.5 — segundo WebSocket REMOVIDO. Era redundante com a Supabase
  // realtime subscription acima (que já pega INSERT/UPDATE/DELETE em
  // zelochat_orders e atualiza o local state sem precisar refetch). Esta
  // segunda WS conexão era unauthenticated (só hitava WS_URL sem token),
  // duplicava a conexão WS por aba e disparava um refresh() completo a
  // cada `order_created` em vez de apenas adicionar a row nova.
  // Migração 012 ativou realtime em zelochat_orders — esse useEffect já
  // estava obsoleto.

  return { orders, loading, error, refresh, addOrder, updateOrderStatus, updateOrder, deleteOrder };
}
