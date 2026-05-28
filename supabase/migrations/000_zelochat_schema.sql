-- ============================================================================
-- ZeloChat schema snapshot — captured from production 2026-04-29
-- ============================================================================
--
-- ⚠️  Shared database with ZeloPDV
--
-- This file is the source of truth for ZeloChat-owned schema only:
--   • CREATE TABLE for `zelochat_*` tables
--   • ALTER TABLE for ZeloChat-specific columns on `empresa_perfil`
--   • RLS policies, indexes, functions, triggers, and storage policies
--     scoped to ZeloChat objects
--
-- It deliberately does NOT recreate shared tables owned by ZeloPDV:
--   • empresa_perfil (the table itself + its core PDV columns)
--   • subscriptions, super_admins
--   • produtos, categorias, subcategorias, vendas*, caixas*, …
--
-- The shared tables live in the ZeloPDV repo's migrations. Running this file
-- against a fresh database WILL FAIL if those tables don't exist yet — apply
-- ZeloPDV's initial migration first, then this one.
--
-- All statements are idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`,
-- `DROP POLICY IF EXISTS … CREATE POLICY`). Re-running this file against
-- prod is a no-op for objects that already match. Use it as a baseline /
-- disaster-recovery doc, not as an incremental migration.
--
-- The numbered files 001_*.sql … 013_*.sql in this directory are partial
-- ALTERs that were committed before the team adopted full-snapshot capture.
-- They remain for historical context but are SUPERSEDED by this file when
-- bootstrapping a new environment.
--
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. ZeloChat-specific columns on shared empresa_perfil
-- ----------------------------------------------------------------------------
-- The empresa_perfil table is owned by ZeloPDV. ZeloChat adds columns to it
-- for AI config, business hours, manager phone, multi-tenant Whatsmiau
-- mapping, customer-notification toggles, etc.

ALTER TABLE public.empresa_perfil
  ADD COLUMN IF NOT EXISTS chave_pix text,
  ADD COLUMN IF NOT EXISTS manager_phone text,
  ADD COLUMN IF NOT EXISTS horario_abertura text,
  ADD COLUMN IF NOT EXISTS horario_fechamento text,
  ADD COLUMN IF NOT EXISTS dias_fechamento text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS ai_instructions text,
  ADD COLUMN IF NOT EXISTS blocked_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS manager_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS zelochat_onboarding_done boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS webhook_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS ai_can_reengage_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS zelochat_disabled_builtin_triggers text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS delivery_config jsonb,
  ADD COLUMN IF NOT EXISTS whatsmiau_instance text,
  ADD COLUMN IF NOT EXISTS whatsmiau_connected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsmiau_phone text,
  ADD COLUMN IF NOT EXISTS notify_customer_preparing boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_customer_ready boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_customer_out_for_delivery boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pix_receipt_config jsonb;

-- whatsmiau_instance: per-tenant Whatsmiau Evolution instance name. UNIQUE
-- only when not-NULL so empresas without a connected WhatsApp share NULL.
-- Auto-create flow in instanceManager.ts depends on this constraint.
CREATE UNIQUE INDEX IF NOT EXISTS empresa_perfil_whatsmiau_instance_uniq
  ON public.empresa_perfil (whatsmiau_instance)
  WHERE whatsmiau_instance IS NOT NULL;

-- webhook_token: per-tenant secret intended to authenticate /webhook/:instance
-- callers (currently unused by router.ts — see CODE_REVIEW.md P0.1).
CREATE UNIQUE INDEX IF NOT EXISTS empresa_perfil_webhook_token_idx
  ON public.empresa_perfil (webhook_token);

-- ----------------------------------------------------------------------------
-- 2. zelochat_sessions — one row per WhatsApp JID per empresa
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.zelochat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresa_perfil(id) ON DELETE CASCADE,
  remote_jid text NOT NULL,
  customer_name text,
  customer_phone text,
  last_message text,
  last_message_time text,
  unread_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'escalated', 'resolved', 'archived')),
  auto_reply boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  profile_pic_url text,
  escalated_at timestamptz,
  acknowledged_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS zelochat_sessions_empresa_remote_unique
  ON public.zelochat_sessions (empresa_id, remote_jid);

CREATE INDEX IF NOT EXISTS zelochat_sessions_empresa_id_idx
  ON public.zelochat_sessions (empresa_id);

CREATE INDEX IF NOT EXISTS zelochat_sessions_updated_at_idx
  ON public.zelochat_sessions (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_zelochat_sessions_status_escalated
  ON public.zelochat_sessions (empresa_id, escalated_at DESC)
  WHERE status = 'escalated';

ALTER TABLE public.zelochat_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zelochat_sessions_select_by_empresa ON public.zelochat_sessions;
CREATE POLICY zelochat_sessions_select_by_empresa
  ON public.zelochat_sessions FOR SELECT
  USING (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS zelochat_sessions_insert_by_empresa ON public.zelochat_sessions;
CREATE POLICY zelochat_sessions_insert_by_empresa
  ON public.zelochat_sessions FOR INSERT
  WITH CHECK (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS zelochat_sessions_update_by_empresa ON public.zelochat_sessions;
CREATE POLICY zelochat_sessions_update_by_empresa
  ON public.zelochat_sessions FOR UPDATE
  USING (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ))
  WITH CHECK (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

-- NOTE: no DELETE policy in prod — operator-side message/session deletion
-- goes through the server using the service-role client.

-- ----------------------------------------------------------------------------
-- 3. zelochat_messages — chat history with role enum that includes 'tool'/'system'
-- ----------------------------------------------------------------------------
-- 🛑 LOAD-BEARING: the role CHECK MUST allow 'tool' and 'system'. Narrowing
-- it silently breaks the entire order-creation pipeline. See CLAUDE.md
-- §"Order confirmation flow — DO NOT BREAK" for the full incident.

CREATE TABLE IF NOT EXISTS public.zelochat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES public.zelochat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  content text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  tool_calls jsonb,
  tool_call_id text,
  audio_transcript text,
  audio_transcript_status text
    CHECK (audio_transcript_status IS NULL
           OR audio_transcript_status IN ('pending', 'done', 'failed'))
);

CREATE INDEX IF NOT EXISTS zelochat_messages_empresa_id_idx
  ON public.zelochat_messages (empresa_id);

CREATE INDEX IF NOT EXISTS zelochat_messages_session_id_idx
  ON public.zelochat_messages (session_id, sent_at);

ALTER TABLE public.zelochat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zelochat_messages_select_by_empresa ON public.zelochat_messages;
CREATE POLICY zelochat_messages_select_by_empresa
  ON public.zelochat_messages FOR SELECT
  USING (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS zelochat_messages_insert_by_empresa ON public.zelochat_messages;
CREATE POLICY zelochat_messages_insert_by_empresa
  ON public.zelochat_messages FOR INSERT
  WITH CHECK (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

-- NOTE: prod has no UPDATE/DELETE policy. Server uses service-role client
-- which bypasses RLS for those operations. See CODE_REVIEW.md P0.8 — adding
-- defense-in-depth UPDATE/DELETE policies is a planned hardening step.

-- ----------------------------------------------------------------------------
-- 4. zelochat_drivers — delivery drivers per empresa
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.zelochat_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresa_perfil(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text NOT NULL,
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'busy', 'offline')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (empresa_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_zelochat_drivers_empresa_id
  ON public.zelochat_drivers (empresa_id);

ALTER TABLE public.zelochat_drivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zelochat_drivers_select_own_empresa ON public.zelochat_drivers;
CREATE POLICY zelochat_drivers_select_own_empresa
  ON public.zelochat_drivers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.empresa_perfil ep
                 WHERE ep.id = zelochat_drivers.empresa_id AND ep.user_id = auth.uid()));

DROP POLICY IF EXISTS zelochat_drivers_insert_own_empresa ON public.zelochat_drivers;
CREATE POLICY zelochat_drivers_insert_own_empresa
  ON public.zelochat_drivers FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.empresa_perfil ep
                      WHERE ep.id = zelochat_drivers.empresa_id AND ep.user_id = auth.uid()));

DROP POLICY IF EXISTS zelochat_drivers_update_own_empresa ON public.zelochat_drivers;
CREATE POLICY zelochat_drivers_update_own_empresa
  ON public.zelochat_drivers FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.empresa_perfil ep
                 WHERE ep.id = zelochat_drivers.empresa_id AND ep.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.empresa_perfil ep
                      WHERE ep.id = zelochat_drivers.empresa_id AND ep.user_id = auth.uid()));

DROP POLICY IF EXISTS zelochat_drivers_delete_own_empresa ON public.zelochat_drivers;
CREATE POLICY zelochat_drivers_delete_own_empresa
  ON public.zelochat_drivers FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.empresa_perfil ep
                 WHERE ep.id = zelochat_drivers.empresa_id AND ep.user_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 5. zelochat_orders — confirmed orders from the WhatsApp pipeline
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.zelochat_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresa_perfil(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  customer_phone text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  pickup_date text NOT NULL,
  pickup_time text NOT NULL,
  delivery_address text,
  driver_id uuid,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'preparing', 'ready', 'out_for_delivery', 'delivered')),
  total numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'whatsapp'
    CHECK (source IN ('whatsapp', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  payment_method text,
  delivery_fee numeric,
  delivery_neighborhood text,
  observations text CHECK (observations IS NULL OR length(observations) <= 500),
  pix_receipt_message_id text,
  pix_receipt_analysis jsonb
);

CREATE OR REPLACE FUNCTION public.zelochat_orders_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zelochat_orders_updated_at ON public.zelochat_orders;
CREATE TRIGGER trg_zelochat_orders_updated_at
  BEFORE UPDATE ON public.zelochat_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.zelochat_orders_set_updated_at();

ALTER TABLE public.zelochat_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zelochat_orders_empresa_owner ON public.zelochat_orders;
CREATE POLICY zelochat_orders_empresa_owner
  ON public.zelochat_orders FOR ALL
  USING (empresa_id = (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

-- Realtime for kanban: enable INSERT/UPDATE replication. Idempotent — inside
-- DO block because supabase_realtime already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'zelochat_orders'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.zelochat_orders';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6. zelochat_pending_orders — short-TTL pending order awaiting customer confirm
-- ----------------------------------------------------------------------------
-- ⚠️  Currently has RLS enabled but ZERO policies (CODE_REVIEW.md P0.7).
-- The server uses the service-role client (which bypasses RLS) so today this
-- works, but there is no defense-in-depth. A future code path that drops the
-- explicit `.eq('empresa_id', ...)` filter would silently leak across tenants.
-- A fix migration adding empresa-scoped SELECT/INSERT/UPDATE/DELETE policies
-- is a planned hardening step.

CREATE TABLE IF NOT EXISTS public.zelochat_pending_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresa_perfil(id) ON DELETE CASCADE,
  remote_jid text NOT NULL,
  customer_name text NOT NULL,
  customer_phone text,
  items jsonb NOT NULL,
  pickup_date date NOT NULL,
  pickup_time text NOT NULL,
  payment_method text,
  total numeric NOT NULL,
  tool_call_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  order_type text CHECK (order_type IS NULL OR order_type IN ('pickup', 'delivery')),
  delivery_address text,
  delivery_neighborhood text,
  delivery_fee numeric,
  observations text CHECK (observations IS NULL OR length(observations) <= 500),
  pix_receipt_status text NOT NULL DEFAULT 'not_required'
    CHECK (pix_receipt_status IN ('not_required', 'required', 'approved', 'rejected')),
  pix_receipt_message_id text,
  pix_receipt_analysis jsonb,
  pix_receipt_rejection_reason text,
  CONSTRAINT zelochat_pending_orders_unique_per_jid UNIQUE (empresa_id, remote_jid)
);

CREATE INDEX IF NOT EXISTS zelochat_pending_orders_empresa_idx
  ON public.zelochat_pending_orders (empresa_id);

CREATE INDEX IF NOT EXISTS zelochat_pending_orders_expires_idx
  ON public.zelochat_pending_orders (expires_at);

ALTER TABLE public.zelochat_pending_orders ENABLE ROW LEVEL SECURITY;
-- (no policies — see warning above)

-- ----------------------------------------------------------------------------
-- 7. zelochat_triggers — operator-defined AI triggers
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.zelochat_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresa_perfil(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('notify_manager', 'escalate_human', 'redirect_contact')),
  name text NOT NULL,
  condition_description text NOT NULL,
  natural_input text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  redirect_phone text,
  redirect_message text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT zelochat_triggers_redirect_phone_required
    CHECK (kind <> 'redirect_contact' OR nullif(btrim(redirect_phone), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_zelochat_triggers_empresa_active
  ON public.zelochat_triggers (empresa_id, active);

ALTER TABLE public.zelochat_triggers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zelochat_triggers_select_own_empresa ON public.zelochat_triggers;
CREATE POLICY zelochat_triggers_select_own_empresa
  ON public.zelochat_triggers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.empresa_perfil ep
                 WHERE ep.id = zelochat_triggers.empresa_id AND ep.user_id = auth.uid()));

DROP POLICY IF EXISTS zelochat_triggers_insert_own_empresa ON public.zelochat_triggers;
CREATE POLICY zelochat_triggers_insert_own_empresa
  ON public.zelochat_triggers FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.empresa_perfil ep
                      WHERE ep.id = zelochat_triggers.empresa_id AND ep.user_id = auth.uid()));

DROP POLICY IF EXISTS zelochat_triggers_update_own_empresa ON public.zelochat_triggers;
CREATE POLICY zelochat_triggers_update_own_empresa
  ON public.zelochat_triggers FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.empresa_perfil ep
                 WHERE ep.id = zelochat_triggers.empresa_id AND ep.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.empresa_perfil ep
                      WHERE ep.id = zelochat_triggers.empresa_id AND ep.user_id = auth.uid()));

DROP POLICY IF EXISTS zelochat_triggers_delete_own_empresa ON public.zelochat_triggers;
CREATE POLICY zelochat_triggers_delete_own_empresa
  ON public.zelochat_triggers FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.empresa_perfil ep
                 WHERE ep.id = zelochat_triggers.empresa_id AND ep.user_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 8. zelochat_quick_responses — operator-defined macro responses
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.zelochat_quick_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresa_perfil(id) ON DELETE CASCADE,
  trigger text NOT NULL,
  response text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_zelochat_quick_responses_empresa
  ON public.zelochat_quick_responses (empresa_id, position);

ALTER TABLE public.zelochat_quick_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zelochat_qr_select_own_empresa ON public.zelochat_quick_responses;
CREATE POLICY zelochat_qr_select_own_empresa
  ON public.zelochat_quick_responses FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.empresa_perfil ep
                 WHERE ep.id = zelochat_quick_responses.empresa_id AND ep.user_id = auth.uid()));

DROP POLICY IF EXISTS zelochat_qr_insert_own_empresa ON public.zelochat_quick_responses;
CREATE POLICY zelochat_qr_insert_own_empresa
  ON public.zelochat_quick_responses FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.empresa_perfil ep
                      WHERE ep.id = zelochat_quick_responses.empresa_id AND ep.user_id = auth.uid()));

DROP POLICY IF EXISTS zelochat_qr_update_own_empresa ON public.zelochat_quick_responses;
CREATE POLICY zelochat_qr_update_own_empresa
  ON public.zelochat_quick_responses FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.empresa_perfil ep
                 WHERE ep.id = zelochat_quick_responses.empresa_id AND ep.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.empresa_perfil ep
                      WHERE ep.id = zelochat_quick_responses.empresa_id AND ep.user_id = auth.uid()));

DROP POLICY IF EXISTS zelochat_qr_delete_own_empresa ON public.zelochat_quick_responses;
CREATE POLICY zelochat_qr_delete_own_empresa
  ON public.zelochat_quick_responses FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.empresa_perfil ep
                 WHERE ep.id = zelochat_quick_responses.empresa_id AND ep.user_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 9. zelochat_escalation_events — audit log of human-handoff events
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.zelochat_escalation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresa_perfil(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.zelochat_sessions(id) ON DELETE CASCADE,
  trigger_id uuid REFERENCES public.zelochat_triggers(id) ON DELETE SET NULL,
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('escalate_human', 'notify_manager')),
  trigger_name text NOT NULL,
  reason_category text NOT NULL CHECK (reason_category IN (
    'frustration','complaint','explicit_human_request','repeated_ai_failure',
    'offensive_language','manual','custom'
  )),
  reason_text text NOT NULL,
  customer_message_excerpt text,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zelochat_escalation_events_empresa_time
  ON public.zelochat_escalation_events (empresa_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_zelochat_escalation_events_session_time
  ON public.zelochat_escalation_events (session_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_zelochat_escalation_events_open
  ON public.zelochat_escalation_events (empresa_id)
  WHERE resolved_at IS NULL;

ALTER TABLE public.zelochat_escalation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zelochat_escalation_events_select ON public.zelochat_escalation_events;
CREATE POLICY zelochat_escalation_events_select
  ON public.zelochat_escalation_events FOR SELECT
  USING (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS zelochat_escalation_events_update ON public.zelochat_escalation_events;
CREATE POLICY zelochat_escalation_events_update
  ON public.zelochat_escalation_events FOR UPDATE
  USING (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ))
  WITH CHECK (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

-- NOTE: prod has no INSERT or DELETE policy. Inserts come from server (service
-- role bypasses RLS). See CODE_REVIEW.md P0.8 / P1.1 — adding empresa-scoped
-- INSERT and DELETE policies, plus a defense-in-depth `.eq('empresa_id')`
-- filter on the resolve-update path, is planned hardening.

-- ----------------------------------------------------------------------------
-- 10. RPC: zelochat_increment_unread — atomic unread bump
-- ----------------------------------------------------------------------------
-- Used by messageHandler.ts when a new customer message arrives. SECURITY
-- DEFINER + SQL body with no parameters reaching the WHERE clause (just the
-- session UUID) — safe.

CREATE OR REPLACE FUNCTION public.zelochat_increment_unread(p_session_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.zelochat_sessions
  SET unread_count = unread_count + 1,
      updated_at   = now()
  WHERE id = p_session_id;
$$;

-- ----------------------------------------------------------------------------
-- 11. Storage bucket: zelochat-media
-- ----------------------------------------------------------------------------
-- Public bucket, 10MB cap, restricted MIME types. Public read is intentional
-- so Whatsmiau can fetch outbound media URLs. INSERT/DELETE rely on the
-- service role bypassing RLS for the server-side upload/cleanup path.
-- ⚠️  CODE_REVIEW.md P0.5 flags timestamp-prefixed filenames as enumerable —
-- per-empresa scoped paths + random slugs is a planned hardening.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'zelochat-media',
  'zelochat-media',
  true,
  10485760,
  ARRAY[
    'image/jpeg','image/png','image/gif','image/webp',
    'audio/ogg','audio/mpeg','audio/webm',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'video/mp4'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "zelochat-media public read" ON storage.objects;
CREATE POLICY "zelochat-media public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'zelochat-media');

DROP POLICY IF EXISTS "zelochat-media service insert" ON storage.objects;
CREATE POLICY "zelochat-media service insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'zelochat-media');

DROP POLICY IF EXISTS "zelochat-media service delete" ON storage.objects;
CREATE POLICY "zelochat-media service delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'zelochat-media');

COMMIT;
