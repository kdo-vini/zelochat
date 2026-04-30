import { getServiceSupabase } from './supabase.js';

/**
 * Pending-order sweeper — closes P2.19.
 *
 * `zelochat_pending_orders` rows with `expires_at < NOW()` are never purged,
 * causing unbounded table growth. This sweeper deletes rows that expired more
 * than 7 days ago (the buffer keeps recent-expired rows available for debugging
 * while still preventing indefinite accumulation).
 *
 * Schedule: run once 2 minutes after startup (lets DB connections settle), then
 * every 24 hours. Errors are swallowed — this is a non-critical maintenance
 * task and must never crash the main process.
 *
 * Manual trigger: import and call `sweepExpiredPendingOrders()` directly.
 */

const SWEEP_STARTUP_DELAY_MS = 2 * 60 * 1000; // 2 minutes
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function sweepExpiredPendingOrders(): Promise<void> {
  const supabase = getServiceSupabase();
  const { error, count } = await supabase
    .from('zelochat_pending_orders')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  if (error) {
    console.error('[pendingOrderSweeper] delete failed:', error.message);
    return;
  }

  const deleted = count ?? 0;
  if (deleted > 0) {
    console.log(`[pendingOrderSweeper] deleted ${deleted} expired rows`);
  }
}

let sweepHandle: NodeJS.Timeout | null = null;

/**
 * Start the periodic pending-order sweep loop. Idempotent — calling twice does
 * not stack timers. Runs once after a 2-minute startup delay, then every 24h.
 * Each tick is fire-and-forget; a failure in one tick does not stop the loop.
 */
export function startPendingOrderSweeper(): void {
  if (sweepHandle) return;

  const tick = () => {
    sweepExpiredPendingOrders().catch((err) => {
      console.error('[pendingOrderSweeper] tick failed:', err);
    });
  };

  setTimeout(tick, SWEEP_STARTUP_DELAY_MS).unref?.();
  sweepHandle = setInterval(tick, SWEEP_INTERVAL_MS);
  sweepHandle.unref?.();
}
