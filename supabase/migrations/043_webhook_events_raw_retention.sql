-- ============================================================================
-- 043_webhook_events_raw_retention — purge old webhook event logs
-- ============================================================================
--
-- Context:
--   zelochat_webhook_events_raw was created in migration 016 as an append-only
--   replay log after the P0.14 incident. The 016 migration noted "add a cron
--   purge later if the table grows" — it has grown to 1.38 GB (93% of the DB).
--
-- Retention policy:
--   • Processed events (processed_at IS NOT NULL) older than 30 days are safe
--     to drop — any incident that wasn't caught in 30 days is not going to be
--     replayed from this log.
--   • Stuck/unprocessed events (processed_at IS NULL) older than 37 days are
--     orphaned — they predate any living incident window and just waste space.
--   • Anything in the last 30 days stays regardless of processed status.
--
-- This migration does the one-time backfill delete to reclaim the accumulated
-- storage immediately. Going forward, server/webhookEventsSweeper.ts runs
-- the same DELETE daily (1 min after startup, then every 24h).
-- ============================================================================

BEGIN;

-- Immediate cleanup: processed events older than 30 days
DELETE FROM public.zelochat_webhook_events_raw
WHERE processed_at IS NOT NULL
  AND processed_at < now() - interval '30 days';

-- Immediate cleanup: stuck/unprocessed events older than 37 days
DELETE FROM public.zelochat_webhook_events_raw
WHERE processed_at IS NULL
  AND received_at < now() - interval '37 days';

COMMIT;
