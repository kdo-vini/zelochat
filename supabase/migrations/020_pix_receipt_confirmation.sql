-- Migration 020 - Pix receipt confirmation gate.
-- Adds ZeloChat-owned config and audit fields. This does not alter ZeloPDV-owned
-- columns or the shared subscriptions/catalog schemas.

ALTER TABLE public.empresa_perfil
  ADD COLUMN IF NOT EXISTS pix_receipt_config jsonb;

COMMENT ON COLUMN public.empresa_perfil.pix_receipt_config IS
  'ZeloChat-owned configuration for requiring Pix receipt image/PDF validation before confirming Pix orders.';

ALTER TABLE public.zelochat_pending_orders
  ADD COLUMN IF NOT EXISTS pix_receipt_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS pix_receipt_message_id text,
  ADD COLUMN IF NOT EXISTS pix_receipt_analysis jsonb,
  ADD COLUMN IF NOT EXISTS pix_receipt_rejection_reason text;

ALTER TABLE public.zelochat_pending_orders
  DROP CONSTRAINT IF EXISTS zelochat_pending_orders_pix_receipt_status_chk;

ALTER TABLE public.zelochat_pending_orders
  ADD CONSTRAINT zelochat_pending_orders_pix_receipt_status_chk
  CHECK (pix_receipt_status IN ('not_required', 'required', 'approved', 'rejected'));

ALTER TABLE public.zelochat_orders
  ADD COLUMN IF NOT EXISTS pix_receipt_message_id text,
  ADD COLUMN IF NOT EXISTS pix_receipt_analysis jsonb;

COMMENT ON COLUMN public.zelochat_orders.pix_receipt_analysis IS
  'Snapshot of the approved Pix receipt analysis used before automatic order confirmation. Not a bank settlement confirmation.';
