-- Migration 011 — Delivery config + delivery fields on orders/pending_orders.
--
-- Adds delivery-by-neighborhood support:
-- 1. empresa_perfil.delivery_config (jsonb) — operator config: enabled flag + neighborhood→fee list
-- 2. zelochat_orders: delivery_fee, delivery_neighborhood (persisted on confirmation)
-- 3. zelochat_pending_orders: order_type, delivery_address, delivery_neighborhood, delivery_fee
--    (needed so confirmPendingOrder can carry delivery data through to the final order)

-- 1. Business delivery config -------------------------------------------------
ALTER TABLE empresa_perfil
  ADD COLUMN IF NOT EXISTS delivery_config jsonb;

-- 2. Confirmed orders — delivery details --------------------------------------
ALTER TABLE zelochat_orders
  ADD COLUMN IF NOT EXISTS delivery_fee numeric(10,2),
  ADD COLUMN IF NOT EXISTS delivery_neighborhood text;

-- 3. Pending orders — delivery details ----------------------------------------
ALTER TABLE zelochat_pending_orders
  ADD COLUMN IF NOT EXISTS order_type text CHECK (order_type IN ('pickup', 'delivery')),
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS delivery_neighborhood text,
  ADD COLUMN IF NOT EXISTS delivery_fee numeric(10,2);
