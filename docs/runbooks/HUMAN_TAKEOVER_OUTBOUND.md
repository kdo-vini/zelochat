# Rollout — tomada humana e engine de outbound

Status: código local pronto; migrations `063–067` não foram aplicadas por esta entrega. O rollout exige ambiente isolado e autorização operacional explícita.

## Invariantes

- Envio humano pelo ZeloChat assume a conversa antes do transporte.
- Envio humano pelo WhatsApp nativo só assume a conversa em `enforce` e com `auth_status='token_match'`.
- `shadow` é o padrão quando a configuração está ausente ou inválida. Nesse modo, `fromMe` faz apenas leituras de evidência e registra `would_takeover`/`would_correlate`; não chama RPC de takeover/correlação, não cancela timer, não cria job/mensagem e não transmite mudança de modo.
- O dispatcher durável continua sendo a autoridade dos outbounds server-side já migrados. Shadow de `fromMe` não prova ordering, lease ou transporte.
- Takeover comum muda modo/epoch, não muda `status`, `escalated_at` nem SLA.
- `delivery_uncertain` nunca é reenviado automaticamente.
- `/api/healthz` não é evidência de banco, fila, worker ou integração WhatsApp.

## Configuração server-side

| Variável | Valor | Efeito |
| --- | --- | --- |
| `CONVERSATION_OUTBOUND_ENGINE_MODE` | ausente/`shadow` | padrão seguro; observa `fromMe` sem mutar |
| `CONVERSATION_OUTBOUND_ENGINE_MODE` | `enforce` | habilita reconciliação/takeover nativo global |
| `CONVERSATION_OUTBOUND_ENGINE_ENFORCE_EMPRESAS` | UUIDs separados por vírgula | libera `enforce` somente nesses tenants enquanto o global está em shadow |
| `FROM_ME_NATIVE_MODE` | `shadow`/`enforce` | compatibilidade temporária; a variável nova tem precedência |
| `CONVERSATION_OUTBOUND_WORKER_DISABLED` | `1` | kill switch de rollback; preserva jobs no ledger sem novos claims |

Não colocar JID, telefone, texto de mensagem, payload ou token em flags/logs. Mudança de env exige restart coordenado de todas as réplicas.

## Métricas e sinais

Logs estruturados usam o prefixo `[conversation_outbound_metric]`. JIDs são redigidos; conteúdo e payload nunca entram.

- `human_takeover`, por `source`;
- `ai_stale_suppressed`, por motivo;
- `from_me_echo`, `from_me_native`, `from_me_pending_correlation`;
- `from_me_would_takeover`, `from_me_would_correlate` no shadow;
- `delivery_uncertain`, por origem;
- `queue_depth`, `queue_oldest_seconds`, `leases_stuck`.

Parar o rollout se houver falso takeover de eco, IA enviada após job humano, POST duplicado, lease vencido ainda ativo, divergência de correlação ou qualquer evento cross-tenant.

## Gate A — banco isolado

1. Criar backup/restore point e confirmar que a conexão não aponta para produção.
2. Aplicar `063`, `064`, `065` e `066`, nessa ordem.
3. Rodar `supabase/verification/conversation_outbound_engine.sql`; ele deve terminar em `ROLLBACK`.
4. Rodar `conversationOutboundRpc.integration.test.ts` com `LOCAL_OUTBOUND_TEST_DATABASE_URL` do banco isolado. Skip não é aprovação.
5. Confirmar grants somente para `service_role`, índice `(empresa_id, wa_message_id)`, índice `(empresa_id, idempotency_key)` e ausência de DDL em tabelas PDV-owned.
6. Publicar backend ainda com modo global `shadow`.

## Gate B — tenant isolado

Capturar fixtures reais sanitizadas de texto, áudio/PTT, imagem/documento/vídeo, sticker, buttons, contato, localização, reação, poll e wrappers `deviceSentMessage`, `ephemeral`, `viewOnce`, `edited` e `documentWithCaption`.

Para cada fixture, registrar a origem conhecida e comparar com a decisão shadow. Exigir zero mutação de controle/job/mensagem pelo `fromMe` shadow. Depois executar `npm run test:e2e:takeover` com backend, bearer, instância, token estável e JID exclusivos do ambiente isolado. Skip não autoriza enforce.

## Gate C — enforce gradual

1. compositor principal e CRM no tenant isolado;
2. IA customer-facing;
3. payloads especiais, gerenciais e internos;
4. transacionais, campanhas e automações;
5. guardrail global sem transporte customer-facing direto;
6. WhatsApp nativo somente com token forte;
7. global apenas após 24 horas sem job preso, duplicata, falso eco ou divergência.

Usar `CONVERSATION_OUTBOUND_ENGINE_ENFORCE_EMPRESAS` no piloto. Só mudar o global para `enforce` depois de remover a allowlist e verificar que todas as réplicas carregaram o mesmo build.

## Migration 067 — cleanup pós-drain

`067_conversation_outbound_rolling_cleanup.sql` é forward-only e não faz parte do primeiro rollout. Ela remove a constraint global de idempotência, o status legado `failed` e o bridge de writers antigos.

Pré-condições obrigatórias:

1. todas as réplicas antigas drenadas;
2. todos os writers confirmados com conflito `(empresa_id,idempotency_key)`;
3. nenhum job ativo criado pelo contrato legado;
4. prova de duas empresas usando a mesma chave e retry concorrente deduplicado dentro da mesma empresa;
5. backup/restore point novo.

A migration falha com `CONVERSATION_OUTBOUND_ROLLING_DRAIN_NOT_CONFIRMED` sem confirmação explícita. Para aplicá-la numa sessão controlada:

```sql
set zelochat.outbound_rolling_drain_confirmed = 'on';
-- executar o conteúdo versionado de 067 na mesma sessão
reset zelochat.outbound_rolling_drain_confirmed;
```

Não editar a migration para remover o guard. Não aplicar via `db push` amplo.

## Rollback operacional

Rollback não reverte migrations e não apaga ledger/eventos.

1. mudar o modo global para `shadow` e remover a allowlist de enforce;
2. desligar auto-respostas globalmente enquanto o caminho emergencial estiver ativo;
3. definir `CONVERSATION_OUTBOUND_WORKER_DISABLED=1` e reiniciar coordenadamente as réplicas;
4. preservar modos humanos, epochs, holds, jobs e eventos para reconciliação;
5. não reativar IA em massa; liberar tenant a tenant somente após identificar a causa;
6. para entrega incerta, reconciliar pelo ID do provedor/raw event; nunca reenviar às cegas.

Após corrigir a causa, retirar o kill switch, confirmar fila/leases e reabilitar primeiro um tenant isolado. Rollback para shadow depois do cutover global sem desligar auto-respostas reabre a corrida que esta engine corrige.
