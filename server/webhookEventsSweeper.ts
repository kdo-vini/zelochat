/**
 * Webhook raw retention is owned by the database, not this process.
 *
 * History: the first sweeper issued three unbounded PostgREST deletes in
 * parallel against `zelochat_webhook_events_raw` (no LIMIT). That compiled
 * to `WITH pgrst_source AS (DELETE …)` and burned Disk IO Budget on the
 * shared ZeloPDV project. A later app RPC loop still raced the table.
 *
 * 2026-09-25 (ZeloPDV #53, applied):
 *   - RPC `purge_zelochat_webhook_events_raw_batch(interval, int)`
 *     service_role only, max 500, keep 3 days, processed rows only
 *   - PROCEDURE `purge_zelochat_webhook_events_raw_sweep` (COMMIT per batch)
 *   - pg_cron job `purge-zelochat-webhook-events-raw` every 15 min
 *
 * Do not reintroduce app-side retention deletes or a second sweeper.
 * Tenant purge in `delete_account` (scoped by empresa_id) is not retention
 * and stays in ZeloPDV.
 *
 * FIX 2026-09-25: unbounded PostgREST delete / competing app sweep → rely
 * on the database cron only.
 */
export const WEBHOOK_RAW_RETENTION_OWNER = 'pg_cron' as const;
export const WEBHOOK_RAW_RETENTION_JOB = 'purge-zelochat-webhook-events-raw' as const;
