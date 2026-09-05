import { startPeriodicTask } from './runtime/periodicTask.js';
import { getServiceSupabase } from './supabase.js';

/**
 * Webhook events raw table retention sweeper.
 *
 * zelochat_webhook_events_raw is an append-only replay log (migration 016).
 * Without periodic purges it grows unboundedly — it hit 1.38 GB (94% of DB)
 * before this sweeper was added.
 *
 * Retention rules:
 *   - Processed events older than 30 days → delete (replay window closed)
 *   - Stuck/unprocessed events older than 37 days → delete (orphaned)
 *
 * Schedule: 1 min after startup, then every 24h. Non-critical: errors are
 * swallowed and never crash the main process.
 */

const SWEEP_STARTUP_DELAY_MS = 1 * 60 * 1000;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// messages.update rows are no longer inserted (filtered in webhookLog.ts),
// but any stragglers from before the fix are swept here as a safety net.
const PROCESSED_RETENTION_DAYS = 14;
const UNPROCESSED_RETENTION_DAYS = 21;

async function sweepWebhookEvents(): Promise<void> {
  const supabase = getServiceSupabase();

  const processedCutoff = new Date(
    Date.now() - PROCESSED_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const unprocessedCutoff = new Date(
    Date.now() - UNPROCESSED_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [processed, stuck, updateStragglers] = await Promise.all([
    supabase
      .from('zelochat_webhook_events_raw')
      .delete({ count: 'exact' })
      .not('processed_at', 'is', null)
      .lt('processed_at', processedCutoff),
    supabase
      .from('zelochat_webhook_events_raw')
      .delete({ count: 'exact' })
      .is('processed_at', null)
      .lt('received_at', unprocessedCutoff),
    supabase
      .from('zelochat_webhook_events_raw')
      .delete({ count: 'exact' })
      .eq('event_type', 'messages.update'),
  ]);

  if (processed.error) console.error('[webhookEventsSweeper] processed delete failed:', processed.error.message);
  if (stuck.error) console.error('[webhookEventsSweeper] stuck delete failed:', stuck.error.message);
  if (updateStragglers.error) console.error('[webhookEventsSweeper] update-stragglers delete failed:', updateStragglers.error.message);

  const total = (processed.count ?? 0) + (stuck.count ?? 0) + (updateStragglers.count ?? 0);
  if (total > 0) {
    console.log(
      `[webhookEventsSweeper] deleted ${total} rows (${processed.count ?? 0} processed, ${stuck.count ?? 0} stuck, ${updateStragglers.count ?? 0} update-stragglers)`,
    );
  }
}


export function startWebhookEventsSweeper(): void {
  startPeriodicTask('webhookEventsSweeper', sweepWebhookEvents, SWEEP_STARTUP_DELAY_MS, SWEEP_INTERVAL_MS);
}
