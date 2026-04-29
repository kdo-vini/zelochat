-- Migration: global AI auto-reply toggle per empresa
-- Lets the dono flip the assistant off without disconnecting WhatsApp.
-- When false, incoming messages still land in the app in real time; the AI just doesn't reply.

ALTER TABLE empresa_perfil
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true;
