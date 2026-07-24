import type { Order } from '../types.js';

/**
 * Delivered orders linger on the Produção board (feed + kanban) for this long
 * after being finalized, then drop off automatically. They are NOT deleted —
 * they stay in the Agenda/histórico (the 14-day fetch in useOrders keeps them
 * in state.orders); only the operational board hides them so it reflects "o que
 * ainda falta fazer" instead of accumulating finished orders across days.
 */
export const DELIVERED_BOARD_LINGER_MS = 30 * 60 * 1000; // 30 min

/**
 * Whether an order should appear on the Produção board right now.
 *
 * - Active orders (any non-delivered status) always show, regardless of age or
 *   pickup date — those are still the operator's job.
 * - Delivered orders show only while still inside the linger window, measured
 *   from `closedAt` (stamped by the canonical engine exactly when the order
 *   became delivered). Once the window passes, the card disappears on its own.
 * - Delivered orders without a `closedAt` (legacy imports / older rows) are
 *   treated as finalized long ago and hidden — never as "just delivered".
 */
export function isOrderOnProductionBoard(
  order: Order,
  nowMs: number,
  lingerMs: number = DELIVERED_BOARD_LINGER_MS,
): boolean {
  if (order.status !== 'delivered') return true;
  if (!order.closedAt) return false;
  const closedMs = Date.parse(order.closedAt);
  if (Number.isNaN(closedMs)) return false;
  return nowMs - closedMs < lingerMs;
}

export function filterProductionBoardOrders(
  orders: Order[],
  nowMs: number,
  lingerMs: number = DELIVERED_BOARD_LINGER_MS,
): Order[] {
  return orders.filter((order) => isOrderOnProductionBoard(order, nowMs, lingerMs));
}
