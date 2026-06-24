-- ZLM-store-settings: welcome text, featured products, category ordering
ALTER TABLE empresa_perfil
  ADD COLUMN IF NOT EXISTS zelomenu_welcome_text       text,
  ADD COLUMN IF NOT EXISTS zelomenu_featured_enabled   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS zelomenu_featured_product_ids jsonb,   -- number[]
  ADD COLUMN IF NOT EXISTS zelomenu_category_order       jsonb;   -- string[] (category names)
