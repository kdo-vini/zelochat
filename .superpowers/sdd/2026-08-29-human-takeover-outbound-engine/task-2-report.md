# Relatório — Tarefa 2

## Arquivos

- `supabase/migrations/063_conversation_outbound_foundation.sql` — fundação persistente de controle canônico por conversa, identidade SQL, backfill de sessões, extensão do ledger de outbound e guardrails de rolling deploy.
- `tests/conversationOutboundSchema.test.ts` — guardrail source-level da migration `063`, grants server-only e unicidade da versão.

## Testes

- RED: `npx tsx tests/conversationOutboundSchema.test.ts` falhou porque `supabase/migrations/063_conversation_outbound_foundation.sql` ainda não existia.
- GREEN: `npx tsx tests/conversationOutboundSchema.test.ts` passou após a criação da migration.
- Compatibilidade: `npx tsx tests/customerRelationshipSchema.test.ts` passou; a numeração segue aceitando uma única `063`.

## Decisões

- A migration cria `zelochat_conversation_ai_control` e `zelochat_conversation_control_events` como tabelas server-only com RLS habilitado, sem grants para `anon` ou `authenticated`.
- `zelochat_conversation_identity_key(p_pessoa_id, p_customer_phone, p_remote_jid)` replica a normalização brasileira de `buildContactKey`: remove DDI `55`, colapsa o nono dígito móvel e produz `person:<uuid>` quando já existe vínculo canônico.
- O backfill cria um controle por família canônica atual e projeta `auto_reply` a partir do modo do controle; quando a família diverge, “humano vence” e todas as sessões terminam em modo humano.
- `zelochat_sessions` ganha `conversation_control_id` com FK composta tenant-safe e só vira `not null` depois do backfill validado.
- `zelochat_messages` passa a aceitar origem durável e o lifecycle expandido (`preparing`, `dispatch_started`, `failed_before_dispatch`, `delivery_uncertain`, `cancelled`), preservando `failed` apenas por compatibilidade de rolling deploy.
- `zelochat_outbound_jobs` ganha o shape conversacional, os índices defensivos por conversa/mensagem e a unicidade tenant-scoped `(empresa_id, idempotency_key)` sem remover a constraint global legada.
- Jobs legados são backfilled com `outbound_origin` (`campaign`/`automation`), `takeover_policy='preserve_ai'` e um payload textual mínimo para manter o ledger coerente até as próximas tasks.

## Riscos / próximos passos

- A constraint global legada de `idempotency_key` continua ativa; a remoção fica para a cleanup migration planejada depois que todas as réplicas escreverem via `(empresa_id, idempotency_key)`.
- A migration não implementa RPCs nem runtime de takeover/claim ainda; ela só prepara o schema e os backfills exigidos pela Task 2.
- Não houve verificação executável em banco real nesta task porque os checks pedidos eram source-level e não havia `SUPABASE_DB_URL`/`DATABASE_URL` configurada no ambiente local.
