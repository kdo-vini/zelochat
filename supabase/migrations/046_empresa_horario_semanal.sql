-- Horário de funcionamento por dia, com múltiplas janelas.
-- Shape: { "sun": [], "mon": [{"start":"11:00","end":"14:00"},{"start":"18:00","end":"23:00"}], ... }
--   - Array vazio [] = fechado no dia.
--   - Janela {start,end} em "HH:MM"; end "00:00" = meia-noite (fim do dia).
-- Quando presente (non-null), é a fonte de verdade do horário. Quando NULL, o
-- comportamento deriva das colunas legadas horario_abertura / horario_fechamento
-- / dias_fechamento (contas antigas ficam idênticas até re-salvarem pela UI).
--
-- Coluna ZeloChat-owned (ADD permitido em empresa_perfil). O ZeloMenu (repo
-- separado) lê esta mesma coluna do banco compartilhado; enquanto não for
-- atualizado, o ZeloChat mantém as colunas legadas em sincronia (shadow) para o
-- bloqueio de pedido fora de horário não quebrar.
alter table public.empresa_perfil
  add column if not exists horario_semanal jsonb;
