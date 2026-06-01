# ZeloChat Performance Audit

> Ver também: [[CODE_REVIEW]] · [[FIXES_PROGRESS]] · [[ZeloChat.audit-report]] · [[ZeloChat.audit-indexes]]

## Scope
- Current HEAD only.
- Focus: heavy users, session/contact loading, message pagination, unbounded queries, dashboard load, tags/search/filter behavior, catalog loading, indexes.

## Executive Summary
- The biggest performance problem is data shape, not only rendering.
- The inbox path still loads too much data up front, filters on the client, and reconstructs preview/ordering with extra message queries.
- The dashboard still computes aggregates by loading capped raw datasets into Node.
- The chat detail backend already supports cursor pagination, but the UI still stops at the newest 50 messages.

## Hot Path Matrix
| Area | Current behavior | Confirmed problem | Impact |
| --- | --- | --- | --- |
| Chat initial load | `bindEmpresa` then `/api/sessions`, then all tags and tags map | Full tenant load instead of visible-page load | Slow boot, large payload, silent truncation at scale |
| Session list preview | Session rows + extra message batch lookups | Message-table fan-out on every refresh | Latency and DB load grow with session count |
| Chat detail | First page only (`limit=50`) | No wired older-message loading | Long threads lose usable context |
| Dashboard overview | Loads capped sessions/messages/events/orders with `count: 'exact'` | Expensive and statistically incomplete | Slow dashboard, misleading metrics for heavy users |
| Catalog | Idle-loads full catalog even outside catalog view | Background load + 2000-row cap | Wasted bandwidth and truncated catalog |

## Confirmed Findings

[P1] Session list is capped and not paginated

Area:
Performance

Status:
Confirmed risk

Evidence:
- File(s): `server/messageHandler.ts`, `src/hooks/useWhatsAppSessions.ts`, `src/services/waApi.ts`, `server/router.ts`, `src/components/views/ChatView.tsx`
- Function/component/route: `fetchAllSessionRows()`, `refresh()`, `getSessions()`, `GET /api/sessions`, session filtering in `ChatView`
- Relevant behavior:
  - `server/messageHandler.ts:29-32` defines `SESSION_LIST_LIMIT` from `ZELOCHAT_SESSION_LIST_LIMIT`, default `2000`.
  - `server/messageHandler.ts:889-898` loads `zelochat_sessions` ordered by `pinned`, `last_message_time`, `updated_at` and applies `.limit(limit)`.
  - `server/messageHandler.ts:904-905` logs when the cap is hit.
  - `src/hooks/useWhatsAppSessions.ts:205-208` always refreshes by calling `bindEmpresa()` and then `getSessions()`.
  - `src/services/waApi.ts:93-99` calls `GET /api/sessions` with no cursor, search, status, or tag params.
  - `src/components/views/ChatView.tsx:714-747` applies search/status/tag filters client-side.
- Why the evidence supports the finding:
  - The inbox result set is capped before filtering and before the frontend knows which subset is visible or relevant.

Why this matters:
- Technical impact:
  - Large tenants cannot page through the full inbox.
- Business impact:
  - Operators can miss live or unresolved conversations.
- Heavy-user impact:
  - Companies with 10k sessions/contacts are guaranteed to hit truncation.
- Customer/support impact:
  - Missed chats translate into lost leads and hard-to-debug “conversation disappeared” complaints.

How to reproduce or validate:
1. Seed more than 2000 sessions for one empresa.
2. Load chat via the current UI.
3. Confirm `/api/sessions` returns only the capped window and the UI filters locally from that truncated base.

Recommended fix:
- Minimal safe fix:
  - Add cursor pagination plus server-side `search`, `status`, `tagId`, and `pinned` filtering to `/api/sessions`.
- Long-term fix:
  - Build a paginated “conversation family” inbox API instead of exposing raw JID rows as the list source of truth.
- DB migration/index/RLS change if needed:
  - Review a composite inbox index aligned to the real sort order.
- Risk of the fix:
  - Medium; the client-side merge logic with WebSocket updates must be adapted carefully.

Confidence:
High

[P1] Session refresh fans out into extra message-table preview lookups

Area:
Performance

Status:
Confirmed risk

Evidence:
- File(s): `server/messageHandler.ts`
- Function/component/route: `getAllSessions()`
- Relevant behavior:
  - `server/messageHandler.ts:38-39` already includes `last_message` and `last_message_time` in session list columns.
  - `server/messageHandler.ts:1331-1358` chunk-loads latest visible messages from `zelochat_messages` after reading the sessions list.
- Why the evidence supports the finding:
  - Every inbox refresh does additional `zelochat_messages` work even though session rows already carry preview/time fields.

Why this matters:
- Technical impact:
  - Increases DB round-trips and pressure on `zelochat_messages`.
- Business impact:
  - Slower inbox refresh directly hurts rush-hour operators.
- Heavy-user impact:
  - More sessions means more chunks and more message lookups.
- Customer/support impact:
  - Delayed list refresh can hide the latest inbound activity.

How to reproduce or validate:
1. Populate a tenant with many active sessions.
2. Call `/api/sessions`.
3. Observe the backend issuing session load plus additional message lookups to rebuild preview/recency.

Recommended fix:
- Minimal safe fix:
  - Use canonical preview/timestamp already stored on the session row when safe.
- Long-term fix:
  - Replace the fan-out with a single SQL/RPC path or a durable denormalized conversation-preview model.
- DB migration/index/RLS change if needed:
  - Partial index on `zelochat_messages (empresa_id, session_id, sent_at desc) WHERE role IN ('user','assistant')` if preview lookup remains.
- Risk of the fix:
  - Medium; must preserve current “latest visible message” semantics.

Confidence:
High

[P1] Dashboard overview computes metrics from capped raw datasets in Node

Area:
Performance

Status:
Confirmed risk

Evidence:
- File(s): `server/dashboardMetrics.ts`
- Function/component/route: `buildDashboardOverview()`, `fetchResponseEvents()`
- Relevant behavior:
  - `server/dashboardMetrics.ts:49-56` defines hard caps of 5000 sessions and 5000 messages.
  - `server/dashboardMetrics.ts:221-228` loads up to 5000 response events.
  - `server/dashboardMetrics.ts:256-289` loads sessions, messages, escalations, and orders as raw rows, with `count: 'exact'` on sessions and messages.
  - `server/dashboardMetrics.ts:296-300` warns when caps are exceeded.
  - `server/dashboardMetrics.ts:303-320` aggregates in memory.
- Why the evidence supports the finding:
  - The current dashboard path is both expensive and incomplete for heavy tenants.

Why this matters:
- Technical impact:
  - Node does data crunching that belongs in SQL/RPC aggregates.
- Business impact:
  - Dashboard can become slow and misleading under real growth.
- Heavy-user impact:
  - Metrics become capped exactly when the business most needs accurate operational visibility.
- Customer/support impact:
  - Operators and support can misread queue health and response-time performance.

How to reproduce or validate:
1. Load a tenant with more than 5000 message rows in the selected range.
2. Open Dashboard.
3. Confirm cap warnings and the lack of full coverage in computed metrics.

Recommended fix:
- Minimal safe fix:
  - Move first-response, AI/human latency, and queue metrics into SQL/RPC aggregate queries.
- Long-term fix:
  - Precompute or materialize operational metrics instead of building them from raw datasets on request.
- DB migration/index/RLS change if needed:
  - Likely RPCs/materialized views, plus indexes aligned to the new aggregate queries.
- Risk of the fix:
  - Medium; changes metric semantics and requires validation against current numbers.

Confidence:
High

[P1] Chat detail API is paginated, but the UI still exposes only the newest 50 messages

Area:
Performance

Status:
Confirmed risk

Evidence:
- File(s): `server/router.ts`, `server/messageHandler.ts`, `src/services/waApi.ts`, `src/hooks/useWhatsAppSessions.ts`
- Function/component/route: `GET /api/sessions/:jid`, `GET /api/sessions/:jid/messages`, `getSession()`, `getOlderMessages()`, `hydrateSession()`
- Relevant behavior:
  - `server/router.ts:1062-1098` exposes both first-page and older-message routes with `limit` and `before`.
  - `src/services/waApi.ts:102-123` exposes both `getSession()` and `getOlderMessages()`.
  - `src/hooks/useWhatsAppSessions.ts:219-245` hydrates a session with `getSession()` only.
  - Repo-wide search in the current head only found `getOlderMessages()` in `src/services/waApi.ts`; `ChatView` does not call it.
- Why the evidence supports the finding:
  - Older-message pagination exists server-side but is not part of the normal operator flow.

Why this matters:
- Technical impact:
  - Long-thread context stays unavailable despite existing backend support.
- Business impact:
  - Operators may answer without enough prior context.
- Heavy-user impact:
  - Repeat customers and long-running threads are common in production.
- Customer/support impact:
  - More manual digging and more mistakes on resumed conversations.

How to reproduce or validate:
1. Open a session with more than 50 stored messages.
2. Confirm the UI loads the newest 50 only.
3. Confirm there is no wired top-of-thread fetch for earlier pages.

Recommended fix:
- Minimal safe fix:
  - Connect `getOlderMessages()` to scroll-top loading in `ChatView`.
- Long-term fix:
  - Add virtualized message history with cursor paging and scroll-anchor preservation.
- DB migration/index/RLS change if needed:
  - Existing message indexes are directionally correct; verify with `EXPLAIN` before adding more.
- Risk of the fix:
  - Low to medium; scroll positioning and duplicate-merge edge cases need careful testing.

Confidence:
High

[P2] Catalog lazy loading is still too eager and capped for larger menus

Area:
Performance

Status:
Confirmed risk

Evidence:
- File(s): `src/AppShell.tsx`, `src/hooks/useCatalog.ts`, `src/components/views/CatalogView.tsx`
- Function/component/route: deferred catalog loading in `AppShell`, `useCatalog()`
- Relevant behavior:
  - `src/AppShell.tsx:241-245` allows catalog loading after deferred idle readiness, even outside the catalog screen.
  - `src/AppShell.tsx:382-403` flips `deferredDataReady` after idle/timeout.
  - `src/hooks/useCatalog.ts:51-53` caps categories/subcategories/products at `500/1000/2000`.
  - `src/components/views/CatalogView.tsx` still searches client-side.
- Why the evidence supports the finding:
  - Users who stay in chat still download the full catalog snapshot after idle; large menus are truncated by cap.

Why this matters:
- Technical impact:
  - Background bandwidth and memory use remain higher than necessary.
- Business impact:
  - Big menus can disappear from catalog UI and AI sync paths.
- Heavy-user impact:
  - Multi-category businesses are more likely to hit the cap.
- Customer/support impact:
  - Catalog mismatches cause confusion between what operators see and what exists in PDV.

How to reproduce or validate:
1. Log in and stay on chat.
2. Wait for idle loading.
3. Confirm catalog queries still fire and cap results to 2000 products.

Recommended fix:
- Minimal safe fix:
  - Keep catalog truly view-lazy outside `catalog` / `ai-configs`.
- Long-term fix:
  - Move catalog search/paging server-side and stop mirroring capped snapshots into the AI runtime.
- DB migration/index/RLS change if needed:
  - Review shared PDV indexes in the owning repo if server-side search is introduced.
- Risk of the fix:
  - Low to medium; affects current perceived boot responsiveness tradeoff.

Confidence:
High

## Suggested Indexes To Review
| Table | Columns | Query supported | Why needed | Risk |
| --- | --- | --- | --- | --- |
| `zelochat_sessions` | `(empresa_id, pinned DESC, last_message_time DESC, updated_at DESC)` | Inbox list sort | Aligns with real sort order instead of only `updated_at` | `last_message_time` is `text`; review type/ordering first |
| `zelochat_messages` | `(empresa_id, session_id, sent_at DESC) WHERE role IN ('user','assistant')` | Latest visible message lookup per session | Helps if preview lookup remains | More write overhead on messages |
| `zelochat_sessions` | `(empresa_id, last_message_time DESC) WHERE status <> 'archived'` | Dashboard active-session scan | Narrows dashboard hot path | Review against actual dashboard query shape |
| `zelochat_orders` | add normalized phone column + index `(empresa_id, customer_phone_normalized, pickup_date DESC)` | Customer-history / active-order lookup | Enables filtering by phone before `limit` | Requires schema change and backfill |

## SQL Suggestions To Review Before Applying
```sql
-- Review only. last_message_time is text today; prefer migrating it to timestamptz
-- or using an expression/index strategy that matches the real stored format.
create index concurrently if not exists idx_zelochat_sessions_empresa_pinned_lastmsg_updated
  on public.zelochat_sessions (empresa_id, pinned desc, last_message_time desc, updated_at desc);

create index concurrently if not exists idx_zelochat_messages_empresa_session_sent_visible
  on public.zelochat_messages (empresa_id, session_id, sent_at desc)
  where role in ('user', 'assistant');

create index concurrently if not exists idx_zelochat_sessions_empresa_lastmsg_non_archived
  on public.zelochat_sessions (empresa_id, last_message_time desc)
  where status <> 'archived';
```

## Deeper Review Still Needed
- `EXPLAIN ANALYZE` with production-like row counts for inbox, preview fan-out, dashboard overview, and operational orders.
- Payload-size measurement for `/api/sessions`, `/api/sessions/tags-map`, `/api/dashboard/overview`, and catalog idle-load.
- Shared-table index review in the Zelo PDV repo.
