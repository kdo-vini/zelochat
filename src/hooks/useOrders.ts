import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';
import { WS_URL } from '../config';
import { updateOrderStatusApi } from '../services/waApi';
import type { Order } from '../types';

type NewOrder = Omit<Order, 'id' | 'createdAt'>;

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

export function useOrders(session: Session | null, onNewOrder?: (order: Order) => void) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

      const { data, error: dbError } = await supabase
        .from('zelochat_orders')
        .select('*')
        .eq('empresa_id', empresaId)
        .order('created_at', { ascending: false });

      if (dbError) throw dbError;
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
  }, [session?.user?.id]);

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
      .select()
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

  // Refresh orders whenever the server confirms a new WhatsApp order
  useEffect(() => {
    if (!session?.user?.id) return;
    const ws = new WebSocket(WS_URL);
    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data as string);
        if (parsed.type === 'order_created') void refresh();
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, [session?.user?.id, refresh]);

  return { orders, loading, error, refresh, addOrder, updateOrderStatus, updateOrder, deleteOrder };
}
