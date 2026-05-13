-- Perfil vivo do cliente: resumo minimalista atualizado pela IA a cada conversa.
-- Aplicado em todas as sessões da família (mesmo customer_phone) para manter coerência cross-JID.
ALTER TABLE zelochat_sessions
  ADD COLUMN IF NOT EXISTS customer_profile text
    CHECK (customer_profile IS NULL OR length(customer_profile) <= 600);
