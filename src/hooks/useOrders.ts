import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';
// WS_URL removido após P2.5 — websocket secundário deletado, realtime do
// Supabase cuida das atualizações de zelochat_orders.
import { cancelOrderApi, createManualOrderApi, updateOrderStatusApi } from '../services/waApi';
import type { Order } from '../types';
import { CANONICAL_ORDER_SELECT, canonicalRowToOrder, type CanonicalOrderRow } from '../domain/canonicalOrders';
import { selectOrdersToAutoPrint } from '../domain/orderAutoPrint';

type NewOrder = Omit<Order, 'id' | 'createdAt'> & { idempotencyKey?: string };

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ORDER_LOOKBACK_DAYS = 14;
const ORDER_LIST_LIMIT = 1000;
const ORDER_COLUMNS = CANONICAL_ORDER_SELECT;

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

const rowToOrder = (row: Record<string, unknown>): Order => canonicalRowToOrder(row as CanonicalOrderRow);

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

  // Reconciliation safety net refs
  const ordersRef = useRef<Order[]>([]);
  const hasBaselineRef = useRef(false);
  const isRefreshingRef = useRef(false);

  // Keep ordersRef in sync with the latest committed orders state
  useEffect(() => { ordersRef.current = orders; }, [orders]);

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

    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;

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
        .from('zelo_orders')
        .select(ORDER_COLUMNS, { count: 'exact' })
        .eq('empresa_id', empresaId)
        // Active orders always show, regardless of age. Terminal orders only show
        // within the lookback window, and only delivered/closed — rejected/cancelled
        // have no UI status slot (see canonicalStatusToUi) and must never resurface,
        // or they render as a ghost "Pendente" card that looks impossible to delete.
        .or(`status.not.in.(delivered,rejected,cancelled,closed),and(status.in.(delivered,closed),created_at.gte.${startDate}T00:00:00-03:00)`)
        .order('created_at', { ascending: false })
        .limit(ORDER_LIST_LIMIT);

      if (dbError) throw dbError;
      if ((count ?? 0) > ORDER_LIST_LIMIT) {
        console.warn(`[orders] lista operacional limitada a ${ORDER_LIST_LIMIT}/${count} pedidos; histórico precisa de paginação.`);
      }

      const mapped = ((data ?? []) as unknown as Record<string, unknown>[]).map(rowToOrder);

      // Reconciliation safety net — on non-baseline calls, diff against the
      // previously-known orders and auto-print anything new that wasn't caught
      // by the realtime INSERT event (which has no delivery guarantee).
      if (hasBaselineRef.current) {
        const newOrders = selectOrdersToAutoPrint(ordersRef.current, mapped, {
          maxAgeMs: 15 * 60 * 1000,
          now: Date.now(),
        });
        for (const order of newOrders) {
          onNewOrderRef.current?.(order);
        }
      } else {
        hasBaselineRef.current = true;
      }

      setOrders(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os pedidos.');
    } finally {
      setLoading(false);
      isRefreshingRef.current = false;
    }
  }, [session?.user?.id, fetchEmpresaId]);

  // Initial fetch + real-time subscription scoped to this empresa
  useEffect(() => {
    const userId = session?.user?.id ?? null;

    // Clear cached empresaId whenever the logged-in user changes
    if (userId !== lastUserIdRef.current) {
      empresaIdRef.current = null;
      hasBaselineRef.current = false;
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
        .channel(`zelo_orders_rt_${empresaId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'zelo_orders',
            filter: `empresa_id=eq.${empresaId}`,
          },
          (payload) => {
            if (payload.eventType === 'INSERT') {
              const id = (payload.new as { id: string }).id;
              void supabase.from('zelo_orders').select(ORDER_COLUMNS)
                .eq('id', id).eq('empresa_id', empresaId).single()
                .then(({ data }) => {
                  if (!data) return;
                  const order = rowToOrder(data as unknown as Record<string, unknown>);
                  let inserted = false;
                  setOrders((prev) => {
                    if (prev.some((existing) => existing.id === order.id)) return prev;
                    inserted = true;
                    return [order, ...prev];
                  });
                  if (inserted) onNewOrderRef.current?.(order);
                });
            } else if (payload.eventType === 'UPDATE') {
              void refresh();
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

  // Polling safety net — refresh every 30s regardless of Realtime state to
  // catch any INSERT events that Supabase Realtime missed (no delivery guarantee).
  useEffect(() => {
    if (!enabled || !session?.user?.id) return;
    const id = setInterval(() => { void refresh(); }, 30_000);
    return () => clearInterval(id);
  }, [enabled, session?.user?.id, refresh]);

  // Tab visibility — catch the "laptop woke from sleep / tab backgrounded" case
  // fast, so a missed Realtime event during sleep triggers an immediate reconciliation.
  useEffect(() => {
    if (!enabled || !session?.user?.id) return;
    const handler = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [enabled, session?.user?.id, refresh]);

  const addOrder = useCallback(async (payload: NewOrder): Promise<Order> => {
    if (!session?.user?.id) throw new Error('Faça login para adicionar pedidos.');
    const token = session.access_token;
    if (!token) throw new Error('Sessão expirada.');

    const items = payload.items.map((it) => ({
      product: it.product,
      quantity: it.quantity,
      unitPrice: it.unitPrice ?? 0,
    }));

    const { order } = await createManualOrderApi(token, {
      customerName: payload.customerName,
      customerPhone: payload.customerPhone,
      items,
      pickupDate: payload.pickupDate,
      pickupTime: payload.pickupTime,
      deliveryAddress: payload.deliveryAddress,
      paymentMethod: payload.paymentMethod,
      observations: payload.observations,
      idempotencyKey: payload.idempotencyKey,
    });

    // Optimistically add to state; the realtime INSERT handler will deduplicate by id.
    setOrders((prev) => {
      if (prev.some((existing) => existing.id === order.id)) return prev;
      return [order, ...prev];
    });
    return order;
  }, [session?.user?.id, session?.access_token]);

  const updateOrderStatus = useCallback(async (id: string, status: Order['status']): Promise<void> => {
    const token = session?.access_token;
    if (!token) throw new Error('Faça login para atualizar pedidos.');
    const current = orders.find((order) => order.id === id);
    if (!current) throw new Error('Pedido nÃ£o encontrado.');
    await updateOrderStatusApi(token, id, status, current.revision ?? 0);
    const accepted = current.requiresAcceptance === true && (status === 'pending' || status === 'preparing');
    // Optimistically stamp closedAt on delivery so the Produção board keeps the
    // card during its linger window (see filterProductionBoardOrders). The
    // server sets the authoritative closed_at ~immediately; the AppShell sync
    // effect treats same-status rows as equal, so this optimistic value is what
    // reaches the board until a full status change re-syncs.
    const stampClosedAt = status === 'delivered' && !current.closedAt;
    const updatedOrder = {
      ...current,
      status,
      ...(stampClosedAt ? { closedAt: new Date().toISOString() } : {}),
      ...(accepted ? { requiresAcceptance: false } : {}),
    };
    setOrders((prev) => prev.map((o) => (o.id === id ? updatedOrder : o)));
  }, [session?.access_token, orders]);

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
    const token = session.access_token;
    await cancelOrderApi(token, id, orders.find((order) => order.id === id)?.revision ?? -1);
    setOrders((prev) => prev.filter((o) => o.id !== id));
  }, [session?.user?.id, fetchEmpresaId, orders]);

  const updateOrder = useCallback(async (id: string, patch: Partial<Omit<Order, 'id' | 'createdAt'>>): Promise<void> => {
    void id;
    void patch;
    throw new Error('Edite o pedido no ZeloMenu antes do aceite; depois dele, use apenas as transições operacionais.');
    /* adapter legado deliberadamente inalcançável durante a remoção da UI de edição
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
      .from('zelo_orders')
      .update(update)
      .eq('id', id)
      .eq('empresa_id', empresaId);

    if (dbError) throw dbError;
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
    */
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
