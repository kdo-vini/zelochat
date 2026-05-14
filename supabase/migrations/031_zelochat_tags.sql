-- Tags de atendimento por empresa.
-- Cada tag pode ter instruções de IA personalizadas que são injetadas no
-- prompt quando a sessão tem aquela tag aplicada.

CREATE TABLE zelochat_tags (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id      uuid NOT NULL REFERENCES empresa_perfil(id) ON DELETE CASCADE,
  name            text NOT NULL,
  color           text NOT NULL DEFAULT '#6366f1',
  ai_instructions text,
  created_at      timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX zelochat_tags_empresa_name ON zelochat_tags(empresa_id, name);
CREATE INDEX zelochat_tags_empresa_id ON zelochat_tags(empresa_id);

ALTER TABLE zelochat_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zelochat_tags_empresa_owner" ON zelochat_tags
  USING (empresa_id = (SELECT id FROM empresa_perfil WHERE user_id = auth.uid()))
  WITH CHECK (empresa_id = (SELECT id FROM empresa_perfil WHERE user_id = auth.uid()));
