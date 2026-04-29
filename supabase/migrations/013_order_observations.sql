-- Migration 013 — Free-form observation field on orders.
--
-- Captures customer-facing notes ("sem cebola", "ponto da carne", "deixar na portaria")
-- on both confirmed and pending orders. The AI asks the customer one final friendly
-- question — "Gostaria de alterar algo, ou tem alguma observação a fazer? 😊" — before
-- calling criar_pedido, so the obs is part of the same flow that generates the
-- confirmation buttons. Manual orders (Produção → Novo pedido) get a textarea in the
-- modal for the same purpose.
--
-- Pattern follows migration 011 (delivery_address): nullable text, no default, no index.
-- CHECK length ≤ 500 is defense-in-depth — both safeForPrompt() server-side and the
-- frontend textarea trim/limit before insert, but the DB enforces the cap regardless.

ALTER TABLE zelochat_orders
  ADD COLUMN IF NOT EXISTS observations text;

ALTER TABLE zelochat_orders
  DROP CONSTRAINT IF EXISTS zelochat_orders_observations_length_chk;

ALTER TABLE zelochat_orders
  ADD CONSTRAINT zelochat_orders_observations_length_chk
  CHECK (observations IS NULL OR length(observations) <= 500);

ALTER TABLE zelochat_pending_orders
  ADD COLUMN IF NOT EXISTS observations text;

ALTER TABLE zelochat_pending_orders
  DROP CONSTRAINT IF EXISTS zelochat_pending_orders_observations_length_chk;

ALTER TABLE zelochat_pending_orders
  ADD CONSTRAINT zelochat_pending_orders_observations_length_chk
  CHECK (observations IS NULL OR length(observations) <= 500);
