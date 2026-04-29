# ZeloChat

WhatsApp-native customer service platform for Brazilian lanchonetes. All user-facing text, prompts, and seed data are in **Brazilian Portuguese**.

## Novidades changelog convention

**Não é todo commit/PR que vira entrada no changelog.** O Novidades é lido pelo dono da lanchonete — só entra o que **realmente muda a experiência dele** (novo recurso visível, correção de bug que ele sentiu, ajuste de comportamento da IA). Refactor interno, ajuste de copy de landing, mudança de infra, tweak de dev tooling, rename de variável, lint fix — **não vão pro changelog**. Na dúvida, não adiciona.

Linguagem: **sempre em português, sem jargão técnico.** Nada de "endpoint", "webhook", "RLS", "deploy", "migration", "schema", "API". Fale como se estivesse explicando pro dono da pizzaria no WhatsApp.

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
    geminiService.ts       # LEGACY — do not modify or expand
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
- **Auto-create on first QR**: se a empresa ainda não tem instância (`whatsmiau_instance = NULL`), o primeiro `/api/qr` cria uma chamada `zelo-{empresaId-first-8}`, persiste em `empresa_perfil` e registra o webhook `/webhook/{instance}` no Whatsmiau.
- **Legacy global lifecycle** (`fetchQR`, `disconnectWhatsApp`, `syncStatusFromUpstream` em `whatsapp.ts`) ainda existe pra rodar o auto-reconnect e health check da empresa "primary" (Donutopia). Os broadcasts WS dessas funções são escopados via `getBoundEmpresaId()` pra não vazar pra outros tenants.
- **Backfill**: a empresa Donutopia (única ativa no beta) recebeu `whatsmiau_instance = 'Comercial_d3c6ca80'` na migration. Outras empresas ficam NULL até clicarem em "Gerar QR Code" pela primeira vez.

## Database (Supabase)

Tables:
- `zelochat_sessions` — one row per WhatsApp JID per empresa. Columns: `id, empresa_id, remote_jid, customer_name, customer_phone, last_message, last_message_time, unread_count, status, auto_reply, updated_at`
- `zelochat_messages` — messages linked to a session. Columns: `id, empresa_id, session_id, role, content, sent_at`. **`role` CHECK constraint MUST allow `'user'`, `'assistant'`, `'tool'`, AND `'system'`.** See §"Order confirmation flow" below — narrowing this constraint silently breaks the entire order creation pipeline.
- `zelochat_drivers` — delivery drivers per empresa
- `empresa_perfil` — business profile (name, address, pix key, logo)
- `produtos` / `categorias` / `subcategorias` — **shared with ZeloPDV**. Same `auth.users` underlies both apps. ZeloChat writes here to add/edit products; changes reflect in ZeloPDV automatically. FKs: `produtos.id_categoria → categorias.id`, `produtos.id_subcategoria → subcategorias.id`, `subcategorias.id_categoria → categorias.id`. Multi-tenant by `id_usuario` (uuid, `auth.uid()`). RLS already scoped by `id_usuario`. Zero triggers.

Session "families": a contact may have multiple rows (different JIDs for same phone). `fetchSessionFamily` groups them by normalized phone key — always use it instead of querying by JID directly.

## Legacy / ignore (delivery module was abandoned)

Do NOT surface, write to, or reference these in ZeloChat UI / prompts:

- `produtos.visivel_delivery` — delivery-only flag, ignore
- `categorias_complementos`, `complementos`, `produtos_complementos_config` — addons/extras system for delivery; unused
- Any `delivery_*` prefixed tables — abandoned module
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

The `.env` checked into the repo points at the **production** Whatsmiau instance (`Comercial_d3c6ca80`). On startup, `server/whatsapp.ts` calls `setWebhook` with the local server's public URL — in dev that's a Cloudflare tunnel from `scripts/tunnel.js`. This **silently overwrites the production webhook URL on Whatsmiau**, redirecting all real customers' inbound messages to the dev machine. Outbound sends still work (they hit Whatsmiau directly), so the symptom is "app sends but receives nothing in prod" — not an obvious failure.

When this happens, recover with:

```bash
curl -X POST "https://api.whatsmiau.dev/webhook/set/Comercial_d3c6ca80" \
  -H "apikey: $WHATSMIAU_API_KEY" -H "Content-Type: application/json" \
  -d '{"webhook":{"enabled":true,"url":"https://zelochat-production.up.railway.app/webhook","webhookByEvents":false,"webhookBase64":true,"events":["MESSAGES_UPSERT","MESSAGES_UPDATE","MESSAGES_DELETE","CONNECTION_UPDATE","CONTACTS_UPSERT"]}}'
```

A Railway redeploy also fixes it (prod re-registers its own URL on startup).

**Before running any local dev command that boots the backend** (`npm run dev:server`, `npm run dev:all`, `npx tsx server/index.ts`, integration tests that import `server/whatsapp.ts`):

- **Recommended:** set `WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1` in your local `.env`. The guard is wired in `server/whatsapp.ts → registerWebhook()` — when set to `1`/`true`/`yes`, startup logs `[whatsapp] webhook register skipped (WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1)` and skips ALL calls to `setWebhook`. Outbound sends still work; the production webhook URL on Whatsmiau stays untouched.
- Alternative: use a separate sandbox Whatsmiau instance + API key for dev — do not reuse the prod ones.
- Alternative: temporarily clear `WHATSMIAU_API_KEY` / `WHATSMIAU_INSTANCE` before booting the local server.

In production (Railway), leave `WHATSMIAU_DISABLE_WEBHOOK_REGISTER` unset (or `0`) so the deploy registers its own webhook URL on startup.

## Billing — Stripe paywall (R$97/mês plano `chat`)

ZeloChat compartilha conta Stripe e tabela `subscriptions` com ZeloPDV. Webhook fica em `zelopdv.com.br/api/billing/webhook` (já trata `plan_tier='chat'`/`'bundle'`). ZeloChat só CRIA Checkout sessions e abre Customer Portal via:

- `POST /api/billing/checkout` → `{ planTier: 'chat'|'bundle' }` → retorna `{ url }` (Stripe Checkout). NO TRIAL.
- `POST /api/billing/portal` → `{ url }` (Stripe Billing Portal — cancel/cartão/invoices)
- `POST /api/billing/sync` → fallback chamado pelo frontend após `?billing=success` se webhook tá lento

Source: `server/billing.ts`. Front: `SubscriptionPaywall` + `BillingManagementCard` em `SettingsView.tsx`. AppShell detecta `?billing=success|canceled|portal-return` e força sync + refresh.

**Env vars no Railway** (backend) — runbook completo em `BILLING.md`:
- `STRIPE_SECRET_KEY` (obrigatório, mesma do ZeloPDV)
- `PUBLIC_APP_URL=https://chat.zelopdv.com.br` (obrigatório, return URLs)
- `STRIPE_PRICE_CHAT` / `STRIPE_PRICE_BUNDLE` (opcional, defaults hardcoded)

`requireActiveZelochatSubscription()` em `server/supabase.ts` rejeita `'trialing'` propositalmente — política produto é "sem teste grátis".

## UI conventions

- **Nunca usar dados mockados** em placeholders ou textos visíveis — use padrões genéricos como `(XX) XXXXX-XXXX`
- Placeholders devem descrever o formato, não simular dados reais
- `formatPhoneDisplay()` em `App.tsx` formata qualquer número bruto para exibição — usar em todo lugar que exibe telefone

## Architecture rules

- `src/domain/` has zero React or AI dependencies — keep it that way
- Never call AI APIs from React components — always go through `/api/ai/complete`
- Never import Baileys/server code from the frontend — use REST API or WebSocket
- `geminiService.ts` is legacy — do not modify or expand
- All chat state mutations go through `useWhatsAppSessions` hook — never mutate `sessions` directly in `App.tsx`
- Delete operations must hit the backend first (or optimistic update + rollback on error)
