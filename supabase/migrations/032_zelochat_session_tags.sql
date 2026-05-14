-- Junction: sessões ↔ tags.
-- empresa_id desnormalizado para RLS simples sem join.

CREATE TABLE zelochat_session_tags (
  session_id  uuid NOT NULL REFERENCES zelochat_sessions(id) ON DELETE CASCADE,
  tag_id      uuid NOT NULL REFERENCES zelochat_tags(id) ON DELETE CASCADE,
  empresa_id  uuid NOT NULL,
  applied_at  timestamptz DEFAULT now(),
  PRIMARY KEY (session_id, tag_id)
);

CREATE INDEX zelochat_session_tags_session_id ON zelochat_session_tags(session_id);
CREATE INDEX zelochat_session_tags_tag_id ON zelochat_session_tags(tag_id);
CREATE INDEX zelochat_session_tags_empresa_id ON zelochat_session_tags(empresa_id);

ALTER TABLE zelochat_session_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zelochat_session_tags_empresa_owner" ON zelochat_session_tags
  USING (empresa_id = (SELECT id FROM empresa_perfil WHERE user_id = auth.uid()))
  WITH CHECK (empresa_id = (SELECT id FROM empresa_perfil WHERE user_id = auth.uid()));
