import type { Order } from '../types';

export interface SelectOrdersToAutoPrintOptions {
  /** Only flag orders created within this many ms of `now`. Guards against reconciliation resurfacing old orders (e.g. a lookback-window boundary shift at midnight) as if they were new. */
  maxAgeMs: number;
  now: number;
}

export function isIfoodSourcedOrder(order: Pick<Order, 'source'> | null | undefined): boolean {
  return order?.source === 'ifood';
}

/**
 * iFood print ownership is PDV (`print_owner=zelo`) or the iFood app
 * (`print_owner=external`). ZeloChat is never that owner — auto-printing an
 * iFood canonical row here always duplicates a ticket.
 */
export function shouldAutoPrintOrder(order: Order): boolean {
  if (isIfoodSourcedOrder(order)) return false;
  if (order.status === 'delivered') return false;
  return true;
}

/**
 * Given the previously-known order list and a freshly-fetched order list,
 * returns the orders that are new (present in `freshOrders`, absent from
 * `previousOrders` by id), excluding terminal `delivered` orders, iFood
 * orders (another surface already prints them), and anything older than
 * `maxAgeMs`. Pure — no I/O, no React.
 */
export function selectOrdersToAutoPrint(
  previousOrders: Order[],
  freshOrders: Order[],
  options: SelectOrdersToAutoPrintOptions,
): Order[] {
  const previousIds = new Set(previousOrders.map((o) => o.id));
  return freshOrders.filter((order) => {
    if (previousIds.has(order.id)) return false;
    if (!shouldAutoPrintOrder(order)) return false;
    const createdAtMs = Date.parse(order.createdAt);
    if (Number.isNaN(createdAtMs)) return false;
    return options.now - createdAtMs <= options.maxAgeMs;
  });
}
