-- Migration: track zelochat-specific onboarding completion
-- Ensures the onboarding wizard shows only on the very first zelochat login,
-- independent of whether nome_exibicao/contato are later edited via settings.

ALTER TABLE empresa_perfil
  ADD COLUMN IF NOT EXISTS zelochat_onboarding_done boolean NOT NULL DEFAULT false;
