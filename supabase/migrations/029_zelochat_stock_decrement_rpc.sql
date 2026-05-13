-- RPC para baixar estoque quando ZeloChat confirma um pedido.
-- Chamada fire-and-forget em confirmPendingOrder; falha não bloqueia o pedido.
-- Match por nome ILIKE (mesma lógica do configStore). GREATEST(0,...) evita negativo.
CREATE OR REPLACE FUNCTION zelochat_decrement_stock(
  p_id_usuario uuid,
  p_items      jsonb   -- [{name: text, qty: numeric}]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  item jsonb;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    UPDATE produtos
    SET estoque_atual = GREATEST(0, estoque_atual - (item->>'qty')::numeric)
    WHERE id_usuario        = p_id_usuario
      AND nome              ILIKE item->>'name'
      AND controlar_estoque = true;
  END LOOP;
END;
$$;
