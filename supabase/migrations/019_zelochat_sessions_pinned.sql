-- ============================================================================
-- 019_zelochat_sessions_pinned — adds pinned column for chat list
-- ============================================================================
--
-- ZeloChat-owned column on a ZeloChat-owned table (zelochat_sessions).
-- Used by the conversation list UI to keep important chats at the top.
-- Safe to land from this repo per CLAUDE.md §"Tables we OWN".

BEGIN;

ALTER TABLE public.zelochat_sessions
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_zelochat_sessions_empresa_pinned
  ON public.zelochat_sessions (empresa_id, updated_at DESC)
  WHERE pinned = true;

COMMIT;
