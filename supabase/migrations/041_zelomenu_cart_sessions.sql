-- ZLM-101
-- Sessões de carrinho server-side do ZeloMenu para o novo motor de pedido.
-- Mantém o fluxo legado `zelochat_pending_orders` intacto para Casa dos Salgados.

CREATE TABLE IF NOT EXISTS public.zelomenu_cart_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresa_perfil(id) ON DELETE CASCADE,
  ordering_id uuid NOT NULL DEFAULT gen_random_uuid(),
  context text NOT NULL CHECK (context IN ('whatsapp_order', 'public_order', 'table_order')),
  state text NOT NULL DEFAULT 'cart_open' CHECK (
    state IN (
      'cart_open',
      'confirmed_waiting_review',
      'confirmed_waiting_payment',
      'needs_customer_adjustment',
      'accepted',
      'rejected',
      'cancelled',
      'archived'
    )
  ),
  source_ref text NOT NULL,
  customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  cart_snapshot jsonb NOT NULL DEFAULT '{"items":[],"observations":null}'::jsonb,
  fulfillment_snapshot jsonb NOT NULL DEFAULT '{"type":"pickup","pickupDate":null,"pickupTime":null,"deliveryAddress":null,"deliveryNeighborhood":null,"deliveryFee":0}'::jsonb,
  pricing_snapshot jsonb NOT NULL DEFAULT '{"subtotal":0,"deliveryFee":0,"total":0}'::jsonb,
  payment_snapshot jsonb NOT NULL DEFAULT '{"declaredMethod":null,"pixReceiptRequired":false,"pixReceiptApproved":false}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  current_token_hash text,
  current_token_last4 text,
  last_revalidated_at timestamptz,
  last_revalidation jsonb,
  confirmed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT zelomenu_cart_sessions_ordering_id_key UNIQUE (ordering_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS zelomenu_cart_sessions_active_source_ref_key
  ON public.zelomenu_cart_sessions (empresa_id, context, source_ref)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS zelomenu_cart_sessions_empresa_context_idx
  ON public.zelomenu_cart_sessions (empresa_id, context, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.zelomenu_cart_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.zelomenu_cart_sessions(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  token_last4 text NOT NULL,
  issued_for_revision integer NOT NULL CHECK (issued_for_revision > 0),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  last_seen_at timestamptz,
  CONSTRAINT zelomenu_cart_tokens_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS zelomenu_cart_tokens_session_idx
  ON public.zelomenu_cart_tokens (session_id, created_at DESC);

ALTER TABLE public.zelomenu_cart_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zelomenu_cart_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zelomenu_cart_sessions_select_by_empresa
  ON public.zelomenu_cart_sessions;
CREATE POLICY zelomenu_cart_sessions_select_by_empresa
  ON public.zelomenu_cart_sessions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.empresa_perfil ep
      WHERE ep.id = zelomenu_cart_sessions.empresa_id
        AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS zelomenu_cart_sessions_insert_by_empresa
  ON public.zelomenu_cart_sessions;
CREATE POLICY zelomenu_cart_sessions_insert_by_empresa
  ON public.zelomenu_cart_sessions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.empresa_perfil ep
      WHERE ep.id = zelomenu_cart_sessions.empresa_id
        AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS zelomenu_cart_sessions_update_by_empresa
  ON public.zelomenu_cart_sessions;
CREATE POLICY zelomenu_cart_sessions_update_by_empresa
  ON public.zelomenu_cart_sessions FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.empresa_perfil ep
      WHERE ep.id = zelomenu_cart_sessions.empresa_id
        AND ep.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.empresa_perfil ep
      WHERE ep.id = zelomenu_cart_sessions.empresa_id
        AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS zelomenu_cart_sessions_delete_by_empresa
  ON public.zelomenu_cart_sessions;
CREATE POLICY zelomenu_cart_sessions_delete_by_empresa
  ON public.zelomenu_cart_sessions FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.empresa_perfil ep
      WHERE ep.id = zelomenu_cart_sessions.empresa_id
        AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS zelomenu_cart_tokens_select_by_empresa
  ON public.zelomenu_cart_tokens;
CREATE POLICY zelomenu_cart_tokens_select_by_empresa
  ON public.zelomenu_cart_tokens FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.zelomenu_cart_sessions sessions
      JOIN public.empresa_perfil ep ON ep.id = sessions.empresa_id
      WHERE sessions.id = zelomenu_cart_tokens.session_id
        AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS zelomenu_cart_tokens_insert_by_empresa
  ON public.zelomenu_cart_tokens;
CREATE POLICY zelomenu_cart_tokens_insert_by_empresa
  ON public.zelomenu_cart_tokens FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.zelomenu_cart_sessions sessions
      JOIN public.empresa_perfil ep ON ep.id = sessions.empresa_id
      WHERE sessions.id = zelomenu_cart_tokens.session_id
        AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS zelomenu_cart_tokens_update_by_empresa
  ON public.zelomenu_cart_tokens;
CREATE POLICY zelomenu_cart_tokens_update_by_empresa
  ON public.zelomenu_cart_tokens FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.zelomenu_cart_sessions sessions
      JOIN public.empresa_perfil ep ON ep.id = sessions.empresa_id
      WHERE sessions.id = zelomenu_cart_tokens.session_id
        AND ep.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.zelomenu_cart_sessions sessions
      JOIN public.empresa_perfil ep ON ep.id = sessions.empresa_id
      WHERE sessions.id = zelomenu_cart_tokens.session_id
        AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS zelomenu_cart_tokens_delete_by_empresa
  ON public.zelomenu_cart_tokens;
CREATE POLICY zelomenu_cart_tokens_delete_by_empresa
  ON public.zelomenu_cart_tokens FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.zelomenu_cart_sessions sessions
      JOIN public.empresa_perfil ep ON ep.id = sessions.empresa_id
      WHERE sessions.id = zelomenu_cart_tokens.session_id
        AND ep.user_id = auth.uid()
    )
  );

REVOKE ALL
  ON public.zelomenu_cart_sessions, public.zelomenu_cart_tokens
  FROM anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.zelomenu_cart_sessions, public.zelomenu_cart_tokens
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
