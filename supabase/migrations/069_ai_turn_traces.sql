-- Rastro completo de cada turno da IA: o que entrou, o prompt exato que foi
-- para o modelo, e o que saiu.
--
-- Por que existe: em 09-10/09/2026 quatro defeitos seguidos exigiram
-- reconstruir conversas no banco na mão para descobrir o que a IA tinha lido.
-- Um deles ("Esse horário já passou hoje: 18:00") só foi explicado depois de
-- achar uma mensagem de 47 dias antes. Os logs da aplicação ficam no Dokploy e
-- na prática não são consultáveis por quem precisa deles.
--
-- ESTE CONTEÚDO É SENSÍVEL. O prompt carrega histórico da conversa, nome,
-- telefone e endereço do cliente. A tabela é service-role apenas: sem RLS
-- liberada para `anon`/`authenticated`, e nenhuma rota do frontend a lê.
-- Guarda por tempo curto (ver `zelochat_prune_ai_turn_traces`).

create table if not exists public.zelochat_ai_turn_traces (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  session_id uuid,
  remote_jid text,
  -- 'model' quando o turno foi respondido pelo OpenAI; nos demais casos, o
  -- caminho deterministico que respondeu antes dele (guard_business_hours,
  -- canonical_ordering, ...). E o campo que diz "quem respondeu".
  path text not null,
  inbound_text text,
  system_prompt text,
  runtime_messages jsonb,
  reply_text text,
  model text,
  guard_detail jsonb,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists zelochat_ai_turn_traces_lookup
  on public.zelochat_ai_turn_traces (empresa_id, created_at desc);
create index if not exists zelochat_ai_turn_traces_jid
  on public.zelochat_ai_turn_traces (empresa_id, remote_jid, created_at desc);

alter table public.zelochat_ai_turn_traces enable row level security;
-- Sem policy: nem `anon` nem `authenticated` leem. Só a service role, que
-- ignora RLS, escreve e consulta.

revoke all on public.zelochat_ai_turn_traces from anon, authenticated;

comment on table public.zelochat_ai_turn_traces is
  'Rastro de troubleshooting dos turnos da IA. Contem PII do cliente; service-role apenas; retencao curta.';

-- Retencao. Chamada de forma oportunista pelo backend (ver
-- server/aiTurnTrace.ts) para nao exigir um agendador novo.
create or replace function public.zelochat_prune_ai_turn_traces(p_keep_days integer default 14)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.zelochat_ai_turn_traces
   where created_at < now() - make_interval(days => greatest(p_keep_days, 1));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.zelochat_prune_ai_turn_traces(integer) from anon, authenticated;
