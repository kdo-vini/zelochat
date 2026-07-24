-- ============================================================================
-- 014_zelochat_rls_hardening — defense-in-depth RLS for ZeloChat tables
-- ============================================================================
--
-- ✅ APPLIED em prod 2026-04-29 (version 20260429192428, verified via MCP).
-- See FIXES_PROGRESS.md: P0.7 (zelochat_pending_orders), P0.8 (messages/escalation).
--
-- Why this exists:
--
--   The server uses the service-role client for ZeloChat operations, which
--   bypasses RLS — every query MUST already include `.eq('empresa_id', …)`
--   to be safe today. That works, but the database itself has no second
--   line of defense if a future code path drops the explicit filter.
--
--   This migration adds the missing policies discovered by the senior
--   audit (CODE_REVIEW.md):
--
--     • zelochat_pending_orders had RLS enabled but ZERO policies (P0.7).
--     • zelochat_messages was missing UPDATE/DELETE policies (P0.8).
--     • zelochat_escalation_events was missing INSERT/DELETE policies (P0.8).
--
--   With these policies in place, even if a server query accidentally drops
--   the empresa filter, the database refuses cross-tenant rows.
--
-- What it does NOT touch:
--
--   • empresa_perfil (ZeloPDV-owned)
--   • subscriptions, super_admins (ZeloPDV-owned)
--   • Any non-zelochat_* table
--
-- Idempotent: every CREATE POLICY is preceded by DROP POLICY IF EXISTS so
-- this can be re-applied without error. No data is moved.
--
-- Pre-flight check before applying:
--   SELECT tablename, policyname, cmd
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN (
--       'zelochat_pending_orders','zelochat_messages','zelochat_escalation_events'
--     )
--   ORDER BY tablename, policyname;
--
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. zelochat_pending_orders — full empresa-scoped CRUD policies (P0.7)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS zelochat_pending_orders_select_by_empresa
  ON public.zelochat_pending_orders;
CREATE POLICY zelochat_pending_orders_select_by_empresa
  ON public.zelochat_pending_orders FOR SELECT
  USING (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS zelochat_pending_orders_insert_by_empresa
  ON public.zelochat_pending_orders;
CREATE POLICY zelochat_pending_orders_insert_by_empresa
  ON public.zelochat_pending_orders FOR INSERT
  WITH CHECK (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS zelochat_pending_orders_update_by_empresa
  ON public.zelochat_pending_orders;
CREATE POLICY zelochat_pending_orders_update_by_empresa
  ON public.zelochat_pending_orders FOR UPDATE
  USING (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ))
  WITH CHECK (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS zelochat_pending_orders_delete_by_empresa
  ON public.zelochat_pending_orders;
CREATE POLICY zelochat_pending_orders_delete_by_empresa
  ON public.zelochat_pending_orders FOR DELETE
  USING (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

-- ----------------------------------------------------------------------------
-- 2. zelochat_messages — add UPDATE + DELETE (P0.8)
-- ----------------------------------------------------------------------------
-- SELECT and INSERT already exist (see 000_zelochat_schema.sql). Adding
-- UPDATE/DELETE so frontend message edits/deletes (e.g., redact a wrongly
-- captured message) hit the proper RLS check instead of failing silently.

DROP POLICY IF EXISTS zelochat_messages_update_by_empresa
  ON public.zelochat_messages;
CREATE POLICY zelochat_messages_update_by_empresa
  ON public.zelochat_messages FOR UPDATE
  USING (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ))
  WITH CHECK (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS zelochat_messages_delete_by_empresa
  ON public.zelochat_messages;
CREATE POLICY zelochat_messages_delete_by_empresa
  ON public.zelochat_messages FOR DELETE
  USING (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

-- ----------------------------------------------------------------------------
-- 3. zelochat_escalation_events — add INSERT + DELETE (P0.8)
-- ----------------------------------------------------------------------------
-- SELECT and UPDATE already exist (see 000_zelochat_schema.sql). Adding
-- INSERT/DELETE so the audit log can be safely written from anywhere
-- (including potentially the frontend in the future) without service-role.

DROP POLICY IF EXISTS zelochat_escalation_events_insert
  ON public.zelochat_escalation_events;
CREATE POLICY zelochat_escalation_events_insert
  ON public.zelochat_escalation_events FOR INSERT
  WITH CHECK (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS zelochat_escalation_events_delete
  ON public.zelochat_escalation_events;
CREATE POLICY zelochat_escalation_events_delete
  ON public.zelochat_escalation_events FOR DELETE
  USING (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

-- ----------------------------------------------------------------------------
-- 4. zelochat_sessions — add DELETE (audit said missing)
-- ----------------------------------------------------------------------------
-- Operator chat-list "delete conversation" action goes through the server
-- today (using service-role), but adding this policy lets the frontend do
-- it directly via Supabase JS for parity with other tables.

DROP POLICY IF EXISTS zelochat_sessions_delete_by_empresa
  ON public.zelochat_sessions;
CREATE POLICY zelochat_sessions_delete_by_empresa
  ON public.zelochat_sessions FOR DELETE
  USING (empresa_id IN (
    SELECT id FROM public.empresa_perfil WHERE user_id = auth.uid()
  ));

COMMIT;

-- ============================================================================
-- Post-apply verification:
--
-- After running this migration, re-run the pre-flight query to confirm:
--   • zelochat_pending_orders has 4 policies (one per CRUD verb)
--   • zelochat_messages has 4 policies (was 2)
--   • zelochat_escalation_events has 4 policies (was 2)
--   • zelochat_sessions has 4 policies (was 3)
--
-- Then deploy a corresponding code release that REMOVES any unnecessary
-- service-role usage that was working around the missing policies. (Most
-- service-role calls in server/* are still needed for the webhook path —
-- they don't have a JWT — but anything reading "the operator's own data"
-- can now use the user-token client.)
-- ============================================================================
