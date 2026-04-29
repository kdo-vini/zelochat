-- Migration: add structured business hours to empresa_perfil
-- Replaces the free-text `hours` field (which lived only in localStorage).
--
-- horario_abertura / horario_fechamento — HH:MM (e.g. '09:00', '18:00')
-- dias_fechamento                       — array of abbreviated day names (e.g. '{Dom,Sab}')

ALTER TABLE empresa_perfil
  ADD COLUMN IF NOT EXISTS horario_abertura  text,
  ADD COLUMN IF NOT EXISTS horario_fechamento text,
  ADD COLUMN IF NOT EXISTS dias_fechamento   text[] DEFAULT '{}';
