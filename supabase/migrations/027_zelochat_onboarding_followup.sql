-- Migration 027 — Sequência de follow-up pós-onboarding (WhatsApp + Email).
--
-- Quando alguém termina o onboarding do ZeloChat hoje, nada acontece. Este
-- migration adiciona a infraestrutura pra disparar mensagens de boas-vindas
-- (Day 0) e nutrir/converter via Resend + WhatsApp da Téchne (Day 3, 7, 14,
-- 21, 28). Lógica e templates ficam em server/onboardingFollowup.ts.
--
-- Três peças aqui:
--
-- 1) empresa_perfil.zelochat_onboarding_done_at — anchor estável pro cálculo
--    de "dia N". Diferente de updated_at, que muda em qualquer edição do
--    perfil, esta coluna só recebe UPDATE quando o onboarding conclui pela
--    primeira vez. Backfill copia updated_at para registros legados pra
--    eles começarem a entrar no fluxo a partir do dia atual.
--
-- 2) zelochat_email_onboarding_logs — uma linha por (user_id, email_day) com
--    UNIQUE pra idempotência. O cron tenta INSERT; se falha por unique, sabe
--    que já mandou. Isso permite reexecuções sem duplicar.
--
-- 3) zelochat_whatsapp_onboarding_logs — mesmo padrão, mas pro WhatsApp.
--
-- RLS habilitado nas duas tabelas sem políticas → service role bypass,
-- anon/authenticated negados por default. Logs são internos, usuário não
-- precisa ler.

ALTER TABLE empresa_perfil
  ADD COLUMN IF NOT EXISTS zelochat_onboarding_done_at TIMESTAMPTZ;

UPDATE empresa_perfil
SET zelochat_onboarding_done_at = COALESCE(updated_at, now())
WHERE zelochat_onboarding_done = true
  AND zelochat_onboarding_done_at IS NULL;

CREATE TABLE IF NOT EXISTS zelochat_email_onboarding_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email_day integer NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  recipient_email text,
  CONSTRAINT zelochat_email_onboarding_logs_uniq UNIQUE (user_id, email_day)
);

CREATE INDEX IF NOT EXISTS zelochat_email_onboarding_logs_user_idx
  ON zelochat_email_onboarding_logs (user_id);

CREATE TABLE IF NOT EXISTS zelochat_whatsapp_onboarding_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  message_day integer NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  recipient_phone text,
  CONSTRAINT zelochat_whatsapp_onboarding_logs_uniq UNIQUE (user_id, message_day)
);

CREATE INDEX IF NOT EXISTS zelochat_whatsapp_onboarding_logs_user_idx
  ON zelochat_whatsapp_onboarding_logs (user_id);

ALTER TABLE zelochat_email_onboarding_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE zelochat_whatsapp_onboarding_logs ENABLE ROW LEVEL SECURITY;
