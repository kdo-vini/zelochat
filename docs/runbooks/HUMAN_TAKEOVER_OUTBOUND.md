# Operação — tomada humana e engine de outbound

Status: engine sempre ativa; as migrations `063–067` devem estar aplicadas antes de publicar o backend que contém este contrato.

## Invariantes

- Todo envio humano pelo ZeloChat assume a conversa antes do transporte.
- Todo envio humano nativo autenticado (`auth_status='token_match'`) assume a conversa na mesma transação que persiste mensagem e job.
- Ausência ou divergência do token nunca altera modo, mensagem, job ou timer.
- O dispatcher durável é a única autoridade para outbounds de conversa; o worker mantém leases, fencing e lifecycle até `sent`, `failed_before_dispatch` ou `delivery_uncertain`.
- Takeover altera modo/epoch da família de JIDs, não `status`, `escalated_at` nem SLA.
- `delivery_uncertain` nunca é reenviado automaticamente.
- `/api/healthz` é somente liveness e não prova saúde do banco, fila, worker ou WhatsApp.

## Aplicação das migrations

Aplicar em ordem, uma vez, no projeto Supabase correto:

1. `063_conversation_outbound_foundation.sql`
2. `064_conversation_control_rpcs.sql`
3. `065_conversation_outbound_claims.sql`
4. `066_native_from_me_takeover.sql`
5. `067_conversation_outbound_rolling_cleanup.sql`

A migration 067 é forward-only: aposenta o status legado `failed`, a constraint global de idempotência e o bridge de writers antigos. Ela exige que o índice tenant-scoped criado em 065 exista; não possui mais flag de confirmação ou janela de rollout.

## Verificação pós-migration

1. Executar `supabase/verification/conversation_outbound_engine.sql` em uma conexão isolada; o script termina em `ROLLBACK`.
2. Executar `npm run test:takeover` e `npm run test:e2e:takeover` com credenciais de um ambiente isolado. Cenários `skipped` não são evidência de produção.
3. Confirmar grants das RPCs somente para `service_role`, índices `(empresa_id, wa_message_id)` e `(empresa_id, idempotency_key)`, e ausência de DDL em tabelas PDV-owned.
4. Confirmar que o WebSocket propaga `conversation_mode_changed` para toda a família e que uma segunda tentativa idempotente não cria nova mensagem, job ou evento.
5. Publicar o backend: não é necessário configurar modo, allowlist, kill switch ou variável de rollout.

## Métricas e sinais

Logs estruturados usam o prefixo `[conversation_outbound_metric]`. JIDs são redigidos; conteúdo e payload nunca entram.

- `human_takeover`, `from_me_native`, `from_me_echo` e `from_me_pending_correlation`;
- `ai_stale_suppressed`;
- `delivery_uncertain`;
- `queue_depth`, `queue_oldest_seconds` e `leases_stuck`.

Investigar imediatamente falso takeover de eco, IA enviada após job humano, POST duplicado, lease vencido ainda ativo, divergência de correlação ou qualquer evento cross-tenant.

## Recuperação operacional

Migrations e ledger não são revertidos para “desligar” a funcionalidade. Em caso de incidente:

1. preservar mensagens, jobs, epochs, holds e eventos para investigação;
2. usar o controle de IA da própria conversa para impedir novas respostas automáticas;
3. reconciliar `delivery_uncertain` pelo ID persistido ou evento bruto; nunca reenviar às cegas;
4. corrigir o código/migration com uma mudança forward-only e reexecutar os gates antes de retomar o tráfego.
