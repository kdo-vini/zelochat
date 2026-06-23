import { listAbandonedCartCandidates, recoverAbandonedCart } from './zelomenuCartSessions.js';

/**
 * ZLM-105 — Abandoned ZeloMenu cart recovery sweeper.
 *
 * A `whatsapp_order` cart left in `cart_open` for more than 2h (and up to 24h)
 * gets ONE friendly recovery nudge with a fresh link. The one-shot guarantee and
 * the "never for confirmed/cancelled/accepted" rule live in
 * `recoverAbandonedCart` (race-safe metadata claim) and the pure
 * `isCartEligibleForAbandonedRecovery` predicate — this file only owns the
 * timing/iteration loop.
 *
 * Schedule: run once 3 minutes after startup (lets the paywall/config caches
 * warm), then every 15 minutes so a nudge fires reasonably close to the 2h mark.
 * Each tick is fire-and-forget; a failure in one tick (or one candidate) never
 * crashes the main process and never stops the rest of the batch.
 *
 * Manual trigger: import and call `sweepAbandonedCarts()` directly.
 */

const SWEEP_STARTUP_DELAY_MS = 3 * 60 * 1000; // 3 minutes
const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const SWEEP_BATCH_LIMIT = 100;

export async function sweepAbandonedCarts(): Promise<void> {
  const candidates = await listAbandonedCartCandidates({ limit: SWEEP_BATCH_LIMIT });
  if (candidates.length === 0) return;

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      const result = await recoverAbandonedCart(candidate);
      if (result === 'sent') sent++;
      else if (result === 'failed') failed++;
      else skipped++;
    } catch (err) {
      failed++;
      console.error(`[abandonedCartSweeper] recovery failed for session ${candidate.id}:`, err);
    }
  }

  if (candidates.length >= SWEEP_BATCH_LIMIT) {
    console.warn(`[abandonedCartSweeper] batch hit limit (${SWEEP_BATCH_LIMIT}) — remaining carts recover on the next tick`);
  }
  if (sent > 0 || failed > 0) {
    console.log(`[abandonedCartSweeper] recovery sweep: sent=${sent} skipped=${skipped} failed=${failed}`);
  }
}

let sweepHandle: NodeJS.Timeout | null = null;

/**
 * Start the periodic abandoned-cart recovery loop. Idempotent — calling twice
 * does not stack timers. Runs once after a 3-minute startup delay, then every
 * 15 minutes. Each tick is fire-and-forget; a failure in one tick does not stop
 * the loop.
 */
export function startAbandonedCartRecoverySweeper(): void {
  if (sweepHandle) return;

  const tick = () => {
    sweepAbandonedCarts().catch((err) => {
      console.error('[abandonedCartSweeper] tick failed:', err);
    });
  };

  setTimeout(tick, SWEEP_STARTUP_DELAY_MS).unref?.();
  sweepHandle = setInterval(tick, SWEEP_INTERVAL_MS);
  sweepHandle.unref?.();
}
