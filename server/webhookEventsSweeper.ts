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
 *   - Processed events older than 7 days → delete (replay window closed)
 *   - Stuck/unprocessed events older than 21 days → delete (orphaned)
 *
 * Schedule: 1 min after startup, then every 24h. Non-critical: errors are
 * swallowed and never crash the main process.
 */

const SWEEP_STARTUP_DELAY_MS = 1 * 60 * 1000;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// messages.update rows are no longer inserted (filtered in webhookLog.ts),
// but any stragglers from before the fix are swept here as a safety net.
const PROCESSED_RETENTION_DAYS = 7;
const UNPROCESSED_RETENTION_DAYS = 21;
const BATCH_SIZE = 500;
const MAX_BATCHES_PER_SWEEP = 100;
const BATCH_PAUSE_MS = 100;

type WebhookRetentionRpcRow = {
  processed_deleted: number;
  unprocessed_deleted: number;
  update_stragglers_deleted: number;
};

type WebhookRetentionClient = {
  rpc(
    name: 'purge_zelochat_webhook_events_raw_batch',
    args: {
      p_processed_before: string;
      p_unprocessed_before: string;
      p_batch_size: number;
    },
  ): PromiseLike<{ data: WebhookRetentionRpcRow[] | null; error: { message: string } | null }>;
};

export type WebhookRetentionSweepSummary = {
  batches: number;
  processed: number;
  unprocessed: number;
  updateStragglers: number;
  total: number;
};

/**
 * Delete expired raw events in small, strictly serial batches. The database
 * function also takes a transaction-scoped advisory lock, so multiple backend
 * replicas cannot run retention deletes at the same time.
 */
export async function sweepWebhookEvents(
  client: WebhookRetentionClient = getServiceSupabase(),
  pause: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<WebhookRetentionSweepSummary> {
  const summary: WebhookRetentionSweepSummary = {
    batches: 0,
    processed: 0,
    unprocessed: 0,
    updateStragglers: 0,
    total: 0,
  };

  const processedCutoff = new Date(
    Date.now() - PROCESSED_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const unprocessedCutoff = new Date(
    Date.now() - UNPROCESSED_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  for (let attempt = 0; attempt < MAX_BATCHES_PER_SWEEP; attempt += 1) {
    const { data, error } = await client.rpc('purge_zelochat_webhook_events_raw_batch', {
      p_processed_before: processedCutoff,
      p_unprocessed_before: unprocessedCutoff,
      p_batch_size: BATCH_SIZE,
    });

    if (error) {
      console.error('[webhookEventsSweeper] batch delete failed:', error.message);
      break;
    }

    const row = data?.[0];
    const processed = Number(row?.processed_deleted ?? 0);
    const unprocessed = Number(row?.unprocessed_deleted ?? 0);
    const updateStragglers = Number(row?.update_stragglers_deleted ?? 0);
    const batchTotal = processed + unprocessed + updateStragglers;
    if (batchTotal === 0) break;

    summary.batches += 1;
    summary.processed += processed;
    summary.unprocessed += unprocessed;
    summary.updateStragglers += updateStragglers;
    summary.total += batchTotal;
    await pause(BATCH_PAUSE_MS);
  }

  if (summary.total > 0) {
    console.log(
      `[webhookEventsSweeper] deleted ${summary.total} rows in ${summary.batches} batch(es) (${summary.processed} processed, ${summary.unprocessed} stuck, ${summary.updateStragglers} update-stragglers)`,
    );
  }

  return summary;
}


export function startWebhookEventsSweeper(): void {
  startPeriodicTask('webhookEventsSweeper', sweepWebhookEvents, SWEEP_STARTUP_DELAY_MS, SWEEP_INTERVAL_MS);
}
