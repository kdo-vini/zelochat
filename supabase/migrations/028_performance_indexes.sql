-- Performance indexes — 2026-05-10 audit
-- Each index matches an actual query pattern found in the codebase.

-- 1. Sessions: getAllSessions() orders by updated_at within empresa
--    Query: messageHandler.ts fetchAllSessionRows()
--    Pattern: WHERE empresa_id = $1 ORDER BY updated_at DESC
CREATE INDEX IF NOT EXISTS idx_zelochat_sessions_empresa_updated
  ON public.zelochat_sessions (empresa_id, updated_at DESC);

-- 2. Messages: getAllSessions() batch-loads latest message per session
--    Query: messageHandler.ts getAllSessions() line 1201
--    Pattern: WHERE empresa_id = $1 AND role IN ('user','assistant') AND session_id IN (...) ORDER BY sent_at DESC
CREATE INDEX IF NOT EXISTS idx_zelochat_messages_empresa_session_sent
  ON public.zelochat_messages (empresa_id, session_id, sent_at DESC);

-- 3. Messages: getSession() loads messages for one session
--    Query: messageHandler.ts getSession() line 1158
--    Pattern: WHERE empresa_id = $1 AND session_id IN (...) ORDER BY sent_at ASC
--    (covered by index #2 above — Postgres can scan DESC index backwards for ASC)

-- 4. Messages: dashboard role+time range queries
--    Query: dashboardMetrics.ts line 258
--    Pattern: WHERE empresa_id = $1 AND role IN (...) AND sent_at BETWEEN ... ORDER BY sent_at DESC
CREATE INDEX IF NOT EXISTS idx_zelochat_messages_empresa_role_sent
  ON public.zelochat_messages (empresa_id, role, sent_at DESC);

-- 5. Orders: Kanban view status filter
--    Query: router.ts line 1445
--    Pattern: WHERE empresa_id = $1 AND status = $2
CREATE INDEX IF NOT EXISTS idx_zelochat_orders_empresa_status
  ON public.zelochat_orders (empresa_id, status);

-- 6. Orders: date range queries (dashboard + kanban)
--    Query: dashboardMetrics.ts line 275, router.ts line 1460
--    Pattern: WHERE empresa_id = $1 AND pickup_date BETWEEN ... ORDER BY pickup_date, pickup_time
CREATE INDEX IF NOT EXISTS idx_zelochat_orders_empresa_pickup
  ON public.zelochat_orders (empresa_id, pickup_date, pickup_time);

-- 7. Sessions: direct JID lookup within empresa (for fetchSessionFamily optimization)
--    Pattern: WHERE empresa_id = $1 AND remote_jid = $2
--    Already covered by zelochat_sessions_empresa_remote_unique

-- 8. Sessions: customer_phone lookup within empresa (for session family resolution)
--    Pattern: WHERE empresa_id = $1 AND customer_phone = $2
CREATE INDEX IF NOT EXISTS idx_zelochat_sessions_empresa_phone
  ON public.zelochat_sessions (empresa_id, customer_phone);
