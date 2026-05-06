-- Migration 021 - Allow Pix receipt validation in AI usage metrics.
-- 020 introduced the feature-side calls; this keeps the usage aggregate
-- constraint aligned for already migrated databases.

ALTER TABLE public.zelochat_ai_usage_daily
  DROP CONSTRAINT IF EXISTS zelochat_ai_usage_daily_feature_check;

ALTER TABLE public.zelochat_ai_usage_daily
  ADD CONSTRAINT zelochat_ai_usage_daily_feature_check
  CHECK (feature IN (
    'ai_auto_reply',
    'ai_auto_followup',
    'ai_manual_reply',
    'ai_generate_instructions',
    'ai_manager',
    'ai_simulator',
    'ai_trigger_parse',
    'ai_transcription',
    'pix_receipt_validation'
  ));
