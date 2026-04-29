# ZeloChat — Senior Code Review (Tier A)

**Date:** 2026-04-29
**Scope:** entire repo at `zelochat/` — 6 parallel specialist passes (auth/multi-tenancy, WhatsApp + messaging, AI + order pipeline, Stripe billing, frontend/UX, DB/schema/RLS).
**Total findings:** 24 P0, 47 P1, 38 P2, 24 P3.

---

## TL;DR — what to fix this week

These are **compound** risks: each one alone is bad; together they form the dominant blast-radius scenarios.

1. **Webhook is unauthenticated AND paywall is open AND there's no message-id idempotency.** Anyone who learns an instance name (`zelo-{first8}-{16hex}`) can replay/inject WhatsApp events into any tenant — leaking messages to operators, creating real `zelochat_orders` rows, spending OpenAI tokens on attacker-controlled prompts. The `webhook_token` column already exists (migration 009) but is never read.
2. **Operational endpoints don't check subscription.** `/api/send`, `/api/ai/*`, `/api/drivers/*/dispatch`, etc. only require an `empresaId` — a cancelled customer keeps blasting messages and AI replies forever. Only `/api/qr` and `/api/qr/refresh` are gated. Frontend has no gate either, just a banner.
3. **Affirmative/negative regex prematurely confirms or cancels orders.** `^(certo|isso|claro|...)`/`^(nao|n\b|...)` are not anchored to end-of-string. "**certo, mas troca a coca**" → confirms. "**não, prefiro de manhã**" → cancels. This fires on every customer message while a pending order is open. Five-line patch, biggest UX bug.
4. **Core schema isn't in source control.** `empresa_perfil`, `zelochat_sessions`, `zelochat_messages`, `zelochat_orders`, `zelochat_pending_orders`, `zelochat_escalation_events` were created via dashboard. The `role` CHECK widening that prevents the documented duplicate-order bug isn't in `supabase/migrations/`. Bus factor: 1.
5. **Logout doesn't clear `localStorage`.** Next user on the same browser sees the prior tenant's business name, address, PIX key, and persisted state. Cross-tenant data leak via shared device.
6. **`isEmpresaSubscriptionActive` fails OPEN.** A Supabase blip silently re-enables every cancelled customer. There is no metric on this.
7. **`zelochat-media` bucket is public, filenames are timestamp-prefixed.** Customer photos/audios across all tenants are world-readable and enumerable by guessing milliseconds.

---

# P0 — Ship-blocking

## Auth, isolation, secrets

- **P0.1 — `/webhook/:instance` has zero caller authentication.** `server/router.ts:333-347`. Resolves empresa via DB lookup on URL path, trusts body. `webhook_token` column from migration 009 is never read. Repro: `curl -X POST $URL/webhook/Comercial_d3c6ca80 -d '{"event":"messages.upsert", ...}'` lands as a real customer message — fires AI, creates orders, notifies manager. Fix: require `apikey: <empresa_perfil.webhook_token>` header AND/OR HMAC-sign URL; allow-list Whatsmiau egress IPs.
- **P0.2 — `boundEmpresaId` singleton breaks the moment a 2nd empresa onboards.** `server/supabase.ts:5`, `server/index.ts:115-153`. Auto-binds when `count===1` (today's beta). `messageHandler.ts` helpers (`addAssistantMessage`, `addToolMessage`, `setAutoReply` at lines 429,457,514,546,580,606) default `empresaId = getBoundEmpresaId()` — so any caller that forgets to thread `empresaId` writes a row under Donutopia for a different tenant's JID. Fix: make `empresaId` mandatory (no defaults), delete `setBoundEmpresaId`, let TypeScript enforce it.
- **P0.3 — `instanceManager.getEmpresaForInstance` falls back to the cache on DB error.** `server/instanceManager.ts:116-151`. Comment claims "fresh DB read", but on transient failure it returns a stale cache entry → up to 60s of cross-tenant routing for inbound webhooks. Fix: drop the fallback, or fail closed with an alert.
- **P0.4 — `/api/produtos` proxy forwards JWT to a third-party host without local verification.** `server/router.ts:1350-1372`. No `requireEmpresaId`, no rate limit. Any valid Supabase token (incl. revoked-but-pre-TTL, paused-subscription customer, or token from a sister project sharing the auth pool) can pull catalog data through this proxy.
- **P0.5 — Public `zelochat-media` bucket + enumerable timestamp filenames.** `server/supabase.ts:133, 203`. Pattern `received/${Date.now()}-${name}` and no auto-delete on `received/` (only `send/` cleans up). Customer faces, IDs, voice notes across all tenants are world-readable to anyone who can scan timestamps. Fix: scope keys per-empresa with random slug, flip bucket private, serve via signed URLs.
- **P0.6 — `empresa_perfil` UPDATE policy has no `WITH CHECK`.** Migration 001 (or live DB). User can change `user_id` on their own row → transfer/steal empresa. Fix: add `WITH CHECK (auth.uid() = user_id)`; ideally lock `user_id` from update via column grant or trigger.
- **P0.7 — `zelochat_pending_orders` has RLS on but no policies.** No SELECT/INSERT/UPDATE/DELETE policy in any migration. Today the server uses service key (works), but there's zero defense-in-depth — a future code path that drops the explicit `.eq('empresa_id', ...)` (already done correctly today in `ai.ts:97-148`) silently leaks across tenants.
- **P0.8 — `zelochat_messages` missing UPDATE/DELETE policies, `zelochat_escalation_events` missing INSERT policy.** Same defense-in-depth gap. `escalation.ts:299-304` resolves an escalation by `session_id` ONLY — no `empresa_id` filter, service-key bypasses RLS, so a session_id collision (or a test fixture, or a future bug) crosses tenants.

## Order pipeline (the documented "DO NOT BREAK" path)

- **P0.9 — Affirmative-text regex confirms partial matches.** `server/ai.ts:779`. Pattern `/^(...|certo|isso|perfeito|...|claro)/` is anchored at start, no `\b`/`$` after each alternate. "**certo, mas troca a coca**" → `confirmPendingOrder()`. "**isso aí mas sem cebola**" → confirms. "**claro que não**" → confirms. Fix: change to `/^(sim|s|ok|certo|isso|...)\s*[.!?…]*\s*$/` against trimmed/accent-folded message, or whitelist exact tokens.
- **P0.10 — Negative-text regex cancels partial matches.** Same file, same pattern, opposite direction. "**não, prefiro de manhã**" → `cancelPendingOrder()`. Fix as above.
- **P0.11 — `justConfirmedMap` is in-memory only; survives no restart, no replica.** `server/ai.ts:31, 191, 858`. After a restart or LB swap, the post-confirm "obrigado!" can re-trigger `criar_pedido` against fresh context. This is the exact duplicate-order bug the CLAUDE.md trap warns about. Fix: persist `last_confirmed_at` on `zelochat_sessions` or do a 5-minute lookback against `zelochat_orders`.
- **P0.12 — `zelochat_messages.role` CHECK widening migration is NOT in source control.** CLAUDE.md names `allow_tool_and_system_roles_in_zelochat_messages` as load-bearing — it's not in `supabase/migrations/`. A fresh Supabase project + numbered-only migrations → constraint rejects `'tool'`/`'system'` → catch-fallback fires on every successful order send → duplicate orders return. Fix: dump the constraint and check it in.
- **P0.13 — Hard-button short-circuit re-runs idempotent reply on Whatsmiau retry.** `server/router.ts:169-207`. `recentlyHandled.set` happens at `:177`, but the no-pending branch `:194-204` doesn't read `recentlyHandled` first. A retried button click → second "Seu pedido já foi confirmado!" message to the customer.
- **P0.14 — No idempotency on inbound webhook (`zelochat_messages` has no `wa_message_id` UNIQUE).** Whatsmiau retries on slow ack or proxy drop. Same message persisted twice, unread doubled, AI runs twice → double pending order or double assistant reply. Fix: add `wa_message_id text` + UNIQUE `(empresa_id, wa_message_id)` + `INSERT … ON CONFLICT DO NOTHING`. Closes P0.14, P1 dedup, P1 fromMe-echo race in one shot.

## Billing / paywall

- **P0.15 — Paywall bypassed on every operational endpoint.** `server/router.ts`. `requireActiveZelochatSubscription` is only on `/api/qr` and `/api/qr/refresh`. `/api/send`, `/api/send/list|location|reaction|poll`, `/api/ai/*`, `/api/sessions/*`, `/api/drivers/*/dispatch`, `/api/orders/:id/status`, `/api/triggers/*`, `/api/sync-config`, `/api/messages/:id` — all unguarded. Cancelled customer keeps spending your OpenAI + Whatsmiau quota. Fix: router-level middleware on `/api/*` excluding `/api/billing/*`, `/api/healthz`, `/api/bind-empresa`, `/api/status`.
- **P0.16 — Frontend has no paywall gate, only a banner.** `src/AppShell.tsx:572-593`. Every nav item still works; only the top banner says "Ative seu plano". Fix: when `!subscriptionActive`, render a paywall view for any `activeView !== 'settings' && !== 'profile' && !== 'novidades'`.
- **P0.17 — `isEmpresaSubscriptionActive` fails OPEN on DB error.** `server/supabase.ts:156-183`. Supabase outage = paywall vanishes for everyone, including cancelled accounts. Fix: cache last successful result per empresa with 5-min TTL; never default to `true` without a prior positive read; emit a fail-open metric.
- **P0.18 — Two parallel Stripe Checkout sessions can both be paid.** `server/billing.ts:194-321`. No `idempotencyKey`, no concurrency lock. Double-click or two-tab → two active subs, customer charged twice. Fix: `idempotencyKey: 'checkout-' + user.id + '-' + tier + '-' + minuteBucket`.
- **P0.19 — Stripe customer reuse via email lookup is cross-product unsafe.** `server/billing.ts:246-249, 344-347, 391-394`. Stripe account is shared with ZeloPDV. A new ZeloChat user with email matching an existing PDV customer adopts that customer record → can open Customer Portal and cancel/refund the *other* product's subscription, and `syncFromStripe` may map a `pdv` sub onto the new user. Fix: never trust email lookup for portal/sync; require `provider_customer_id` from DB; if missing, send to Checkout (which creates a fresh customer with `metadata.user_id`).

## Data integrity & frontend

- **P0.20 — Logout doesn't clear `localStorage`, in-flight requests, WS, or printer permission.** `src/components/views/ProfileView.tsx:96-101`, `src/services/authService.ts:40`. Next account on the same browser inherits the prior tenant's `zelochat_state_v2` (full businessInfo, address, PIX key, daily context). Fix: clear all `zelochat_*` localStorage keys + close WS + abort fetches before navigate.
- **P0.21 — `useOrders.ts` reads/mutates `zelochat_orders` with NO `empresa_id` filter.** `src/hooks/useOrders.ts:58, 149, 181, 204`. Wholly RLS-dependent. The RLS policy on `zelochat_orders` is not in any committed migration (P0.23). Fix: add defense-in-depth `.eq('empresa_id', empresaIdRef.current)` AND commit the RLS policy.
- **P0.22 — `confirmPendingOrder` driver lookup missing `empresa_id` filter.** `server/ai.ts:415-419`. Service-role client + raw `eq('id', target.driver_id)`. If `driver_id` ever points at another empresa's driver (data corruption, restored backup), the foreign name leaks into the customer reply. Fix: `.eq('empresa_id', empresaId)` and treat null as "Entregador não encontrado".
- **P0.23 — Core tables have NO `CREATE TABLE` migrations.** `supabase/migrations/` has 001-013 — all `ALTER`. `empresa_perfil`, `zelochat_sessions`, `zelochat_messages`, `zelochat_orders`, `zelochat_pending_orders`, `zelochat_escalation_events` were created in the dashboard. Schema is unversioned, RLS state unverifiable from source. Fix: `pg_dump --schema-only` → check in as `000_initial_schema.sql`.
- **P0.24 — `whatsmiau_instance` UNIQUE constraint not in any migration.** Codebase relies on it (`maybeSingle()` in `getEmpresaForInstance`). Two simultaneous `/api/qr` calls for a brand-new empresa each create an instance; last write to `empresa_perfil` wins; orphan instance stays on Whatsmiau billing. Fix: `CREATE UNIQUE INDEX … WHERE whatsmiau_instance IS NOT NULL` + wrap creation in transaction with `SELECT … FOR UPDATE`.

---

# P1 — High

## Auth & RLS

- **P1.1** — Cross-tenant write window via service-key + missing `empresa_id` filter on `zelochat_escalation_events.update` (`escalation.ts:299-304, 337-342`).
- **P1.2** — `extractAttachmentDataUrl` (`messageHandler.ts:193-219`) trusts `mediaUrl` from webhook payload verbatim. Combined with the unauthenticated webhook (P0.1), an attacker injects an attacker-hosted URL → operator's IP/UA leaks on every chat open.
- **P1.3** — `validate-numbers` endpoint (`router.ts:1407-1414`) accepts up to 50 numbers per request, no rate limit. Free phone-existence enumerator via Whatsmiau.
- **P1.4** — Instance names in plaintext logs (`instanceManager.ts:33,45,62-63,100,145`, `whatsapp.ts:538,612`). If logs leak, the auth boundary leaks (the "instance name is the secret" model).
- **P1.5** — CORS error path returns 500 with `FRONTEND_URL` in error string (`index.ts:26-33`). Use `cb(null, false)` instead of throwing.

## WhatsApp / messaging

- **P1.6** — Multiple browser tabs racing `/api/qr` create N orphan Whatsmiau instances. `instanceManager.ts:201-228`. No per-empresa lock. Fix: in-memory mutex or Postgres advisory lock.
- **P1.7** — `wasSentByServer` 30-s TTL is too short for cold-restart + Whatsmiau retry — outbound echo gets re-persisted as organic operator message after restart. Fix: persist via `wa_message_id` UNIQUE.
- **P1.8** — Phone normalization can't tell landline from mobile — 10-digit local + 11-digit local merge into different "families". `messageHandler.ts:95-101`, `domain/chat.ts:52-59`.
- **P1.9** — Incoming media has no size cap; 50 MB video → ~75 MB Buffer in event loop → OOM risk. `messageHandler.ts:193-219`. Transcription has 5 MB cap, upload doesn't.
- **P1.10** — Send failures (`sendTextMessage` throw) after `addAssistantMessage`/`createOrderInDb` succeed → operator sees "✅ enviado" but customer never received. `ai.ts:184, 198, 938, 1011, 1022, ...`.
- **P1.11** — Legacy single-tenant lifecycle (`fetchQR`, `disconnectWhatsApp`, `syncStatusFromUpstream`) calls `broadcast(..., undefined)` when `getBoundEmpresaId()` is null in multi-tenant → fan-out to ALL connected empresas. Donutopia disconnects → every other empresa's "WhatsApp Conectado" pill flips red.
- **P1.12** — `fetchInstanceConnectionState` enumerates ALL Whatsmiau instances on every `/api/status` call → leaks all instance names to whichever empresa polls. `whatsapp.ts:417-434`.
- **P1.13** — Subscription cancellation doesn't trigger `deleteInstance` / `logoutInstance`. Whatsmiau bill keeps running for a non-paying ex-customer.
- **P1.14** — `auth_info_baileys/` wipe on disconnect (`whatsapp.ts:80-90`) is dead code in the Whatsmiau era; risk of accidental data deletion via symlink/cwd misconfig. Remove.
- **P1.15** — Hard-button regex misses common variants: `'✅Confirmar'` (no space), `'CONFIRMAR'` (uppercase), `'Confirmar ✅'` (emoji at end), VS16 variation, smart-quote periods. `router.ts:165-167`. Misses fall through to AI → can recreate the duplicate-order bug.

## AI pipeline

- **P1.16** — `recordAiFailure` counter in-memory; multi-replica = no escalation on persistent failures. `escalation.ts:375, 397`.
- **P1.17** — `configStore` desync between replicas — second pod runs with empty cardápio, AI hallucinates prices freely. `configStore.ts:66`. Fix: hydrate from DB on every webhook for an unknown empresaId.
- **P1.18** — Customer-supplied `customerName`, `deliveryAddress`, `pickupTime`, `quantity` not run through `safeForPrompt` before persisting (`ai.ts:947, 952-967`). Only `observations` is. Re-introduces prompt-injection on subsequent turns.
- **P1.19** — AI may emit two `tool_calls` in one turn; only `[0]` is processed (`ai.ts:853`). Customer hangs silently if both tools are needed.
- **P1.20** — Conversation history is unbounded (`messageHandler.ts:441-446`). Cost grows per-conversation lifetime. Cap at 60 turns.
- **P1.21** — Soft-confirm strips digits before regex → `'5min'`/`'10s'` → `'min'`/`'s'` → matches `^s$` → confirms. `router.ts:222`.
- **P1.22** — Catch-block in `criar_pedido` may leave orphan pending row if `setPendingOrder` succeeded but inner catch threw before sending the apology. `ai.ts:1016-1023`.
- **P1.23** — `confirmPendingOrder` retry path tells customer to "tap ✅ Confirmar de novo" but the buttons are gone after first click. `ai.ts:160-169`. Tell them to type "Sim".
- **P1.24** — Manager phone not validated before escalation send — silent SLA breach if format is wrong.

## Billing

- **P1.25** — `syncFromStripe` may overwrite a `plan_tier='pdv'` row with `'chat'`. `billing.ts:459-466`. Filter `existingRows` to chat-relevant tiers before picking candidate.
- **P1.26** — `createPortalSession` opens portal even with no Zelo subscription (returns from email-lookup). User can manage *another product's* subscription. `billing.ts:328-363`.
- **P1.27** — No gate on `/api/billing/checkout` against `incomplete` rows → duplicate Checkout sessions stack up. `billing.ts:218-224`.
- **P1.28** — `'trialing'` users locked out with no clear UI path; banner pushes them through Checkout creating a duplicate sub.
- **P1.29** — `'paused'` status falls through with no UI to unpause. Stripe portal allows pause by default — user can self-pause and can't recover.

## Frontend

- **P1.30** — Drag-and-drop status update has no rollback on backend failure (`AppShell.tsx:517-525, 563-566`, `useOrders.updateOrder` line 189). Card stays in wrong column forever.
- **P1.31** — `handleAddOrder` / `handleEditOrder` / `handleDeleteOrder` have no try/catch; uncaught throw into modal. `AppShell.tsx:527-543`.
- **P1.32** — Sign-up "verifique seu e-mail" screen has no resend / no retry / wipes the email field. `AuthPage.tsx:178-196`.
- **P1.33** — WS reconnect surfaces no UI signal; `waConnected` doesn't flip false on WS drop. `useWhatsAppSessions.ts:478-493`.
- **P1.34** — `syncConfigToServer` swallows all errors silently (`AppShell.tsx:455-465`); AI in production runs with stale config and operator never knows.
- **P1.35** — Quick-response edits use uncontrolled `defaultValue` + debounced save with no error feedback. `AIConfigsView.tsx:357-385`.
- **P1.36** — Trigger create/update/delete error handling silently swallows: `void updateTrigger().catch(()=>{})` everywhere. `AIConfigsView.tsx:468, 472, 485-487, 495-497`.
- **P1.37** — Paywall banner doesn't hide on `subscriptionLoading=true` initial flicker. `AppShell.tsx:573`.
- **P1.38** — OAuth callback timeout 8s — too short for slow connections. `OAuthCallbackPage.tsx:23`. No retry on `?error=oauth_failed`.
- **P1.39** — `useNotificationSound` resets `unlocked=false` on ONE failed `play()` — banner reappears forever.
- **P1.40** — Forms preserve nothing on session-expiry: user retypes everything.

## Database

- **P1.41** — `webhook_token` (migration 009) added but never used. Either wire it up or delete.
- **P1.42** — `zelochat_sessions (empresa_id, remote_jid)` UNIQUE not provable. Two simultaneous webhooks for new contact → two session rows.
- **P1.43** — `getAllSessions` does table scan + in-memory family grouping (`messageHandler.ts:287, 461`). Doesn't scale past a few thousand sessions.
- **P1.44** — `zelochat_increment_unread` RPC referenced but not in any migration.

---

# P2 — Medium (selected — full list in original agent reports)

- **P2.1** — Native `confirm()` / `alert()` for destructive actions in 8+ places. Inconsistent UX, untranslated on some browsers, jarring on mobile.
- **P2.2** — Modals lack `role="dialog"`, focus trap, return-focus, Escape close (only `PlanChangeModal` has Escape).
- **P2.3** — Mobile chat: `detailsOpen` panel `hidden md:flex` — operators on phones can't manually escalate or see escalation log.
- **P2.4** — Chat list `filteredSessions.map` is unvirtualized; SLA timer interval per row → tanks scroll at ~200+ chats.
- **P2.5** — `useOrders` opens a SECOND WebSocket without auth (`useOrders.ts:213-223`). Consolidate into main WS.
- **P2.6** — `AppShell.tsx` re-renders all views on every WS message; memoize.
- **P2.7** — Chat detail panel (`hidden md:flex`) means manual escalation is mouse-only on mobile.
- **P2.8** — Onboarding step 2 phone validator accepts 10-digit landlines as WhatsApp.
- **P2.9** — `SettingsView` "Exportar backup" downloads full `state` (chat history with phone numbers) as cleartext JSON — LGPD concern.
- **P2.10** — `Stripe` price IDs hardcoded as defaults in source (`billing.ts:54, 60`). Dev env without overrides charges production prices.
- **P2.11** — `priceBRL: 97/147` hardcoded in two places (backend + frontend constants). Stripe price change → UI shows wrong number.
- **P2.12** — `change-plan` doesn't surface 3DS/SCA challenge — generic "Erro ao processar pagamento".
- **P2.13** — `?billing=success` triggers `/api/billing/sync` without verifying `session_id`. Reflected-action sink (low impact since user can only sync own).
- **P2.14** — PII in logs (`billing.ts:170, 184, 549, 602, 637`): customer_id, email, last4. LGPD reporting concern.
- **P2.15** — `fetchInstanceQR` retry loop blocks event loop with 5s+ awaits inside response handler.
- **P2.16** — `messages.update` broadcasts without verifying message belongs to this empresa.
- **P2.17** — `extractText` silently drops unknown WhatsApp message types — log them.
- **P2.18** — Whisper transcription failure: AI sees `[Áudio]` placeholder, replies "não entendi", customer sends another audio (driving) → loop. No auto-escalation after N failures.
- **P2.19** — Pending-order TTL filtered correctly but expired rows never deleted; table grows unbounded.
- **P2.20** — `auto_reply` debounce of 1500ms allows cost runaway: customer sending msg every 2s triggers AI on every one.
- **P2.21** — Escalation race: in-flight reply can ship after `auto_reply=false` is set (`escalation.ts:200-208` vs `index.ts:87`).
- **P2.22** — `empresa_perfil.manager_history` JSONB grows unbounded.
- **P2.23** — Realtime publication on `zelochat_orders` — RLS-enforced, but the policy is uncommitted (per P0.23).
- **P2.24** — `super_admins` policy on `empresa_perfil` grants ALL ops to active super_admins. Audit pool quarterly; lock `super_admins` table itself from authenticated reads.
- **P2.25** — Profile picture URL stored verbatim; Whatsmiau URLs expire after 24-48h → broken images. Re-validate or proxy through Storage.

---

# P3 — Low

Selected highlights — full list in agent reports. Most are hardening / cosmetic / future-scale.

- WS `/ws?token=...` puts JWT in URL → proxy logs / browser history.
- `vite.config.ts` mixes `process.env` server concern into client config.
- `MessageBubble` audio duration estimation wrong for non-ogg.
- `Camera` button on `ProfileView.tsx:113` has no `onClick`.
- `landing-theme` body class can leak across page transitions.
- `/api/ai/complete` proxy and `generateAgentInstructions` have no rate limit.
- `ProfileView.tsx:99` doesn't await `signOut()` failure.
- `printer.print` failures only console.error — operator gets no notification.
- `useSubscription` doesn't react to JWT rotation (only `user.id`).
- `recentSentIds`/`recentlyHandled`/`justConfirmedMap` all in-memory — break on horizontal scale.
- `AIConfigsView` "Triggers personalizados" → "Gatilhos personalizados" for PT consistency.
- ChatView "Digite uma mensagem ou /macro" — "macro" is jargon.

---

# Cross-cutting themes

1. **Singletons + in-memory state assume one replica.** `boundEmpresaId`, `justConfirmedMap`, `consecutiveFailures`, `recentlyHandled`, `recentSentIds`, `configStore`, `hydratedAiSettings` — every one of these breaks correctness (not just performance) the moment Railway scales beyond a single instance. Document "must run single-replica" as a deployment invariant OR move them to Redis/DB.
2. **Service-role client + missing `.eq('empresa_id')` is a recurring leak class.** Service key bypasses RLS, so EVERY query needs explicit empresa-scoping. Two confirmed leaks (`ai.ts:415`, `escalation.ts:299/337`). Add a lint rule: any `getServiceSupabase().from(...)` chain MUST be followed by `.eq('empresa_id', ...)`.
3. **Errors silently swallowed everywhere on the frontend.** `void X.catch(()=>{})` in triggers, quick responses, drag-and-drop, sync-config, order delete. CLAUDE.md says "Never show raw errors — interpret them first" but the current code shows *nothing*.
4. **Schema drift between code and migrations.** Core tables, role CHECK widening, UNIQUE constraints, RPC function — all referenced in code but never committed as SQL. Bus factor 1.
5. **The "instance name as auth secret" model is brittle.** Names appear in logs, in Whatsmiau dashboard, in error reports. Migration 009 added `webhook_token` for this exact problem and then never wired it up.
6. **The "regex to detect customer intent" pattern is fragile.** Affirmative/negative for soft-confirm, hard-button text variants, audio placeholders. Each needs careful boundary handling and accent-folding; many today don't have it.

---

# Recommended fix sequence

Priority order assumes a small team and single-replica Railway today.

**Sprint 1 — revenue + correctness (1-3 days)**
1. P0.15, P0.16 — paywall middleware on `/api/*` + frontend gate → stop the revenue leak.
2. P0.9, P0.10 — anchor the affirmative/negative regex → stop wrong-confirms and wrong-cancels.
3. P0.11 — persist `last_confirmed_at` → stop duplicate-order regression on restart.
4. P0.20 — clear `localStorage` on logout → stop cross-tenant bleed.
5. P0.17 — fail-closed (with cache) on subscription DB error → close the silent paywall-disable path.

**Sprint 2 — schema in source control (1 day)**
6. P0.23 — `pg_dump --schema-only` → `000_initial_schema.sql`. Capture role CHECK, RLS policies, every constraint that exists. Without this, every other DB fix is unreviewable.

**Sprint 3 — webhook + idempotency (2-3 days)**
7. P0.1 — wire `webhook_token` (already in DB) into `/webhook/:instance`.
8. P0.14 — add `wa_message_id` UNIQUE → idempotent inserts. Closes P1.7 + P1 dup-replay together.
9. P0.5 — scope `zelochat-media` keys per empresa with random slugs; flip private; signed URLs.

**Sprint 4 — multi-tenant correctness (2 days)**
10. P0.2 — kill `boundEmpresaId` singleton; make `empresaId` mandatory.
11. P0.3 — `getEmpresaForInstance` no fallback on DB error.
12. P0.18 — Stripe `idempotencyKey` on Checkout creation.
13. P0.19 — never trust email lookup for portal; require `provider_customer_id`.

**Sprint 5 — observability + UX (3-5 days)**
14. Surface error states everywhere `void X.catch(()=>{})` exists today.
15. Replace native `confirm()` with the existing `ConfirmDelete` modal.
16. Mobile `detailsOpen` panel (manual escalate from phones).
17. Sign-up resend-email CTA.
18. WS reconnect indicator.

---

# What I didn't audit

- Tests folder — assumed coverage is light per CLAUDE.md tone.
- Vercel/Railway deployment configs beyond `vercel.json` and `railway.json` headers.
- ZeloPDV's webhook handler at `zelopdv.com.br/api/billing/webhook` — out of repo scope, but it OWNS your subscription state. Recommend a reconciler cron that scans `subscriptions` rows and re-fetches from Stripe every 15 min to detect divergence.
- The Stripe Billing Portal configuration — `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` controls whether users can self-pause/cancel. Audit in Stripe Dashboard, not in code.
- Production DB state — recommend running a one-shot script that asserts every `zelochat_*` table has RLS enabled and at least one policy scoped by `auth.uid()`.

---

*End of review.*
