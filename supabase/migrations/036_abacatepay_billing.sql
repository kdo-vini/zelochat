-- zelochat_billing_payments: tracks individual Pix payment attempts per user.
-- Each Pix charge (cobrança transparente) creates one row here. On webhook
-- confirmation, the row status becomes 'completed' and a subscription row is
-- activated. Server reads/writes via service role; users can only SELECT their own rows.
CREATE TABLE IF NOT EXISTS public.zelochat_billing_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES public.empresa_perfil(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'abacatepay',
  provider_payment_id text NOT NULL,
  plan_tier text NOT NULL CHECK (plan_tier IN ('chat', 'bundle')),
  amount_brl numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  pix_copy_paste text,
  pix_qr_code text,
  expires_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id)
);

ALTER TABLE public.zelochat_billing_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zelochat_billing_payments_select_own"
  ON public.zelochat_billing_payments
  FOR SELECT
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_zelochat_billing_payments_user_id
  ON public.zelochat_billing_payments (user_id);

CREATE INDEX IF NOT EXISTS idx_zelochat_billing_payments_provider_payment_id
  ON public.zelochat_billing_payments (provider_payment_id);

-- zelochat_billing_webhook_events: idempotency log for incoming external webhooks.
-- Before processing any event, we INSERT here. Duplicate event_id triggers a
-- unique constraint violation (code 23505) which we treat as "already processed".
-- Server-only: no user-facing RLS policy needed (service role bypasses RLS).
CREATE TABLE IF NOT EXISTS public.zelochat_billing_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'abacatepay',
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

ALTER TABLE public.zelochat_billing_webhook_events ENABLE ROW LEVEL SECURITY;
