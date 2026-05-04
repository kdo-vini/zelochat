-- ============================================================================
-- 018_zelochat_ai_usage_daily - aggregated AI usage metrics
-- ============================================================================
--
-- ZeloChat-owned daily aggregates for internal cost/usage monitoring.
-- This intentionally stores no prompts, responses, customer names, phones,
-- JIDs or message IDs. Only counters/tokens by empresa, day, feature and model.

BEGIN;

CREATE TABLE IF NOT EXISTS public.zelochat_ai_usage_daily (
  empresa_id uuid NOT NULL REFERENCES public.empresa_perfil(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  feature text NOT NULL CHECK (feature IN (
    'ai_auto_reply',
    'ai_auto_followup',
    'ai_manual_reply',
    'ai_generate_instructions',
    'ai_manager',
    'ai_simulator',
    'ai_trigger_parse',
    'ai_transcription'
  )),
  model text NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  success_count integer NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  rate_limited_count integer NOT NULL DEFAULT 0 CHECK (rate_limited_count >= 0),
  prompt_tokens bigint NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens bigint NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens bigint NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, usage_date, feature, model)
);

CREATE INDEX IF NOT EXISTS idx_zelochat_ai_usage_daily_empresa_date
  ON public.zelochat_ai_usage_daily (empresa_id, usage_date DESC);

ALTER TABLE public.zelochat_ai_usage_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zelochat_ai_usage_daily_select_by_empresa
  ON public.zelochat_ai_usage_daily;
-- Internal-only dashboard: operators should not read usage/cost aggregates.

DROP POLICY IF EXISTS zelochat_ai_usage_daily_select_by_super_admin
  ON public.zelochat_ai_usage_daily;
CREATE POLICY zelochat_ai_usage_daily_select_by_super_admin
  ON public.zelochat_ai_usage_daily FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM public.super_admins
    WHERE user_id = auth.uid()
      AND is_active = true
  ));

CREATE OR REPLACE FUNCTION public.zelochat_increment_ai_usage_daily(
  p_empresa_id uuid,
  p_usage_date date,
  p_feature text,
  p_model text,
  p_status text DEFAULT 'success',
  p_prompt_tokens bigint DEFAULT 0,
  p_completion_tokens bigint DEFAULT 0,
  p_total_tokens bigint DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_success integer := CASE WHEN p_status = 'success' THEN 1 ELSE 0 END;
  v_error integer := CASE WHEN p_status = 'error' THEN 1 ELSE 0 END;
  v_rate_limited integer := CASE WHEN p_status = 'rate_limited' THEN 1 ELSE 0 END;
BEGIN
  IF p_status NOT IN ('success', 'error', 'rate_limited') THEN
    RAISE EXCEPTION 'invalid ai usage status: %', p_status;
  END IF;

  INSERT INTO public.zelochat_ai_usage_daily (
    empresa_id,
    usage_date,
    feature,
    model,
    request_count,
    success_count,
    error_count,
    rate_limited_count,
    prompt_tokens,
    completion_tokens,
    total_tokens
  )
  VALUES (
    p_empresa_id,
    p_usage_date,
    p_feature,
    left(coalesce(nullif(p_model, ''), 'unknown'), 120),
    1,
    v_success,
    v_error,
    v_rate_limited,
    greatest(coalesce(p_prompt_tokens, 0), 0),
    greatest(coalesce(p_completion_tokens, 0), 0),
    greatest(coalesce(p_total_tokens, 0), 0)
  )
  ON CONFLICT (empresa_id, usage_date, feature, model)
  DO UPDATE SET
    request_count = public.zelochat_ai_usage_daily.request_count + 1,
    success_count = public.zelochat_ai_usage_daily.success_count + v_success,
    error_count = public.zelochat_ai_usage_daily.error_count + v_error,
    rate_limited_count = public.zelochat_ai_usage_daily.rate_limited_count + v_rate_limited,
    prompt_tokens = public.zelochat_ai_usage_daily.prompt_tokens + greatest(coalesce(p_prompt_tokens, 0), 0),
    completion_tokens = public.zelochat_ai_usage_daily.completion_tokens + greatest(coalesce(p_completion_tokens, 0), 0),
    total_tokens = public.zelochat_ai_usage_daily.total_tokens + greatest(coalesce(p_total_tokens, 0), 0),
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.zelochat_increment_ai_usage_daily(uuid, date, text, text, text, bigint, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zelochat_increment_ai_usage_daily(uuid, date, text, text, text, bigint, bigint, bigint)
  TO service_role;

COMMIT;
