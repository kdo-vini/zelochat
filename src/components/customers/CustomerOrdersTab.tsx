import { useEffect, useRef, useState } from 'react';
import { fetchCustomerOrders, type CustomerDetail } from '../../services/customerApi';
import { orderStatusLabel } from '../../domain/orderStatusLabels';

export function CustomerOrdersTab({ customer, token }: { customer: CustomerDetail; token: string | null }) {
  const activeCustomerId = useRef(customer.id);
  const [orders, setOrders] = useState(() => customer.orders);
  const [nextCursor, setNextCursor] = useState(() => customer.ordersNextCursor);
  const [hasMore, setHasMore] = useState(() => customer.ordersHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    activeCustomerId.current = customer.id;
    setOrders(customer.orders);
    setNextCursor(customer.ordersNextCursor);
    setHasMore(customer.ordersHasMore);
    setLoadingMore(false);
    setError(null);
  }, [customer.id, customer.orders, customer.ordersNextCursor, customer.ordersHasMore, token]);
  const average = customer.orderCount ? customer.totalValue / customer.orderCount : 0;
  const loadMore = async () => {
    if (!token || !hasMore || !nextCursor || loadingMore) return;
    const requestedCustomerId = customer.id;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchCustomerOrders(token, customer.id, nextCursor);
      if (activeCustomerId.current !== requestedCustomerId) return;
      setOrders((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      if (activeCustomerId.current === requestedCustomerId) setError('Não foi possível carregar mais pedidos. Tente novamente.');
    } finally {
      if (activeCustomerId.current === requestedCustomerId) setLoadingMore(false);
    }
  };
  return <div className="p-4"><div className="mb-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-[var(--color-surface-muted)] p-2"><strong className="block text-[15px] text-[var(--color-ink)]">{customer.orderCount}</strong><span className="text-[11px] text-[var(--color-ink-faint)]">Compras</span></div><div className="rounded-lg bg-[var(--color-surface-muted)] p-2"><strong className="block text-[15px] text-[var(--color-ink)]">R$ {customer.totalValue.toFixed(2).replace('.', ',')}</strong><span className="text-[11px] text-[var(--color-ink-faint)]">Total gasto</span></div><div className="rounded-lg bg-[var(--color-surface-muted)] p-2"><strong className="block text-[15px] text-[var(--color-ink)]">R$ {average.toFixed(2).replace('.', ',')}</strong><span className="text-[11px] text-[var(--color-ink-faint)]">Ticket médio</span></div></div>{error && <p role="alert" className="mb-3 text-[12px] text-[var(--color-alert)]">{error}</p>}{orders.length === 0 ? <p className="text-[13px] text-[var(--color-ink-muted)]">Nenhuma compra vinculada.</p> : <><ul className="divide-y divide-[var(--color-line)]">{orders.map((order) => <li key={order.id} className="flex items-center justify-between py-3 text-[13px]"><span className="text-[var(--color-ink-muted)]">{new Date(order.createdAt).toLocaleDateString('pt-BR')} · {order.origin === 'counter' ? 'Balcão' : orderStatusLabel(order.status ?? '')}</span><strong className="text-[var(--color-ink)]">R$ {order.total.toFixed(2).replace('.', ',')}</strong></li>)}</ul>{hasMore && <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="m-3 min-h-[44px] w-[calc(100%-1.5rem)] rounded-lg border border-[var(--color-line)] text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50">{loadingMore ? 'Carregando…' : 'Carregar mais'}</button>}</>}</div>;
}
