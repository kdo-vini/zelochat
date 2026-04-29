-- Migration: persist blockedDates and managerHistory per empresa in Supabase
-- Before this migration, both lived only in localStorage and were lost on session end.
--
-- empresa_perfil.blocked_dates   — JSONB array of { date, reason } objects
-- empresa_perfil.manager_history — JSONB array of ChatMessage objects (gestão por conversa)

ALTER TABLE empresa_perfil
  ADD COLUMN IF NOT EXISTS blocked_dates  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS manager_history jsonb NOT NULL DEFAULT '[]'::jsonb;
