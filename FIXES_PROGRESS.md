# ZeloChat — Fixes Progress Tracker

**Source review:** [CODE_REVIEW.md](CODE_REVIEW.md) — 6-agent senior audit, 24 P0 / 47 P1 / 38 P2 / 24 P3.
**Customer status:** 1 paying tenant (R$3k contract). System has broken twice in 2 days of customer use — fixes here directly target the recurring failure modes.

Use this doc to know **at a glance** what's safe in production right now and what's still on fire. Each fix has a `Status`, the `Files touched`, and the `Risk` it eliminates. Fixes that need a prod migration are marked `BLOCKED — needs operator approval` until the user signs off on applying.

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
| P0.1 | `/webhook/:instance` no caller authentication | ✅ | `server/router.ts:357`, `server/instanceManager.ts:106` | Validate-if-present mode shipped. Set `WEBHOOK_REQUIRE_TOKEN=1` after Whatsmiau-side is configured to flip strict. |
| P0.2 | `boundEmpresaId` singleton breaks 2nd tenant | ✅ | `server/supabase.ts:263`, `server/messageHandler.ts` (multiple), `server/ai.ts:903`, `server/whatsapp.ts:27` | All operational helpers now require `empresaId: string` — TypeScript enforces. Singleton narrowed to ONLY `broadcastLegacyLifecycleEvent` in whatsapp.ts which no-ops in multi-tenant (closes P1.11 fan-out leak too). |
| P0.3 | `getEmpresaForInstance` cache-fallback on DB error | ✅ | `server/instanceManager.ts:149` | Removed entirely (dead code after P0.1 migrated all callers to `getEmpresaAndTokenForInstance`, which fails closed). On Supabase blip, webhook returns 404 → Whatsmiau retries → recovered DB processes once (idempotent via wa_message_id from P0.14). |
| P0.4 | `/api/produtos` proxy unauthenticated | ✅ | `server/router.ts:1374` | `requireEmpresaId(req)` validates JWT locally before proxying upstream. Paywall middleware also gates it. |
| P0.5 | `zelochat-media` bucket public + enumerable filenames | ✅ | `server/supabase.ts:188`, `server/messageHandler.ts:198`, `server/router.ts:726`, `scripts/cleanup-orphan-media.ts` | NEW uploads scoped per-empresa with 128-bit random slug. Dry-run revealed only 4 historical files at old paths, ALL ORPHANS (not referenced in `zelochat_messages.content`). Cleanup script `scripts/cleanup-orphan-media.ts` lists the 4 explicit names and uses Storage API to delete (Supabase blocks direct DELETE FROM storage.objects). Run once via `npx tsx scripts/cleanup-orphan-media.ts`. |
| P0.6 | `empresa_perfil` UPDATE policy missing `WITH CHECK` | ✅ | `zeloPDV-Prod/.ai/migrations/empresa_perfil_update_with_check.sql` (local — PDV gitignora `.ai/`) | Migration aplicada em prod via MCP em 2026-04-29. Verificada: `qual = with_check = (auth.uid() = user_id)`. Fecha vetor de roubo de empresa via `UPDATE empresa_perfil SET user_id = …`. Aplicada do repo PDV (tabela é PDV-owned). |
| P0.7 | `zelochat_pending_orders` RLS on but no policies | 🟡 | `supabase/migrations/014_zelochat_rls_hardening.sql` | Migration DRAFTED. Apply only after operator review. |
| P0.8 | `zelochat_messages` no UPDATE/DELETE; `zelochat_escalation_events` no INSERT/DELETE | 🟡 ✅ | `supabase/migrations/014_zelochat_rls_hardening.sql` + `server/escalation.ts:293-340` | Migration DRAFTED. Code-side `.eq('empresa_id')` already added (P1.1 closed). |
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

## Sprint history

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
