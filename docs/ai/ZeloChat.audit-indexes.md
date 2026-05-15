# ZeloChat Index Audit

## Current Confirmed Indexes In Repo
- `supabase/migrations/000_zelochat_schema.sql`
  - `zelochat_sessions_empresa_remote_unique`
  - `zelochat_sessions_empresa_id_idx`
  - `zelochat_sessions_updated_at_idx`
  - `idx_zelochat_sessions_status_escalated`
- `supabase/migrations/017_dashboard_response_events.sql`
  - `idx_zelochat_response_events_empresa_time`
  - `idx_zelochat_response_events_session_time`
  - `idx_zelochat_response_events_first_by_responder`
  - `idx_zelochat_response_events_response_message`
- `supabase/migrations/028_performance_indexes.sql`
  - `idx_zelochat_sessions_empresa_updated`
  - `idx_zelochat_messages_empresa_session_sent`
  - `idx_zelochat_messages_empresa_role_sent`
  - `idx_zelochat_orders_empresa_status`
  - `idx_zelochat_orders_empresa_pickup`
  - `idx_zelochat_sessions_empresa_phone`
- `supabase/migrations/031_zelochat_tags.sql`
  - `zelochat_tags_empresa_name`
  - `zelochat_tags_empresa_id`
- `supabase/migrations/032_zelochat_session_tags.sql`
  - `zelochat_session_tags_session_id`
  - `zelochat_session_tags_tag_id`
  - `zelochat_session_tags_empresa_id`
- `supabase/migrations/016_webhook_events_raw.sql`
  - indexes for `empresa_id`, `received_at`, unprocessed rows, and `wa_message_id`

## Confirmed Gaps

### 1. Inbox sort is not aligned to the current query shape
- Query evidence:
  - `server/messageHandler.ts:891-898`
  - `WHERE empresa_id = ? ORDER BY pinned DESC, last_message_time DESC, updated_at DESC LIMIT ?`
- Current repo indexes:
  - `idx_zelochat_sessions_empresa_updated`
  - older `updated_at`-only indexes
- Gap:
  - no confirmed index in repo aligned to `pinned + last_message_time + updated_at`

### 2. Customer-context queries in AI filter by phone only after top-N limits
- Query evidence:
  - `server/ai.ts:1688-1699`
  - `server/ai.ts:1726-1737`
- Gap:
  - current repo indexes help `empresa_id + status` and `empresa_id + pickup_date`, but not “lookup by normalized customer phone before limit”

### 3. Dashboard scans active sessions and time-ranged messages via capped raw reads
- Query evidence:
  - `server/dashboardMetrics.ts:256-289`
- Gap:
  - current indexes help part of the scan, but the bigger issue is aggregate shape; index-only tuning will not fully fix the Node-side computation path

### 4. Tenant consistency in `zelochat_session_tags` is not enforced at the DB layer
- Schema evidence:
  - `supabase/migrations/032_zelochat_session_tags.sql:4-20`
- Gap:
  - not an index gap, but a relational-integrity gap. `empresa_id` is denormalized without a composite-FK/check/trigger to enforce tag/session tenant consistency.

## Suggested Indexes

### Suggestion A
- Table: `public.zelochat_sessions`
- Columns: `(empresa_id, pinned desc, last_message_time desc, updated_at desc)`
- Query supported:
  - inbox list in `fetchAllSessionRows()`
- Why needed:
  - matches the actual ordering used in the hot inbox path
- Risk:
  - `last_message_time` is `text` today, so lexical ordering and index usefulness depend on the stored format; review type migration first if needed

### Suggestion B
- Table: `public.zelochat_messages`
- Columns: `(empresa_id, session_id, sent_at desc) WHERE role IN ('user','assistant')`
- Query supported:
  - latest visible message per session if preview fan-out remains
- Why needed:
  - narrows preview lookups to the role subset the inbox actually uses
- Risk:
  - extra write overhead on a hot table

### Suggestion C
- Table: `public.zelochat_sessions`
- Columns: `(empresa_id, last_message_time desc) WHERE status <> 'archived'`
- Query supported:
  - dashboard session scan
- Why needed:
  - narrows active-session ordering used by dashboard load
- Risk:
  - partial index must stay aligned with real dashboard semantics

### Suggestion D
- Table: `public.zelochat_orders`
- Columns:
  - long-term: add `customer_phone_normalized` and index `(empresa_id, customer_phone_normalized, pickup_date desc)`
- Query supported:
  - customer history / active order lookup for AI
- Why needed:
  - lets the system filter by phone before `limit`
- Risk:
  - schema/backfill work; current code normalizes in memory only

## Suggested SQL Migrations To Review Before Applying
```sql
-- Review only. Do not apply blindly.

create index concurrently if not exists idx_zelochat_sessions_empresa_pinned_lastmsg_updated
  on public.zelochat_sessions (empresa_id, pinned desc, last_message_time desc, updated_at desc);

create index concurrently if not exists idx_zelochat_messages_empresa_session_sent_visible
  on public.zelochat_messages (empresa_id, session_id, sent_at desc)
  where role in ('user', 'assistant');

create index concurrently if not exists idx_zelochat_sessions_empresa_lastmsg_non_archived
  on public.zelochat_sessions (empresa_id, last_message_time desc)
  where status <> 'archived';
```

## Non-Index DB Changes Worth More Than Another Index
- Add tenant-consistency enforcement to `zelochat_session_tags`.
- Consider migrating `zelochat_sessions.last_message_time` from `text` to `timestamptz`.
- Consider adding normalized customer phone columns for AI/order lookup paths.
- Replace Node-side dashboard aggregations with SQL/RPC aggregates before adding more dashboard indexes.
