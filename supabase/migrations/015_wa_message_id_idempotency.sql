-- ============================================================================
-- 015_wa_message_id_idempotency — dedup inbound webhook deliveries
-- ============================================================================
--
-- 🟡 STATUS: DRAFT. NOT YET APPLIED TO PROD. Apply via Supabase MCP / CLI
--    only after operator review. See FIXES_PROGRESS.md → P0.14.
--
-- Why this exists:
--
--   Whatsmiau retries webhook deliveries on slow ack or proxy timeout. Today
--   `processWebhookEvent` calls `insertMessage` unconditionally, so a retry
--   produces a SECOND row in `zelochat_messages` for the same WhatsApp
--   message. Worse: the AI auto-reply fires twice → two assistant messages
--   to the customer, two pending orders, double OpenAI cost. The senior
--   audit (CODE_REVIEW.md P0.14) flags this as the highest-impact bug
--   still latent in the inbound path.
--
-- What this migration does:
--
--   1. Adds `wa_message_id text` to `zelochat_messages` (nullable so
--      historical rows continue to read fine).
--   2. Creates a partial UNIQUE index on (`empresa_id`, `wa_message_id`)
--      WHERE `wa_message_id IS NOT NULL`. This lets the existing rows stay
--      and starts enforcing dedup for new ones.
--
--   The application code change to start populating wa_message_id and
--   switching `insert` to `upsert(..., onConflict: 'empresa_id,wa_message_id',
--   ignoreDuplicates: true)` ships in the SAME RELEASE — see
--   `server/messageHandler.ts` _handleIncomingMessage. With the unique index
--   in place but the code not populating yet, behavior is unchanged. With
--   the code populating but no index, behavior is still unchanged. Both
--   together: dedup kicks in.
--
-- Rollout order (zero-downtime):
--
--   Step A: apply this migration. New column + index exist; column is NULL
--           on every row. No code reads or writes it yet. Production keeps
--           working exactly as before.
--   Step B: deploy code that writes `wa_message_id` on insert with
--           `INSERT … ON CONFLICT DO NOTHING`. Now retries are idempotent.
--           SELECT paths don't read the column.
--   Step C: (optional, much later) backfill `wa_message_id` for historical
--           rows from the message-handler logs. Not strictly necessary.
--
-- Risks if you skip the staged rollout:
--
--   • Apply migration + deploy code that REQUIRES the column, but the index
--     isn't there yet → INSERT works but you have no dedup, customer sees
--     duplicate replies during the deploy window.
--   • Deploy code first then apply migration → INSERT works, no dedup.
--
--   Both are non-fatal but defeat the point. Always apply the migration
--   FIRST, verify the column exists, then deploy the code.
--
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Add nullable wa_message_id column
-- ----------------------------------------------------------------------------

ALTER TABLE public.zelochat_messages
  ADD COLUMN IF NOT EXISTS wa_message_id text;

COMMENT ON COLUMN public.zelochat_messages.wa_message_id IS
  'WhatsApp message ID from Whatsmiau (data.key.id). Used for inbound webhook idempotency. NULL on historical rows captured before idempotency rollout.';

-- ----------------------------------------------------------------------------
-- 2. Partial UNIQUE index — only when wa_message_id is non-NULL
-- ----------------------------------------------------------------------------
-- Partial index is critical: historical rows have NULL and we don't want to
-- collapse them. New rows from the code change will all have a value, and the
-- (empresa_id, wa_message_id) combo is what makes a duplicate webhook
-- delivery a no-op.
--
-- CONCURRENTLY would be ideal but cannot run inside a transaction. Use
-- a separate non-transactional apply if the table is large (current row
-- count ~860; safe to lock briefly).

CREATE UNIQUE INDEX IF NOT EXISTS zelochat_messages_empresa_wa_msg_uniq
  ON public.zelochat_messages (empresa_id, wa_message_id)
  WHERE wa_message_id IS NOT NULL;

COMMIT;

-- ============================================================================
-- Post-apply verification:
--
--   SELECT
--     pg_get_indexdef(idx.indexrelid) AS def
--   FROM pg_index idx
--   WHERE idx.indrelid = 'public.zelochat_messages'::regclass
--     AND pg_get_indexdef(idx.indexrelid) LIKE '%wa_message_id%';
--
-- Expected:
--   CREATE UNIQUE INDEX zelochat_messages_empresa_wa_msg_uniq
--     ON public.zelochat_messages USING btree (empresa_id, wa_message_id)
--     WHERE (wa_message_id IS NOT NULL);
--
-- Then deploy the matching code change in `server/messageHandler.ts`
-- (`_handleIncomingMessage` → switch insert to upsert with onConflict).
-- ============================================================================
