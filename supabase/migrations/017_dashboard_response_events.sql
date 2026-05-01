-- ============================================================================
-- 017_dashboard_response_events - source-of-truth response time metrics
-- ============================================================================
--
-- Adds a ZeloChat-owned metrics table so the dashboard can distinguish
-- automatic AI replies from human/manual replies going forward without changing
-- the semantics of zelochat_messages.role (where assistant still means
-- "outbound message" for chat history compatibility).

BEGIN;

CREATE TABLE IF NOT EXISTS public.zelochat_response_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresa_perfil(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.zelochat_sessions(id) ON DELETE CASCADE,
  incoming_message_id uuid NOT NULL REFERENCES public.zelochat_messages(id) ON DELETE CASCADE,
  response_message_id uuid NOT NULL REFERENCES public.zelochat_messages(id) ON DELETE CASCADE,
  responder_type text NOT NULL CHECK (responder_type IN ('ai', 'human')),
  source text NOT NULL CHECK (source IN ('ai_auto', 'human_manual')),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zelochat_response_events_empresa_time
  ON public.zelochat_response_events (empresa_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_zelochat_response_events_session_time
  ON public.zelochat_response_events (session_id, sent_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zelochat_response_events_first_by_responder
  ON public.zelochat_response_events (empresa_id, incoming_message_id, responder_type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zelochat_response_events_response_message
  ON public.zelochat_response_events (empresa_id, response_message_id);

ALTER TABLE public.zelochat_response_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zelochat_response_events_select_by_empresa
  ON public.zelochat_response_events;
CREATE POLICY zelochat_response_events_select_by_empresa
  ON public.zelochat_response_events FOR SELECT
  USING (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS zelochat_response_events_insert_by_empresa
  ON public.zelochat_response_events;
CREATE POLICY zelochat_response_events_insert_by_empresa
  ON public.zelochat_response_events FOR INSERT
  WITH CHECK (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

COMMIT;
