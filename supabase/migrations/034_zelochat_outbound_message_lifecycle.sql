-- Persist outbound send lifecycle for operator/AI messages.
-- This lets support distinguish queued/sending/sent/failed local state from
-- WhatsApp delivery/read receipts.

ALTER TABLE public.zelochat_messages
  ADD COLUMN IF NOT EXISTS outbound_status text
    CHECK (outbound_status IS NULL OR outbound_status IN ('queued', 'sending', 'sent', 'failed')),
  ADD COLUMN IF NOT EXISTS outbound_error text;

CREATE INDEX IF NOT EXISTS idx_zelochat_messages_outbound_status
  ON public.zelochat_messages (empresa_id, outbound_status, sent_at DESC)
  WHERE outbound_status IS NOT NULL;
