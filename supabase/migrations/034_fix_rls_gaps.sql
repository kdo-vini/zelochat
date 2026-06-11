-- ============================================================================
-- Fix RLS gaps: storage policies, RPC hardening
-- ============================================================================

-- 1. Restrict zelochat-media INSERT/DELETE to service_role only
-- (Previously open to all authenticated users — anyone could upload/delete media)
DROP POLICY IF EXISTS "zelochat-media service insert" ON storage.objects;
CREATE POLICY "zelochat-media service insert"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'zelochat-media');

DROP POLICY IF EXISTS "zelochat-media service delete" ON storage.objects;
CREATE POLICY "zelochat-media service delete"
  ON storage.objects FOR DELETE
  TO service_role
  USING (bucket_id = 'zelochat-media');

-- 2. Harden zelochat_decrement_stock RPC
CREATE OR REPLACE FUNCTION zelochat_decrement_stock(
  p_id_usuario uuid,
  p_items      jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

REVOKE ALL ON FUNCTION zelochat_decrement_stock(uuid, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION zelochat_decrement_stock(uuid, jsonb) TO service_role;

-- 3. Harden zelochat_increment_unread RPC (if it exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'zelochat_increment_unread') THEN
    REVOKE ALL ON FUNCTION zelochat_increment_unread(uuid) FROM public, anon, authenticated;
    GRANT EXECUTE ON FUNCTION zelochat_increment_unread(uuid) TO service_role;
  END IF;
END $$;
