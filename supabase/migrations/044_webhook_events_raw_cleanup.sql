-- ============================================================================
-- 044_webhook_events_raw_cleanup — purge messages.update rows + tighten retention
-- ============================================================================
--
-- Root cause of 1.38 GB growth:
--
--   1. messages.update events (delivery/read receipts, ~78% of rows) were being
--      logged despite having zero replay value — they only trigger a WebSocket
--      broadcast to the frontend. server/webhookLog.ts now skips them before
--      insert. This migration deletes all existing rows of this type.
--
--   2. Outbound media messages (fromMe: true) carry the media payload in
--      data.message.base64, which the stripping code in webhookLog.ts missed
--      (it only stripped data.base64 and nested subtype fields). Some rows
--      reached 626 KB. The stripping code is fixed in the same release.
--
-- What this migration does:
--   1. DELETE all messages.update rows (no replay value; safe to drop at any age)
--   2. DELETE processed rows older than 14 days (was 30; 14 is plenty for
--      incident response now that stripping works correctly)
--   3. DELETE stuck/unprocessed rows older than 21 days
--
-- Expected reclaimed space: ~1.1–1.3 GB (the 171k messages.update rows plus
-- the oversized upsert rows that are now >14 days old or already processed).
-- ============================================================================

BEGIN;

-- 1. All messages.update rows — no replay value regardless of age
DELETE FROM public.zelochat_webhook_events_raw
WHERE event_type = 'messages.update';

-- 2. Processed events beyond 14-day replay window
DELETE FROM public.zelochat_webhook_events_raw
WHERE processed_at IS NOT NULL
  AND processed_at < now() - interval '14 days';

-- 3. Stuck/unprocessed events older than 21 days
DELETE FROM public.zelochat_webhook_events_raw
WHERE processed_at IS NULL
  AND received_at < now() - interval '21 days';

COMMIT;
