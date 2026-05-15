# ZeloChat Full Production Audit

## Executive Summary
- Is ZeloChat ready for heavy users?
  - No. The inbox, dashboard, and message-history flows still rely on capped whole-tenant loads and incomplete pagination wiring.
- Is it ready for paid traffic?
  - Not yet. The combination of inbox truncation, dormant webhook auth, and incomplete failure recovery still creates avoidable customer-facing risk.
- Is the AI engine safe enough for real customer conversations?
  - Not yet. The current head still has confirmed gaps in escalation fallback, active-order context, stock-aware availability, stale runtime catalog sync, and audio timeout recovery.
- Is Zelo PDV integration safe enough?
  - Partially. Tenant mapping is much better than older docs suggested, but the AI runtime still trusts stale/lossy browser snapshots and ignores stock-controlled availability.
- What are the top 5 business risks?
  - Cross-tenant tag leakage into prompts.
  - Missing enforced webhook auth on `/webhook/:instance`.
  - Inbox/dashboard scaling bottlenecks that truncate or hide active work.
  - Wrong AI context from stale browser sync, stock-blind catalog, and order-status drift.
  - Orphaned audio conversations and other lifecycle gaps that leave customers without clear service continuity.

## Historical Drift
- Legacy `POST /webhook` is removed; current traffic enters through `POST /webhook/:instance`.
- Current HEAD already has inbound dedupe by `wa_message_id`, raw webhook logging, and session list virtualization; older markdown that assumes those are absent is stale.
- The repo now contains `000_zelochat_schema.sql`, but the RLS-hardening story is still inconsistent because `014_zelochat_rls_hardening.sql` remains marked draft.
- Backend message pagination already exists; the remaining issue is that the chat UI does not consume it.

## Architecture Map
- Frontend:
  - React SPA rooted in `src/App.tsx` / `src/AppShell.tsx`.
  - Chat state lives in `src/hooks/useWhatsAppSessions.ts`.
  - Shared PDV profile/catalog are read directly from Supabase in `src/hooks/useEmpresaPerfil.ts` and `src/hooks/useCatalog.ts`.
- Backend/API:
  - Express entry in `server/index.ts`.
  - Routes in `server/router.ts`.
  - WebSocket fan-out in `server/ws.ts`.
- Database:
  - Chat-owned tables live under `zelochat_*`.
  - Shared PDV tables include `empresa_perfil`, `produtos`, `categorias`, `subcategorias`.
- AI Engine:
  - `server/ai.ts` + `server/configStore.ts`
  - OpenAI for chat/tool flows, transcription, Pix receipt validation.
- WhatsApp/Webhook:
  - Whatsmiau integration in `server/whatsapp.ts`
  - Inbound route `POST /webhook/:instance`
- Realtime/Polling:
  - Browser WebSocket at `/ws`
  - Supabase realtime for orders
- Zelo PDV Integration:
  - Frontend shared-table CRUD
  - Backend catalog/profile hydration for prompt building
- Auth/Multi-tenancy:
  - Supabase JWT -> `empresa_id`
  - Webhook -> per-instance empresa lookup
- Critical flows:
  - Webhook -> persistence -> debounce -> AI -> send
  - Inbox load -> conversation hydrate -> realtime merge
  - Escalation/manual takeover -> AI block -> human resolution

## Findings By Severity

### P0

[P0] Cross-tenant tag attachment leaks foreign AI instructions into another tenant's conversation

Area:
Security

Status:
Confirmed bug

Evidence:
- File(s): `server/router.ts`, `server/tags.ts`, `supabase/migrations/032_zelochat_session_tags.sql`, `server/ai.ts`
- Function/component/route:
  - `POST /api/sessions/:sessionId/tags/:tagId`
  - `applyTagToSession()`
  - `getSessionTagsFull()`
  - `buildSystemInstruction()`
- Relevant behavior:
  - `server/router.ts:1777-1783` accepts arbitrary `tagId`.
  - `server/tags.ts:143-154` upserts the junction row without verifying the tag belongs to the same empresa.
  - `supabase/migrations/032_zelochat_session_tags.sql:4-20` has no tenant-consistency FK/check between session, tag, and `empresa_id`.
  - `server/tags.ts:127-140` reads joined tag metadata back through that row.
  - `server/ai.ts:2952-2957` loads session tags and `server/ai.ts:1977` injects them into prompt context.
- Why the evidence supports the finding:
  - With a known foreign `tagId`, the current code path can attach and surface another tenant's tag data and instructions.

Why this matters:
- Technical impact:
  - Breaks tenant isolation and prompt integrity.
- Business impact:
  - One company's private AI instructions can influence another company's chat behavior.
- Heavy-user impact:
  - More operators/tags mean more ways a leaked UUID can cause damage.
- Customer/support impact:
  - This is a trust-breaking cross-tenant leak and a hard production blocker.

How to reproduce or validate:
1. Obtain a valid foreign `tagId`.
2. Call `POST /api/sessions/:sessionId/tags/:tagId` in another tenant.
3. Reload session tags or trigger AI prompt assembly and confirm the foreign tag is now visible/injected.

Recommended fix:
- Minimal safe fix:
  - Verify `zelochat_tags.empresa_id = empresaId` before any attach/delete/read helper accepts the `tagId`.
- Long-term fix:
  - Enforce tenant consistency in `zelochat_session_tags` at the DB layer.
- DB migration/index/RLS change if needed:
  - Yes; add composite-FK or trigger-based tenant validation.
- Risk of the fix:
  - Medium; existing bad junction rows must be cleaned before strict DB enforcement.

Confidence:
High

### P1

[P1] `/webhook/:instance` accepts missing webhook token by design

Area:
Security

Status:
Confirmed risk

Evidence:
- File(s): `server/router.ts`, `supabase/migrations/000_zelochat_schema.sql`
- Function/component/route: `POST /webhook/:instance`
- Relevant behavior:
  - `server/router.ts:681-692` documents webhook auth as dormant.
  - `server/router.ts:703-709` rejects only mismatched tokens.
  - `server/router.ts:710-726` proceeds when the token is missing.
  - `supabase/migrations/000_zelochat_schema.sql:73-76` shows a per-tenant `webhook_token` exists.
- Why the evidence supports the finding:
  - Missing secret is accepted; the effective auth boundary is the instance path alone in default mode.

Why this matters:
- Technical impact:
  - Forged inbound events can reach persistence, AI, and order flows if an instance path is known.
- Business impact:
  - Bad actors can inject fake conversation state and spend AI budget.
- Heavy-user impact:
  - Larger tenants provide more opportunities to hide malicious events.
- Customer/support impact:
  - Makes incident attribution and replay harder.

How to reproduce or validate:
1. Call `POST /webhook/:instance` without a token header.
2. Use a valid instance name.
3. Confirm the route acknowledges and processes the payload in default mode.

Recommended fix:
- Minimal safe fix:
  - Put a verifiable edge boundary in front of the route.
- Long-term fix:
  - Fail closed on a reliably forwarded secret/signature scheme.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Medium; must not cut off legitimate upstream traffic while changing the auth boundary.

Confidence:
High

[P1] Session list is capped at 2000 and still has no server-side pagination or filtering

Area:
Performance

Status:
Confirmed risk

Evidence:
- File(s): `server/messageHandler.ts`, `src/hooks/useWhatsAppSessions.ts`, `src/services/waApi.ts`, `src/components/views/ChatView.tsx`
- Function/component/route: `fetchAllSessionRows()`, `refresh()`, `getSessions()`, inbox filters in `ChatView`
- Relevant behavior:
  - `server/messageHandler.ts:29-32` defines a default `SESSION_LIST_LIMIT` of 2000.
  - `server/messageHandler.ts:889-898` applies the cap in the inbox query.
  - `src/hooks/useWhatsAppSessions.ts:205-208` always loads the full inbox result.
  - `src/services/waApi.ts:93-99` calls `/api/sessions` with no cursor or filter params.
  - `src/components/views/ChatView.tsx:714-747` filters locally.
- Why the evidence supports the finding:
  - Heavy-tenant inbox state is truncated before the UI can search, filter, or page through it.

Why this matters:
- Technical impact:
  - The inbox source of truth is incomplete under scale.
- Business impact:
  - Live conversations can fall out of the visible list.
- Heavy-user impact:
  - Tenants with 10k+ sessions are directly affected.
- Customer/support impact:
  - Missed chats become lost revenue and confusing operator complaints.

How to reproduce or validate:
1. Load more than 2000 sessions for a tenant.
2. Refresh chat.
3. Confirm the UI only ever sees the capped window and filters from that subset.

Recommended fix:
- Minimal safe fix:
  - Add cursor pagination and server-side search/status/tag filtering to `/api/sessions`.
- Long-term fix:
  - Replace raw JID-row inbox loading with a paginated conversation-family index.
- DB migration/index/RLS change if needed:
  - Review an inbox index aligned to `empresa_id, pinned, last_message_time, updated_at`.
- Risk of the fix:
  - Medium.

Confidence:
High

[P1] Inbox refresh fans out into message preview queries on every load

Area:
Performance

Status:
Confirmed risk

Evidence:
- File(s): `server/messageHandler.ts`
- Function/component/route: `getAllSessions()`
- Relevant behavior:
  - Session list rows already include `last_message` / `last_message_time`.
  - `server/messageHandler.ts:1331-1358` still batch-queries `zelochat_messages` to reconstruct latest visible preview/ordering.
- Why the evidence supports the finding:
  - The main inbox request performs extra work on the hot message table even before the operator opens a conversation.

Why this matters:
- Technical impact:
  - Adds latency and DB load to the primary operator entrypoint.
- Business impact:
  - Slower inbox refresh during live traffic.
- Heavy-user impact:
  - More sessions mean more preview chunk queries.
- Customer/support impact:
  - Operators see slower updates on active inbound work.

How to reproduce or validate:
1. Populate a large tenant.
2. Call `/api/sessions`.
3. Inspect backend behavior and confirm extra message-table lookups beyond the initial session query.

Recommended fix:
- Minimal safe fix:
  - Stop rebuilding preview when the denormalized session row is already trustworthy for the list.
- Long-term fix:
  - Use a single SQL/RPC path or a durable conversation-preview model.
- DB migration/index/RLS change if needed:
  - Partial index on visible message roles if preview lookup remains.
- Risk of the fix:
  - Medium.

Confidence:
High

[P1] Dashboard overview loads capped raw datasets with `count: 'exact'`

Area:
Performance

Status:
Confirmed risk

Evidence:
- File(s): `server/dashboardMetrics.ts`
- Function/component/route: `buildDashboardOverview()`
- Relevant behavior:
  - `server/dashboardMetrics.ts:49-56` defines caps of 5000 sessions/messages.
  - `server/dashboardMetrics.ts:256-289` loads raw sessions, messages, escalations, and orders, with `count: 'exact'` on sessions/messages.
  - `server/dashboardMetrics.ts:296-300` warns when caps are exceeded.
- Why the evidence supports the finding:
  - The dashboard path is both expensive and incomplete for heavier tenants.

Why this matters:
- Technical impact:
  - Node-side aggregation on capped raw data.
- Business impact:
  - Slow or misleading dashboard metrics.
- Heavy-user impact:
  - Biggest tenants get the least reliable dashboard.
- Customer/support impact:
  - Harder to trust queue and response metrics during operations.

How to reproduce or validate:
1. Use a tenant with more than 5000 messages in range.
2. Open Dashboard.
3. Observe cap warnings and incomplete coverage.

Recommended fix:
- Minimal safe fix:
  - Move critical metrics into SQL/RPC aggregates.
- Long-term fix:
  - Materialize operational metrics instead of computing from raw request-time scans.
- DB migration/index/RLS change if needed:
  - Likely yes; aggregate RPCs/views.
- Risk of the fix:
  - Medium.

Confidence:
High

[P1] Chat detail still exposes only the newest 50 messages

Area:
UX

Status:
Confirmed risk

Evidence:
- File(s): `server/router.ts`, `src/services/waApi.ts`, `src/hooks/useWhatsAppSessions.ts`
- Function/component/route:
  - `GET /api/sessions/:jid`
  - `GET /api/sessions/:jid/messages`
  - `getOlderMessages()`
  - `hydrateSession()`
- Relevant behavior:
  - Backend paging exists.
  - Frontend opens a session with `limit=50` and does not wire older-message loading into the chat surface.
- Why the evidence supports the finding:
  - Operators cannot access older thread context in the normal chat workflow.

Why this matters:
- Technical impact:
  - Existing stored context is inaccessible.
- Business impact:
  - Higher risk of contextless manual replies.
- Heavy-user impact:
  - Long-lived customers hit this constantly.
- Customer/support impact:
  - More manual digging and more mistakes when resuming old conversations.

How to reproduce or validate:
1. Open a 50+ message thread.
2. Scroll upward.
3. Confirm the UI does not fetch earlier pages.

Recommended fix:
- Minimal safe fix:
  - Wire `getOlderMessages()` into scroll-top loading.
- Long-term fix:
  - Cursor-based infinite history with scroll-anchor preservation.
- DB migration/index/RLS change if needed:
  - No immediate DB migration required.
- Risk of the fix:
  - Low to medium.

Confidence:
High

[P1] `/api/send` can send successfully and then fail to persist the outbound message locally

Area:
Reliability

Status:
Confirmed bug

Evidence:
- File(s): `server/router.ts`, `server/messageHandler.ts`
- Function/component/route: `POST /api/send`, `addAssistantMessage()`
- Relevant behavior:
  - `server/router.ts:1146-1148` sends outbound text/media first.
  - `server/router.ts:1150-1154` persists the assistant message after successful send.
  - `server/router.ts:1155-1161` returns error if persistence fails.
- Why the evidence supports the finding:
  - Customer delivery can succeed while the operator timeline stays incomplete.

Why this matters:
- Technical impact:
  - Outbound lifecycle is not recoverable in the current path.
- Business impact:
  - Operators may resend messages customers already got.
- Heavy-user impact:
  - More outbound traffic means more exposure to transient DB failures.
- Customer/support impact:
  - Creates duplicate or contradictory manual replies.

How to reproduce or validate:
1. Force send success.
2. Force DB persistence failure immediately after.
3. Confirm the customer receives the message while the UI does not show it.

Recommended fix:
- Minimal safe fix:
  - Persist an outbound lifecycle record before send and reconcile afterward.
- Long-term fix:
  - Queue/state-machine model for outbound sends.
- DB migration/index/RLS change if needed:
  - Likely yes.
- Risk of the fix:
  - Medium.

Confidence:
High

[P1] Audio transcription timeout can permanently skip AI reply

Area:
Reliability

Status:
Confirmed bug

Evidence:
- File(s): `server/ai.ts`, `server/transcription.ts`, `server/messageHandler.ts`
- Function/component/route:
  - `waitForPendingAudioTranscriptions()`
  - `generateAndSendReply()`
  - `transcribeAudio()`
- Relevant behavior:
  - `server/ai.ts:2741-2745` aborts reply on timeout.
  - `server/transcription.ts:135-138` later stores the transcript only.
- Why the evidence supports the finding:
  - No late-completion rearm exists in the current code path.

Why this matters:
- Technical impact:
  - Audio turns can die silently.
- Business impact:
  - Lost or stalled customer interactions.
- Heavy-user impact:
  - More queueing and upstream slowness increase frequency.
- Customer/support impact:
  - Hard-to-notice service holes.

How to reproduce or validate:
1. Delay transcription beyond timeout.
2. Send audio into AI-enabled chat.
3. Confirm the transcript arrives later without an automatic reply.

Recommended fix:
- Minimal safe fix:
  - Re-schedule reply on transcription completion if still eligible.
- Long-term fix:
  - Formal workflow/state machine for transcription + AI response.
- DB migration/index/RLS change if needed:
  - Optional processing-state fields.
- Risk of the fix:
  - Medium.

Confidence:
High

[P1] Critical human-escalation built-ins can be disabled by operators

Area:
AI Engine

Status:
Confirmed risk

Evidence:
- File(s): `server/triggers.ts`, `src/components/views/AIConfigsView.tsx`, `server/ai.ts`
- Function/component/route:
  - built-in trigger loading/toggling
  - trigger-driven AI reply flow
- Relevant behavior:
  - Current settings UI allows disabling built-ins that govern automatic escalation for complaint/human-request scenarios.
- Why the evidence supports the finding:
  - Deterministic safety behavior becomes optional configuration instead of hard server-side policy.

Why this matters:
- Technical impact:
  - Safety relies on model behavior in scenarios that should fail safe.
- Business impact:
  - Angry or human-requesting customers can remain stuck in AI.
- Heavy-user impact:
  - More simultaneous chats means more escalation-worthy edge cases.
- Customer/support impact:
  - Higher churn and manual recovery burden.

How to reproduce or validate:
1. Disable critical built-in escalation triggers.
2. Send complaint/human-request messages.
3. Confirm the path depends on model/tool behavior rather than a mandatory server block.

Recommended fix:
- Minimal safe fix:
  - Make critical escalation built-ins non-disableable.
- Long-term fix:
  - Add mandatory pre-model safety classifiers/fallbacks for those categories.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Low.

Confidence:
High

[P1] AI active-order context ignores `out_for_delivery`

Area:
AI Engine

Status:
Confirmed bug

Evidence:
- File(s): `server/ai.ts`, `src/types.ts`
- Function/component/route: `fetchActiveOrdersForCustomer()`
- Relevant behavior:
  - `server/ai.ts:1726-1731` uses `dispatched`.
  - `src/types.ts:152` defines `out_for_delivery`.
- Why the evidence supports the finding:
  - In-route deliveries are dropped from AI context.

Why this matters:
- Technical impact:
  - Order-state context is wrong.
- Business impact:
  - Customers can receive incorrect “where is my order?” answers.
- Heavy-user impact:
  - More live deliveries mean more misses.
- Customer/support impact:
  - Support burden rises on live-delivery conversations.

How to reproduce or validate:
1. Create an `out_for_delivery` order.
2. Trigger AI reply for that customer.
3. Confirm the order is absent from active-order context.

Recommended fix:
- Minimal safe fix:
  - Replace `dispatched` with `out_for_delivery`.
- Long-term fix:
  - Share order-status constants across layers.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Low.

Confidence:
High

[P1] Customer history and active-order context are built from enterprise-wide top-N slices before phone filtering

Area:
AI Engine

Status:
Confirmed risk

Evidence:
- File(s): `server/ai.ts`
- Function/component/route:
  - `fetchCustomerHistory()`
  - `fetchActiveOrdersForCustomer()`
- Relevant behavior:
  - `server/ai.ts:1688-1699` limits orders before filtering by phone.
  - `server/ai.ts:1726-1737` does the same for active orders.
- Why the evidence supports the finding:
  - Heavy-traffic tenants can lose the target customer's context even when correct data exists in DB.

Why this matters:
- Technical impact:
  - Prompt memory is semantically incomplete.
- Business impact:
  - AI repeats questions or misses active orders.
- Heavy-user impact:
  - Gets worse as enterprise concurrency grows.
- Customer/support impact:
  - AI feels forgetful/inconsistent.

How to reproduce or validate:
1. Seed many recent orders for other customers.
2. Put the target customer's history outside the top-N slice.
3. Trigger AI and observe missing context.

Recommended fix:
- Minimal safe fix:
  - Filter by phone in SQL before `limit`.
- Long-term fix:
  - Add normalized phone columns/indexes for customer-centric lookups.
- DB migration/index/RLS change if needed:
  - Likely yes for normalized phone fields.
- Risk of the fix:
  - Low to medium.

Confidence:
High

[P1] AI runtime ignores stock-controlled availability

Area:
Integration

Status:
Confirmed risk

Evidence:
- File(s): `src/hooks/useCatalog.ts`, `server/configStore.ts`, `server/ai.ts`
- Function/component/route:
  - shared catalog read
  - runtime config hydration
  - prompt/order product resolution
- Relevant behavior:
  - Frontend catalog reads `controlar_estoque` and `estoque_atual`.
  - Backend runtime hydration ignores them and availability is derived only from `ocultar_no_pdv`.
- Why the evidence supports the finding:
  - The AI can still offer out-of-stock products.

Why this matters:
- Technical impact:
  - Availability validation is incomplete.
- Business impact:
  - Wrong product promises.
- Heavy-user impact:
  - Rush-hour stock changes amplify the issue.
- Customer/support impact:
  - More apologies and manual order fixes.

How to reproduce or validate:
1. Set a stock-controlled product to zero stock.
2. Keep it visible.
3. Trigger an AI order flow and confirm it remains available to the model.

Recommended fix:
- Minimal safe fix:
  - Hydrate stock fields and derive availability from stock + hidden flag.
- Long-term fix:
  - Revalidate stock at pending-order and confirmation time.
- DB migration/index/RLS change if needed:
  - No initial DB migration required.
- Risk of the fix:
  - Medium.

Confidence:
High

[P1] `/api/sync-config` lets a stale browser overwrite backend AI catalog/profile runtime state

Area:
Integration

Status:
Confirmed risk

Evidence:
- File(s): `src/AppShell.tsx`, `server/router.ts`, `server/configStore.ts`, `src/hooks/useCatalog.ts`
- Function/component/route:
  - `syncConfigToServer()`
  - `POST /api/sync-config`
- Relevant behavior:
  - Browser posts `products`, `catalogHierarchy`, and profile fields to backend runtime config.
  - Backend accepts that payload directly and can reuse it for up to five minutes.
  - Browser catalog itself is capped at 2000 products.
- Why the evidence supports the finding:
  - AI runtime can drift from the shared source of truth and even shrink when the browser snapshot is capped.

Why this matters:
- Technical impact:
  - Wrong runtime config for AI.
- Business impact:
  - Stale prices, stale hours, stale Pix key, or missing products in live replies.
- Heavy-user impact:
  - Larger catalogs and more concurrent edits worsen it.
- Customer/support impact:
  - AI can contradict Zelo PDV during real conversations.

How to reproduce or validate:
1. Keep an older tab open.
2. Change catalog/profile data elsewhere.
3. Let the older tab sync config and confirm backend AI state reverts to the older snapshot.

Recommended fix:
- Minimal safe fix:
  - Stop mirroring catalog data from browser to backend runtime config.
- Long-term fix:
  - Shared DB as single source of truth plus versioned invalidation.
- DB migration/index/RLS change if needed:
  - Optional catalog/profile version markers.
- Risk of the fix:
  - Medium.

Confidence:
High

[P1] Auto-reply mode changes are not broadcast to other tabs/attendants

Area:
Chat Engine

Status:
Confirmed risk

Evidence:
- File(s): `server/router.ts`, `server/messageHandler.ts`, `src/hooks/useWhatsAppSessions.ts`, `server/ws.ts`
- Function/component/route:
  - `POST /api/sessions/:jid/auto-reply`
  - `setAutoReply()`
  - WebSocket event handling
- Relevant behavior:
  - `server/router.ts:1947-1952` toggles auto-reply.
  - `server/messageHandler.ts:2053-2079` updates DB rows for the family and returns without broadcasting.
  - `src/hooks/useWhatsAppSessions.ts:265-285` only updates the current tab optimistically.
  - `server/ws.ts:5-21` has no dedicated event type for this state change.
- Why the evidence supports the finding:
  - Manual/AI ownership can diverge across tabs until refresh.

Why this matters:
- Technical impact:
  - Realtime state convergence is incomplete.
- Business impact:
  - Two attendants can believe different modes are active for the same customer.
- Heavy-user impact:
  - More tabs and attendants increase the chance of conflicting assumptions.
- Customer/support impact:
  - Human takeover reliability looks weaker than it should.

How to reproduce or validate:
1. Open the same chat in two tabs.
2. Toggle manual/AI in one tab.
3. Confirm the second tab does not receive an immediate dedicated realtime state update.

Recommended fix:
- Minimal safe fix:
  - Broadcast an explicit WebSocket event for auto-reply changes.
- Long-term fix:
  - Complete a formal conversation-state event contract across tabs.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Low to medium.

Confidence:
High

### P2

[P2] Tag/session model is split between phone-family conversations and row-level storage

Area:
Architecture

Status:
Architecture risk

Evidence:
- File(s): `server/messageHandler.ts`, `server/tags.ts`, `server/escalation.ts`
- Function/component/route:
  - `fetchSessionFamily()`
  - `resolveSessionUuid()`
  - `findSessionByJid()`
- Relevant behavior:
  - Inbox groups multiple session rows into one phone-family conversation.
  - Tags and escalation helpers still resolve by exact JID/session row.
- Why the evidence supports the finding:
  - Some conversation-level features are modeled against technical rows instead of a stable aggregated conversation identity.

Why this matters:
- Technical impact:
  - Family/JID drift risks inconsistent tags, escalation semantics, and event routing.
- Business impact:
  - Operators can see conversation metadata behave inconsistently.
- Heavy-user impact:
  - More multi-JID families means more fragmentation.
- Customer/support impact:
  - Harder to reason about the “real” conversation state.

How to reproduce or validate:
1. Create multiple `zelochat_sessions` rows for the same phone-family.
2. Apply tags or escalations through one JID.
3. Observe how features depend on which row is treated as canonical.

Recommended fix:
- Minimal safe fix:
  - Normalize these features to a stable canonical family key.
- Long-term fix:
  - Introduce a first-class conversation-family entity.
- DB migration/index/RLS change if needed:
  - Likely yes.
- Risk of the fix:
  - Medium.

Confidence:
High

[P2] Backend emits `message_status`, but the frontend ignores it

Area:
UX

Status:
Confirmed bug

Evidence:
- File(s): `server/router.ts`, `server/ws.ts`, `src/hooks/useWhatsAppSessions.ts`
- Function/component/route: `messages.update` -> WebSocket -> hook
- Relevant behavior:
  - `server/router.ts:571-579` broadcasts `message_status`.
  - `server/ws.ts:12` includes `message_status`.
  - `src/hooks/useWhatsAppSessions.ts:619-620` has no branch for that event type.
- Why the evidence supports the finding:
  - Delivery/read tick updates are dropped on the client.

Why this matters:
- Technical impact:
  - Stale message lifecycle visibility.
- Business impact:
  - Operators cannot trust read/delivery state.
- Heavy-user impact:
  - More outbound support conversations make this more painful.
- Customer/support impact:
  - More uncertainty and resend behavior.

How to reproduce or validate:
1. Send a message.
2. Let delivery/read webhooks arrive.
3. Observe no status advance in the client.

Recommended fix:
- Minimal safe fix:
  - Handle `message_status` in the client hook.
- Long-term fix:
  - Persist richer outbound lifecycle state including failures.
- DB migration/index/RLS change if needed:
  - Not for the first fix.
- Risk of the fix:
  - Low.

Confidence:
High

[P2] Message delete events can miss multi-JID family views

Area:
Chat Engine

Status:
Confirmed risk

Evidence:
- File(s): `server/messageHandler.ts`, `src/hooks/useWhatsAppSessions.ts`
- Function/component/route:
  - `deleteMessageByWhatsAppId()`
  - `message_deleted` handling
- Relevant behavior:
  - `server/messageHandler.ts:1123-1129` uses `family.latest.remote_jid`.
  - `src/hooks/useWhatsAppSessions.ts:589-595` only applies the delete to the exact `session.id` key.
- Why the evidence supports the finding:
  - Multi-JID families can miss the delete event until a refresh or rehydrate.

Why this matters:
- Technical impact:
  - Stale deleted content remains visible.
- Business impact:
  - Operators can act on already-deleted content.
- Heavy-user impact:
  - More family complexity means more divergence.
- Customer/support impact:
  - Weakens trust in delete-for-everyone behavior.

How to reproduce or validate:
1. Use a family with multiple JIDs.
2. Delete a message from one row.
3. Observe another UI copy keyed to a different family row miss the delete.

Recommended fix:
- Minimal safe fix:
  - Emit the delete using the same stable session/family key the UI caches.
- Long-term fix:
  - First-class conversation-family identity.
- DB migration/index/RLS change if needed:
  - Possibly.
- Risk of the fix:
  - Medium.

Confidence:
High

[P2] Session delete does not fan out in realtime

Area:
Chat Engine

Status:
Confirmed risk

Evidence:
- File(s): `server/messageHandler.ts`, `src/hooks/useWhatsAppSessions.ts`, `server/ws.ts`
- Function/component/route: `deleteSession()`
- Relevant behavior:
  - `server/messageHandler.ts:1620-1645` deletes DB rows without broadcasting.
  - `src/hooks/useWhatsAppSessions.ts:288-295` removes the session only in the initiating tab.
  - `server/ws.ts` has no `session_deleted` event type.
- Why the evidence supports the finding:
  - Other tabs remain stale.

Why this matters:
- Technical impact:
  - Cross-tab state divergence.
- Business impact:
  - Different attendants see different inbox state.
- Heavy-user impact:
  - Multi-tab workflows are common in busy operations.
- Customer/support impact:
  - Creates operator confusion.

How to reproduce or validate:
1. Delete a session in one tab.
2. Keep another tab open.
3. Observe the stale session remains until refresh.

Recommended fix:
- Minimal safe fix:
  - Add `session_deleted` realtime fan-out.
- Long-term fix:
  - Complete event contract for destructive session actions.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Low.

Confidence:
High

[P2] Chat auto-scroll snaps to bottom on any message update

Area:
UX

Status:
Confirmed risk

Evidence:
- File(s): `src/components/views/ChatView.tsx`
- Function/component/route: scroll effect
- Relevant behavior:
  - `src/components/views/ChatView.tsx:1027-1029` scrolls to bottom whenever active session messages change.
- Why the evidence supports the finding:
  - Reviewing old context becomes unstable during live updates.

Why this matters:
- Technical impact:
  - No scroll-anchor preservation.
- Business impact:
  - Operators lose place when reading history.
- Heavy-user impact:
  - More frequent realtime updates mean more snaps.
- Customer/support impact:
  - Lower operator trust and slower handling.

How to reproduce or validate:
1. Scroll upward in an active chat.
2. Let a transcript update or new message arrive.
3. Observe the snap back to bottom.

Recommended fix:
- Minimal safe fix:
  - Only auto-scroll when already near the bottom.
- Long-term fix:
  - Preserve anchor and add explicit jump-to-latest behavior.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Low.

Confidence:
High

[P2] Raw webhook failures are logged but not replayed automatically

Area:
Reliability

Status:
Confirmed risk

Evidence:
- File(s): `server/router.ts`, `server/webhookLog.ts`
- Function/component/route:
  - raw webhook logging path
- Relevant behavior:
  - Rows get `processing_error`, but the repo has no replay worker or admin replay surface.
- Why the evidence supports the finding:
  - Detection exists without automatic recovery.

Why this matters:
- Technical impact:
  - Failure evidence is preserved, but the work stays unrecovered.
- Business impact:
  - Regressions can still drop customer work until humans intervene.
- Heavy-user impact:
  - More inbound traffic increases the failed-event backlog.
- Customer/support impact:
  - Support lacks self-serve replay tooling.

How to reproduce or validate:
1. Force processing to fail after raw event insert.
2. Inspect logged row.
3. Confirm no automatic replay occurs.

Recommended fix:
- Minimal safe fix:
  - Build a replay tool for failed rows.
- Long-term fix:
  - Dead-letter/replay workflow with retry metadata.
- DB migration/index/RLS change if needed:
  - Optional replay state columns.
- Risk of the fix:
  - Low to medium.

Confidence:
High

[P2] There is no persisted prompt/context snapshot for AI supportability

Area:
Observability

Status:
Confirmed risk

Evidence:
- File(s): `server/aiUsage.ts`, `supabase/migrations/018_zelochat_ai_usage_daily.sql`, `server/ai.ts`
- Function/component/route:
  - AI usage aggregation
  - prompt assembly
- Relevant behavior:
  - AI usage table intentionally stores no prompt/response/context payloads.
  - Prompt/context is built in memory and not persisted as an audit artifact in this repo.
- Why the evidence supports the finding:
  - The product can answer “how much AI ran”, but not “why this exact reply was produced”.

Why this matters:
- Technical impact:
  - Incident debugging lacks decision evidence.
- Business impact:
  - Wrong AI replies are harder to explain and fix.
- Heavy-user impact:
  - More conversations mean more opaque incidents.
- Customer/support impact:
  - Support cannot quickly explain AI behavior to the business owner.

How to reproduce or validate:
1. Inspect repo for prompt/context audit persistence.
2. Compare with the AI usage aggregate table.
3. Confirm only aggregate usage exists today.

Recommended fix:
- Minimal safe fix:
  - Persist a redacted prompt/context summary and tool path for AI turns.
- Long-term fix:
  - Dedicated AI audit log with retention and redaction controls.
- DB migration/index/RLS change if needed:
  - Yes; likely a new audit table.
- Risk of the fix:
  - Medium.

Confidence:
High

[P2] Plaintext PII is emitted to logs in AI/order paths

Area:
Security

Status:
Confirmed risk

Evidence:
- File(s): `server/ai.ts`
- Function/component/route: order creation and AI error logging
- Relevant behavior:
  - `server/ai.ts:1836` logs order args payload.
  - `server/ai.ts:3800-3801` logs raw upstream AI error payload data.
- Why the evidence supports the finding:
  - Customer/order information can land outside the primary DB in plaintext logs.

Why this matters:
- Technical impact:
  - Unnecessary sensitive-data surface.
- Business impact:
  - LGPD exposure and trust risk.
- Heavy-user impact:
  - More traffic means more sensitive log output.
- Customer/support impact:
  - Log viewers gain access to more customer data than necessary.

How to reproduce or validate:
1. Trigger order creation or an upstream AI error.
2. Inspect server logs.
3. Confirm sensitive payload data is emitted.

Recommended fix:
- Minimal safe fix:
  - Redact/drop payload fields from logs.
- Long-term fix:
  - Structured redacted logging and secret-safe error wrappers.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Low.

Confidence:
High

[P2] Repo migration baseline is still inconsistent on RLS hardening

Area:
Architecture

Status:
Architecture risk

Evidence:
- File(s): `supabase/migrations/000_zelochat_schema.sql`, `supabase/migrations/014_zelochat_rls_hardening.sql`
- Function/component/route: migration baseline
- Relevant behavior:
  - `014_zelochat_rls_hardening.sql` is still marked draft/not applied.
  - It contains security policies that the repo otherwise treats as desired hardening.
- Why the evidence supports the finding:
  - New environments cannot rely on one single authoritative secure baseline in repo state today.

Why this matters:
- Technical impact:
  - Environment drift risk.
- Business impact:
  - Security guarantees depend on how an environment was built.
- Heavy-user impact:
  - Not volume-specific.
- Customer/support impact:
  - Incident recovery and audits are harder.

How to reproduce or validate:
1. Compare 000 and 014.
2. Note the draft/not-applied marker in 014.
3. Confirm the repo baseline is split.

Recommended fix:
- Minimal safe fix:
  - Reconcile the repo baseline and explicitly document live-vs-repo state.
- Long-term fix:
  - Maintain one authoritative recovery baseline.
- DB migration/index/RLS change if needed:
  - Yes.
- Risk of the fix:
  - Medium.

Confidence:
High

### P3

[P3] Loading states are mostly text/spinner based rather than skeleton-based

Area:
UX

Status:
Product suggestion

Evidence:
- File(s): `src/components/views/ChatView.tsx`, `src/components/views/DashboardView.tsx`
- Function/component/route: loading states
- Relevant behavior:
  - Chat shows text-only “Carregando conversas…”.
  - Dashboard shows a centered spinner/loading text.
- Why the evidence supports the finding:
  - The surfaces work, but perceived performance and layout stability can still improve.

Why this matters:
- Technical impact:
  - None critical.
- Business impact:
  - Lower perceived polish on slow devices/networks.
- Heavy-user impact:
  - Low-end notebooks feel rougher.
- Customer/support impact:
  - Operators may confuse slow load with broken load.

How to reproduce or validate:
1. Throttle network.
2. Open chat and dashboard.
3. Observe current spinner/text-only states.

Recommended fix:
- Minimal safe fix:
  - Add inbox-row and dashboard-card skeletons.
- Long-term fix:
  - Shared loading-state system across operator views.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Low.

Confidence:
High

[P3] Test coverage still carries stale assumptions about the removed legacy webhook route

Area:
Architecture

Status:
Confirmed risk

Evidence:
- File(s): `tests/qa-session.spec.ts`, `server/router.ts`
- Function/component/route:
  - Playwright session tests
  - `POST /webhook`
- Relevant behavior:
  - Current repo still contains test coverage aimed at the removed legacy webhook path, while the real production path is `/webhook/:instance`.
- Why the evidence supports the finding:
  - Some coverage is aimed at a removed entrypoint instead of the active multi-tenant route.

Why this matters:
- Technical impact:
  - Tests can miss the current critical path.
- Business impact:
  - Production regressions can slip through “green” coverage.
- Heavy-user impact:
  - Indirect.
- Customer/support impact:
  - Harder to trust regression coverage.

How to reproduce or validate:
1. Inspect `tests/qa-session.spec.ts`.
2. Compare with `server/router.ts` legacy webhook behavior.
3. Confirm the active route is `/webhook/:instance`.

Recommended fix:
- Minimal safe fix:
  - Add/shift coverage to `/webhook/:instance`.
- Long-term fix:
  - Build end-to-end fixtures for current multi-tenant webhook flow.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Low.

Confidence:
High

## Top 10 Issues By Business Impact
1. Cross-tenant tag leak into prompt context.
2. Missing enforced webhook auth on `/webhook/:instance`.
3. Stale/lossy browser sync overriding backend AI catalog/profile runtime state.
4. AI ignoring stock-controlled availability.
5. Inbox list capped at 2000 with no server-side pagination/filtering.
6. Dashboard overview built from capped raw datasets.
7. Audio transcription timeout leaving customers unanswered.
8. AI active-order context missing `out_for_delivery`.
9. AI customer-history/order context using enterprise-wide top-N slices before phone filtering.
10. Manual/AI ownership changes not broadcasting across tabs.

## Must Fix Before Scaling Ads
- Cross-tenant tag leak.
- Webhook auth gap.
- Inbox pagination/truncation.
- Dashboard capped raw metrics.
- Stale/lossy AI runtime catalog/profile sync.

## Must Fix Before Heavy Users
- Inbox pagination and server-side filtering.
- Preview fan-out in `/api/sessions`.
- Dashboard aggregate rewrite.
- Older-message pagination in the chat UI.
- Catalog background load and 2000-row cap.

## Must Fix Before Selling AI As Reliable
- Audio timeout no-rearm path.
- Disableable critical escalation built-ins.
- `out_for_delivery` context drift.
- Customer history/active-order top-N query pattern.
- Stock-blind availability.
- Cross-tab manual/AI mode divergence.

## Must Fix Before Deep Zelo PDV Integration
- Remove browser-mirrored catalog/profile runtime sync as a source of truth.
- Enforce stock-aware availability in AI runtime.
- Add versioning/invalidation for shared profile/catalog changes.
- Measure and cap prompt footprint for larger menus.

## Can Improve Later
- Skeleton loading states.
- Simulator scope clarity vs runtime parity.
- Stronger support UI around webhook replay and AI audits.
- Canonical conversation-family model to simplify row/JID edge cases.

## Recommended Implementation Order
1. Tenant boundary hardening
  - Why first: removes the only confirmed cross-tenant leak and closes the most dangerous ingress boundary.
  - Risk: medium
  - Files likely involved: `server/router.ts`, `server/tags.ts`, `supabase/migrations/032_zelochat_session_tags.sql`, edge/webhook infra
  - Tests/checks needed: tenant isolation, foreign-tag attach reject, webhook auth acceptance/reject tests
2. Heavy-user inbox and dashboard scaling
  - Why first: these are the biggest blockers to paid traffic and operator trust at volume.
  - Risk: medium to high
  - Files likely involved: `server/messageHandler.ts`, `server/router.ts`, `src/hooks/useWhatsAppSessions.ts`, `src/components/views/ChatView.tsx`, `server/dashboardMetrics.ts`
  - Tests/checks needed: pagination, server-side search/filter, large-inbox fixtures, dashboard aggregate correctness
3. AI context correctness
  - Why first: wrong product/order context directly harms customer conversations.
  - Risk: medium
  - Files likely involved: `server/ai.ts`, `server/configStore.ts`, `src/AppShell.tsx`, `src/hooks/useCatalog.ts`
  - Tests/checks needed: order-status context, stock gating, catalog invalidation, top-N phone-filter regression tests
4. Lifecycle reliability and observability
  - Why first: fixes invisible failure modes and support blind spots.
  - Risk: medium
  - Files likely involved: `server/router.ts`, `server/transcription.ts`, `server/webhookLog.ts`, `server/aiUsage.ts`, `server/ai.ts`
  - Tests/checks needed: send-after-persist failure simulation, audio timeout retry, failed webhook replay, AI audit logging
5. Cross-tab realtime completeness
  - Why first: improves live attendance correctness once the bigger blockers above are contained.
  - Risk: low to medium
  - Files likely involved: `server/ws.ts`, `server/messageHandler.ts`, `src/hooks/useWhatsAppSessions.ts`
  - Tests/checks needed: multi-tab auto-reply toggle, session delete fan-out, message-status UI updates

## Suggested Database Indexes
| Table | Columns | Query supported | Why needed | Risk |
| --- | --- | --- | --- | --- |
| `zelochat_sessions` | `(empresa_id, pinned desc, last_message_time desc, updated_at desc)` | Inbox list | Aligns with current list ordering | Review because `last_message_time` is `text` |
| `zelochat_messages` | `(empresa_id, session_id, sent_at desc) WHERE role IN ('user','assistant')` | Latest visible message lookup | Reduces preview lookup cost if retained | Extra write overhead |
| `zelochat_sessions` | `(empresa_id, last_message_time desc) WHERE status <> 'archived'` | Dashboard active-session scan | Narrows current dashboard scan | Review against final dashboard query shape |
| `zelochat_orders` | normalized phone column + `(empresa_id, customer_phone_normalized, pickup_date desc)` | Customer history / active order lookup | Lets phone filtering happen before `limit` | Requires schema change/backfill |

Suggested SQL to review before applying:

```sql
create index concurrently if not exists idx_zelochat_sessions_empresa_pinned_lastmsg_updated
  on public.zelochat_sessions (empresa_id, pinned desc, last_message_time desc, updated_at desc);

create index concurrently if not exists idx_zelochat_messages_empresa_session_sent_visible
  on public.zelochat_messages (empresa_id, session_id, sent_at desc)
  where role in ('user', 'assistant');

create index concurrently if not exists idx_zelochat_sessions_empresa_lastmsg_non_archived
  on public.zelochat_sessions (empresa_id, last_message_time desc)
  where status <> 'archived';
```

## Suggested Tests
- Webhook idempotency:
  - duplicate `wa_message_id` should not create duplicate inbound rows or duplicate AI runs.
- Manual mode blocking AI:
  - toggle manual before and during AI run; no outbound AI reply should persist/send.
- Escalation blocking AI:
  - escalated conversation must not send AI reply until resolved.
- Message pagination:
  - 50+ message threads should load older pages without scroll jumps or duplicates.
- Heavy session loading:
  - tenant with >2000 sessions should page and filter correctly without silent truncation.
- Tenant isolation:
  - foreign `tagId`, `sessionId`, and message resources must be rejected.
- Zelo PDV product context correctness:
  - out-of-stock and hidden items must not appear as available to AI.
- Failed WhatsApp send:
  - manual outbound path must preserve operator-visible failure/sent state.
- Failed AI call:
  - repeated AI failure should escalate and remain debuggable.
- Tag filtering:
  - tags should remain scoped and stable under family/JID edge cases.
- Search:
  - server-side search should find sessions beyond the current first page.

## Open Questions
- Has `014_zelochat_rls_hardening.sql` actually been applied in the live Supabase project?
- Do any production tenants still use legacy or guessable Whatsmiau instance names?
- Are duplicate product names allowed in shared Zelo PDV catalogs? This affects the risk level of name-based stock decrement logic.
