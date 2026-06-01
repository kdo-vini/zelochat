# ZeloChat Memory

> Ver também: [[CLAUDE]] · [[CODE_REVIEW]] · [[FIXES_PROGRESS]] · [[ZeloChat.audit-report]]

## Purpose
- ZeloChat is a WhatsApp-native customer service platform for Brazilian small businesses, especially food businesses and lanchonetes.
- It supports AI and manual attendance, sessions/conversations, contacts, messages, escalation, tags, quick responses, order support, and shared company/profile/product context.
- It is integrated with Zelo PDV through shared Supabase tables such as `empresa_perfil`, `produtos`, `categorias`, and `subcategorias`.
- The codebase assumes production use with real customer conversations, real order state, and multi-tenant isolation.

## Tech Stack Detected
- Frontend framework: React 19 + Vite + TypeScript.
- UI/runtime libraries: Tailwind CSS, `motion/react`, `lucide-react`, `react-router-dom`.
- Backend/API structure: Express server in `server/index.ts` with routes in `server/router.ts`.
- Database: Supabase Postgres. Chat-owned tables use `empresa_id`; shared PDV tables use `id_usuario` / `empresa_perfil.user_id`.
- Auth model: Supabase JWT. Backend resolves tenant from the bearer token via `requireEmpresaId()` / `requireEmpresaAndUserId()` in `server/supabase.ts`. WebSocket auth is a first message `{ type: 'auth', token }` in `server/ws.ts`.
- Realtime/polling/webhook model:
  - WebSocket fan-out for chat events via `/ws`.
  - Whatsmiau inbound webhook at `POST /webhook/:instance`.
  - Direct Supabase realtime is also used for orders in `src/hooks/useOrders.ts`.
- AI provider/model integration:
  - OpenAI server-side SDK in `server/ai.ts`, `server/openaiClient.ts`, `server/pixReceiptValidator.ts`, `server/transcription.ts`.
  - Default chat model: `gpt-4o-mini`.
  - Default transcription model: `gpt-4o-mini-transcribe`.
- WhatsApp provider/integration: Whatsmiau / Evolution v2 wrapper in `server/whatsapp.ts`.
- Zelo PDV shared data/integration:
  - Frontend catalog CRUD reads/writes `produtos`, `categorias`, `subcategorias` directly through Supabase in `src/hooks/useCatalog.ts`.
  - Backend AI runtime hydrates shared profile/catalog from `empresa_perfil.user_id` in `server/configStore.ts`.
- Relevant libraries confirmed:
  - `@supabase/supabase-js`
  - `openai`
  - `axios`
  - `ws`
  - `stripe`
  - `tsx`
  - `@playwright/test` is installed; tests exist, but no `package.json` test script is defined.

## Repo Map
- Chat UI:
  - `src/components/views/ChatView.tsx`
  - `src/components/views/MessageBubble.tsx`
  - `src/hooks/useWhatsAppSessions.ts`
- Session/contact list:
  - `src/hooks/useWhatsAppSessions.ts`
  - `src/components/views/ChatView.tsx`
  - `server/messageHandler.ts`
- Message list / message persistence:
  - `src/components/views/ChatView.tsx`
  - `src/components/views/MessageBubble.tsx`
  - `server/messageHandler.ts`
- API routes:
  - `server/router.ts`
  - `server/index.ts`
- Webhook handlers / WhatsApp integration:
  - `server/router.ts`
  - `server/index.ts`
  - `server/whatsapp.ts`
  - `server/instanceManager.ts`
  - `server/webhookLog.ts`
- AI engine / prompt construction:
  - `server/ai.ts`
  - `server/configStore.ts`
  - `server/triggers.ts`
  - `server/builtinTriggers.ts`
  - `server/pixReceiptValidator.ts`
  - `server/aiSimulator.ts`
- Manual / AI mode logic:
  - `server/router.ts`
  - `server/messageHandler.ts`
  - `server/escalation.ts`
  - `server/configStore.ts`
  - `src/components/views/ChatView.tsx`
- Tags / filters / search:
  - `server/tags.ts`
  - `src/hooks/useTags.ts`
  - `src/components/views/ChatView.tsx`
  - `supabase/migrations/031_zelochat_tags.sql`
  - `supabase/migrations/032_zelochat_session_tags.sql`
- Zelo PDV integration:
  - `src/hooks/useCatalog.ts`
  - `src/hooks/useEmpresaPerfil.ts`
  - `src/AppShell.tsx`
  - `server/configStore.ts`
  - `server/router.ts` (`/api/produtos`, `/api/sync-config`)
- Database / schema / RLS:
  - `supabase/migrations/000_zelochat_schema.sql`
  - `supabase/migrations/014_zelochat_rls_hardening.sql`
  - `supabase/migrations/016_webhook_events_raw.sql`
  - `supabase/migrations/017_dashboard_response_events.sql`
  - `supabase/migrations/018_zelochat_ai_usage_daily.sql`
  - `supabase/migrations/028_performance_indexes.sql`
  - `supabase/migrations/031_zelochat_tags.sql`
  - `supabase/migrations/032_zelochat_session_tags.sql`
  - `supabase/migrations/033_zelochat_session_tags_tenant_enforcement.sql`
  - `supabase/migrations/034_zelochat_outbound_message_lifecycle.sql`
  - `supabase/migrations/035_zelochat_sessions_pagination_indexes.sql`
  - `supabase/migrations/038_zelochat_trigger_redirect_contact.sql`
- AI reply scheduling / debounce:
  - `server/replyDebouncer.ts` — staged 3-phase debounce (read 3s → typing 3s → reply 4s); configurable via `AI_DEBOUNCE_*` env vars; `AI_DEBOUNCE_DISABLED=1` reverts to 1500ms legacy
- Manager AI assistant:
  - `server/managerAssistant.ts` — operator-facing AI chat for configuration changes (history capped at 100 persisted, 40 sent to model)
- Web Push / PWA notifications:
  - `server/push.ts` — sends push notifications to subscribed browsers after new inbound message; requires VAPID env vars
- Pending order expiry sweep:
  - `server/pendingOrderSweeper.ts` — deletes `zelochat_pending_orders` with `expires_at < NOW() - 7 days`; runs 2min after boot + every 24h
- Payments (Pix via AbacatePay):
  - `server/abacatepay.ts` — Pix payment integration alongside Stripe (added 2026-05-21)
- Logs / observability:
  - `server/observability.ts`
  - `server/webhookLog.ts`
  - `server/aiUsage.ts`
  - `server/dashboardMetrics.ts`
- Tests:
  - `tests/aiSchedule.test.ts`
  - `tests/conversationState.test.ts`
  - `tests/pixReceipt.test.ts`
  - `tests/audioTranscriptionRearm.test.ts`
  - `tests/auditFixGuardrails.test.ts`
  - `tests/qa-chat-sync.spec.ts`
  - `tests/qa-session.spec.ts`
  - `tests/replyDebouncer.test.ts`
  - `tests/replyDebouncer-disabled.test.ts`

## Critical Data Flows
1. Incoming WhatsApp message -> webhook -> session resolution -> message persistence -> UI update -> AI decision -> AI response -> WhatsApp send
  - Entry: `server/router.ts` `POST /webhook/:instance`
  - Tenant resolution: `server/instanceManager.ts` `getEmpresaAndTokenForInstance()`
  - Raw event log: `server/webhookLog.ts`
  - Dispatch: `server/router.ts` `processWebhookEvent()`
  - Persistence: `server/index.ts` `onIncomingMessage()` -> `server/messageHandler.ts` `handleIncomingMessage()`
  - WebSocket update: `server/messageHandler.ts` broadcasts `message`
  - AI scheduling: `server/index.ts` -> `server/replyDebouncer.ts`
  - AI generation/send: `server/ai.ts` `generateAndSendReply()`
  - Outbound persistence: `server/messageHandler.ts` `addAssistantMessage()`

2. User opens ZeloChat dashboard -> sessions loaded -> filters/tags/search applied -> messages loaded
  - Auth: `src/hooks/useSupabaseSession.ts`
  - Session list load: `src/hooks/useWhatsAppSessions.ts` `refresh()` -> `src/services/waApi.ts` `getSessions()` -> paginated `GET /api/sessions`
  - Session list build: `server/messageHandler.ts` `getSessionsPage()`
  - Status/search/tag filters are sent to the server by `src/components/views/ChatView.tsx`
  - Conversation open: `src/hooks/useWhatsAppSessions.ts` `hydrateSession()` -> `src/services/waApi.ts` `getSession()`

3. User opens a heavy conversation with many messages
  - Backend support exists: `server/router.ts` `GET /api/sessions/:jid/messages`
  - Backend pagination: `server/messageHandler.ts` `getSession(jid, empresaId, limit, before)`
  - Frontend behavior: `src/hooks/useWhatsAppSessions.ts` exposes `loadOlderMessages()` and `src/components/views/ChatView.tsx` calls it when the operator scrolls near the top.

4. User switches conversation from AI to manual
  - UI toggle: `src/components/views/ChatView.tsx`
  - API: `POST /api/sessions/:jid/auto-reply` in `server/router.ts`
  - Backend update: `server/messageHandler.ts` `setAutoReply()`
  - AI enforcement: `server/index.ts` checks `session.autoReply`; `server/ai.ts` re-checks `autoReply` before sending.

5. User switches conversation from manual to AI
  - Same route and persistence path as above.
  - Global AI still also depends on `server/configStore.ts` / `empresa_perfil.ai_enabled`, `ai_mode`, `ai_schedule_start`, `ai_schedule_end`.

6. Escalation from AI to human
  - Automatic/manual escalation: `server/escalation.ts` `escalateSession()`
  - Trigger path from AI: `server/ai.ts` through triggers and `recordAiFailure()`
  - UI banner and resolve action: `src/components/views/ChatView.tsx`

6a. AI redirects customer to another WhatsApp line
  - Custom trigger kind: `redirect_contact` in `zelochat_triggers`.
  - Config fields: `redirect_phone` and optional `redirect_message` with `{link}` placeholder.
  - Runtime path: OpenAI emits the existing `dispatch_trigger`; `server/ai.ts` treats `redirect_contact` as turn-terminal after `escalate_human` and before `criar_pedido`.
  - Side effects: sends and persists a WhatsApp text with `https://wa.me/<number>` plus a tool audit row only. It does not call `escalateSession()`, create escalation events, create/confirm orders, or flip `auto_reply`.

7. Tags created/applied/removed/filtered
  - Tag CRUD: `server/tags.ts`
  - Tag routes: `server/router.ts`
  - UI load/apply/filter: `src/hooks/useTags.ts` and `src/components/views/ChatView.tsx`

8. ZeloChat reads company profile/products/orders from Zelo PDV
  - Shared profile read: `src/hooks/useEmpresaPerfil.ts`, `server/configStore.ts`
  - Shared catalog read: `src/hooks/useCatalog.ts`, `server/configStore.ts`
  - Orders are ZeloChat-owned, not PDV-owned: `src/hooks/useOrders.ts`, `server/router.ts`, `server/ai.ts`

9. AI uses Zelo PDV product/profile context to answer customer
  - Runtime config hydration: `server/configStore.ts`
  - Prompt assembly: `server/ai.ts` `buildSystemInstruction()`
  - Catalog injected as flat product list plus hierarchy in the current head.

10. Failed AI call / failed WhatsApp send / failed DB save
  - AI failures: `server/ai.ts` catch path + `server/escalation.ts` `recordAiFailure()`
  - Webhook processing failures: `server/webhookLog.ts` `processing_error`
  - Manual send path: `server/router.ts` `/api/send`
  - Audio transcription failures: `server/transcription.ts`
  - Dashboard timing metrics: `server/messageHandler.ts` `recordResponseEventForLatestInbound()`

## Data Model Summary
- `empresa_perfil`
  - Shared with Zelo PDV.
  - ZeloChat-specific columns include AI settings, business hours, `webhook_token`, `whatsmiau_instance`, `delivery_config`, `pix_receipt_config`.
- `zelochat_sessions`
  - One row per WhatsApp JID per empresa.
  - Key fields: `empresa_id`, `remote_jid`, `status`, `auto_reply`, `last_message`, `last_message_time`, `unread_count`, `updated_at`.
  - The UI groups multiple rows into a phone-family conversation.
- `zelochat_messages`
  - Linked to `zelochat_sessions.id`.
  - Key fields: `empresa_id`, `session_id`, `role`, `content`, `tool_calls`, `wa_message_id`, `sent_at`.
  - Audio transcription fields are present in current code paths.
- `zelochat_orders`
  - ZeloChat-owned confirmed orders.
  - Current frontend status enum: `pending`, `preparing`, `ready`, `out_for_delivery`, `delivered`.
- `zelochat_pending_orders`
  - Pending order confirmation/edit flow used by `server/ai.ts`.
- `zelochat_tags`
  - Tag metadata per empresa, including `ai_instructions`.
- `zelochat_triggers`
  - Operator-defined AI triggers per empresa.
  - Supported kinds: `notify_manager`, `escalate_human`, `redirect_contact`.
  - `redirect_contact` uses `redirect_phone` and optional `redirect_message` to send a wa.me handoff link while keeping the session in AI mode for future messages.
- `zelochat_session_tags`
  - Junction between sessions and tags.
  - Tenant consistency enforced at DB level via migration `033_zelochat_session_tags_tenant_enforcement.sql` (Sprint 58).
- `zelochat_escalation_events`
  - Escalation audit/event log.
- `zelochat_response_events`
  - Response-time metrics table for dashboard.
- `zelochat_webhook_events_raw`
  - Append-only raw inbound webhook log with `processed_at` and `processing_error`.
- `zelochat_ai_usage_daily`
  - Aggregated AI usage/cost counters only; it intentionally stores no prompt/response payloads.
- Shared Zelo PDV tables referenced from this repo:
  - `produtos`
  - `categorias`
  - `subcategorias`
- Subscription/billing referenced:
  - Shared `subscriptions` table is queried in `server/supabase.ts` for paywall checks.
  - Stripe billing flows exist in `server/billing.ts`.

## Multi-Tenant Rules
- Confirmed tenant identity fields:
  - Chat-owned tables: `empresa_id`
  - Shared catalog tables: `id_usuario`
  - Shared profile table: `empresa_perfil.id` + `empresa_perfil.user_id`
- Auth resolution:
  - HTTP API: bearer JWT -> `resolveEmpresaAndUserIdFromToken()` / `requireEmpresaId()` in `server/supabase.ts`
  - WebSocket: JWT is resolved on first socket message in `server/ws.ts`
  - Webhook: tenant resolves from `whatsmiau_instance` path in `server/instanceManager.ts`
- Where tenant filters are applied:
  - Most server-side routes explicitly filter by `empresa_id`.
  - Frontend Supabase reads for shared PDV tables explicitly filter by `id_usuario = session.user.id`.
- RLS assumptions/policies:
  - `000_zelochat_schema.sql` contains the current baseline snapshot.
  - `014_zelochat_rls_hardening.sql` contains additional hardening but is still marked draft/not applied in repo comments.
- Known risky areas:
  - `zelochat_session_tags` cross-tenant risk was fixed in Sprint 58: migration `033_zelochat_session_tags_tenant_enforcement.sql` enforces DB-level tenant consistency.
  - `/webhook/:instance` fails closed on missing token by default. `setWebhookForInstance()` registers tokenized webhook URLs because Whatsmiau custom headers have historically been unreliable. `WEBHOOK_ALLOW_MISSING_TOKEN_DURING_ROLLOUT=1` is the temporary emergency bypass.
  - Service-role usage is still common on backend hot paths, so explicit tenant filters remain critical.

## AI Engine Summary
- Prompt is built in `server/ai.ts` `buildSystemInstruction()`.
- Current prompt context includes:
  - AI instructions / owner style
  - available products
  - catalog hierarchy
  - blocked dates
  - daily context
  - customer history summary
  - active order summary
  - session tags
  - business hours / profile data
- Message history selection:
  - `generateAndSendReply()` forwards only `user` and `assistant` messages to OpenAI.
  - Runtime history is capped at 60 messages after filtering.
- Products/profile inclusion:
  - Hydrated via `server/configStore.ts`.
  - Current head also accepts browser-pushed runtime snapshots through `/api/sync-config`.
- Manual/AI mode enforcement:
  - `server/index.ts` checks `autoReply`, escalation status, and global AI enablement before scheduling.
  - `server/ai.ts` re-fetches the session and aborts if `autoReply` was turned off or session escalated mid-flight.
- Escalation handling:
  - Trigger-based and failure-based escalation live in `server/escalation.ts`.
  - Escalated sessions disable `auto_reply`.
- Failed AI responses:
  - Catch path in `server/ai.ts` records AI usage error and escalates after repeated failures.
- Token/cost controls present:
  - AI route guards for `/api/ai/*`
  - runtime history cap of 60 messages
  - audio size cap in `server/transcription.ts`
  - aggregated AI usage counters in `zelochat_ai_usage_daily`
- Known prompt/business-rule risks confirmed by current audit:
  - `out_for_delivery` orders are omitted from active-order context.
  - customer history and active orders use small enterprise-wide slices before phone filtering.
  - stock-controlled availability is enforced in the AI runtime as of Sprint 62.
  - `dailyContext` is inserted into the system prompt without sanitization/cap in the current code path.
  - catalog prompt currently duplicates flat and hierarchical catalog text.

## Performance Hot Paths
| Hot path | Files involved | Query / behavior | Pagination | Server-side filtering | Index / scaling note |
| --- | --- | --- | --- | --- | --- |
| Initial dashboard load | `src/AppShell.tsx`, `src/hooks/useWhatsAppSessions.ts`, `server/router.ts`, `server/messageHandler.ts` | Loads paged `/api/sessions`, all tags, session tags map, and later idle-loaded catalog/orders | Yes for inbox list | Yes for inbox status/search/tag | Migration `035_zelochat_sessions_pagination_indexes.sql` supports the paged inbox |
| Session/contact list | `server/messageHandler.ts`, `src/components/views/ChatView.tsx` | `getSessionsPage()` returns server-filtered pages; frontend loads more near list bottom | Yes | Yes | Preview fan-out still exists inside each page, but the blast radius is bounded by page size |
| Message open | `server/router.ts`, `server/messageHandler.ts`, `src/hooks/useWhatsAppSessions.ts` | `GET /api/sessions/:jid?limit=50` and `GET /api/sessions/:jid/messages?before=...` | Yes | N/A | Chat UI now loads older messages on top-scroll |
| Message send | `server/router.ts`, `server/messageHandler.ts`, `server/whatsapp.ts` | `/api/send` persists an outbound intent (`outbound_status='sending'`), sends through Whatsmiau, then marks `sent` or `failed` | N/A | N/A | Migration `034_zelochat_outbound_message_lifecycle.sql` adds persisted lifecycle fields |
| Incoming webhook | `server/router.ts`, `server/index.ts`, `server/messageHandler.ts` | Token check, ack first, raw-event log, dedupe inbound by `wa_message_id`, schedule AI | N/A | N/A | Missing token now 401s unless the explicit rollout bypass env is set |
| AI reply generation | `server/ai.ts`, `server/configStore.ts` | Hydrates runtime config, builds large prompt, calls OpenAI with tools | No | Partial | Catalog can dominate prompt size in larger tenants |
| Tag filtering/search | `src/hooks/useTags.ts`, `src/components/views/ChatView.tsx`, `server/tags.ts` | Loads all tags and full session->tags map, filters client-side | No | No | Not suitable for very large inboxes |
| Unread counts / last message preview | `server/messageHandler.ts`, `src/hooks/useWhatsAppSessions.ts` | Counts persist on sessions; last visible preview is rebuilt from message batches on refresh | No | N/A | Current preview computation adds extra queries |
| Zelo PDV product/profile loading | `src/hooks/useCatalog.ts`, `src/hooks/useEmpresaPerfil.ts`, `server/configStore.ts` | Frontend loads entire shared catalog with caps; backend loads full shared catalog without limit | No | No | `/api/sync-config` now reloads catalog from DB so browser snapshots do not override stock truth |

## Existing Risks / Known Pitfalls
- Fixed in Sprint 58: cross-tenant tag attachment is blocked in service code and migration `033` enforces session/tag tenant consistency.
- Fixed in Sprint 58: inbound webhook token validation fails closed by default, with tokenized webhook URLs and an explicit temporary rollout bypass env.
- Fixed in Sprint 58: inbox list has a paginated/filterable server API and frontend load-more wiring.
- Fixed in Sprint 58: older message pagination is wired into the chat UI on top-scroll.
- Fixed in Sprint 58: audio transcription completion re-arms the debounced AI reply when the audio remains the latest unanswered customer turn.
- Fixed in Sprint 58: manual outbound sends persist `sending`/`sent`/`failed` lifecycle state and fromMe echo repair no longer skips missing DB rows.
- Fixed in Sprint 59: outbound Whatsmiau send payloads use phone digits instead of full JIDs, and text/media/audio helpers require a returned provider message ID before the manual-send lifecycle can mark a message `sent`.
- Fixed in Sprint 62: AI runtime reads `controlar_estoque`/`estoque_atual`, removes zero-stock products from the prompt, exposes positive stock limits, blocks `criar_pedido` above stock, rechecks current stock before confirming a pending order, and reloads catalog from DB after `/api/sync-config`.
- Confirmed: `out_for_delivery` orders are missing from AI active-order context. Root cause: `server/ai.ts:1778` queries `.in('status', ['pending','preparing','ready','dispatched'])` — `'dispatched'` is a non-existent status value (DB CHECK constraint uses `'out_for_delivery'`), making that filter term a dead no-op AND omitting the real status name. Two bugs in one line.
- Confirmed: no persisted prompt/context snapshot exists for supportability; only aggregated AI usage is stored.
- Confirmed: `dailyContext` entries are injected into the system prompt without `safeForPrompt()` sanitization or length cap (`server/ai.ts:2062-2064`). All other user-controlled fields use `safeForPrompt(value, maxLen)`. Accepted risk: operator controls their own `dailyContext`.

## Historical Drift Notes
- Current supported webhook route is `POST /webhook/:instance`; legacy `POST /webhook` now returns `410`.
- Multi-tenant instance resolution and inbound dedupe by `wa_message_id` are implemented in the current head.
- Session list virtualization exists in `src/components/views/ChatView.tsx`; the main bottleneck is backend/data volume, not only DOM rendering.
- `000_zelochat_schema.sql` now exists as a recovery snapshot, but `014_zelochat_rls_hardening.sql` is still marked draft and the repo baseline remains internally inconsistent.
- `GET /api/sessions/:jid/messages` exists and is wired into the chat UI on top-scroll.

## Verification Commands
- Install: `npm install`
- Frontend dev server: `npm run dev`
- Backend dev server: `npm run dev:server`
  - Warning: unsafe with shared production-like Whatsmiau env unless webhook registration is disabled or sandbox credentials are used.
- Full dev stack: `npm run dev:all`
  - Same Whatsmiau warning as above.
- Build: `npm run build`
- Lint/typecheck: `npm run lint`
- Server typecheck: `npx tsc --noEmit -p server/tsconfig.json`
- Tests:
  - `package.json` defines: `npm test` → `npm run test:unit` → `tsx tests/run-unit-tests.ts`; also `npm run test:e2e` (Playwright) and `npm run test:e2e:ui`.
  - Playwright specs: `tests/*.spec.ts`. Unit tests: `tests/*.test.ts`.
  - Sprint 58 guardrails: `npx tsx tests/audioTranscriptionRearm.test.ts` and `npx tsx tests/auditFixGuardrails.test.ts`
- Database/migration commands: Unknown / not confirmed yet from this repo alone. Supabase migrations are stored under `supabase/migrations/`.

## Rules for Future Codex Sessions
- Always read this memory file before deep ZeloChat work.
- Do not trust client-provided `empresa_id`, `company_id`, `sessionId`, or `tagId` without server-side tenant validation.
- Never bypass tenant checks, especially on service-role code paths.
- Never let AI reply when manual mode or escalation should block it.
- Prefer paginated/cursor-based APIs for sessions and messages.
- Avoid loading all sessions, tags, and messages for heavy users.
- Preserve idempotency for webhooks, messages, and AI replies.
- Treat `/api/sync-config` as a risky runtime path until stale browser mirroring is removed.
- Keep audit findings evidence-based; if the code does not prove it, mark it as hypothesis.
