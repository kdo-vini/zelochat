-- Enforce tenant consistency on the session/tag junction table.
-- The service layer now validates tag ownership before writes; these
-- constraints make the same rule non-bypassable at the database layer.

DELETE FROM zelochat_session_tags st
WHERE NOT EXISTS (
  SELECT 1
  FROM zelochat_sessions s
  WHERE s.id = st.session_id
    AND s.empresa_id = st.empresa_id
)
OR NOT EXISTS (
  SELECT 1
  FROM zelochat_tags t
  WHERE t.id = st.tag_id
    AND t.empresa_id = st.empresa_id
);

CREATE UNIQUE INDEX IF NOT EXISTS zelochat_sessions_id_empresa_id_unique
  ON zelochat_sessions(id, empresa_id);

CREATE UNIQUE INDEX IF NOT EXISTS zelochat_tags_id_empresa_id_unique
  ON zelochat_tags(id, empresa_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'zelochat_session_tags_session_empresa_fk'
      AND conrelid = 'public.zelochat_session_tags'::regclass
  ) THEN
    ALTER TABLE public.zelochat_session_tags
      ADD CONSTRAINT zelochat_session_tags_session_empresa_fk
      FOREIGN KEY (session_id, empresa_id)
      REFERENCES public.zelochat_sessions(id, empresa_id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'zelochat_session_tags_tag_empresa_fk'
      AND conrelid = 'public.zelochat_session_tags'::regclass
  ) THEN
    ALTER TABLE public.zelochat_session_tags
      ADD CONSTRAINT zelochat_session_tags_tag_empresa_fk
      FOREIGN KEY (tag_id, empresa_id)
      REFERENCES public.zelochat_tags(id, empresa_id)
      ON DELETE CASCADE;
  END IF;
END $$;
