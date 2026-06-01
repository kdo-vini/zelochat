# ZeloChat

WhatsApp-native customer service platform for Brazilian lanchonetes. All user-facing text, prompts, and seed data are in **Brazilian Portuguese**.

> **Sprint atual / foco do momento:** ler [[CURRENT]] antes de qualquer tarefa.

## 📖 Required reading before any non-trivial change

**Read in this order before touching anything customer-facing or tagged "CRITICAL":**

1. **[[CURRENT]]** — sprint atual, o que está em aberto, decisões recentes
2. **[[CODE_REVIEW]]** — auditoria sênior (24 P0 / 47 P1 / 38 P2 / 24 P3). Every finding has file:line, repro, customer impact, fix.
3. **[[FIXES_PROGRESS]]** — Live tracker: shipped vs drafted vs blocked. Update when shipping a fix.
4. **[[BILLING]]** — Stripe/Asaas runbook + cross-product subscription details.
5. **[[INCIDENTS]]** — Outage runbook. First stop when something looks broken in prod.
6. **[[CLAUDE]]** — Project context. Has two non-negotiable sections: "Shared database with ZeloPDV" (what we MUSTN'T touch) and "Critical functions — touch with extreme care".

## Codex memory

Before any deep ZeloChat task, read [[ZeloChat.memory]] first. Keep findings evidence-based and update that memory when the repo's confirmed architecture or risks materially change.

Inline `🚨 CRITICAL` JSDoc-style blocks in the source code mark functions whose breakage has caused — or could cause — a customer-visible outage. Search for that emoji to find them.

## Novidades changelog convention

Changelog entries must be concise, non-technical, and understandable by any restaurant operator. Do **not** add one entry per commit by default. Add entries only for meaningful user-facing changes, and keep a maximum of **4 entries per day** by summarizing related work into broader entries.

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
  components/views/        # One file per nav view (DashboardView, KanbanView, etc.)

server/
  index.ts        # Express entry point, WebSocket wiring, auto-reply debounce
  router.ts       # All API routes (/api/sessions, /api/send, /api/drivers, etc.)
  messageHandler.ts # Supabase read/write for sessions and messages
  whatsapp.ts     # Whatsmiau (Evolution v2) instance lifecycle (QR, connect, reconnect)
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

When this happens, a Dokploy redeploy fixes it (prod re-registers its own URL on startup with the correct `?token=`).

**Before running any local dev command that boots the backend** (`npm run dev:server`, `npm run dev:all`, `npx tsx server/index.ts`):

- **Recommended:** set `WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1` in your local `.env` — skips ALL webhook registration on startup, outbound sends still work.
- Alternative: use a separate sandbox Whatsmiau instance + API key for dev — do not reuse prod ones.

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

## Workflow
- For complex tasks, always use subagents for async work and multitasking. Be an orchestrator.

## Documentação — convenção AI-first

Toda IA que trabalhar neste repo **deve manter a documentação automaticamente**.

### Após qualquer fix ou feature
- **[[FIXES_PROGRESS]]**: adicionar entrada na sprint do dia. Formato: `- ✅ <ID> — <o que era> → <o que foi feito> — \`arquivo:linha\``
- **[[CURRENT]]**: atualizar "Em aberto" se o fix fecha algo listado lá

### Após fix crítico em prod (P0/P1 ou que causou outage visível)
- **[[INCIDENTS]]**: nova entrada com: Sintoma (1 linha), Causa-raiz (1 frase), Fix (1 frase + arquivo:linha)
- Comentário inline na função crítica: `// FIX YYYY-MM-DD: <causa em 1 frase> → <fix em 1 frase>`

### Feature entregue
- Deletar o arquivo de spec da feature (specs são temporários, o código é a verdade)
- Se o comportamento for não-óbvio, documentar em CLAUDE.md ou AGENTS.md

### Início de qualquer sessão
1. Ler **[[CURRENT]]** — entender o foco atual
2. Se o foco mudou, atualizar **[[CURRENT]]** antes de começar
3. Para mudanças em funções listadas em "Critical functions" no [[CLAUDE]], ler o inline docstring completo antes de tocar

### Regra de ouro
> Documentação que não existe não será lembrada. Se você fez algo não-óbvio, documenta agora — não depois.
