-- Migration: persist AI instructions and quick responses (macros) per empresa
-- Before this migration, both lived only in localStorage.
--
-- empresa_perfil.ai_instructions — master prompt / personality of the agent
-- zelochat_quick_responses       — /TRIGGER macros the operator can send in chat

ALTER TABLE empresa_perfil
  ADD COLUMN IF NOT EXISTS ai_instructions text;

CREATE TABLE IF NOT EXISTS public.zelochat_quick_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresa_perfil(id) ON DELETE CASCADE,
  trigger text NOT NULL,
  response text NOT NULL DEFAULT '',
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_zelochat_quick_responses_empresa
  ON public.zelochat_quick_responses (empresa_id, position);

ALTER TABLE public.zelochat_quick_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "zelochat_qr_select_own_empresa" ON public.zelochat_quick_responses;
CREATE POLICY "zelochat_qr_select_own_empresa"
  ON public.zelochat_quick_responses
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.empresa_perfil ep
      WHERE ep.id = empresa_id AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "zelochat_qr_insert_own_empresa" ON public.zelochat_quick_responses;
CREATE POLICY "zelochat_qr_insert_own_empresa"
  ON public.zelochat_quick_responses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.empresa_perfil ep
      WHERE ep.id = empresa_id AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "zelochat_qr_update_own_empresa" ON public.zelochat_quick_responses;
CREATE POLICY "zelochat_qr_update_own_empresa"
  ON public.zelochat_quick_responses
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.empresa_perfil ep
      WHERE ep.id = empresa_id AND ep.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.empresa_perfil ep
      WHERE ep.id = empresa_id AND ep.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "zelochat_qr_delete_own_empresa" ON public.zelochat_quick_responses;
CREATE POLICY "zelochat_qr_delete_own_empresa"
  ON public.zelochat_quick_responses
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.empresa_perfil ep
      WHERE ep.id = empresa_id AND ep.user_id = auth.uid()
    )
  );
