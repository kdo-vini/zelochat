-- Auto-tags: condição em português escrita pelo dono que diz QUANDO a IA deve
-- marcar a conversa com esta tag automaticamente. Quando não-nulo, a tag vira
-- uma "tag automática" e é oferecida ao modelo (tool aplicar_tag); quando nulo,
-- a tag continua sendo aplicada só na mão. As políticas de RLS existentes da
-- tabela já cobrem a coluna nova.

ALTER TABLE zelochat_tags ADD COLUMN auto_apply_condition text;
