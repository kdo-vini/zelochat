# ZeloChat Architecture

## Current state
React 19 + Vite SPA, all state in `useState` (localStorage persistence in flight). OpenAI GPT-4o-mini called from browser with `dangerouslyAllowBrowser: true`. Baileys runs in an Express server on `:3001` with its own in-memory session. No auth, no DB, single lanchonete.

## Phase 1: Single-user production

1. **Persistence — Supabase now, not later.** localStorage is acceptable only until the first paying conversation happens. Migrate as soon as WhatsApp is wired end-to-end (losing customer chats on a cache clear is a product-killer). Use Supabase Postgres, single project, no RLS yet (one user, enforced by server-side service role). Frontend talks to Supabase via `@supabase/supabase-js` using the anon key for reads; all writes proxied through the Express server.
2. **OpenAI key — move to Express server today.** Remove `dangerouslyAllowBrowser`. Add `POST /ai/complete` on the existing Baileys server; it holds `OPENAI_API_KEY` in env and forwards requests. Frontend calls `/ai/complete`, never OpenAI directly. Same server already trusted for WhatsApp creds, so no new trust boundary.
3. **WhatsApp ↔ State sync — server is the source of truth.** Baileys server writes every inbound/outbound message directly to Supabase (`messages` table). Frontend subscribes via Supabase Realtime on `messages` and `contacts`. Server in-memory session holds only the Baileys socket + auth state (`auth_info_baileys/`), never business data. Frontend no longer owns conversation state — it renders from Supabase. Outbound: frontend `POST /wa/send` → server sends via Baileys → server writes to `messages` → Realtime pushes back to UI.
4. **Data model (Phase 1):**
   - `contacts` (id uuid pk, wa_jid text unique, name, phone, tags text[], created_at, last_message_at)
   - `conversations` (id uuid pk, contact_id fk, status enum[open,pending,resolved], assigned_to text null, unread_count int, updated_at)
   - `messages` (id uuid pk, conversation_id fk, direction enum[in,out], body text, media_url text null, wa_message_id text unique, ai_generated bool, created_at)
   - `ai_suggestions` (id uuid pk, message_id fk, suggestion text, model text, tokens_in int, tokens_out int, used bool, created_at)
   - `settings` (id int pk=1, business_name, ai_system_prompt, auto_reply_enabled bool, business_hours jsonb)

## Phase 2: Multi-tenant

1. **Auth — Supabase Auth with email magic link + phone OTP fallback.** Email magic link as primary (owners already check email for invoices/Ifood); phone OTP (via Supabase + Twilio Verify) for owners who resist email. Skip WhatsApp-as-auth — using the same channel for login and business messaging confuses the mental model and Baileys-based OTP is a ToS grey area.
2. **Tenant isolation — RLS in a single Supabase project.** Add `tenant_id uuid` FK on every table. RLS policies: `tenant_id = (auth.jwt() ->> 'tenant_id')::uuid`. One project keeps migrations, backups, and billing simple; RLS has been battle-tested for this scale (<1k tenants). Separate schemas/projects only if a tenant demands data residency — not a Phase 2 concern.
3. **WhatsApp multi-tenancy — one Node process, many Baileys sockets, keyed by tenant_id.** Refactor server into a `SessionManager` holding `Map<tenant_id, BaileysSocket>`. Auth state persisted per tenant in Supabase Storage (bucket `wa-auth/{tenant_id}/`) instead of the local `auth_info_baileys/` folder, so the process is stateless and restart-safe. Vertical scale until ~50 tenants/process; then shard by `tenant_id % N` across process replicas behind a router. Do NOT spin up one container per tenant — Baileys connections are cheap, containers are not.
4. **OpenAI cost isolation — log tokens per call, aggregate per tenant.** `ai_suggestions.tokens_in/out` already carries this. Add `tenant_id` + nightly rollup into `tenant_usage_daily` (tenant_id, date, tokens_in, tokens_out, cost_cents). Gate via soft quota in settings (`ai_monthly_budget_cents`); server checks remaining budget before calling OpenAI and returns a canned response when exceeded.
5. **State shape migration — from flat `ZeloState` to `{ session, tenant, data }`.** `session` = auth user + current tenant_id. `tenant` = settings, branding, quota. `data` = contacts/conversations/messages, all already tenant-scoped by RLS so the frontend code barely changes — just inject `tenant_id` into the Supabase client via JWT claim. Keep the single-store pattern; do not introduce Redux/Zustand.

## Migration path
- Trigger for Phase 1: first real customer conversation handled. Changes: add Supabase project, move OpenAI key to Express, schema above, Realtime subscription in frontend, delete localStorage persistence.
- Trigger for Phase 2: second lanchonete onboarded (even a pilot). Changes: enable Supabase Auth, add `tenant_id` + RLS to every table, refactor server to `SessionManager` with Supabase Storage auth state, add usage rollup job.
- Do not build Phase 2 abstractions during Phase 1. Add `tenant_id` columns only when the second tenant is real — guessing the shape costs more than a one-time ALTER TABLE + backfill.
- Baileys auth state migration (local folder → Supabase Storage) is the riskiest step in Phase 2; test with a throwaway number before touching the production socket.
- No Phase 3 in this doc by design.
