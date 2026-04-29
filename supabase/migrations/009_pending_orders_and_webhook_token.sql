-- Migration 009 — Pending orders table + per-empresa webhook auth token + AI re-engage flag.
--
-- Three concerns bundled together because they all came from the same code review pass
-- and any one of them in isolation leaves the system in a half-fixed state:
--
-- 1) zelochat_pending_orders — durable replacement for the in-memory pendingOrders Map
--    in server/ai.ts. A pending order is created when the AI calls criar_pedido and
--    deleted when the customer clicks Confirmar/Cancelar (or it expires). One row max
--    per (empresa_id, remote_jid) — UPSERT semantics handle the case where the AI
--    re-fires criar_pedido while a pending row already exists.
--
-- 2) empresa_perfil.webhook_token — random per-empresa secret. Whatsmiau is configured
--    to send this in the apikey header, so the webhook handler can both authenticate
--    requests (no more open endpoint) AND derive the empresa without relying on the
--    process-global getBoundEmpresaId() singleton.
--
-- 3) empresa_perfil.ai_can_reengage_pending — opt-in flag. When true, the AI is allowed
--    to proactively reference unconfirmed pending orders ("vi que você começou um pedido
--    e não confirmou — quer continuar?"). Plumbing only here; outreach scheduler is
--    future work.

-- 1. Pending orders ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS zelochat_pending_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_perfil(id) ON DELETE CASCADE,
  remote_jid text NOT NULL,
  customer_name text NOT NULL,
  customer_phone text,
  items jsonb NOT NULL,
  pickup_date date NOT NULL,
  pickup_time text NOT NULL,
  payment_method text,
  total numeric(10,2) NOT NULL,
  tool_call_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  CONSTRAINT zelochat_pending_orders_unique_per_jid UNIQUE (empresa_id, remote_jid)
);

CREATE INDEX IF NOT EXISTS zelochat_pending_orders_expires_idx
  ON zelochat_pending_orders (expires_at);

CREATE INDEX IF NOT EXISTS zelochat_pending_orders_empresa_idx
  ON zelochat_pending_orders (empresa_id);

-- 2. Per-empresa webhook auth token -----------------------------------------
ALTER TABLE empresa_perfil
  ADD COLUMN IF NOT EXISTS webhook_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS empresa_perfil_webhook_token_idx
  ON empresa_perfil (webhook_token);

-- 3. AI re-engage opt-in flag -----------------------------------------------
ALTER TABLE empresa_perfil
  ADD COLUMN IF NOT EXISTS ai_can_reengage_pending boolean NOT NULL DEFAULT false;
