-- Migration 012 — Enable Supabase Realtime on zelochat_orders.
--
-- Without this, the postgres_changes channel in src/hooks/useOrders.ts
-- (filter empresa_id=eq.{id}) silently never fires. Effects of NOT having it:
--   * Produção/Agenda show stale data when navigating from Chat
--   * Auto-print on confirmed WhatsApp orders never triggers (uses onNewOrder
--     callback which lives inside the realtime INSERT handler)
--   * No cross-device sync (status changes on phone don't reach desktop)
--
-- RLS already scopes rows by empresa_id, so realtime only delivers events
-- for the authenticated user's own empresa.

ALTER PUBLICATION supabase_realtime ADD TABLE zelochat_orders;
