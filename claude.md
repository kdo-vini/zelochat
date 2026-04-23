# ZeloChat

WhatsApp-native customer service platform for Brazilian lanchonetes. All user-facing text, prompts, and seed data are in **Brazilian Portuguese**.

## Commands

```bash
npm run dev          # Frontend only — Vite on port 3000
npm run dev:server   # Backend only — Express/Baileys on port 3001
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
  whatsapp.ts     # Baileys socket lifecycle (QR, connect, reconnect)
  ws.ts           # WebSocket broadcast to frontend
  ai.ts           # OpenAI reply generation
  supabase.ts     # Supabase service client + empresa auth
  configStore.ts  # In-memory business config (synced from frontend)
  drivers.ts      # Driver CRUD against Supabase
```

## Stack

- **Frontend**: React + Vite + TypeScript + Tailwind + Motion (framer)
- **Backend**: Express + Baileys (WhatsApp) + tsx (watch mode)
- **Database**: Supabase (PostgreSQL)
- **AI**: OpenAI (gpt-4o-mini) via server-side proxy
- **Auth**: Supabase JWT — token passed as `Authorization: Bearer` to all `/api/*` calls

## Database (Supabase)

Tables:
- `zelochat_sessions` — one row per WhatsApp JID per empresa. Columns: `id, empresa_id, remote_jid, customer_name, customer_phone, last_message, last_message_time, unread_count, status, auto_reply, updated_at`
- `zelochat_messages` — messages linked to a session. Columns: `id, empresa_id, session_id, role, content, sent_at`
- `zelochat_drivers` — delivery drivers per empresa
- `empresa_perfil` — business profile (name, address, pix key, logo)

Session "families": a contact may have multiple rows (different JIDs for same phone). `fetchSessionFamily` groups them by normalized phone key — always use it instead of querying by JID directly.

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

## Baileys / WhatsApp gotchas

- **JID format**: `{countryCode+number}@s.whatsapp.net` — e.g. `5514998360854@s.whatsapp.net`. Always include country code (55 for Brazil).
- **Brazilian numbers**: 10–11 digits without DDI → auto-prefix `55` before building JID. Never trust a raw local number as a JID.
- **Phone formatting**: `formatPhone` in `messageHandler.ts` formats `5514XXXXXXXXX` → `(14) XXXXX-XXXX`. Only works for 11-digit local numbers after stripping `55`.
- **Auth state**: stored in `auth_info_baileys/` — delete this folder to force re-scan of QR code.
- **Profile pictures**: `sock.profilePictureUrl(jid, 'image')` throws if photo is private — always wrap in try/catch and return `null`.
- **Pre-existing TS errors** in `server/messageHandler.ts` (lines 154, 305) are known and unrelated to new features — ignore them in `npm run lint`.

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
