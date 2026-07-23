import type { Order } from '../types';

export interface SelectOrdersToAutoPrintOptions {
  /** Only flag orders created within this many ms of `now`. Guards against reconciliation resurfacing old orders (e.g. a lookback-window boundary shift at midnight) as if they were new. */
  maxAgeMs: number;
  now: number;
}

/**
 * Given the previously-known order list and a freshly-fetched order list,
 * returns the orders that are new (present in `freshOrders`, absent from
 * `previousOrders` by id), excluding terminal `delivered` orders and
 * anything older than `maxAgeMs`. Pure — no I/O, no React.
 */
export function selectOrdersToAutoPrint(
  previousOrders: Order[],
  freshOrders: Order[],
  options: SelectOrdersToAutoPrintOptions,
): Order[] {
  const previousIds = new Set(previousOrders.map((o) => o.id));
  return freshOrders.filter((order) => {
    if (previousIds.has(order.id)) return false;
    if (order.status === 'delivered') return false;
    const createdAtMs = Date.parse(order.createdAt);
    if (Number.isNaN(createdAtMs)) return false;
    return options.now - createdAtMs <= options.maxAgeMs;
  });
}
