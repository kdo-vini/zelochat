# ZeloChat — Fixes Progress Tracker

**Source review:** [CODE_REVIEW.md](CODE_REVIEW.md) — 6-agent senior audit, 24 P0 / 47 P1 / 38 P2 / 24 P3.
**Customer status:** 1 paying tenant (R$3k contract, Casa dos Salgados). 1 founder test (Donutopia).

## 📊 Status atual (2026-04-30 Sprint 28 open)

| Tier | Total | Closed | Pending | Deferred | % |
|---|---|---|---|---|---|
| **P0** | 24 | **24** | 0 | 0 | **100% ✅** |
| **P1** | 47 | **41** | 0 | 3 | **87% ✅** |
| **P2** | 38 | 24 | 14 | 0 | 63% |
| **P3** | 24 | 1 | 23 | 0 | 4% |

**P1 closed = 34 explicit shipped + 7 cross-fix verificados** (P1.1, P1.11, P1.25, P1.26, P1.27, P1.41, P1.42, P1.44 — ver §"P1s closed via cross-fix" abaixo). P1.37 shipped Sprint 19 (paywall flicker).

**P1 deferred (3)**: P1.16, P1.17, P1.43 — multi-replica concerns, NÃO fazer enquanto single-node Railway. CLAUDE.md flag deploy invariant.

**P1 actively pending (0)**: todos fechados. 3 deferred (P1.16, P1.17, P1.43) para multi-replica.

Use this doc to know **at a glance** what's safe in production right now and what's still on fire. Each fix has a `Status`, the `Files touched`, and the `Risk` it eliminates. Fixes that need a prod migration are marked `BLOCKED — needs operator approval` until the user signs off on applying.

## P1s closed via cross-fix (verificados 2026-04-29 Sprint 18 close)

Não estão na lista de "shipped explicit" mas foram verificados como já resolvidos por outras correções:

| ID | Como foi closed | File hint |
|---|---|---|
| P1.1 | escalation update empresa-scoped via P0.22 fix | `escalation.ts:299, 337` |
| P1.11 | `broadcastLegacyLifecycleEvent` scoped via `getBoundEmpresaId()` (P0.2 narrowing) | `whatsapp.ts:25-30` |
| P1.25 | `syncFromStripe` filtra `['chat','bundle']` em existingRows | `billing.ts:219` |
| P1.26 | `createPortalSession` exige `provider_customer_id` (DB-rooted) | `billing.ts:362` |
| P1.27 | `idempotencyKey` cobre double-click + pre-record `incomplete` | `billing.ts:295,298` |
| P1.41 | `webhook_token` wired em `getEmpresaAndTokenForInstance` (dormant pelo bug Whatsmiau-side, código completo) | `instanceManager.ts:117-147`, `router.ts:436-510` |
| P1.42 | `zelochat_sessions_empresa_remote_unique` UNIQUE INDEX | `migration 000:99-100` |
| P1.44 | `zelochat_increment_unread` RPC | `migration 000:500` |

## P1s actively pending (0 — todos fechados)

| ID | Descrição | Risco | Sprint sugerido |
|---|---|---|---|
| ✅ P1.2 | `extractAttachmentDataUrl` confia em `mediaUrl` do payload — allowlist HTTPS + hostname | Médio (auth boundary) | Sprint 20 |
| ✅ P1.8 | Phone normalization landline (10 dig) vs mobile (11 dig) — normalize 11-digit com '9' | Baixo (UX) | Sprint 20 |
| P1.16 | `recordAiFailure` in-memory, multi-replica = sem escalação | Deferred | quando scale |
| P1.17 | `configStore` desync entre réplicas | Deferred | quando scale |
| ✅ P1.28 | `'trialing'` users locked out sem path claro — UI + backend guard | UX | Sprint 20 |
| ✅ P1.29 | `'paused'` status sem UI pra unpause — badge dinâmico + portal routing | UX | Sprint 20 |
| ✅ P1.37 | Paywall banner flicker on `subscriptionLoading=true` | Cosmético | Sprint 19 |
| ✅ P1.40 | Forms perdem state on session expiry — `useLocalDraft` hook + toast | Médio (complexo) | Sprint 20 |
| P1.43 | `getAllSessions` table scan (escala >2k sessions) | Deferred | quando scale |

---

## Legend

- ✅ **Shipped** — code merged in this branch, type-checks clean, no prod migration needed.
- 🟢 **partial** — fix shipped for the prospective surface; historical/legacy data still at risk. See per-row caveat.
- 🟡 **Drafted** — code or migration written but **not applied** to prod. Ready for review + apply.
- 🟥 **Blocked — operator approval** — fix touches shared infra (ZeloPDV) or needs a destructive prod migration.
- ⏳ **Pending** — not started yet.
- ❌ **Won't fix in this branch** — out of scope (e.g., touches ZeloPDV-owned tables).

---

## P0 — Ship-blocking fixes

| ID | Title | Status | Files | Notes |
|----|-------|--------|-------|-------|
| P0.1 | `/webhook/:instance` no caller authentication | ✅ via Plan D (URL-as-secret) | `server/router.ts:436`, `server/instanceManager.ts:165` | Header-based auth NOT VIABLE — Whatsmiau v2 accepts `headers.apikey` config but doesn't forward (Sprint 18 diagnostic confirmed). Pivoted to URL-as-secret: new instances use `zelo-{empresa8}-{16hex}` = 64 bits entropy. Legacy enumerable instances rotated in Sprint 18. Token-validation code kept dormant; if Whatsmiau ever fixes forwarding, `WEBHOOK_REQUIRE_TOKEN=1` becomes viable without code change (`auth_status` column is the canary). |
| P0.2 | `boundEmpresaId` singleton breaks 2nd tenant | ✅ | `server/supabase.ts:263`, `server/messageHandler.ts` (multiple), `server/ai.ts:903`, `server/whatsapp.ts:27` | All operational helpers now require `empresaId: string` — TypeScript enforces. Singleton narrowed to ONLY `broadcastLegacyLifecycleEvent` in whatsapp.ts which no-ops in multi-tenant (closes P1.11 fan-out leak too). |
| P0.3 | `getEmpresaForInstance` cache-fallback on DB error | ✅ | `server/instanceManager.ts:149` | Removed entirely (dead code after P0.1 migrated all callers to `getEmpresaAndTokenForInstance`, which fails closed). On Supabase blip, webhook returns 404 → Whatsmiau retries → recovered DB processes once (idempotent via wa_message_id from P0.14). |
| P0.4 | `/api/produtos` proxy unauthenticated | ✅ | `server/router.ts:1374` | `requireEmpresaId(req)` validates JWT locally before proxying upstream. Paywall middleware also gates it. |
| P0.5 | `zelochat-media` bucket public + enumerable filenames | ✅ | `server/supabase.ts:188`, `server/messageHandler.ts:198`, `server/router.ts:726`, `scripts/cleanup-orphan-media.ts` | NEW uploads scoped per-empresa with 128-bit random slug. Dry-run revealed only 4 historical files at old paths, ALL ORPHANS (not referenced in `zelochat_messages.content`). Cleanup script `scripts/cleanup-orphan-media.ts` lists the 4 explicit names and uses Storage API to delete (Supabase blocks direct DELETE FROM storage.objects). Run once via `npx tsx scripts/cleanup-orphan-media.ts`. |
| P0.6 | `empresa_perfil` UPDATE policy missing `WITH CHECK` | ✅ | `zeloPDV-Prod/.ai/migrations/empresa_perfil_update_with_check.sql` (local — PDV gitignora `.ai/`) | Migration aplicada em prod via MCP em 2026-04-29. Verificada: `qual = with_check = (auth.uid() = user_id)`. Fecha vetor de roubo de empresa via `UPDATE empresa_perfil SET user_id = …`. Aplicada do repo PDV (tabela é PDV-owned). |
| P0.7 | `zelochat_pending_orders` RLS on but no policies | ✅ | `supabase/migrations/014_zelochat_rls_hardening.sql` | Migration APPLIED em prod (version 20260429192428, verified 2026-04-30 via MCP). |
| P0.8 | `zelochat_messages` no UPDATE/DELETE; `zelochat_escalation_events` no INSERT/DELETE | ✅ | `supabase/migrations/014_zelochat_rls_hardening.sql` + `server/escalation.ts:293-340` | Migration APPLIED em prod (same as P0.7). Code-side `.eq('empresa_id')` already added (P1.1 closed). |
| P0.9 | Affirmative-text regex prematurely confirms orders | ✅ | `server/ai.ts:34, 786` | Whitelist exact-match w/ accent-strip + trailing punct. |
| P0.10 | Negative-text regex aggressively cancels orders | ✅ | `server/ai.ts:34, 787` | Same fix as P0.9. |
| P0.11 | `justConfirmedMap` in-memory only — duplicate orders after restart | ✅ | `server/ai.ts:35-66, 905-915` | DB fallback via `wasOrderRecentlyConfirmedInDb`. |
| P0.12 | Role CHECK widening migration not in source control | ✅ | `supabase/migrations/000_zelochat_schema.sql` | Verified live + captured. |
| P0.13 | Hard-button short-circuit re-fires idempotent reply on Whatsmiau retry | ✅ | `server/router.ts:177-188` | `prevHandledAt` retry detection at top of serialize block. |
| P0.14 | No idempotency on inbound webhook (`wa_message_id` UNIQUE missing) | ✅ | `supabase/migrations/015_wa_message_id_idempotency.sql` + `server/messageHandler.ts:430` + `server/index.ts:114` | Migration applied. Code-side `upsertInboundUserMessage` with `onConflict: 'empresa_id,wa_message_id'` shipped. `handleIncomingMessage` returns `boolean`; index.ts skips auto-reply on duplicate webhook redelivery. |
| P0.15 | Paywall bypassed on every operational endpoint | ✅ | `server/index.ts:42` | Global middleware on `/api/*` w/ minimal exempt list. |
| P0.16 | Frontend has no paywall gate, only banner | ✅ | `src/AppShell.tsx:718` | Paywall placeholder for any view except settings/profile/novidades. |
| P0.17 | `isEmpresaSubscriptionActive` fails OPEN on DB error | ✅ | `server/supabase.ts:80-150` | Fail-closed cache w/ positive-cache fallback. |
| P0.18 | Two parallel Stripe Checkout sessions can both be paid | ✅ | `server/billing.ts:259` | `idempotencyKey: checkout-${user.id}-${tier}-${5min-bucket}` on `stripe.checkout.sessions.create`. |
| P0.19 | Stripe email-lookup adopts cross-product customer | ✅ | `server/billing.ts:246, 344, 391` | Email lookup removed from Checkout/Portal/sync. DB `provider_customer_id` is the only source. |
| P0.20 | Logout doesn't clear `localStorage` — cross-tenant leak on shared device | ✅ | `src/services/authService.ts:40` | `clearLocalAppState()` wipes `zelochat_*` keys. |
| P0.21 | `useOrders.ts` reads/mutates `zelochat_orders` w/ no `empresa_id` filter | ✅ | `src/hooks/useOrders.ts:47, 179, 191` | Defense-in-depth `.eq('empresa_id', empresaId)` on every CRUD op. |
| P0.22 | `confirmPendingOrder` driver lookup missing `empresa_id` filter | ✅ | `server/ai.ts:483` + `server/escalation.ts:293, 337` | Driver lookup + escalation update/acknowledge paths all scoped. |
| P0.23 | Core schema not in source control | ✅ | `supabase/migrations/000_zelochat_schema.sql` | ZeloChat-only snapshot. Idempotent. |
| P0.24 | `whatsmiau_instance` partial UNIQUE not in source | ✅ | `supabase/migrations/000_zelochat_schema.sql` | Verified live + captured. |

---

## What's intentionally NOT being changed

These are out of scope or unsafe to change from this branch:

- **All ZeloPDV-owned tables**: `empresa_perfil` core columns, `subscriptions`, `super_admins`, `produtos`, `categorias`, `vendas*`, `caixas*`, `mesas*`, `comandas*`. Adding/altering columns from this repo would clobber ZeloPDV's migration history.
- **The `subscriptions` table CHECK constraints, RLS policies, plan_tier values**: ZeloPDV's billing webhook writes here. Changing the schema would break ZeloPDV's webhook handler.
- **`auth.users` and Supabase storage `objects` schema**: Supabase platform-owned.
- **The Whatsmiau API contract**: third-party. Wiring `webhook_token` (P0.1) requires their dashboard config too.
- **The single `boundEmpresaId` deploy invariant**: until the customer goes multi-tenant, the app assumes 1 replica + 1 empresa. This is fine for now; **flagged in CLAUDE.md** as a deployment constraint.

---

## P2s closed via previous sprints (verificados 2026-04-30)

| ID | Como foi closed | Sprint |
|---|---|---|
| P2.1 | `confirm()`/`alert()` → `ConfirmModal` + `useToast` em 8 callsites | Sprint 19 |
| P2.5 | segundo WebSocket unauthenticated em `useOrders` removido | Sprint 11 |
| P2.11 | `priceBRL` consolidado em `src/data/pricing.ts` | Sprint 19 |

---

## Sprint history

### Sprint 28 (2026-04-30) — Profile logout hardening

- ✅ P3 — Logout no perfil agora trata erro do Supabase: se o servidor não confirmar o encerramento da sessão, o modal mostra uma mensagem clara em português e permite tentar novamente, em vez de navegar como se tivesse dado certo — `src/components/views/ProfileView.tsx`
- Type-check/build verde: frontend `tsc --noEmit`, server `tsc --noEmit -p server/tsconfig.json`, `vite build`

### Sprint 27 (2026-04-30) — AppShell render containment

- ✅ P2.6 — `AppShell` agora memoiza as bordas das views e passa fatias estáveis de estado para telas que não consomem conversas. Mensagens novas no WhatsApp deixam de forçar repaint do kanban, agenda, configurações, perfil, motoboys e catálogo quando esses dados não mudaram — `src/AppShell.tsx`, `src/components/views/DashboardView.tsx`, `src/components/views/ProductionView.tsx`, `src/components/views/CalendarView.tsx`, `src/components/views/AIConfigsView.tsx`, `src/components/views/SettingsView.tsx`, `src/components/views/ProfileView.tsx`
- Type-check/build verde: frontend `tsc --noEmit`, server `tsc --noEmit -p server/tsconfig.json`, `vite build`

### Sprint 26 (2026-04-30) — Modal accessibility closeout

- ✅ P2.2 — Dialog surfaces now use the shared accessible modal primitive: `role="dialog"`, `aria-modal`, labelled titles, focus trap, Escape close, and return-focus. Covered confirmation modals, plan-change, catalog CRUD, new conversation, image/video preview, Calendar/Kanban/Production order drawers, and manual order modal. Remaining `fixed inset-0` usages are click-away/backdrop surfaces, not standalone dialogs — `src/components/Modal.tsx`, `src/components/views/CalendarView.tsx`, `src/components/views/KanbanView.tsx`, `src/components/views/ProductionView.tsx`, `src/components/views/MessageBubble.tsx`
- Type-check verde: frontend `tsc --noEmit` + `tsc --noEmit -p server/tsconfig.json`

### Sprint 25 (2026-04-30) — Chat list performance

- ✅ P2.4 — Lista de conversas agora usa windowing quando passa de 80 conversas: renderiza só linhas visíveis + overscan, reduzindo DOM e timers SLA ativos em listas grandes — `src/components/views/ChatView.tsx`
- Type-check verde: frontend `tsc --noEmit` + `tsc --noEmit -p server/tsconfig.json`

### Sprint 24 (2026-04-30) — Modal accessibility + billing edge cases

- ✅ P2.12 — `change-plan` agora detecta erro Stripe de confirmação/autenticação do cartão e retorna `PAYMENT_ACTION_REQUIRED`; frontend mostra ação de abrir portal em vez de erro genérico — `server/billing.ts`, `src/components/views/PlanChangeModal.tsx`
- ✅ P2.23 — Verificado como fechado via schema commitado: `zelochat_orders` tem RLS ligada + policy `zelochat_orders_empresa_owner` em `000_zelochat_schema.sql`, antes da publicação realtime — `supabase/migrations/000_zelochat_schema.sql`
- 🟢 P2.2 parcial ampliado — `PlanChangeModal`, modais de catálogo e "Nova conversa" agora usam o primitive acessível (`role="dialog"`, `aria-modal`, focus trap, Escape, return-focus). Restam drawers/overlays de detalhe antes de contar P2.2 como fechado — `src/components/views/PlanChangeModal.tsx`, `src/components/views/catalog/CatalogModals.tsx`, `src/components/views/ChatView.tsx`
- Type-check verde: frontend `tsc --noEmit` + `tsc --noEmit -p server/tsconfig.json`

### Sprint 23 (2026-04-30) — P2 billing + WhatsApp hardening + audio recovery

- ✅ P2.10 — Stripe price IDs não têm mais fallback hardcoded: `STRIPE_PRICE_CHAT` e `STRIPE_PRICE_BUNDLE` agora são obrigatórios, com runbook atualizado — `server/billing.ts`, `BILLING.md`, `CLAUDE.md`
- ✅ P2.13 — retorno `?billing=success` só chama sync quando há `session_id`; backend valida que o Checkout Session pertence ao Stripe customer do usuário antes de espelhar assinatura — `src/AppShell.tsx`, `server/billing.ts`
- ✅ P2.15 — `fetchInstanceQR()` não faz mais sleeps de retry dentro do handler HTTP; retorna `connecting` rápido quando Whatsmiau ainda não entregou o QR — `server/whatsapp.ts`
- ✅ P2.18 — falhas consecutivas de transcrição de áudio agora escalam o atendimento após 3 tentativas, com aviso claro ao cliente e contador single-replica documentado — `server/messageHandler.ts`
- ✅ P2.21 — resposta da IA revalida `auto_reply`/`status` depois da chamada OpenAI e aborta se o operador assumiu a conversa durante o voo — `server/ai.ts`
- ✅ P2.25 — avatar de contato agora cai para iniciais estáveis quando a foto do Whatsmiau expira ou quebra, evitando imagem quebrada no chat — `src/components/ContactAvatar.tsx`, `src/components/views/ChatView.tsx`
- 🟢 P2.2 parcial — `ConfirmModal` agora usa o novo primitive acessível (`role="dialog"`, `aria-modal`, focus trap, Escape, return-focus). Não contado como fechado até migrar os modais custom restantes — `src/components/Modal.tsx`, `src/components/ConfirmModal.tsx`
- Novidades: entrada PT-BR para o handoff de áudio com falha — `src/data/changelog.ts`
- Type-check verde: frontend `tsc --noEmit` + `tsc --noEmit -p server/tsconfig.json`

### Sprint 22 (2026-04-30) — Tier 1 UX batch (mobile + churn prevention)

- ✅ P2.3 / P2.7 — Mobile chat detail panel: header button "Detalhes" (Info icon, `md:hidden`) abre overlay full-screen com backdrop animado no mobile; desktop inalterado (`md:flex` inline) — `src/components/views/ChatView.tsx`
- ✅ P2.8 — Onboarding phone validator agora rejeita 10-dígitos landline; aceita apenas 11-dígitos mobile (DDD + 9 + 8 dígitos); inline error PT-BR com highlight vermelho no campo; mensagem de ajuda contextual — `src/pages/OnboardingPage.tsx`
- ✅ P2.20 — `auto_reply` rate limit: máx 3 respostas AI por contato por 60s; cap-hit loga `[auto_reply] rate-limit hit for empresa=X jid=Y`; sliding window in-memory (single-replica concern documented inline em `server/index.ts`) — `server/index.ts`
- Type-check verde: frontend `tsc --noEmit` + `tsc --noEmit -p server/tsconfig.json`

---

### Sprint 21 (2026-04-30) — P2 security/LGPD + operational health

- ✅ P2.14 — PII redacted from billing logs: `redactEmail()` + `redactCustomerId()` helpers em `server/redact.ts`; aplicados em todos os logs de `server/billing.ts` que continham email, customer_id, last4
- ✅ P2.16 — `messages.update` broadcast agora valida `empresa_id === empresaId` antes de transmitir pro frontend; JID format check também — `server/router.ts`
- ✅ P2.9 — "Exportar backup" agora exporta apenas config (businessInfo, triggers, quickResponses, aiInstructions, drivers, blockedDates, deliveryConfig). Sessions, messages, orders e managerHistory excluídos. Arquivo renomeado `zelochat-config-*` + `_notice` explicativo — `src/components/views/SettingsView.tsx`
- ✅ P2.19 — `startPendingOrderSweeper()`: roda 2min após boot + a cada 24h, deleta `zelochat_pending_orders` com `expires_at < NOW() - 7 days` — `server/pendingOrderSweeper.ts` (novo) + wired em `server/index.ts`
- ✅ P2.22 — `managerHistory` capped em 100 entries via `.slice(-100)` nos dois paths de append — `src/components/views/AIConfigsView.tsx`
- ✅ P2.17 — `extractText` agora loga `[extractText] unknown message type:` antes do fallback `return null` — `server/messageHandler.ts`
- Type-check verde: frontend `tsc --noEmit` + `tsc --noEmit -p server/tsconfig.json`

---

### Sprint 20 (2026-04-30) — P1 security + billing UX + form persistence

- ✅ P1.2 — `isAllowedMediaUrl` allowlist: HTTPS + hostname against `storage.googleapis.com`, `supabase.co`, `whatsmiau.dev` etc. Blocks attacker-controlled URLs in webhook payload — `server/messageHandler.ts`
- ✅ P1.8 — `buildContactKey` normalizes 11-digit mobile (DDD + '9' + 8 digits) to 10-digit base; `formatPhone` handles 10-digit local numbers — `src/domain/chat.ts`, `server/messageHandler.ts`
- ✅ P1.28 — Trialing users: backend blocks duplicate Stripe checkout with `TRIALING_USE_PORTAL` error; frontend shows "período de avaliação" headline + routes to portal — `server/billing.ts`, `src/components/views/SettingsView.tsx`
- ✅ P1.29 — Paused subscription: `needsPortal` includes `'paused'`; dynamic badge (`STATUS_LABEL` map + color classes); `SUBSCRIPTION_PAUSED` error replaces misleading `SUBSCRIPTION_PAYMENT_ISSUE` — `server/billing.ts`, `src/components/views/SettingsView.tsx`
- ✅ P1.40 — `useLocalDraft` hook: debounced localStorage persistence, server-sync guard, `isDirtyVsServer`, `hasStoredDraft`; wired into `SettingsView` (business info + hours) and `AIConfigsView` (AI instructions); restore toast on mount — `src/hooks/useLocalDraft.ts`, `src/components/views/SettingsView.tsx`, `src/components/views/AIConfigsView.tsx`
- Type-check verde: frontend `tsc --noEmit` + `tsc --noEmit -p server/tsconfig.json`

### Sprint 19 (overnight automated, 2026-04-30)

- ✅ P3 — copy polish (PT consistency + remove dead Camera button) — task 1
- ✅ P2.11 — `priceBRL` constants consolidados em `src/data/pricing.ts` — task 2
- ✅ P1.37 — paywall banner hide on `subscriptionLoading=true` — task 3
- ✅ P2.1 — confirm/alert nativos substituídos por `ConfirmModal` + `useToast` — task 4
  - Novo `src/components/ConfirmModal.tsx` (shared, reused in all 8 callsites)
  - `CatalogModals.ConfirmDelete` delegado ao novo `ConfirmModal`
  - 8 callsites migrados: CalendarView, AIConfigsView, ChatView (×2), DriversView, ProductionView, ProfileView, SettingsView
  - 2 alert() → useToast (CalendarView: info + error)
- Type-check verde nos 2 tsconfigs

### Sprint 1 (shipped 2026-04-29) — revenue + correctness
- ✅ P0.9, P0.10 — order-confirm regex
- ✅ P0.11 — last_confirmed_at DB fallback
- ✅ P0.15, P0.16 — paywall middleware + frontend gate
- ✅ P0.17 — fail-closed subscription cache
- ✅ P0.20 — logout localStorage clear
- ✅ Type-check clean (`npm run lint` and `tsc --noEmit -p server/tsconfig.json`)

### Sprint 2 (shipped 2026-04-29) — schema in source control
- ✅ P0.23, P0.12, P0.24 — captured live schema as `000_zelochat_schema.sql`. ZeloChat-only, idempotent, with explicit ZeloPDV-boundary header.
- 📝 Old `001_*.sql … 013_*.sql` retained as historical record; superseded by `000_*.sql` for fresh-DB bootstrap.

### Sprint 4 (shipped 2026-04-29) — P0.14 activation + P0.5 hardening + P0.3 dead code + P0.2 singleton kill
- ✅ P0.14 — `upsertInboundUserMessage` with `onConflict: 'empresa_id,wa_message_id'` shipped. `handleIncomingMessage` returns boolean; `index.ts` skips auto-reply on duplicate redelivery. Whatsmiau retries no longer create double messages or double-fire AI.
- 🟢 P0.5 — NEW media uploads now use `${prefix}/${empresaId}/${randomHex16}-${fileName}`. Cross-tenant enumeration of new files is combinatorially infeasible (128-bit slug + scoped path). Historical files remain at old paths until a retroactive cleanup migration runs.
- ✅ P0.3 — `getEmpresaForInstance` (with stale-cache fallback) deleted. Webhook path now exclusively uses `getEmpresaAndTokenForInstance` which fails closed → Whatsmiau retries → idempotent processing via wa_message_id.
- ✅ P0.2 — `boundEmpresaId` singleton kill. All operational helpers (`getSession`, `getAllSessions`, `markSessionAsRead`, `deleteSession`, `addAssistantMessage`, `addToolMessage`, `setAutoReply`, `updateSessionName`, `handleIncomingMessage`, `generateAndSendReply`) require `empresaId: string` — TS enforces. The singleton is narrowed to ONLY `broadcastLegacyLifecycleEvent` in whatsapp.ts, which no-ops in multi-tenant mode (closes P1.11 fan-out leak too).
- Type-check clean: `npm run lint` ✅ + `npx tsc --noEmit -p server/tsconfig.json` ✅

### Sprint 3 (shipped 2026-04-29) — remaining P0s
**Code (no migration needed) — applied:**
- ✅ P0.1 — webhook_token validate-if-present (flip with `WEBHOOK_REQUIRE_TOKEN=1` once Whatsmiau is configured)
- ✅ P0.4 — `/api/produtos` proxy now requires JWT (`requireEmpresaId`)
- ✅ P0.13 — hard-button retry idempotency (prevents double-ack on Whatsmiau redeliveries)
- ✅ P0.18 — Stripe Checkout `idempotencyKey` (5-min bucket — double-click safe, retries-after-decline fresh)
- ✅ P0.19 — Stripe email-lookup removed (Checkout/Portal/sync all DB-rooted)
- ✅ P0.21 — `useOrders.ts` defense-in-depth empresa filter on every CRUD
- ✅ P0.22 — driver lookup + escalation update/acknowledge paths empresa-scoped (also closes P1.1)
- ✅ Critical-function butterfly-effect docs added to `generateAndSendReply`, `confirmPendingOrder`, `processWebhookEvent`, `/webhook/:instance`, paywall middleware
- ✅ CLAUDE.md gained "Shared database with ZeloPDV" + "Critical functions" sections

**Migrations APPLIED (and code activation):**
- ✅ `014_zelochat_rls_hardening.sql` — APPLIED. Adds policies for `zelochat_pending_orders` (P0.7), UPDATE/DELETE on `zelochat_messages` (P0.8), INSERT/DELETE on `zelochat_escalation_events` (P0.8), DELETE on `zelochat_sessions`.
- ✅ `015_wa_message_id_idempotency.sql` — APPLIED. Code-side activation also shipped: `server/messageHandler.ts` now uses `upsertInboundUserMessage` with `onConflict: 'empresa_id,wa_message_id'`, returns `boolean`; `server/index.ts` skips auto-reply when handler returns `false` (duplicate redelivery). Closes P0.14 fully.

### Sprint 5 (shipped 2026-04-29) — P0.6 from PDV repo + P0.5 retroactive
- ✅ P0.6 — `empresa_perfil` UPDATE policy gained `WITH CHECK (auth.uid() = user_id)`. Closes empresa transfer/theft vector. Applied to prod via Supabase MCP. SQL doc at `zeloPDV-Prod/.ai/migrations/empresa_perfil_update_with_check.sql` (PDV gitignora `.ai/`).
- ✅ P0.5 retroactive — dry-run via `storage.objects` revealed only 4 historical files at old enumerable paths, all confirmed orphans (zero references in `zelochat_messages.content`). One-off cleanup script `scripts/cleanup-orphan-media.ts` ships in this commit; run with `npx tsx scripts/cleanup-orphan-media.ts` to remove them via Storage API.
- **All 24 P0s now addressed.** 24 fully closed pending one-time script execution for P0.5 cleanup.

### Sprint 18 (shipped 2026-04-29) — P0.1 pivot to URL-as-secret + legacy instance rotation
- ✅ **P0.1 verdict — Whatsmiau headers config is UI-only, doesn't actually forward.** WEBHOOK_DEBUG_HEADERS diagnostic captured 2 events post-deploy + 14 events post-reconnect from Donutopia, all with `sensitive=[]` (zero auth-shaped headers arrived). Body keys also clean (no embedded auth). Strict-mode header validation is not viable; abandoning that path.
- ✅ **Adopted URL-as-secret as the auth boundary.** New instances created via `createInstance()` already use `zelo-{empresa8}-{16hex}` = 64 bits of entropy → unguessable URL path. Token-validation code in `/webhook/:instance` left dormant (no-op until Whatsmiau fixes header forwarding); `auth_status` column on `zelochat_webhook_events_raw` is the canary.
- ✅ **Removed diagnostic + log spam.** `WEBHOOK_DEBUG_HEADERS` block deleted (purpose served). The `[Webhook] token-missing` warning log removed — would fire on 100% of real traffic now and is pure noise. Strict-mode reject + token-mismatch logs preserved (real attack signals).
- ✅ **Rotated 2 legacy instances** (Donutopia `zelo-28400a79` + Casa dos Salgados `zelo-70ec4c72`, both enumerable from empresa UUID). Whatsmiau DELETE + DB null. Customers reconnect via existing /api/qr flow → auto-creates new instance with random suffix. Casa dos Salgados scheduled for tomorrow morning (operator confirmed both empresas idle now).
- ✅ Documented URL-as-secret as the auth boundary in `CLAUDE.md` §"Webhook auth boundary".
- Type-check ✅

### Sprint 17 (shipped 2026-04-29) — P0.1 strict-mode prep + P1.13 sweeper + P1.4 redaction
- ✅ **P0.1 strict-mode visibility** — `zelochat_webhook_events_raw.auth_status` (migration `017_webhook_events_raw_auth_status.sql`). Router stamps each row with `token_match` / `token_missing` / `token_mismatch`. Pre-flip query: `SELECT auth_status, COUNT(*) FROM zelochat_webhook_events_raw WHERE received_at > now() - interval '24 hours' GROUP BY 1`. Zero `token_missing` over 24h = safe to set `WEBHOOK_REQUIRE_TOKEN=1`. Whatsmiau-side headers already configured for both active empresas (Donutopia + Casa dos Salgados) via `POST /webhook/set/{instance}` with `headers: {apikey: webhook_token}`.
- ✅ **P1.13** — subscription sweeper (`server/subscriptionSweeper.ts` + CLI `scripts/sweep-canceled-subscriptions.ts`). Resolves "active" via the same `resolveActiveSubscription` predicate as the paywall (manually_extended_until OR provider status), defaults 30-day grace, dry-run by default in CLI mode. Wired in `server/index.ts` to run 5min after boot + every 6h. Conservative: customer churn → Whatsmiau instance reaped → re-scan QR re-provisions on renewal. Customer data (messages, sessions, orders) NOT touched.
- ✅ **P1.4** — instance names redacted in logs (`server/redact.ts` w/ `redactInstance` + `redactToken`). Touched: `server/router.ts` `/webhook/:instance` (5 spots), `server/whatsapp.ts` (7 spots — incl. the global `[WhatsApp] Instances found` JSON dump that previously leaked the entire fleet's names + ownerJids; now logs only count), `server/subscriptionSweeper.ts` (3 spots). Defense-in-depth: pre-P0.1 instance name was the auth boundary; even post-`webhook_token` a leaked name still confirms tenant existence + narrows attacker search. Pattern: `zelo-70ec4c72` → `zelo-***4c72`, enough suffix for ops correlation.
- Type-check ✅

### Sprint 16 (shipped 2026-04-29) — webhook_events_raw defense + P0.5 cleanup executado
- ✅ **Defense permanente contra futuros P0.14**: nova tabela `zelochat_webhook_events_raw` (migration `016_webhook_events_raw.sql`, APLICADA em prod via MCP) registra cada payload de `/webhook/:instance` ANTES do processamento. RLS on, 0 policies (service-role only) — payloads contêm telefones/conteúdo de outros tenants se a resolução de instance falhar. Helper em `server/webhookLog.ts` com `recordRawWebhookEvent` + `markWebhookEventProcessed`. Wired em `router.ts /webhook/:instance` após o ack (não bloqueia Whatsmiau). Falhas de log são swallowed — defense layer não pode quebrar o ack path. Base64 de mídia é stripped antes do insert pra manter row size bounded. Próxima regressão na persistência vira reprocessável via SELECT em `zelochat_webhook_events_raw WHERE processed_at IS NULL OR processing_error IS NOT NULL`.
- ✅ P0.5 cleanup — `npx tsx scripts/cleanup-orphan-media.ts` rodado. 4 órfãos pré-P0.5 deletados via Storage API. Verificação: 0 arquivos restantes em paths enumeráveis. Bucket fully clean.
- ✅ Type-check `npm run lint` + `tsc -p server/tsconfig.json`

### Sprint 15 (shipped 2026-04-29) — Recovery dos dados perdidos pela regressão P0.14
**Análise de impacto:**
- 2 sessions afetadas: Gustavo + Ricardo (ambas Donutopia — empresa de teste do founder)
- **Casa dos Salgados (R$3k cliente real): 0 mensagens perdidas** ✅
- Janela: 18:00–22:00 UTC em 2026-04-29

**Tentativa de recovery via Whatsmiau API:**
- Probe em /v2/chat/findMessages, /evolution/chat/findMessages, /chat/fetchMessages, /message/findMessages, vários paths e variantes do instance ID. Todos 404.
- Conclusão: Whatsmiau **não expõe endpoint de histórico de mensagens** — só envio + webhook config (/webhook/find/{instance} funciona). Histórico é "fire-and-forget"; perdido é perdido.

**Recovery manual (apenas para Gustavo):**
- "Opa" recuperado a partir de `zelochat_sessions.last_message` (que ensureSession atualizou mesmo quando o upsert falhou). INSERT manual em `zelochat_messages` com `wa_message_id = NULL` (sem ID original; partial unique index só constrange when not-null, então OK).
- Ricardo: texto original perdido para sempre — `last_message` foi sobrescrito pelo reply da AI antes de eu poder fazer recovery. Lesson: ensureSession sobrescreve last_message tanto em msgs user quanto assistant.

**Lessons learned:**
1. Sempre que mexer em paths críticos de persistência, fazer dry-run com SQL `RETURNING` em ambiente real ANTES de deploy.
2. Whatsmiau não tem fallback de history — toda perda em janela de bug é definitiva. Considerar persist webhook payload BRUTO em uma tabela de log antes de processar (defesa contra futuros bugs similares).

### Sprint 14 (shipped 2026-04-29) — P1.35 quick-response error feedback
- ✅ P1.35 — `scheduleQrSave` em `AIConfigsView` agora mostra toast em failure. Antes só limpava `qrSaveState` e logava no console — operador via "Saving..." piscar e sumir, achava que tinha salvo, próxima vez que abria viu a mudança perdida.
- Type-check ✅

### Sprint 13 (shipped 2026-04-29) — CORS leak + rate limit
- ✅ P1.5 — CORS callback agora `cb(null, false)` em vez de throw. Antes a Error message expunha `FRONTEND_URL` em respostas 500 — qualquer atacante descobria a allowlist via origin proibido.
- ✅ P1.3 — rate limit per-empresa em `/api/whatsapp/validate-numbers`: 200 números/hora. Antes só cap de 50 por request mas sem janela — operador (ou token comprometido) podia rodar em loop e usar Whatsmiau como enumerador grátis de telefones com WhatsApp.
- Type-check ✅

### Sprint 12 (shipped 2026-04-29) — P1.34 sync-config feedback
- ✅ P1.34 — `syncConfigToServer` antes silenciava todo erro com `catch {}`. Agora track consecutive failures via ref e mostra UM toast após 5 falhas seguidas (~3s sem sync funcionando). On success, reseta o contador e — se o toast tinha aparecido — mostra "voltou a sincronizar". One-shot, não spam.
- Type-check ✅

### Sprint 11 (shipped 2026-04-29) — Dead-code cleanup
- ✅ P1.14 — `wipeAuthInfo` + import `rmSync` removidos. Era safety-net pré-Whatsmiau (era Baileys local). Hoje todo auth está upstream — código + footgun do `rmSync` em path relativo.
- ✅ P2.5 — segundo WebSocket em `useOrders` deletado. Era unauthenticated (sem token), redundante com a Supabase realtime subscription que já cobre INSERT/UPDATE/DELETE em zelochat_orders desde migration 012.
- Type-check ✅

### Sprint 10 (shipped 2026-04-29) — P1 batch 3
- ✅ P1.23 — `confirmPendingOrder` retry message: era "Toque em ✅ Confirmar de novo" mas o botão original já foi consumido pelo WhatsApp. Agora pede "responda *Sim*" — soft-confirm em router.ts pega e roda confirm de novo (FIX H1 mantém pending row intacta).
- ✅ P1.38 — OAuth callback timeout 8s → 20s. Conexões 3G/4G no celular do dono não cabiam em 8s, virava "OAuth falhou" injusto.
- ✅ P1.39 — `useNotificationSound` requer 3 falhas consecutivas pra flipar unlocked=false. Antes UM hiccup (GC, throttle) re-mostrava o banner.
- Type-check ✅

### Sprint 9 (shipped 2026-04-29) — P1 batch 2
- ✅ P1.7 — `wasSentByServer` TTL 30s → 10min. Cobre Railway redeploys (2-3min) + Whatsmiau queue lag. NOTA: ainda não sobrevive a process restart — solução completa via `wa_message_id` UNIQUE persisting fica TODO. Inline doc explica.
- ✅ P1.12 — cache de 5s na `/evolution/instances` list. Antes /api/status (polled @ 3s pelo card) gerava load no Whatsmiau + log da inventário completo de instâncias.
- ✅ P1.19 — log warning quando OpenAI emite múltiplos tool_calls (raro). Refactor pra processar todos em sequência fica TODO.
- ✅ P1.22 — `clearPendingOrder` em best-effort no catch do `criar_pedido`. Antes setPendingOrder podia ter sucesso e algo downstream falhar → pending row órfã, customer dizia "sim" e o soft-confirm rodava sobre order fantasma.
- Type-check ✅

### Sprint 8 (shipped 2026-04-29) — Hotfix do P0.14 + P1 batch
- 🔥 **HOTFIX 28dd528** — `upsert(..., { ignoreDuplicates: true })` do supabase-js NÃO retorna a row em insert fresco. Minha checagem `data.length === 0` interpretava todo insert como duplicate → 531 mensagens user esperadas, **0 persistidas com wa_message_id desde o deploy**. Casa dos Salgados estava perdendo TODA mensagem inbound (last_message do session row mascarava). Trocou pra INSERT puro com catch do código 23505 (Postgres unique_violation).
- ✅ UX flicker WhatsApp `desconectado` por 3s ao trocar view: módulo-level cache de `lastKnownWaStatus` sobrevive remounts do `WhatsAppIntegrationCard`. Antes initial state hardcoded 'disconnected' fazia badge piscar vermelho até o /api/status responder.
- ✅ P1.21 — soft-confirm regex agora não strip-digit ("10s" / "5min" não viram mais "s" / "min"). Mesma whitelist exact-match do P0.9/P0.10.
- ✅ P1.9 — cap de 25MB em mídia inbound base64. Antes vídeo 50MB era decodado direto pra Buffer (~75MB) no event loop — múltiplos paralelos = OOM/Railway crash.
- ✅ P1.20 — conversation history capped em últimas 60 turnos antes de mandar pra OpenAI. Antes cliente que chateia há meses gerava prompt linearmente crescente, escalando custo + latência sem teto.
- ✅ P1.15 — hard-button regex agora normaliza accent + emoji + punct + case e match por token "confirmar"/"cancelar". Antes exact-match "✅ Confirmar" perdia variantes ("✅Confirmar", "Confirmar ✅", "CONFIRMAR", VS16) que caíam no AI como freeform → duplicate-order risk.
- ✅ P1.6 — per-empresa in-flight mutex em `getOrCreateOwnInstanceForEmpresa`. Duas abas abrindo /api/qr simultaneamente não criam mais instâncias órfãs no Whatsmiau. Multi-node deploy precisaria de advisory lock — flagged inline.
- Type-check ✅

### Sprint 7 (shipped 2026-04-29) — P1 segurança batch (D)
- ✅ P1.18 — sanitização ampla em `criar_pedido`: `customerName`, `deliveryAddress`, `deliveryNeighborhood`, `pickupTime`, `paymentMethod` agora todos passam por `safeForPrompt` antes de persistir em `zelochat_pending_orders`. Antes só `observations` era sanitizado — quebra de linha ou backtick num customerName injetado podia virar prompt-injection ao ser lido em turnos posteriores.
- ✅ P1.24 — `phoneToJid` (em escalation.ts E ai.ts) agora valida estritamente: aceita só 10-11 dígitos (Brasil sem DDI, prepend 55) ou 12-13 dígitos começando com 55. Antes "211999998888" passava → JID inválido → Whatsmiau silenciava entrega → gerente nunca recebia notificação de escalação.
- ✅ P1.10 — `confirmPendingOrder` e `cancelPendingOrder` agora try/catch do `sendTextMessage`. Em failure, persiste a tentativa com prefixo `[FALHA NO ENVIO — reenviar manualmente]` em `zelochat_messages` pra que o operador veja no chat history. Pedido em DB não é afetado (já rolou). Antes Whatsmiau 5xx fazia o pedido ser criado sem o customer receber confirmação, customer ligava perguntando "foi?".
- Type-check ✅

### Sprint 6 (shipped 2026-04-29) — P1 user-facing UX batch (C)
- ✅ P1.30 — drag-and-drop status update agora rolls back optimistic state em failure + toast "Voltei pra coluna anterior".
- ✅ P1.31 — `handleAddOrder/EditOrder/DeleteOrder` em AppShell agora try/catch + toast de sucesso/erro + rollback.
- ✅ P1.32 — sign-up "Verifique seu e-mail" tem botão "Reenviar e-mail de confirmação" + estados sending/sent/error visíveis. Operador não-técnico não fica preso achando que sistema quebrou.
- ✅ P1.33 — novo state `wsConnected` no `useWhatsAppSessions` separa o WebSocket layer da WhatsApp layer. AppShell renderiza pill âmbar "Reconectando ao servidor…" quando WS dropou mas WhatsApp ainda está OK. Antes, operador via "Conectado" falso enquanto WS estava drop.
- ✅ P1.36 — trigger CRUD em `AIConfigsView` agora reporta toda failure via toast (antes era `void X.catch(()=>{})`); deleção também faz toast de success.
- 🆕 Sistema de toast in-app: `src/contexts/ToastContext.tsx` + `<ToastProvider>` envolvendo `<Routes>` em `App.tsx`. Reuse via `useToast()` hook em qualquer componente. Variantes success/error/info, stacking top-right, auto-dismiss (4s success/info, 8s error). Lucide icons + Motion animations.
- Type-check ✅

**Type-check status:** `npm run lint` ✅ + `npx tsc --noEmit -p server/tsconfig.json` ✅

---

## Operational notes for the live customer

- The paywall middleware will return **402** on previously-open routes. Watch Railway logs for `[paywall] gate error` and customer-support tickets in the first hour after deploy.
- The fail-closed subscription cache means a Supabase outage will lock out users whose cache hasn't been seeded. First request after deploy warms the cache.
- The order-confirm DB lookup adds one extra Supabase round-trip per `criar_pedido` tool call — single-digit ms.
- The frontend logout now wipes `localStorage` keys — users will lose UI prefs (sidebar width, calendar mode) on next login. Acceptable tradeoff for the cross-tenant data leak.

---

## How to update this file

When you ship/draft a fix:
1. Flip the row in the table above (⏳ → 🟡 / ✅ / 🟥).
2. Add a one-line entry to the relevant Sprint section.
3. If the fix changes a CRITICAL function (one whose breakage cascades), add an inline JSDoc-style comment to the function explaining the chain effect — see `server/ai.ts` `generateAndSendReply` for the pattern.

If you're closing out a sprint:
1. Run `npm run lint` AND `npx tsc --noEmit -p server/tsconfig.json`. Both must pass.
2. Write a short post-deploy checklist at the bottom of the sprint section.
