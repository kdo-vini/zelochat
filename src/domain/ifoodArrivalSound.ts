import type { Order } from '../types';

const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;
const TERMINAL = new Set(['delivered']);

export interface FindNewArrivalOrdersOptions {
  now?: number;
  maxAgeMs?: number;
}

/**
 * Orders that just appeared since the last list snapshot (any channel).
 * Caller skips the first paint (empty previous → treat as baseline).
 * Skips delivered cards and rows older than `maxAgeMs`.
 */
export function findNewArrivalOrders(
  previous: Order[],
  next: Order[],
  options: FindNewArrivalOrdersOptions = {},
): Order[] {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const previousIds = new Set((Array.isArray(previous) ? previous : []).map((order) => order?.id).filter(Boolean));
  return (Array.isArray(next) ? next : []).filter((order) => {
    if (!order?.id || previousIds.has(order.id)) return false;
    if (TERMINAL.has(order.status)) return false;
    const createdAtMs = Date.parse(order.createdAt);
    if (!Number.isNaN(createdAtMs) && now - createdAtMs > maxAgeMs) return false;
    return true;
  });
}
