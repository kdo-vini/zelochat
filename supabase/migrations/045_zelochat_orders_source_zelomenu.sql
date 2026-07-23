-- ZeloMenu public orders insert into zelochat_orders with source 'zelomenu'.
-- Relax the CHECK constraint so the insert does not fail silently.

ALTER TABLE public.zelochat_orders
  DROP CONSTRAINT IF EXISTS zelochat_orders_source_check;

ALTER TABLE public.zelochat_orders
  ADD CONSTRAINT zelochat_orders_source_check
  CHECK (source IN ('whatsapp', 'manual', 'zelomenu'));
