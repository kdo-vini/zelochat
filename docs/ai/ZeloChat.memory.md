# ZeloChat Memory

> Ver também: [[CLAUDE]] · [[CODE_REVIEW]] · [[FIXES_PROGRESS]] · [[ZeloChat.audit-report]]

## Purpose

### Human takeover/outbound engine (confirmed 2026-08-30)
- Task 3 introduced `server/conversationControl.ts` as the canonical seam for AI/manual conversation control. Public callers use `beginAiTurn`, `claimHumanTakeover`, `resumeAiConversation`, `ensureConversationControl`, and `isAiPermitCurrent`; `AiTurnPermit.epoch` is exposed to TypeScript as a string so Postgres `bigint` is never lossy in JS.
- Migration `064_conversation_control_rpcs.sql` is the database authority for conversation mode and epoch. RPC callers pass only `empresa_id + remote_jid` plus actor/message metadata; the database resolves the canonical control, takes advisory/row locks, merges duplicate controls with human mode winning, projects legacy `zelochat_sessions.auto_reply`, and cancels only queued `ai_auto|ai_followup` jobs on takeover.
- Review round 1 hardened that contract: canonical resolution now connects enriched `person:*` sessions with unresolved `phone:*` sessions for the same contact key, locks identity keys/control rows in deterministic order, validates `p_message_id` and `p_actor_user_id` inside the tenant, and marks active jobs on losing controls as `delivery_uncertain` before merge so the partial unique `sending|dispatch_started` index is not violated.
- Rolling deploy compatibility is handled by `trg_zelochat_conversation_control_session_bridge`: legacy inserts/identity updates call ensure inside the same DB transaction, and direct legacy `auto_reply` updates become audited control transitions with epoch advancement and family projection. Do not remove this bridge until all old writers are gone and a cleanup migration explicitly retires direct `auto_reply` writes.
- `ensureSession` now calls `ensure_zelochat_conversation_control` before returning a session, so a newly observed JID variation inherits the existing family control/mode before it becomes eligible for AI. Legacy direct writes are bridged through `setAutoReply` and `escalateSession`; do not reintroduce direct service-role updates to `auto_reply` outside the control RPC projection.
- Task 4 added `065_conversation_outbound_claims.sql`: claim/finalization are tenant- and `lease_owner`-fenced, conversation jobs serialize by canonical `conversation_control_id`, stale AI epochs are cancelled under the control lock, and an expired `dispatch_started` lease becomes `delivery_uncertain` plus a control hold rather than retrying the POST. `server/outbound/providerAdapter.ts` separates deterministic preflight from transport; `startTransport` revalidates mode/epoch/hold/lease after preflight, attempts increment only at that fence, and the post-fence path consumes one fully serialized HTTP request. If a hold appears during preflight, the later intent/message returns atomically to `queued` without consuming an attempt; it is not cancelled and becomes claimable after hold release. A 2xx/void/no message ID is uncertain. Media payload JSONB contains only exact tenant/job-bound `outbound/<empresa>/<job>/<sha256>` metadata, never Data URLs/raw URLs; bytes are used for checksum/fingerprint and the provider receives an HTTPS signed storage URL. Terminal media cleanup selects only media kinds and runs from the production worker after a grace period. Merging controls projects every uncertain message and deterministically preserves/rotates existing holds. The temporary migration-064 global rollout gate remains the first production lock, followed by canonical control then job.
- Task 5 introduced `server/conversationOutbound.ts` as the single orchestration seam for future routes and AI callers. Human ZeloChat sends call `begin_zelochat_human_outbound` first, cancel local debounce only after the returned `takeover_applied=true`, reserve media jobs before upload, then move `preparing→queued` only after the immutable `outbound/<empresa>/<job>/<checksum>` asset and fingerprint are ready. Fix Round 1 made media preparation ownership explicit through claim/complete/fail CAS RPCs so idempotent retry losers relêem the existing job instead of uploading or failing a valid `queued` row. AI sends require an `AiTurnPermit`, reject tenant/JID mismatches before enqueue, and rely on `enqueue_zelochat_ai_outbound` to resolve `remote_jid→conversation_control_id` and reserve message+job/idempotency atomically under same-control/mode-`ai`/epoch locks; missing/stale permits return `suppressed` with no sendable job. Fix Round 2 made existing AI idempotency fail-closed: the RPC must prove the existing job matches empresa, JID, conversation control, epoch, origin and expected payload/fingerprint before returning it, while `intent_payload_fingerprint` preserves the pre-upload media intent so divergent media retries cannot claim preparation ownership over the original job. Fix Round 3 preserved the 4-arg media-claim overload for old replicas in a narrow legacy envelope and lets the 5-arg claim adopt `intent_payload_fingerprint` exactly once for safe pre-R2 AI retries. Fix Round 4 forbids the new dispatcher from adopting human media with null intent because legacy metadata cannot prove the original bytes: exact and divergent retries both return a friendly terminal failure requiring a new intent/key before any claim/upload, while the 5-arg RPC limits null-intent adoption to AI and the legacy 4-arg overload remains for old replicas. The dispatcher waits up to `CONVERSATION_SEND_WAIT_MS` (default 10s) for `sent|failed_before_dispatch|delivery_uncertain`, otherwise returns `queued` and lets worker WebSocket lifecycle finish later. Message intent helpers now carry origin/actor/job and canonical states; `OutboundWorker.runBatch` can use local instance concurrency only across distinct conversation controls while the database remains the cross-replica authority, and status broadcasts are fail-soft/out-of-band so WebSocket failures do not create `delivery_uncertain` without a POST. Migration 065 keeps a temporary `zelochat_outbound_job_rolling_bridge` only for old campaign/automation inserts that omit origin/payload; conversation rows never receive defaults. Remove the rolling bridge only after pre-Task-4 replicas drain. `tests/conversationOutboundRpc.integration.test.ts` provides the real PostgreSQL interleaving probe but explicitly skips without `LOCAL_OUTBOUND_TEST_DATABASE_URL`; keep enforcement rollout gated until it passes locally, callers are migrated, and `fromMe` classification/reconciliation are implemented and verified.
- Task 6 carries `AiTurnPermit` from each newly persisted respondible inbound through debounce, model calls, tool/fallback helpers and the direct reply endpoint; all customer-facing AI creates `ai_auto|ai_followup` jobs and is suppressed on stale epoch. Fix Round 1 made AI escalation a conditional control/epoch/trigger claim, made legacy pending confirmation an atomic permit-check + canonical idempotent order + pending delete, and fences both Pix validator routes before/after the external model call. Escalation enqueues customer copy as `system_handoff`; manager notifications are detached `internal_system` jobs and never create a customer-conversation bubble. Direct transport remains allowed only for protocol effects such as presence/read receipt/revocation.
- Task 7 migrates every ZeloChat human operator send in scope (`/api/send`, CRM message compose, contact/list/location/reaction/poll and manual retry) to `dispatchConversationOutbound` with `origin='human_zelochat'` and `takeoverPolicy='take_over'`. These routes now require authenticated `clientes.comunicar`, pass `actorUserId`, accept client idempotency keys with server fallback only for legacy callers, and return discriminated lifecycle JSON (`sent|queued|failed_before_dispatch|delivery_uncertain`) without provider/internal details. Frontend compose and retry paths generate one UUID per intent and retain it across lost HTTP responses until success. `delivery_uncertain` is not retryable by the default retry button; explicit new-copy UX is deferred to Task 10. `fromMe` reconciliation and Task 9 transational/campaign/automation migration remain pending, so keep enforcement rollout gated.

### CRM rollout (confirmed 2026-08-26)
- CRM no longer has a per-company rollout gate. Migration `062_retire_crm_rollout_gate.sql` normalizes the legacy `crm_enabled` column, while `server/customers/rollout.ts`, navigation, and customer APIs treat CRM as always available behind the normal subscription/paywall and actor permissions. Only campaigns and automations remain rollout-gated.
- Migration `061_enable_crm_for_active_plans.sql` now enables the Clientes module for every empresa with a `subscriptions.status` of `active` or `trialing`; it leaves campaigns, automations, and outbound jobs disabled. Treat the rollout flag as plan inclusion for CRM, not as a paid add-on. The production bundle published at 14:26 includes the new navigation; authenticated visual validation still requires an operator session.
- Migration `057_customer_crm_rollout.sql` is additive and stores legacy per-company flags for `crm`, `campaigns`, and `automations`; after migration 062, only campaigns and automations are consulted at runtime. CRM access still requires the normal subscription/paywall and actor permissions.
- `server/customers/metrics.ts` records only allowlisted aggregate counters and exposes queue age, stuck leases, and disconnected status; message content, JIDs, and phone values are never persisted in rollout metrics. Gate C and backfill are complete for the two controlled tenants; rollout flags remain disabled elsewhere.
- Gate A database verification completed 2026-08-26 on the connected Supabase project: PDV identity/order migrations plus ZeloChat `048–060` are applied; transactional RLS/tenant fixture passed and rolled back. Migration 060 adds additive FK/search indexes for the CRM relationship, audience, campaign, queue, and automation tables; the performance advisor no longer reports unindexed FKs for those new CRM tables. Gate B dry-run completed read-only across all tenants: 2,035 sessions, 1 preview link, 0 conflicts, and 2,034 unmatched sessions. Gate C pilots then ran on Donutopia (9 sessions, 9 incomplete, no links/conflicts/failures) and Casa dos Salgados (1,716 sessions, 1 link, 1,715 incomplete, no conflicts/failures). CRM is enabled only for those two active tenants; campaigns, automations and outbound jobs remain off. Agreste was not enabled because the database reports `trial_expired`. Data-shape evidence remains a rollout concern: 78 customer rows exist, but only 40 have 10–13 digit contacts, versus 2,033 session phones in that range. Authenticated local UI coverage passed at 360/390/768/1440 in `tests/customers-crm.spec.ts`; live visual validation still awaits an authorized deploy and test session. The canonical ZeloPDV worktree now contains the remote-timestamped CRM stream in commit `8e40e4c`; no remote ledger repair or `db push` was performed.
- ZeloChat is a WhatsApp-native customer service platform for Brazilian small businesses, especially food businesses and lanchonetes.
- It supports AI and manual attendance, sessions/conversations, contacts, messages, escalation, tags, quick responses, order support, and shared company/profile/product context.
- It is integrated with Zelo PDV through shared Supabase tables such as `empresa_perfil`, `produtos`, `categorias`, and `subcategorias`.
- The codebase assumes production use with real customer conversations, real order state, and multi-tenant isolation.

## Tech Stack Detected
- Frontend framework: React 19 + Vite + TypeScript.
- UI/runtime libraries: Tailwind CSS, `motion/react`, `lucide-react`, `react-router-dom`.
- Backend/API structure: Express server in `server/index.ts` with routes in `server/router.ts`.
- Database: Supabase Postgres. Chat-owned tables use `empresa_id`; shared PDV tables use `id_usuario` / `empresa_perfil.user_id`.
- Auth model: Supabase JWT. Backend resolves tenant from the bearer token via `requireEmpresaId()` / `requireEmpresaAndUserId()` in `server/supabase.ts`; `server/accessControl.ts` resolves active sub-users through shared `access_users`/`access_roles`, caches by actor (never owner), and fails closed for inactive links. WebSocket auth is a first message `{ type: 'auth', token }` in `server/ws.ts`.
- CRM schema boundary (confirmed 2026-08-25): ZeloPDV owns `pessoas`/identities and ZeloChat owns only relationship state. Migration `048_customer_relationship_foundation.sql` links sessions with nullable `pessoa_id` plus persisted `owner_user_id`; a non-definer compatibility trigger derives the owner for legacy writers, keeps `customer_profile` as a temporary fallback, and stores relationship/tags/match conflicts in server-only RLS tables. Composite owner/tenant FKs prevent cross-tenant person/tag links even when parent ownership changes; browser roles have no CRM table grants, and the transactional verifier temporarily grants ACLs to exercise deny policies as `anon`/`authenticated`. Runtime probes live in `supabase/verification/customer_relationship_authz.sql`.
- CRM runtime boundary (confirmed 2026-08-25; Gate A verified 2026-08-26): `server/customers/identity.ts` is the only ZeloChat adapter for PDV RPC identity decisions. Webhook/session enrichment is best-effort and preserves messages on conflict/RPC failure; sessions and orders use `pessoa_id` only when unambiguous and retain customer snapshots. Backfill checkpoints live in server-only migration 049, and customer read APIs aggregate server-side behind `pessoas.visualizar`. The connected Supabase project passed the transactional RLS/concurrency fixture; the two controlled pilots completed without conflicts/failures and no other tenant was activated.
- CRM audit hardening (confirmed 2026-08-25): order consumers call the optional-person RPC through `server/customers/orderContract.ts`, retrying legacy signature only for proven missing-contract errors; dry-run uses read-only lookup; identity sources are `pdv|whatsapp|zelomenu|manual`. Customer cursors are opaque keysets with full tuples, PostgREST reserved syntax is rejected, and every CRM subroute validates owner-scoped `tipo='cliente'` before service-role reads. Gate B/C data checks are complete; published visual validation and expansion decision remain.
- CRM UI permission hardening (confirmed 2026-08-26): the “Novo cliente” action is rendered only for `pessoas.gerenciar`; read-only operators still browse the full CRM without a guaranteed-to-fail mutation button. The customer-message shortcut resolves and passes the UUID session id to Atendimento, never a WhatsApp JID.
- CRM relationship detail (confirmed 2026-08-26): `getCustomerDetail` reads tenant-scoped sent campaign/automation counts and the opt-out ledger; `CustomerRelationshipTab` surfaces suppression state instead of assuming communication is allowed. These reads remain server-side and fail closed with the rest of the CRM detail query.
- CRM FK index hardening (confirmed 2026-08-26): ZeloChat migration `060_customer_fk_indexes.sql` and the canonical ZeloPDV migration `20260826131437_060_customer_crm_fk_indexes.sql` add owner/person/relationship lookup indexes without changing browser grants or rollout state. The remote migration is applied; the remaining performance notices are legacy/shared tables, duplicate legacy indexes, or expected unused-index notices while the pilot dataset is small.
- Customer timeline navigation uses the most recent message's session id when returning to Atendimento; never infer the active session from a remote JID or the oldest aggregated message.
- CRM rereview hardening (confirmed 2026-08-25): migration 050 adds an atomic partial unique open-conflict key and server-only RPC upsert, plus server-side customer aggregation and a single global timeline ordered by `(occurred_at, kind, id)`. Contract fallback accepts only the exact missing `create_zelo_order(p_pessoa_id)` signature or `zelo_orders.pessoa_id` read-column error; generic SQL states never trigger fallback.
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
  - Account deletion is fenced in the shared database: `claim_due_account_deletions(p_limit)` is the only due-account source; `renew_account_deletion_claim(...)` must validate/renew immediately before every external effect; and `finalize_claimed_account_deletion(...)` is the only final purge path. Reactivation must acquire `begin_account_deletion_reactivation(...)` before Stripe and complete with the exact token; ambiguous provider outcomes retain the fence, and purge never claims any pending reactivation. Never reintroduce a direct due SELECT or direct `delete_account` call in the worker. Destructive WhatsApp cleanup uses only the instance captured by the claim and never `WHATSMIAU_INSTANCE`. QR/connect must fresh-read both fences and persist only when both are null, compensating upstream creation on CAS loss.
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
  - Failed manual sends can be retried through `POST /api/messages/:id/retry`, which atomically claims only an `outbound_status='failed'` assistant intent before sending. `DELETE /api/messages/failed/:id` removes only an undelivered local intent; it must never call WhatsApp revoke.
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
  - Print-on-accept (ZLM-106): printing is CLIENT-SIDE — the browser talks to the Zelo Impressão desktop app at `http://127.0.0.1:17321` (`src/services/zeloImpressaoClient.ts` → `printerService.ts` → `usePrinter.ts`). The server cannot reach the operator's printer, so all print triggers live in the frontend. When `/health` finds the Windows app open, `zeloImpressaoClient` first attempts `POST /connect` and stores the returned local token; this makes the normal ZeloChat/ZeloPDV journey automatic. A six-digit code remains the fallback for legacy agents, unauthorized origins or failed automatic authorization. Auto-print fires from `useOrders`' realtime INSERT → `AppShell.autoPrintOrder`; since ZLM-104 inserts the `zelochat_orders` row only on human accept, this already prints at accept time (not at customer confirmation). `autoPrintOrder` is now gated on `printer.connected` ("se configurado") to avoid error-toast spam on machines without a printer. Manual reprint: `AppShell.reprintOrder` → `ProductionView` `OrderDrawer` "Imprimir pedido" button, with explicit success/failure toasts. V1 prints the whole order via `buildOrderText`; per-sector split (D-090) is deferred.
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
- Operational correction 2026-07-23: `public_order` materializes `zelo_orders` in `pending_review` before the store decision. It must print on arrival; the `useOrders` listener stays active in Atendimento, and Production shows "Aceitar pedido" (transition to `accepted`/Pendente) plus "Recusar pedido". Auto-print must not wait for acceptance or duplicate the ticket after it. `printerService.buildOrderText` wraps long items at 32 columns so group modifiers are preserved.
- Order status API error contract (2026-07-23): Supabase/PostgREST transition errors are plain objects, not native `Error` instances. `src/domain/orderTransitionError.ts` must normalize them before the status route responds; otherwise every blocked transition becomes an opaque 500/`UNKNOWN_ERROR`. Keep customer-facing messages friendly and log the internal classification only on the server.
- Auto-accept/Pix rule: the ZeloMenu preference only holds `pending_payment` while `pix_receipt_config` is actively enabled and configured in ZeloChat. After the AI validates a Pix receipt, it performs `payment_approved` and then the service-role `accept_zelo_order`; if the second transition fails, it must escalate and tell the customer that manual acceptance is still pending.
- Receipt rendering rule: ZeloMenu modifier selections remain structured as `OrderItem.modifierGroups` plus `productName` through `canonicalRowToOrder`. `printerService.buildOrderText` owns the plain-text presentation and uses `\n` per group; never add HTML such as `<br>` to order data.
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

## Confirmed 2026-08-25: CRM relationship boundary
- ZeloChat has CRM primitives but no canonical contact aggregate: sessions/JIDs, messages, session tags, orders, ticket statistics and the AI-generated `customer_profile` exist, but there is no persisted customer identity, birthday, internal note, consent/opt-out ledger or campaign recipient ledger.
- `customer_profile` is already generated in `server/ai.ts`, persisted on `zelochat_sessions` and injected back into the AI prompt. The operator panel in `src/components/views/ChatView.tsx` does not currently render it; older documentation that calls the feature merely planned is stale.
- A session remains a transport conversation, not a person. Any future CRM should use an immutable tenant-scoped contact id, map JIDs/phones as identities, and keep merge/unmerge auditable. Last-ten-digit matching is a useful heuristic, not a safe master key.
- Aggregate production snapshot (read-only, no PII) on 2026-08-25: `pessoas` had 84 `cliente` rows across 9 owners (44 with contact) and 26 `funcionario` rows across 7 owners (11 with contact); 2,034 `zelochat_sessions` had phone, but only 7 matched `pessoas` under the same owner by the current last-ten-digit heuristic. `vendas` had 15,454 rows, with 708 linked through `id_cliente` and 2 through `id_pessoa`. Treat these counts as a dated snapshot, not constants.
- `pessoas` is PDV-owned and mixes relationship types. Do not alter it from ZeloChat or use employees as a default marketing audience. A ZeloChat-owned relationship layer can bridge to `pessoas`; a true shared person identity must be designed and migrated in the ZeloPDV/shared boundary first.
- Strategic analysis and rollout recommendation live in `docs/CRM_FEASIBILITY_REPORT.md`.
- CRM rollout status (2026-08-26): ZeloChat migrations `048–060` and the canonical PDV stream through `20260826131437` are applied in the connected Supabase project; migration 060 adds additive FK/search indexes for CRM relationship, audience, campaign, queue and automation tables. The performance advisor no longer reports unindexed FKs for those new CRM tables; remaining notices are legacy/adjacent or expected unused-index notices while the pilot dataset is small. The implementation is integrated in the main branches (`zelochat 99535d3`, `zelopdv cb1cc24`); published authenticated visual validation and deploy authorization remain open.

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
