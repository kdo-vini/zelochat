# ZeloChat

WhatsApp-native customer service platform for Brazilian lanchonetes. All user-facing text, prompts, and seed data are in **Brazilian Portuguese**.

> **Sprint atual / foco do momento:** ver [[CURRENT]] antes de qualquer tarefa.

## 📖 Required reading before any non-trivial change

This repo has FOUR companion docs at the project root that capture context not visible from the code alone. **Read them before touching anything customer-facing or anything tagged "CRITICAL":**

1. **[[CODE_REVIEW]]** — Senior-tier audit of the codebase (24 P0 / 47 P1 / 38 P2 / 24 P3). Each finding has file:line, repro steps, customer impact, and proposed fix. This is the source-of-truth catalog of known issues.
2. **[[FIXES_PROGRESS]]** — Live tracker of which audit findings are SHIPPED, DRAFTED, BLOCKED, or PENDING. Every fix entry links to the files that changed. Update this whenever you ship a fix or draft a migration.
3. **[[BILLING]]** — Stripe/Asaas runbook. Subscription state, plan tiers, the cross-product (ZeloPDV) shared `subscriptions` table.
4. **[[INCIDENTS]]** — Outage runbook. Symptoms → known root causes → recovery steps for every production incident we've already fixed. **First stop when something looks broken in prod.** Update after every new outage so the next person doesn't re-debug it.

Plus the two §sections in this file ("Shared database with ZeloPDV" and "Critical functions — touch with extreme care") — those are non-obvious tribal knowledge that breaking will cost real customer money.

If you're an AI agent or new dev opening the repo for the first time: read those four docs in order before doing anything else. The audit alone took six senior reviewers ~40k tokens to produce — re-running that work is wasteful and the findings haven't been re-litigated.

## Novidades changelog convention

**Não é todo commit/PR que vira entrada no changelog.** O Novidades é lido pelo dono da lanchonete — só entra o que **realmente muda a experiência dele** (novo recurso visível, correção de bug que ele sentiu, ajuste de comportamento da IA). Refactor interno, ajuste de copy de landing, mudança de infra, tweak de dev tooling, rename de variável, lint fix — **não vão pro changelog**. Na dúvida, não adiciona.

Linguagem: **sempre em português, sem jargão técnico.** Nada de "endpoint", "webhook", "RLS", "deploy", "migration", "schema", "API". Fale como se estivesse explicando pro dono da pizzaria no WhatsApp.

Volume: o changelog deve ser enxuto. Não crie uma entrada para cada commit pequeno. Use no máximo **4 entradas por dia**, consolidando várias melhorias relacionadas em uma entrada clara quando fizer sentido.

Quando for entrada válida, adicione no **topo** de `src/data/changelog.ts`.

```ts
{
  date: 'YYYY-MM-DD',         // today's date
  category: 'big' | 'medium' | 'minor' | 'hotfix',
  title: 'Título em português', // user-friendly, no tech jargon
  description: 'Uma frase clara sobre o que mudou e por que o operador vai gostar.',
}
```

Categories:
- `big` — new major feature visible to the end-user (highlighted card in Novidades)
- `medium` — meaningful improvement or new capability
- `minor` — small polish, copy change, or UX tweak
- `hotfix` — urgent bug fix that broke something in production

## Deploy

Production runs on **Dokploy**, linked directly to the `main` branch on GitHub (`kdo-vini/zelochat`). **Every push to `main` triggers an automatic redeploy** — no manual step needed, no GitHub Actions required. Docker build + container restart typically takes 2–5 minutes after the push lands. Do not tell the user to "manually trigger Dokploy" — it happens automatically on push.

URL: `https://chat.zelopdv.com.br`

## Commands

```bash
npm run dev          # Frontend only — Vite on port 3000
npm run dev:server   # Backend only — Express on port 3001
npm run dev:all      # Both concurrently
npm run build        # Production build
npm run lint         # TypeScript type-check (tsc --noEmit)
```

## Architecture

```
src/
  App.tsx                  # Root component — all global state lives here
  types.ts                 # Shared TypeScript types (ZeloState, ChatSession, etc.)
  domain/chat.ts           # Pure utilities: normalizePhoneNumber, formatPhone, JID helpers
  hooks/
    useWhatsAppSessions.ts # WebSocket + REST — source of truth for chat sessions
    useSupabaseSession.ts  # Auth (Supabase JWT token)
    useProdutos.ts         # Products from Zelo PDV API
    useDrivers.ts          # Delivery drivers (Supabase)
    useEmpresaPerfil.ts    # Business profile (Supabase)
  services/
    waApi.ts               # All REST calls to /api/* (sessions, send, delete, etc.)
    openaiService.ts       # AI proxy calls via /api/ai/complete
    zeloApi.ts             # Zelo PDV product mapping
    statePersistence.ts    # localStorage state save/load
  components/views/        # One file per nav view (DashboardView, KanbanView, etc.)

server/
  index.ts        # Express entry point, WebSocket wiring, auto-reply debounce
  router.ts       # All API routes (/api/sessions, /api/send, /api/drivers, etc.)
  messageHandler.ts # Supabase read/write for sessions and messages
  whatsapp.ts     # Whatsmiau (Evolution v2) — send fns + bound-empresa lifecycle
  instanceManager.ts # Multi-tenant: empresaId ↔ Whatsmiau instance lookup + create/delete
  ws.ts           # WebSocket broadcast to frontend
  ai.ts           # OpenAI reply generation
  supabase.ts     # Supabase service client + empresa auth
  configStore.ts  # In-memory business config (synced from frontend)
  drivers.ts      # Driver CRUD against Supabase
```

## Stack

- **Frontend**: React + Vite + TypeScript + Tailwind + Motion (framer)
- **Backend**: Express + Whatsmiau (Evolution v2 API) + tsx (watch mode)
- **Database**: Supabase (PostgreSQL)
- **AI**: OpenAI (gpt-4o-mini) via server-side proxy
- **Auth**: Supabase JWT — token passed as `Authorization: Bearer` to all `/api/*` calls

## Multi-instância Whatsmiau (P0-02 + P1-01)

Cada empresa tem sua própria instância Whatsmiau. Mapeamento em `empresa_perfil.whatsmiau_instance` (TEXT, UNIQUE quando não-NULL).

- **Resolução de instância no SEND**: todas as funções de envio em `server/whatsapp.ts` (`sendTextMessage`, `sendButtonMessage`, `sendMediaMessage`, etc.) aceitam um `empresaId?: string | null` opcional. Internamente chamam `resolveInstance(empresaId)` que delega ao `instanceManager.getInstanceForEmpresa()`. Se `empresaId` não vier (ou empresa ainda não tem instância), cai no `WHATSMIAU_INSTANCE` do env (legacy single-tenant — mantém o beta atual rodando).
- **Webhook por instância**: `POST /webhook/:instance` resolve `empresaId` via `instanceManager.getEmpresaForInstance(instance)`. Whatsmiau registra a URL `${PUBLIC_URL}/webhook/${instance}` para cada empresa nova. A rota legacy `POST /webhook` (apikey-header auth) continua funcionando pra empresas antigas.
- **`instanceManager.ts`** expõe: `getInstanceForEmpresa`, `getOrCreateOwnInstanceForEmpresa`, `getEmpresaForInstance`, `createInstance`, `deleteInstance`, `setConnectionState`. Cache em memória com TTL 60s.
- **Connection lifecycle (status/QR/disconnect) é per-empresa** desde P1-01. As rotas `/api/status`, `/api/qr`, `/api/qr/refresh` e `/api/whatsapp/disconnect` exigem JWT e usam `getOrCreateOwnInstanceForEmpresa()` — nunca caem no FALLBACK_INSTANCE de outra empresa. Helpers em `whatsapp.ts`: `fetchInstanceConnectionState`, `fetchInstanceQR`, `logoutInstance`, `setWebhookForInstance`.
- **Auto-create on first QR**: se a empresa ainda não tem instância (`whatsmiau_instance = NULL`), o primeiro `/api/qr` cria uma chamada `zelo-{empresaId-first-8}-{16hex-random}`, persiste em `empresa_perfil` e registra o webhook `/webhook/{instance}` no Whatsmiau. O sufixo aleatório de 16 hex (64 bits) é o auth boundary efetivo — ver §"Webhook auth boundary" abaixo.

### Webhook auth boundary — URL-as-secret (post-P0.1 investigation)

Investigação em 2026-04-29 (commit 8b367c4 com diagnóstico `WEBHOOK_DEBUG_HEADERS`) provou que **Whatsmiau v2 aceita o campo `headers.apikey` em `/webhook/set/{instance}` (visível em GET) mas não forwarda esse header nas entregas reais.** Bug deles, sem ETA. Logo, `WEBHOOK_REQUIRE_TOKEN=1` (strict mode) NÃO É VIÁVEL — flipar agora 401 100% do tráfego legítimo.

**Auth boundary efetivo hoje: o nome da instância no path da URL.**
- **Instâncias novas**: `zelo-{empresaId8}-{16hex}` = 64 bits de entropia → unguessable. Suporta escala nacional.
- **Instâncias legacy (pré-rotação)**: formato `zelo-{empresaId8}` sem sufixo aleatório. Enumeráveis a partir do UUID da empresa. **Devem ser rotacionadas** (deletar + recriar via fluxo normal de `/api/qr`).
- **Auth via `?token=` na URL está ATIVA.** `/webhook/:instance` extrai o token do query param (Whatsmiau não forwarda o header `apikey`, mas respeita a URL completa). O token deve estar presente na URL registrada — `server/index.ts` garante isso no startup. `WEBHOOK_ALLOW_MISSING_TOKEN_DURING_ROLLOUT=1` é um escape de emergência para rollouts.

**NÃO regenere a coluna `webhook_token` em `empresa_perfil`** — é o segredo que autentica o webhook via `?token=` na URL. Manter estável; nunca expor em logs.
- **Legacy global lifecycle** (`fetchQR`, `disconnectWhatsApp`, `syncStatusFromUpstream` em `whatsapp.ts`) ainda existe pra rodar o auto-reconnect e health check de empresas single-tenant. Os broadcasts WS dessas funções são escopados via `getBoundEmpresaId()` pra não vazar pra outros tenants.
- No startup multi-tenant, `server/index.ts` re-registra os webhooks de todas as instâncias ativas para garantir que o `?token=` esteja sempre na URL registrada no Whatsmiau.

## Database (Supabase)

Tables:
- `zelochat_sessions` — one row per WhatsApp JID per empresa. Columns: `id, empresa_id, remote_jid, customer_name, customer_phone, last_message, last_message_time, unread_count, status, auto_reply, updated_at`
- `zelochat_messages` — messages linked to a session. Columns: `id, empresa_id, session_id, role, content, sent_at`. **`role` CHECK constraint MUST allow `'user'`, `'assistant'`, `'tool'`, AND `'system'`.** See §"Order confirmation flow" below — narrowing this constraint silently breaks the entire order creation pipeline.
- `zelochat_drivers` — delivery drivers per empresa
- `empresa_perfil` — business profile (name, address, pix key, logo)
- `produtos` / `categorias` / `subcategorias` — **shared with ZeloPDV**. Same `auth.users` underlies both apps. ZeloChat writes here to add/edit products; changes reflect in ZeloPDV automatically. FKs: `produtos.id_categoria → categorias.id`, `produtos.id_subcategoria → subcategorias.id`, `subcategorias.id_categoria → categorias.id`. Multi-tenant by `id_usuario` (uuid, `auth.uid()`). RLS already scoped by `id_usuario`. Zero triggers.

Session "families": a contact may have multiple rows (different JIDs for same phone). `fetchSessionFamily` groups them by normalized phone key — always use it instead of querying by JID directly.

## 🛑 Shared database with ZeloPDV — what we MUST NOT touch from this repo

ZeloChat and ZeloPDV are two separate apps that **share one Supabase project** (`xnnjyrblpvsqrtsshawa`). Same `auth.users`, same database, same migrations log. Changing schema from this repo that's owned by ZeloPDV will silently break the other product — and there is no test environment that covers both at once.

### Tables we OWN (safe to migrate from this repo)
- `zelochat_sessions`, `zelochat_messages`, `zelochat_drivers`, `zelochat_orders`,
  `zelochat_triggers`, `zelochat_quick_responses`, `zelochat_pending_orders`,
  `zelochat_escalation_events`
- ZeloChat-specific COLUMNS added to `empresa_perfil` (e.g. `whatsmiau_instance`, `webhook_token`, `ai_enabled`, `manager_phone`, `chave_pix`, `notify_customer_*`, `delivery_config`, `manager_history`, `blocked_dates`, `zelochat_onboarding_done`, `zelochat_disabled_builtin_triggers`, `ai_can_reengage_pending`, `ai_instructions`, `horario_*`, `dias_fechamento`)
- `zelochat-media` storage bucket and its policies
- `zelochat_increment_unread` and `zelochat_orders_set_updated_at` functions

### Tables we DO NOT OWN (NEVER ALTER from this repo)
- **`empresa_perfil`** the table itself, its primary key, its `user_id` FK, and PDV-only columns (`nome_exibicao`, `documento`, `endereco`, `contato`, `timezone`, `logo_url`, `rodape_recibo`, `largura_bobina`, `modulo_pdv_ativo`, `modulo_delivery_ativo`, `pin_admin`, `razao_social`, `plataformas_pagamento`, `last_seen_at`, `onboarding_completed`, `tipo_negocio`). We can ADD columns; we cannot DROP or ALTER theirs.
- **`subscriptions`** — owned by ZeloPDV's webhook handler. Schema, CHECK constraints (`plan_tier`, `status`), RLS. We READ; we never DDL.
- **`super_admins`** — admin pool. ZeloPDV-owned.
- **`produtos`, `categorias`, `subcategorias`** — shared catalog. ZeloChat reads + writes ROWS, but the SCHEMA is ZeloPDV's. Multi-tenant via `id_usuario` (note: PDV uses `id_usuario`, not `empresa_id` — different convention).
- **`vendas*`, `caixas*`, `caixa_*`, `pessoas`, `expenses`, `vendas_pagamentos`, `mesas`, `comandas*`, `email_*`, `subscription_cron_logs`, `admin_activity_logs`** — PDV/admin only.
- **`auth.*` schema** — Supabase platform.
- **`storage.*` schema (objects/buckets table itself)** — Supabase platform; we add policies + buckets, never alter the platform tables.

### Why this matters
Adding `ALTER TABLE empresa_perfil DROP COLUMN ...` from here, or attempting to add a new RLS policy with a name that ZeloPDV already uses, or applying a migration that resets ZeloPDV's `subscriptions_status_check` constraint, will cause one of:
- ZeloPDV's billing webhook handler stops writing rows (revenue lost on PDV side)
- PDV operators can't read their own catalog (RLS misalignment)
- Migration history desyncs and `supabase db reset` produces a different schema than prod
- Worst case: data loss on a column we didn't realize was load-bearing for PDV

### Workflow when you need to change a shared table
1. Open an issue in the ZeloPDV repo describing the change and why ZeloChat needs it.
2. Land the migration in ZeloPDV first.
3. Pull the resulting prod schema back into ZeloChat's `000_zelochat_schema.sql` snapshot via `pg_dump` or the Supabase MCP.
4. Never run a migration from THIS repo against shared tables.

## 🚨 Critical functions — touch with extreme care

These functions are CRITICAL for product correctness. Each one has caused (or has the potential to cause) a customer-visible outage if broken. Inline docs in the source explain the chain effect; this index is just the master list.

| Function | Location | Why it's critical |
|---|---|---|
| `generateAndSendReply` | `server/ai.ts` | The AI dispatch entry point. Bad changes here = duplicate orders, wrong-confirms, prompt-injection. The 3-layer trap from §"Order confirmation flow" lives here. |
| `confirmPendingOrder` / `cancelPendingOrder` / `clearPendingOrder` | `server/ai.ts` | The pending-order lifecycle. The order between insert/clear/send is load-bearing — see "FIX H1" comment in `confirmPendingOrder`. |
| `dispatchIncomingMessage` and the hard-button short-circuit | `server/router.ts` | Layer 3 of the order-flow trap. Every customer reply path passes through here. |
| `processWebhookEvent` and `/webhook/:instance` | `server/router.ts` | Auth boundary for inbound WhatsApp. Currently relies on instance name as secret (P0.1) — rotation/dedup decisions land here. |
| `requireActiveZelochatSubscription` / `isEmpresaSubscriptionActive` / `resolveActiveSubscription` | `server/supabase.ts` | The paywall + the cache. Failing OPEN here = silent revenue leak across the fleet. |
| `getEmpresaForInstance` / `getInstanceForEmpresa` / `createInstance` | `server/instanceManager.ts` | Multi-tenant routing. A stale cache hit = cross-tenant message leak. |
| `getOrCreateSession` / `appendMessage` / `addToolMessage` | `server/messageHandler.ts` | Message persistence. Every helper defaulting `empresaId = getBoundEmpresaId()` is a cross-tenant hazard once a 2nd customer onboards. |
| The paywall middleware in `server/index.ts` | `server/index.ts:42` | Guards every `/api/*` route. Adding a bypass to the exempt list without thinking through the abuse vector = revenue leak. |
| `clearLocalAppState` (logout) | `src/services/authService.ts` | If new `zelochat_*`-prefixed localStorage keys are introduced, they MUST be wiped here, or the cross-tenant leak via shared device returns. |

When changing any of these, follow the rule: read CLAUDE.md → read CODE_REVIEW.md → read the existing inline docstring → walk through ONE customer scenario in your head before editing.

## Legacy / ignore

- `subscription*` tables — belong to ZeloPDV's paid tier, ZeloChat has its own pricing (§Pricing)

When building product CRUD, stick to: `nome`, `preco`, `id_categoria`, `id_subcategoria`, `controlar_estoque`, `estoque_atual`, `eh_item_por_unidade`, `ocultar_no_pdv`. For anything more granular, direct the user to [zelopdv.com.br](https://zelopdv.com.br) rather than replicating the full PDV admin.

## Environment

```
OPENAI_API_KEY      # Required for AI auto-reply
SERVER_PORT         # Baileys/Express port (default 3001)
FRONTEND_URL        # CORS allowed origin (default http://localhost:3000)
VITE_SUPABASE_URL   # Supabase project URL (frontend)
VITE_SUPABASE_ANON_KEY  # Supabase anon key (frontend)
SUPABASE_URL        # Supabase project URL (server)
SUPABASE_SERVICE_KEY    # Supabase service role key (server)
```

## Whatsmiau API (Evolution API v2 wrapper)

Base URL: `https://api.whatsmiau.dev` — docs: `https://whatsmiau.dev/docs`

**Sending media** — `POST /message/sendMedia/{instance}`:
```json
{ "number": "5511999998888", "mediatype": "image", "media": "https://public-url.com/file.jpg", "caption": "Texto", "mimetype": "image/jpeg", "fileName": "foto.jpg" }
```
- `media` **must be a public HTTPS URL** — base64 strings are NOT accepted (treated as URL → 503/500)
- Flow: upload to Supabase Storage (`zelochat-media` bucket, public) → get public URL → send URL → auto-delete after 10 min
- `mediatype`: `"image"` | `"document"` | `"audio"` | `"video"`

**Receiving media** — webhook with `webhookBase64: true`:
- Whatsmiau embeds base64 in the payload at `data.base64` (or `data.message.imageMessage.base64` as fallback)
- Reconstruct as `data:${mimeType};base64,${raw}` for storage/display

**Webhook** — `POST /webhook/set/{instance}`:
```json
{ "webhook": { "enabled": true, "url": "https://...", "webhookByEvents": false, "webhookBase64": true, "events": ["MESSAGES_UPSERT","CONNECTION_UPDATE","CONTACTS_UPSERT"] } }
```

**Sending audio (PTT)** — `POST /message/sendWhatsAppAudio/{instance}` (different endpoint!):
```json
{ "number": "5511999998888", "audio": "https://public-url.com/voice.mp3", "encoding": true }
```
- Field is `audio`, NOT `media` — sending audio through `sendMedia` with `mediatype:"audio"` is wrong
- Same URL-only constraint: upload to Supabase Storage first, then send URL
- `encoding: true` re-encodes before sending (recommended for compatibility)

**Sending text** — `POST /message/sendText/{instance}`: `{ "number": "...", "text": "..." }`

## WhatsApp gotchas

- **JID format**: `{countryCode+number}@s.whatsapp.net` — e.g. `5514998360854@s.whatsapp.net`. Always include country code (55 for Brazil).
- **Brazilian numbers**: 10–11 digits without DDI → auto-prefix `55` before building JID. Never trust a raw local number as a JID.
- **Phone formatting**: `formatPhone` in `messageHandler.ts` formats `5514XXXXXXXXX` → `(14) XXXXX-XXXX`. Only works for 11-digit local numbers after stripping `55`.
- **Profile pictures**: Whatsmiau returns the URL on `res.data.profilePictureUrl`; wrap fetches in try/catch — private photos throw.
- **Legacy Baileys auth folder**: `server/whatsapp.ts` wipes `auth_info_baileys/` on connect as a safety net so a stale local `creds.json` can never silently re-auth. Folder is gitignored — fine to leave or delete locally.

## 🛑 Order confirmation flow — DO NOT BREAK (cost two days of debugging)

The order pipeline is layered. All three layers must hold or duplicate orders return:

1. **`zelochat_messages.role` CHECK constraint allows `'tool'` and `'system'`.** When the AI calls `criar_pedido`, the happy path executes `addToolMessage(role='tool', …)` to persist the audit trail. If the constraint rejects `'tool'`, the insert throws — and crucially that throw is caught by the same `try` block that wraps `sendButtonMessage`. The code can't tell "buttons failed" from "DB rejected the audit row," so it falls into the catch-fallback path. This is what caused the original duplicate-order bug: every order was double-inserted because the audit insert was throwing on every successful send.
   - The fix migration is `allow_tool_and_system_roles_in_zelochat_messages`.
   - If you ever see `zelochat_messages_role_check` in a server log, drop everything and widen the constraint immediately.

2. **`server/ai.ts` `criar_pedido` catch-fallback must NEVER call `createOrderInDb` or `clearPendingOrder`.** The fallback (when `sendButtonMessage` truly fails) keeps the pending row in place and sends a "responda *Sim* / *Não*" text. Auto-creating the order here is what caused the duplicate: customer saw the buttons (delivered despite the throw), tapped Confirmar, the pending was already cleared, and the click leaked into the AI which re-ran `criar_pedido`.

3. **`server/router.ts` hard button clicks (`CONFIRM_ORDER` / `CANCEL_ORDER` button-id OR exact-match text) MUST short-circuit `dispatchIncomingMessage()` even when no pending order exists.** Reply idempotently ("Seu pedido já foi confirmado!"). If a button click ever reaches the AI as freeform input, the AI will create a new order from scratch.

If you change ANY of these three layers, manually walk through the duplicate-order screenshot in the issue history and verify the fix still holds. Do not trust unit tests alone — the bug only surfaces with the full webhook → AI → DB chain.

## ⚠️ Local dev steals the production webhook (read before running `npm run dev:server`)

The `.env` checked into the repo may point at a production Whatsmiau instance. On startup, `server/whatsapp.ts` calls `setWebhook` (single-tenant) or `setWebhookForInstance` (multi-tenant) with the local server's public URL — in dev that's a Cloudflare tunnel from `scripts/tunnel.js`. This **silently overwrites the production webhook URL on Whatsmiau**, redirecting all real customers' inbound messages to the dev machine. Outbound sends still work (they hit Whatsmiau directly), so the symptom is "app sends but receives nothing in prod" — not an obvious failure.

When this happens, a Dokploy redeploy of the backend fixes it (prod re-registers its own URL on startup with the correct `?token=`).

**Before running any local dev command that boots the backend** (`npm run dev:server`, `npm run dev:all`, `npx tsx server/index.ts`, integration tests that import `server/whatsapp.ts`):

- **Recommended:** set `WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1` in your local `.env`. The guard is wired in `server/whatsapp.ts → registerWebhook()` — when set to `1`/`true`/`yes`, startup logs `[whatsapp] webhook register skipped (WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1)` and skips ALL calls to `setWebhook`. Outbound sends still work; the production webhook URL on Whatsmiau stays untouched.
- Alternative: use a separate sandbox Whatsmiau instance + API key for dev — do not reuse the prod ones.
- Alternative: temporarily clear `WHATSMIAU_API_KEY` / `WHATSMIAU_INSTANCE` before booting the local server.

In production (Dokploy), leave `WHATSMIAU_DISABLE_WEBHOOK_REGISTER` unset (or `0`) so the deploy registers its own webhook URL on startup. Also set `PUBLIC_APP_URL=https://chat.zelopdv.com.br` (or `WEBHOOK_PUBLIC_URL`) so `getPublicWebhookUrl()` resolves to the public domain — without it, the backend falls back to `http://localhost:3001` and Whatsmiau registrations fail.

## Billing — Stripe paywall (R$97/mês plano `chat`)

ZeloChat compartilha conta Stripe e tabela `subscriptions` com ZeloPDV. Webhook fica em `zelopdv.com.br/api/billing/webhook` (já trata `plan_tier='chat'`/`'bundle'`). ZeloChat só CRIA Checkout sessions e abre Customer Portal via:

- `POST /api/billing/checkout` → `{ planTier: 'chat'|'bundle' }` → retorna `{ url }` (Stripe Checkout). NO TRIAL.
- `POST /api/billing/portal` → `{ url }` (Stripe Billing Portal — cancel/cartão/invoices)
- `POST /api/billing/sync` → fallback chamado pelo frontend após `?billing=success` se webhook tá lento

Source: `server/billing.ts`. Front: `SubscriptionPaywall` + `BillingManagementCard` em `SettingsView.tsx`. AppShell detecta `?billing=success|canceled|portal-return` e força sync + refresh.

**Env vars no Dokploy** (backend) — runbook completo em `BILLING.md`:
- `STRIPE_SECRET_KEY` (obrigatório, mesma do ZeloPDV)
- `PUBLIC_APP_URL=https://chat.zelopdv.com.br` (obrigatório, return URLs)
- `STRIPE_PRICE_CHAT` / `STRIPE_PRICE_BUNDLE` (obrigatórios; sem fallback hardcoded para evitar usar price de produção em dev)

`requireActiveZelochatSubscription()` em `server/supabase.ts` rejeita `'trialing'` propositalmente — política produto é "sem teste grátis".

## Ciclo de vida de instâncias Whatsmiau (JÁ IMPLEMENTADO)

Dois sweepers rodam em background e limpam instâncias órfãs automaticamente:

**`server/subscriptionSweeper.ts`** — assinatura cancelada/expirada:
- Roda 5min após startup + a cada 6h
- Grace period: **7 dias** após expiração. Passado esse prazo, chama `deleteInstance()`.
- Provider-agnostic: tanto Stripe quanto AbacatePay/Pix escrevem na mesma tabela `subscriptions`. O check é `status='active' AND current_period_end > now` — uma assinatura Pix expirada (status='active' mas period_end no passado) é capturada corretamente.
- Dados do cliente (mensagens, sessões, pedidos) são preservados. Só a instância Whatsmiau some.
- Se o cliente renovar depois do grace, `/api/qr` cria a instância nova automaticamente.

**`server/accountDeletionSweeper.ts`** — deleção de conta:
- Roda 3min após startup + a cada hora
- Após 14 dias de grace (`DELETE /api/account` stampa `deletion_scheduled_at`): cancela Stripe (no-op para clientes Pix — cobrança única, sem recorrência), deleta instância Whatsmiau, limpa storage, executa RPC `delete_account` (purga tudo).

## Notificações de status de pedido (JÁ IMPLEMENTADO)

Quando o dono arrasta um card no Kanban, o cliente **já recebe WhatsApp automático** — NÃO é um gap. As flags `notify_customer_preparing`, `notify_customer_ready` e `notify_customer_out_for_delivery` ficam em `empresa_perfil`. A lógica de envio está em `server/router.ts` na rota `PATCH /api/orders/:id/status` (~linha 1484). O texto enviado por status está hard-coded no mesmo bloco. As flags são configuráveis pelo Gerente IA via `SET_CUSTOMER_NOTIFICATION` em `server/managerAssistant.ts`.

## Estoque no cardápio

Produtos com `controlar_estoque = true` exibem badge de estoque colorido na `CatalogView`: verde (>5), âmbar (1–5), vermelho (0 = "Sem estoque"). Produtos sem controle de estoque não mostram nada. O campo `estoque_atual` já é lido pelo `useCatalog.ts`. A baixa de estoque quando um pedido do ZeloChat é confirmado **ainda não está implementada** — deve ser feita via RPC do ZeloPDV (coordenar com o repo do ZeloPDV antes de implementar, pois o schema de `produtos` é deles).

## Histórico do cliente (abordagem planejada, não implementada)

Para memória cross-conversation da IA, a abordagem planejada é: manter um campo de resumo minimalista no perfil do cliente (provavelmente em `zelochat_sessions` ou nova tabela) com até X caracteres, que a IA sobrepõe/atualiza incrementalmente a cada conversa. Não é um log completo — é um "perfil vivo" comprimido. Ainda não implementado.

## Web Push / PWA notifications

Service worker em `public/sw.js`, registrado pelo `src/main.tsx` apenas em build prod. Inscrições ficam em `zelochat_push_subscriptions` (uma linha por browser/dispositivo opt-in). Disparos saem do `server/push.ts → sendPushToEmpresa()`, chamado pelo `server/index.ts` logo após `handleIncomingMessage()` resolver `persisted=true`. O SW só mostra o banner se nenhuma aba ZeloChat está visível — a checagem é dentro do `push` handler.

**Setup em produção (uma vez)**:
1. Gerar par VAPID: `npx web-push generate-vapid-keys`
2. Set no Dokploy backend: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:contato@zelopdv.com.br`
3. Aplicar migração `supabase/migrations/039_zelochat_push_subscriptions.sql` no Supabase

Sem essas envs, `/api/push/vapid-public-key` retorna `{enabled:false}` e o banner some — degradação silenciosa, nada quebra.

## UI conventions

- **Nunca usar dados mockados** em placeholders ou textos visíveis — use padrões genéricos como `(XX) XXXXX-XXXX`
- Placeholders devem descrever o formato, não simular dados reais
- `formatPhoneDisplay()` em `App.tsx` formata qualquer número bruto para exibição — usar em todo lugar que exibe telefone

## Architecture rules

- `src/domain/` has zero React or AI dependencies — keep it that way
- Never call AI APIs from React components — always go through `/api/ai/complete`
- Never import Baileys/server code from the frontend — use REST API or WebSocket
- All chat state mutations go through `useWhatsAppSessions` hook — never mutate `sessions` directly in `App.tsx`
- Delete operations must hit the backend first (or optimistic update + rollback on error)

## Documentação — convenção AI-first

Toda IA que trabalhar neste repo **deve manter a documentação automaticamente**. Não é opcional — é o que permite que a próxima IA (ou dev) entre sem perguntar nada.

### Após qualquer fix ou feature
- **[[FIXES_PROGRESS]]**: adicionar entrada na sprint do dia. Formato: `- ✅ <ID> — <o que era> → <o que foi feito> — \`arquivo:linha\``
- **[[CURRENT]]**: atualizar "Em aberto" se o fix fecha algo listado lá

### Após fix crítico em prod (P0/P1 ou que causou outage visível)
- **[[INCIDENTS]]**: nova entrada com: Sintoma (1 linha), Causa-raiz (1 frase), Fix (1 frase + arquivo:linha)
- Comentário inline na função crítica: `// FIX YYYY-MM-DD: <causa em 1 frase> → <fix em 1 frase>`

### Feature entregue
- Deletar o arquivo de spec da feature (specs são temporários, o código é a verdade)
- Se o comportamento for não-óbvio, documentar em CLAUDE.md ou no arquivo relevante

### Início de qualquer sessão de trabalho
1. Ler **[[CURRENT]]** — entender o foco atual
2. Se o foco mudou, atualizar **[[CURRENT]]** antes de começar
3. Para mudanças em funções listadas em "Critical functions", ler o inline docstring completo antes de tocar

### Regra de ouro
> Documentação que não existe não será lembrada. Se você fez algo não-óbvio, documenta agora — não depois.
