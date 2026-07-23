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
  - ZeloMenu product publication now uses the real `zelomenu_product_publications` overlay in ZeloChat: `src/hooks/useCatalog.ts` reads/writes it in the authenticated `Cardápio`, `server/configStore.ts` resolves public catalog items through it before the cart/AI see availability, and modifier groups/options are now surfaced in both the authenticated publication UI and the public cart runtime. Product-photo ownership currently uses the shared `logos` bucket with the prefix `zelomenu-products/{userId}/...`, plus cleanup on replace/delete/account purge.
  - Shared `subscriptions` expiry for ZeloChat access must use the later valid timestamp between `current_period_end` and `manually_extended_until`; an expired manual extension must never shorten a renewed chat/bundle entitlement.
  - Current shared subscription semantics are still legacy in code: ZeloChat frontend/backend price and gating assume `chat=97`, `bundle=147`, and the PDV repo still uses `has_pedidos_addon` / `has_mesas_addon` / `has_acessos_addon`. `ZELOMENU_LINEAR_PLAN.md` `ZLM-005` and `ZLM-205` define the migration path away from that mismatch.
  - ZLM-205 local part (D-103, 2026-06-23): `src/domain/zelomenuEntitlements.ts` is the single pure resolver for ZeloMenu capabilities (ZLM-005 matrix) from `plan_tier`+active. Fail-safe ON for chat/bundle (D-014), legacy `has_pedidos_addon` grants only ordering/kitchen (D-099), single seam `hasZeloMenuFlag` for the future PDV-owned `has_zelo_menu`. Exposed via `useSubscription().capabilities`. In the ZeloChat app this is currently equivalent to `isActive` (chat/bundle always includes ZeloMenu), so no extra nav gate was added; the resolver is the explicit contract + the wiring seam for the eventual `has_zelo_menu` read.
  - ZLM-204 delivery-by-neighborhood (D-081/D-082/D-083, 2026-06-23): the cart no longer rejects a neighborhood that isn't in `empresa_perfil.delivery_config.neighborhoods`. `resolveDeliveryFeeForNeighborhood()` (pure, in `src/domain/zelomenuCart.ts`, shared by `server/zelomenuCartSessions.ts` and the public page) returns `{ fee, toConfirm }`: listed neighborhood adds its fee (case/accent-insensitive), free-text or missing neighborhood → fee 0 + `toConfirm` (taxa "a confirmar"), which never blocks confirmation but forces human review. The flag rides the `deliveryFeeToConfirm` fulfillment snapshot field and surfaces in the customer message, the chat review card, and the manager notification. Public UI uses an `<input list>`+`<datalist>` for the neighborhood. Only `DELIVERY_DISABLED` (store hasn't enabled delivery) still hard-blocks.
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
- Frontend update/loading:
  - `src/components/shared/UpdateAvailableBanner.tsx` polls `/api/version`; refresh uses temporary `?appVersion=` cache-bust and removes it after mount.
  - `nginx.frontend.conf` must serve `index.html` and SPA fallback with `Cache-Control: no-store`; only Vite hashed `/assets/*` should be `immutable`.
- ZeloMenu cart-session backend:
  - `server/zelomenuCartSessions.ts` is the new ZeloChat-owned backend seam for MVP cart sessions.
  - Authenticated open path: `POST /api/zelomenu/cart-sessions/whatsapp`.
  - Public consume/edit/confirm paths: `GET/PATCH /public-api/zelomenu/cart/:token` and `POST /public-api/zelomenu/cart/:token/confirm`.
  - `supabase/migrations/041_zelomenu_cart_sessions.sql` stores only `token_hash` in `zelomenu_cart_tokens`; raw public token is never persisted.
  - Public frontend route now exists at `src/pages/ZeloMenuCartPage.tsx` under `/menu/carrinho/:token`, outside `/app/*`.
  - `server/ai.ts` (HISTÓRICO, revertido por ZLM-310): used `openWhatsAppCartSession()` at the end of `criar_pedido` to hand the customer off to the public cart link. **This whole AI-builds-the-order path was removed — see the ZLM-310 entry below. The AI no longer creates orders at all.**
  - The AI integration kept a legacy pending-order/button fallback (also removed by ZLM-310).
  - Confirmation keeps the order in `zelomenu_cart_sessions` state (`confirmed_waiting_review` or `confirmed_waiting_payment`) and intentionally does not create a legacy `zelochat_orders` row before human accept.
  - `server/router.ts` now exposes authenticated review/accept endpoints for chat operators: `GET /api/zelomenu/cart-sessions/review` and `POST /api/zelomenu/cart-sessions/:id/accept`.
  - `server/zelomenuCartSessions.ts` now materializes the legacy operational adapter only on manual accept: it revalidates again, blocks Pix pending / broken stock or agenda, writes acceptance audit into `metadata`, creates the real `zelochat_orders` row, sends the final customer confirmation, and archives the accepted cart session so the next WhatsApp order can open a fresh row.
  - `src/components/views/ChatView.tsx` now opens a dedicated review modal from the “Pedido recebido pelo cardápio” card instead of forcing the operator into Kanban before the order exists in production.
  - Confirmed ZeloMenu carts persist a WhatsApp/chat message that starts with "✅ Pedido recebido pelo cardápio!", which the chat feedback parser treats separately from legacy "✅ Pedido confirmado!" production orders.
  - Public cart edits are persisted before confirmation: `src/pages/ZeloMenuCartPage.tsx` debounces draft changes for 650 ms, serializes `PATCH` requests so older writes cannot land after newer ones, keeps the active React draft authoritative while saves are in flight, flushes pending edits before refresh/back/confirmation, and exposes saving/saved/error feedback. `src/domain/zelomenuStoreCartCache.ts` is the shared browser-cache seam between the store page and checkout: every successful checkout save mirrors the server snapshot into `zelomenu_cart_<slug>`, while empty/confirmed carts remove it. `buildPublicResponse()` must preserve the safe public `metadata.slug` for `public_order` (alongside `source`), otherwise checkout-cache sync silently becomes a no-op. Do not split these caches again; refreshing or returning to the menu must preserve edits and must not resurrect removed items.
  - Abandoned-cart recovery (ZLM-105): `server/abandonedCartSweeper.ts` runs 3min after boot and every 15min. It sends ONE recovery nudge for a `whatsapp_order` cart left in `cart_open` for 2–24h. One-shot is enforced by a race-safe claim on `metadata.recoveryNudgeSentAt` (no DB migration — uses the existing `metadata` JSONB). Eligibility lives in the pure `isCartEligibleForAbandonedRecovery` predicate; it never fires for confirmed/waiting-payment/accepted/cancelled/archived carts and respects the global AI gate (`isAiGloballyEnabledNow`) so no nudge goes out while the AI is off or outside the scheduled window. The public token can't be reconstructed from the DB, so the nudge mints a fresh link via `issueFreshCartToken` (extracted from `openWhatsAppCartSession`).
  - Print-on-accept (ZLM-106): printing is CLIENT-SIDE — the browser talks to the Zelo Impressão desktop app at `http://127.0.0.1:17321` (`src/services/zeloImpressaoClient.ts` → `printerService.ts` → `usePrinter.ts`). The server cannot reach the operator's printer, so all print triggers live in the frontend. Auto-print fires from `useOrders`' realtime INSERT → `AppShell.autoPrintOrder`; since ZLM-104 inserts the `zelochat_orders` row only on human accept, this already prints at accept time (not at customer confirmation). `autoPrintOrder` is now gated on `printer.connected` ("se configurado") to avoid error-toast spam on machines without a printer. Manual reprint: `AppShell.reprintOrder` → `ProductionView` `OrderDrawer` "Imprimir pedido" button, with explicit success/failure toasts. V1 prints the whole order via `buildOrderText`; per-sector split (D-090) is deferred.
  - ZLM-201 done (2026-06-23): the authenticated `Cardápio` view now has a ZeloMenu publication panel backed by `src/domain/zelomenuPublication.ts` and the real `zelomenu_product_publications` table. Operators can publish/unpublish, pause temporarily, set public name, description, order, modifiers/options and either upload an owned product image or keep an external HTTPS URL. The public cart catalog is resolved through the same domain rule, so only published, unpaused, base-valid products become available and public presentation fields come from the overlay.
  - **ZLM-310 done (2026-06-25): the WhatsApp AI no longer creates orders — ordering is single-source through ZeloMenu (D-106).** What changed in `server/ai.ts`:
    - The `criar_pedido` tool (`CREATE_ORDER_TOOL`) was removed from the tool stack. The runtime tools are now `CONSULT_ORDER_TOOL` + `DISPATCH_TRIGGER_TOOL` (+ `APPLY_TAG_TOOL` when auto-tags exist). The model literally cannot emit an order.
    - The `criar_pedido` handler (~396 lines), `setPendingOrder`, the `forceCreateOrderFromObservationAck` path, and the observation-ack detection cluster (`shouldForceCreateOrderAfterObservationPrompt` et al.) were deleted. `forceCreate…` forced `tool_choice: criar_pedido`; after commit `29e2198` removed the tool from the array, that override was a **latent OpenAI 400** the moment it ever fired — removing it fixed that.
    - The restaurant system prompt now redirects to the public storefront link and forbids the AI from collecting/calculating/confirming orders.
    - **Slug injection (the bug that made the previous redirect non-functional):** `BusinessConfig.zelomenuSlug` is loaded by `loadAiSettingsFromDb` (isolated fail-soft query on `empresa_perfil.zelomenu_slug`, kept OUT of the fragile multi-variant select chain so a missing column never silences hydration). `buildSystemInstruction` builds the real link via `buildPublicStoreUrl(getZeloMenuPublicBaseUrl(), cfg.zelomenuSlug)` — default base `https://menu.zelopdv.com.br`, override `ZELOMENU_PUBLIC_BASE_URL`. **If the empresa has no slug, the prompt tells the AI to escalate to a human (`dispatch_trigger`/`escalate_human`) instead of pasting a broken `{slug}` link.**
    - Retained as a **dormant safety net**: `confirmPendingOrder`/`cancelPendingOrder`/`getPendingOrder`, the pending-order guardrail in `generateAndSendReply`, and the `router.ts` hard/soft button short-circuits. Nothing creates pending rows anymore, so these drain any DB rows that exist at deploy time via the `PENDING_ORDER_TTL_MIN` TTL and then no-op. Not removed because they live in the P0 webhook hot path and ripping them out is pure regression risk for zero functional gain.
    - `server/aiSimulator.ts` mirrors production: dropped `CREATE_ORDER_TOOL` and the `criar_pedido` dry-run. `SimulateResult.wouldCreateOrder` is kept (always `false`) for frontend `AIConfigsView` compatibility.
    - Guardrail tests rewritten: `tests/aiZeloMenuGuardrails.test.ts` now asserts the order-creation code is ABSENT and the slug link is built; `tests/aiPromptGuardrails.test.ts` asserts the redirect rule + real slug URL + the no-slug escalation fallback.
    - **Single source of orders:** every order now originates in ZeloMenu — public storefront (`public_order` → `zelochat_orders.source='zelomenu'` / `pedidos.origem='zelomenu'`). The old WhatsApp-AI path (`source='whatsapp'`) no longer produces new orders.
- AI behavior rules:
  - `src/domain/conversationState.ts` owns deterministic WhatsApp-turn decisions before OpenAI for pending-order confirmation, cancellation, edits, no-observation replies, emoji consent, payment proof, and semantic product matching.
  - `src/domain/orderEventTriggers.ts` owns deterministic post-confirmation trigger selection for real order-created events. Do not rely only on the model's `dispatch_trigger` call for operational alerts such as "Novo pedido" or "pedido grande"; `server/ai.ts` calls this after `confirmPendingOrder` creates the `zelochat_orders` row.
  - `tests/aiTurnDecision.test.ts` is the primary regression suite for behavior like `sem obs`, `não muda nada`, `sim, sem cebola`, `cancelar só a coca`, exact hard buttons, and enthusiasm emoji.
  - `obsidian/AI_BEHAVIOR_RULES.md` documents this as product behavior for future AI agents.
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
  - Current production order flow is still ZeloChat-owned legacy via `zelochat_orders`, but the strategic direction defined in `ZELOMENU_LINEAR_PLAN.md` is a new `Ordering` aggregate with PDV operational materialization on accept: `whatsapp_order -> pedidos.origem='zelochat'`, `public_order -> pedidos.origem='zelomenu'` (PDV repo), `table_order -> comandas` with kitchen tickets `origem='comanda'`.
  - `ZELOMENU_LINEAR_PLAN.md` `ZLM-004` now also fixes the catalog seam: `produtos` / `categorias` / `subcategorias` remain the PDV-owned common catalog, while ZeloMenu publication fields and sellable modifier groups live in a separate publication overlay, also PDV-owned in the target architecture.
  - `ZELOMENU_LINEAR_PLAN.md` `ZLM-005` fixes the entitlement seam: shared infrastructure does not imply shared UI access. Chat-only uses the ordering/menu infrastructure without gaining the PDV app; `has_pedidos_addon` is legacy and must not become the canonical ZeloMenu entitlement.

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
  - ZeloChat-owned confirmed orders in the legacy production flow.
  - Current frontend status enum: `pending`, `preparing`, `ready`, `out_for_delivery`, `delivered`.
  - Treat as transitional adapter for the Casa dos Salgados pilot, not as the final canonical cross-surface order model.
- `zelochat_pending_orders`
  - Pending order confirmation/edit flow used by `server/ai.ts`.
- `zelomenu_cart_sessions`
  - ZeloChat-owned server-side cart session for the new ZeloMenu flow.
  - Stores `ordering_id`, `context`, `source_ref`, `revision` and JSON snapshots for customer/cart/fulfillment/pricing/payment.
  - Current MVP context is `whatsapp_order`; legacy `zelochat_pending_orders` is intentionally untouched.
- `zelomenu_cart_tokens`
  - ZeloChat-owned token history for cart sessions.
  - Public token is stored only as hash; stale tokens may still read/revalidate a session but cannot mutate it.
  - Public ZeloMenu UI
  - `src/pages/ZeloMenuCartPage.tsx` + `src/services/zelomenuApi.ts` already consume the new public API.
  - Current public UI supports review/edit/confirm: catalog browsing, item quantity changes, delivery/pickup fields, payment, observations, Pix warning, stale-token/read-only handling, and post-confirm read-only state.
  - ZLM-103 confirms back into the WhatsApp/chat lifecycle without touching production rows; ZLM-104 completes the loop with manual accept inside the chat; ZLM-105 adds one-shot abandoned-cart recovery; ZLM-106 closes print-on-accept + manual reprint (see notes above). Phase 1 (whatsapp_order MVP) is complete. Phase 2 now has `ZLM-201` closed in ZeloChat, with the next structural gaps moving to `ZLM-203` (slug/public menu) and `ZLM-205` (billing/entitlements).
- Strategic ordering direction
  - `ZELOMENU_LINEAR_PLAN.md` `ZLM-003` closes the interface for a future `Ordering` aggregate with:
    - single `ordering_id` from cart to fulfillment
    - external seam `apply(command)` + `getSnapshot(ref)`
    - pre-accept states stored in ZeloChat-owned ordering tables
    - operational materialization only on `accept`
  - This is important because the current PDV `pedidos` model does not yet represent `confirmed_waiting_review`, `confirmed_waiting_payment`, or adjustment loops cleanly.
- Strategic catalog/publication direction
  - `ZELOMENU_LINEAR_PLAN.md` `ZLM-004` closes the interface for a future `Catalog/Menu Publication` module with:
    - shared base catalog in PDV-owned `produtos` / `categorias` / `subcategorias`
    - separate publication overlay for public name, description, image, ordering, visibility, and manual availability
    - explicit sellable modifier groups/options attached to the base product
    - no duplicated base price by channel; public pricing = `produto.preco + option deltas`
- Strategic entitlement/navigation direction
  - `ZELOMENU_LINEAR_PLAN.md` `ZLM-005` closes the access model with:
    - capability split between `chat_app`, `pdv_core`, `menu_publication`, `ordering_review`, `kitchen_queue`, `mesas`, and `acessos`
    - Chat-only operating only inside ZeloChat
    - PDV+ZeloMenu operating only inside ZeloPDV
    - bundle seeing both apps against the same underlying order state
    - legacy `has_pedidos_addon` treated as grandfathered capability, not as the new ZeloMenu contract
  - `ZELOMENU_LINEAR_PLAN.md` `ZLM-101` now has a concrete backend foundation: cart session state lives outside `zelochat_pending_orders`, with one active cart per `empresa_id + context + source_ref`, hashed public tokens, and public revalidation/edit routes ready for the upcoming ZeloMenu UI.
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
  - Current head drift confirmed 2026-06-01: `/webhook/:instance` accepts a missing token for a known instance unless `WEBHOOK_REQUIRE_TOKEN=1|true|yes` is set. Older Sprint 58 docs/tests still expect fail-closed by default plus explicit `WEBHOOK_ALLOW_MISSING_TOKEN_DURING_ROLLOUT`; `tests/auditFixGuardrails.test.ts` fails on that missing marker.
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
  - Built-in human-escalation triggers are validated against the latest customer message in `src/domain/escalationIntent.ts` / `server/ai.ts`: normal ZeloMenu orders, greetings, and status questions cannot be escalated as complaints by a model false positive; clear complaints, explicit human requests, and offensive language still can.
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
| Incoming webhook | `server/router.ts`, `server/index.ts`, `server/messageHandler.ts` | Token check, ack first, raw-event log, dedupe inbound by `wa_message_id`, schedule AI | N/A | N/A | Current code accepts missing token unless `WEBHOOK_REQUIRE_TOKEN` strict mode is set; this conflicts with older fail-closed docs/tests |
| AI reply generation | `server/ai.ts`, `server/configStore.ts` | Hydrates runtime config, builds large prompt, calls OpenAI with tools | No | Partial | Catalog can dominate prompt size in larger tenants |
| Tag filtering/search | `src/hooks/useTags.ts`, `src/components/views/ChatView.tsx`, `server/tags.ts` | Loads all tags and full session->tags map, filters client-side | No | No | Not suitable for very large inboxes |
| Unread counts / last message preview | `server/messageHandler.ts`, `src/hooks/useWhatsAppSessions.ts` | Counts persist on sessions; last visible preview is rebuilt from message batches on refresh | No | N/A | Current preview computation adds extra queries |
| Zelo PDV product/profile loading | `src/hooks/useCatalog.ts`, `src/hooks/useEmpresaPerfil.ts`, `server/configStore.ts` | Frontend loads entire shared catalog with caps; backend loads full shared catalog without limit | No | No | `/api/sync-config` now reloads catalog from DB so browser snapshots do not override stock truth |

## Existing Risks / Known Pitfalls
- Fixed in Sprint 58: cross-tenant tag attachment is blocked in service code and migration `033` enforces session/tag tenant consistency.
- Drift confirmed 2026-06-01: inbound webhook token validation no longer matches the Sprint 58 fail-closed documentation. Code uses `WEBHOOK_REQUIRE_TOKEN` strict opt-in and accepts missing tokens for known instances by default; `tests/auditFixGuardrails.test.ts` fails because `WEBHOOK_ALLOW_MISSING_TOKEN_DURING_ROLLOUT` is absent.
- Fixed in Sprint 58: inbox list has a paginated/filterable server API and frontend load-more wiring.
- Fixed in Sprint 58: older message pagination is wired into the chat UI on top-scroll.
- Fixed in Sprint 58: audio transcription completion re-arms the debounced AI reply when the audio remains the latest unanswered customer turn.
- Fixed in Sprint 58: manual outbound sends persist `sending`/`sent`/`failed` lifecycle state and fromMe echo repair no longer skips missing DB rows.
- Fixed in Sprint 59: outbound Whatsmiau send payloads use phone digits instead of full JIDs, and text/media/audio helpers require a returned provider message ID before the manual-send lifecycle can mark a message `sent`.
- Fixed in Sprint 62: AI runtime reads `controlar_estoque`/`estoque_atual`, removes zero-stock products from the prompt, exposes positive stock limits, blocks `criar_pedido` above stock, rechecks current stock before confirming a pending order, and reloads catalog from DB after `/api/sync-config`.
- Confirmed: `out_for_delivery` orders are missing from AI active-order context. Root cause: `server/ai.ts:1778` queries `.in('status', ['pending','preparing','ready','dispatched'])` — `'dispatched'` is a non-existent status value (DB CHECK constraint uses `'out_for_delivery'`), making that filter term a dead no-op AND omitting the real status name. Two bugs in one line.
- Confirmed: no persisted prompt/context snapshot exists for supportability; only aggregated AI usage is stored.
- Confirmed: `dailyContext` entries are injected into the system prompt without `safeForPrompt()` sanitization or length cap (`server/ai.ts:2062-2064`). All other user-controlled fields use `safeForPrompt(value, maxLen)`. Accepted risk: operator controls their own `dailyContext`.
- Confirmed 2026-06-01 dependency/warnings review: `localtunnel` was removed because `scripts/tunnel.js` already uses cloudflared; `npm audit --audit-level=low` is clean. Direct dependency majors still pending include `express@5`, `vite@8`, `stripe@22`, `pino@10`, and `typescript@6`; see `DEV_SETUP.md`.
- Confirmed 2026-06-01 build warning: `npm run build` passes but emits Vite chunk warning; largest app chunk is `index-BgmHYe4Y.js` at 569.66 kB / 162.59 kB gzip.

## Confirmed 2026-07-23: canonical sales and cash
- Delivered canonical orders now materialize an idempotent `vendas` row and `vendas_itens` through the shared Supabase boundary in the sibling ZeloPDV repo (`.ai/migrations/canonical_order_sales_2026_07_23.sql`). The cash register is selected by the delivery timestamp (`data_abertura <= sale_at <= data_fechamento`, or still open), not by the cash register open when a repair runs.
- If no cash register covers the delivery timestamp, the sale remains financially recorded with `id_caixa = null` so delivery is not blocked and period reports can still include it; it must be surfaced for reconciliation rather than assigned to a later cash register.
- Historical `legacy_zelochat` deliveries without `closed_at` are not safely backfilled automatically because their cash interval cannot be proven; they need explicit manual reconciliation.

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
- Rollout Supabase ZeloMenu concluído (2026-06-23): `zelochat_fix_rls_gaps_2026_06_23`, `trial_expired_status_2026_06_17`, `zelomenu_cart_sessions_tables_2026_06_23`, `zelomenu_cart_sessions_policies_grants_2026_06_23` e `zelomenu_publication_schema_2026_06_23` estão aplicadas. As tabelas `zelomenu_cart_sessions`, `zelomenu_cart_tokens`, `zelomenu_product_publications`, `zelomenu_modifier_groups` e `zelomenu_modifier_options` existem em produção com RLS ligado, policies completas, `anon` sem grants e `authenticated`/`service_role` limitados a DML.
- ZLM-201 publicação real fechada (2026-06-23): ZeloChat `Cardápio` consome `zelomenu_product_publications` para publicar/despublicar, pausar, configurar nome/descrição/ordem, manter modifiers (`zelomenu_modifier_groups`/`zelomenu_modifier_options`) e enviar imagem própria do produto para um path owned em storage. `server/configStore.ts` resolve o catálogo público com `resolveZeloMenuPublicationCatalogProduct`, mantendo preço em `produtos.preco` e filtrando itens não publicados/pausados/inválidos. Troca/remoção da foto faz cleanup best-effort; exclusão do produto e purge da conta também limpam esse asset.

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
