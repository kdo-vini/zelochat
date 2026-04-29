-- ============================================================================
-- 016_webhook_events_raw — persist raw inbound webhook payloads BEFORE processing
-- ============================================================================
--
-- Why this exists:
--
--   The 2026-04-29 incident (regressão P0.14): an `upsert(..., {
--   ignoreDuplicates: true })` quirk caused EVERY fresh insert in
--   `zelochat_messages` to look like a duplicate, dropping ~4h of inbound
--   user messages on the floor. Whatsmiau does NOT expose a history endpoint
--   (validated against 12+ paths). Lost is lost — no recovery possible.
--
--   This table is the permanent fix for the entire CLASS of bugs: any future
--   regression in the inbound persistence path can be replayed from the raw
--   payloads stored here. Storage is cheap; replayability is invaluable.
--
-- What this migration does:
--
--   1. Creates `zelochat_webhook_events_raw` — append-only log of every
--      inbound webhook body received by `/webhook/:instance` after the
--      auth gate (token check) passes.
--   2. Indexes for typical queries: per-empresa recent events, unprocessed
--      events (stuck or in-flight), idempotent lookup by wa_message_id.
--   3. RLS enabled with NO policies — only service_role can read/write,
--      which is correct because raw payloads contain customer phone numbers
--      and message bodies.
--
-- Application wiring (deploys in same release):
--   • `server/webhookLog.ts` — `recordRawWebhookEvent()` helper
--   • `server/router.ts` POST /webhook/:instance — fire-and-forget insert
--      after auth, before res.json(). Failures log + continue (must NOT
--      break webhook ack).
--
-- Retention:
--   Not addressed by this migration. Volume is low (~10s/day for 1 customer,
--   scales linearly). Add a cron purge of `processed_at < now() - 30 days`
--   later if the table grows.
--
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.zelochat_webhook_events_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance TEXT NOT NULL,
  empresa_id UUID NULL,
  event_type TEXT NULL,
  wa_message_id TEXT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ NULL,
  processing_error TEXT NULL
);

COMMENT ON TABLE public.zelochat_webhook_events_raw IS
  'Append-only log of inbound webhook payloads. Replay source if persistence path regresses (see 016 migration header).';

COMMENT ON COLUMN public.zelochat_webhook_events_raw.empresa_id IS
  'NULL when instance resolution failed (unknown instance) — auth path still rejects, but we log to detect probing/misconfig.';

COMMENT ON COLUMN public.zelochat_webhook_events_raw.wa_message_id IS
  'Extracted from data.key.id at log time. Used to find replay candidates after a bug fix without parsing JSONB at scale.';

COMMENT ON COLUMN public.zelochat_webhook_events_raw.processed_at IS
  'Set after processWebhookEvent returns successfully. NULL = stuck or in-flight; combine with received_at to detect regressions.';

COMMENT ON COLUMN public.zelochat_webhook_events_raw.payload IS
  'Full webhook body. Media base64 fields are stripped before insert to keep row size bounded (see server/webhookLog.ts).';

CREATE INDEX IF NOT EXISTS zelochat_webhook_events_raw_empresa_received_idx
  ON public.zelochat_webhook_events_raw (empresa_id, received_at DESC);

CREATE INDEX IF NOT EXISTS zelochat_webhook_events_raw_received_idx
  ON public.zelochat_webhook_events_raw (received_at DESC);

CREATE INDEX IF NOT EXISTS zelochat_webhook_events_raw_unprocessed_idx
  ON public.zelochat_webhook_events_raw (received_at DESC)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS zelochat_webhook_events_raw_wa_msg_idx
  ON public.zelochat_webhook_events_raw (empresa_id, wa_message_id)
  WHERE wa_message_id IS NOT NULL;

ALTER TABLE public.zelochat_webhook_events_raw ENABLE ROW LEVEL SECURITY;

-- No policies declared. Supabase service_role bypasses RLS so the server can
-- read/write freely. Authenticated users (operators) have NO access — payloads
-- contain phone numbers + message content from other tenants if instance
-- resolution failed.

COMMIT;

-- ============================================================================
-- Post-apply verification:
--
--   SELECT relrowsecurity FROM pg_class WHERE relname='zelochat_webhook_events_raw';
--   -- Expected: t (true)
--
--   SELECT indexname FROM pg_indexes
--   WHERE tablename='zelochat_webhook_events_raw' ORDER BY indexname;
--   -- Expected: 4 indexes + the PK.
--
--   SELECT count(*) FROM pg_policies
--   WHERE tablename='zelochat_webhook_events_raw';
--   -- Expected: 0 (service-role only).
-- ============================================================================
