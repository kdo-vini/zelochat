import {
  expireStaleCartOpenSessions,
  listAbandonedCartCandidates,
  purgeExpiredArchivedCarts,
  recoverAbandonedCart,
} from './zelomenuCartSessions.js';

/**
 * ZLM-105 — Abandoned ZeloMenu cart sweeper. Three passes per tick:
 *
 * 1. Recovery — a `whatsapp_order` cart left in `cart_open` for 2h–24h gets ONE
 *    friendly recovery nudge with a fresh link. One-shot + "never for
 *    confirmed/cancelled/accepted" live in `recoverAbandonedCart` (race-safe
 *    metadata claim) and the pure `isCartEligibleForAbandonedRecovery` predicate.
 * 2. Archive — any `cart_open` idle for more than 24h (all contexts, incl.
 *    public_order) is soft-archived (`state='archived'`, `archived_at`, marker
 *    `metadata.archivedReason='abandoned_expiry'`). Disjoint from the recovery
 *    window (>24h vs <24h), so a cart never gets nudged and archived in the same
 *    tick. Confirmed/accepted orders are never touched.
 * 3. Purge — abandoned carts archived more than 90 days ago are hard-deleted.
 *    Filtered by the marker, so confirmed/accepted orders (which also carry
 *    `archived_at`) are never deleted — they back the future "Peça novamente".
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
      // The existing cart sweeper remains the only candidate scanner. When
      // ZELOCHAT_AUTOMATION_LEDGER=1, recoverAbandonedCart queues the shared
      // ledger job instead of sending directly, so both paths cannot duplicate.
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

  // Limpeza: arquiva cart_open parado >24h e apaga arquivados-por-abandono >90d.
  const archived = await expireStaleCartOpenSessions({ limit: SWEEP_BATCH_LIMIT });
  const purged = await purgeExpiredArchivedCarts({ limit: SWEEP_BATCH_LIMIT });
  if (archived > 0 || purged > 0) {
    console.log(`[abandonedCartSweeper] cleanup: archived=${archived} purged=${purged}`);
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
