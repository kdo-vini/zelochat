# Diagnóstico de Disk I/O — Supabase compartilhado ZeloPDV/ZeloChat

Data: 2026-09-18  
Projeto: `ZeloPDV` (`xnnjyrblpvsqrtsshawa`, Nano/Free, `us-east-2`)  
Escopo: diagnóstico somente leitura. Nenhuma migration, alteração de job ou escrita em produção foi executada.

## Resumo executivo

A causa principal do I/O excessivo é amplificação de escrita no log bruto de webhooks, não falta de compute. O endpoint grava quase todo evento antes de saber se ele tem valor operacional, deduplica mensagens somente depois do insert bruto, atualiza a mesma linha para marcar processamento e depois a apaga por retenção. Cada etapa produz WAL, suja páginas, mantém índices e exige vacuum.

O problema é agravado por uma limpeza sem índice em `processed_at`: o plano estimado é `Seq Scan`, e somente três execuções históricas consumiram 142,11 s e aproximadamente 1,06 GB de WAL. A tabela é hoje a maior relação do banco: 70 MB de heap + 12 MB de índices, 82 MB no total, para cerca de 24,8 mil linhas vivas.

O volume atual também é concentrado: um único par tenant/instância responde por 96,52% das linhas vivas. Mais de um terço das linhas não é mensagem: `contacts.upsert`, `connection.update` e `messages.delete` somam 34,09%. Esses tipos não são elegíveis ao replay automático atual, portanto o payload bruto retido não entrega a justificativa operacional que paga seu custo.

Há uma segunda fonte de amplificação em `zelochat_sessions`: `ensureSession` atualiza a linha e `updated_at` antes da deduplicação, inclusive para redelivery. Um inbound novo ainda executa outra escrita para incrementar não lidos. Como `updated_at` participa de oito índices, esses updates não são HOT e reescrevem índices desnecessariamente.

## Evidência de produção

### Tabela bruta

| Métrica | Resultado |
| --- | ---: |
| Heap | 70 MB |
| Índices | 12 MB |
| Total | 82 MB |
| Linhas estimadas | 24.788 |
| Leituras sequenciais acumuladas | 373 |
| Blocos lidos | 685.932 |
| Tuplas escritas | 1.270.782 |
| Blocos escritos, estimativa do perfil | 165.438 |
| Bloat do heap | 6.320 kB |
| Linhas mortas na amostra | 1.022 |
| Bloat do índice de não processados | 11,4× / 416 kB desperdiçados |

As estatísticas atuais mostram 401.783 inserts, 402.604 updates e 466.395 deletes. Isso é compatível com o caminho observado no código: uma linha entra, quase sempre é atualizada e mais tarde é apagada. Os inserts produziram 4.481.002.846 bytes de WAL; updates simples de processamento/erro acrescentaram 523.965.748 bytes e updates de lease/replay mais 47.447.689 bytes. Cerca de 8,4% dos eventos passaram pelo caminho de lease/replay.

### Composição das 24.788 linhas vivas

| `event_type` | Linhas | Participação | Payload médio | Pendentes |
| --- | ---: | ---: | ---: | ---: |
| `messages.upsert` | 16.338 | 65,91% | 1.267 B | 44 |
| `contacts.upsert` | 7.471 | 30,14% | 2.652 B | 5 |
| `connection.update` | 740 | 2,99% | 281 B | 1 |
| `messages.delete` | 239 | 0,96% | 332 B | 0 |

Payload JSON vivo: aproximadamente 39 MB, média de 1.646 B. Há 24.738 linhas processadas, 50 pendentes e 31 em dead letter.

Ranking sanitizado por tenant/instância:

| Posição | Tenant / instância (SHA-256 abreviado) | Linhas | Participação | Pendentes |
| --- | --- | ---: | ---: | ---: |
| 1 | `baa144… / 8e4d11…` | 23.924 | 96,52% | 49 |
| 2 | `938119… / de6073…` | 864 | 3,48% | 1 |

Somente dois pares aparecem no conjunto vivo. Os identificadores reais não foram incluídos neste relatório.

### Duplicatas e picos

- Por `(empresa_id, wa_message_id)`: 2.255 chaves repetidas abrangem 4.524 linhas; o excedente é 2.269 linhas, ou 9,15% do conjunto vivo. O máximo observado foi seis cópias.
- Payload integral idêntico: 175 grupos, 351 linhas e excedente de 176 linhas, ou 0,71%; máximo de três cópias.
- 08/09: 3.752 eventos, payload médio 2.213 B.
- 13/09: 3.524 eventos, payload médio 2.118 B.
- Dias maduros normais: aproximadamente 989–1.629 eventos/dia.

Os picos foram causados por sincronização de contatos: em 08/09, `contacts.upsert` respondeu por 2.851 de 3.752 eventos (76,0%); em 13/09, por 2.846 de 3.524 (80,8%). Cada evento carregava somente um contato, em vez de um lote compacto. Isso prova que o pico imediato foi uma enxurrada de inserts individuais de contatos; reconexão é uma explicação plausível para disparar a sincronização, mas não ficou comprovada pelos dados retidos.

Dentro dos 16.338 `messages.upsert`:

- 12.376 (75,75%) são recebidos e 3.962 (24,25%) são enviados/`fromMe=true`;
- 8.001 (48,97%) são de grupos, 8.290 (50,74%) individuais e 47 outros;
- somente 4.417 são mensagens individuais recebidas, 17,82% de todas as linhas raw vivas;
- tipos de mensagem mais comuns: texto/conversation 7.395, áudio 3.457, unknown 2.747, imagem 1.558, reaction 569 e sticker 379.

`messages.update`, que representa status de entrega/leitura, é filtrado antes do insert no código atual. Não apareceu marcador separado de history/device no envelope agregado; `source` é sempre `whatsapp`. Grupos não devem ser descartados sem validar takeover humano, auditoria e demais consumidores.

Não se deve criar uma unique apenas em `wa_message_id`: a diferença entre 9,15% por ID e 0,71% byte a byte mostra que o mesmo ID pode aparecer em eventos ou estados semanticamente distintos. A deduplicação segura deve incorporar tipo e uma fingerprint canônica, ou ser restrita a `messages.upsert` com contrato validado.

## Caminho completo do evento

1. `POST /webhook/:instance` resolve tenant e autentica em `server/router.ts:1047-1096`.
2. `recordRawWebhookEvent` roda antes do ACK e antes do processamento em `server/router.ts:1098-1127`.
3. `server/webhookLog.ts:83-116` normaliza o tipo, remove base64 pesado e faz `INSERT` simples. Não há upsert nem constraint de deduplicação. O único tipo descartado antes do insert é `messages.update` (`server/webhookLog.ts:89-91`).
4. O processador aceita `messages.upsert`, `connection.update`, `messages.update`, `messages.delete` e `contacts.upsert` em `server/router.ts:558-996`. Tipos desconhecidos também são persistidos e depois apenas registrados como aviso.
5. Filtros de assinatura, `fromMe`, grupos, broadcast, reaction, status/device e deduplicação de mensagem acontecem depois da persistência bruta (`server/router.ts:558-630`; `server/messageHandler.ts:1825-1895,2544-2575`).
6. Sucesso faz update de `processed_at`; falha grava erro, `next_attempt_at` e limpa lease (`server/webhookLog.ts:130-165`).
7. O replay de `supabase/migrations/066_native_from_me_takeover.sql:285-333` aceita somente `messages.upsert`, `fromMe=true`, `token_match`, vencido e sem lease ativo. `contacts.upsert`, `connection.update`, `messages.delete`, inbound `fromMe=false` e `token_missing` nunca são reprocessados automaticamente.
8. O worker consulta a fila a cada 5 s, até 20 itens, máximo de oito tentativas, em `server/webhookReplayWorker.ts:31-114`; inicia em `server/index.ts:578-583`.
9. O sweeper da aplicação inicia um minuto após o boot e roda diariamente. Ele dispara, em paralelo, deletes de processados com mais de 14 dias, não processados com mais de 21 dias e resíduos de `messages.update` (`server/webhookEventsSweeper.ts:19-68`; `server/index.ts:569-571`).
10. O `pg_cron` atual tem quatro jobs não relacionados: lifecycle diário, onboarding diário, nudge horário e limpeza semanal do storage. A retenção raw não vem de `pg_cron`.

## Plano da retenção

`EXPLAIN (COSTS, VERBOSE, FORMAT JSON)`, sem `ANALYZE`, para o delete histórico de 30 dias escolheu `Seq Scan`, custo estimado `0..3509,91`. Nenhuma linha foi alterada. `pg_stat_statements` registra essa consulta três vezes, totalizando 142,11062 s, 17,2% do tempo medido no snapshot e aproximadamente 1,06 GB de WAL conforme a evidência fornecida.

Os índices existentes cobrem `received_at`, `(empresa_id, received_at)`, `(empresa_id, wa_message_id)`, não processados e replay due. Não existe índice em `processed_at`.

## Amplificação em `zelochat_sessions`

- `ensureSession` faz read da família e update do payload completo, sempre alterando `updated_at`, em `server/messageHandler.ts:1254-1339`.
- O inbound chama `ensureSession` antes da deduplicação (`server/messageHandler.ts:2501-2559`). Uma reentrega duplicada, portanto, ainda escreve a sessão.
- Uma mensagem nova faz o update acima e depois chama `zelochat_increment_unread`, que escreve novamente e muda `updated_at` (`server/messageHandler.ts:2572-2576`; `supabase/migrations/000_zelochat_schema.sql:510-521`).
- `updated_at` participa de oito índices. `idx_zelochat_sessions_empresa_updated` e `zelochat_sessions_empresa_activity_idx` têm a mesma chave `(empresa_id, updated_at DESC)`.
- `CONTACTS_UPSERT` regrava a foto sem comparar o valor (`server/router.ts:973-991`; `server/messageHandler.ts:1342-1350`).
- Marcar lida, arquivar, fixar e renomear não usam `IS DISTINCT FROM`; abrir uma conversa já lida pode gerar nova versão da linha (`server/messageHandler.ts:2075-2095,2196-2209,2227-2277,2322-2338`).
- O perfil de IA também é atualizado sem comparar conteúdo (`server/ai.ts:3524-3527`).

Produção confirma a ordem de grandeza: cerca de 3.005 linhas vivas, 1.773 inserts e 128.547 updates, aproximadamente 72,5 updates por linha inserida. Só 18.569 updates (14,4%) foram HOT; cerca de 109.978 precisaram manter índices. Houve 352 autovacuums e 620 autoanalyzes.

## I/O e WAL evitáveis

Estimativas, não medições contrafactuais:

1. Parar de persistir `contacts.upsert`, `connection.update` e `messages.delete` reduziria 8.450 das 24.788 linhas vivas, 34,09%, e cerca de 20,3 MB do payload lógico vivo. Como esses tipos não entram no replay atual, também elimina seu update de sucesso, delete futuro, manutenção de índices e vacuum.
2. Aplicando linearmente 34,09% aos 4,48 GB históricos de WAL de inserts, a ordem de grandeza evitável é 1,53 GB. O ganho total do ciclo é maior por incluir updates e deletes, mas não deve ser somado sem nova medição.
3. Todos os 2.269 excedentes por `wa_message_id` pertencem a `messages.upsert`, sem sobreposição com os 8.450 tipos descartáveis. Filtragem + dedupe semântica validada alcançaria 10.719 linhas, 43,24% do vivo. Aplicada linearmente aos inserts e updates históricos, a ordem de grandeza é aproximadamente 1,94 GB de WAL de insert + 247 MB de WAL de update, cerca de 2,2 GB antes de deletes e vacuum. Dedupe estritamente byte a byte oferece um piso menor e mais seguro de 0,71%.
4. O índice parcial de retenção troca varreduras completas por lookup ordenado. Seu benefício cresce com a tabela; seu custo é manter mais um índice em cada transição para processado. Por isso deve acompanhar retenção curta e delete em lotes, não servir para justificar manter dados sem valor.
5. Em sessões, mover dedupe antes de `ensureSession`, evitar updates no-op, consolidar o incremento e remover o índice duplicado reduz tanto heap/WAL quanto a atual multiplicação por oito índices. A porcentagem precisa requer contadores depois do rollout.

## Plano de correção por impacto e risco

### P0 — instrumentar e limitar a origem, sem perder replay

1. Adicionar contadores agregados por `event_type`, tenant, instância, `fromMe`, grupo/broadcast/status e resultado de dedupe, sem payload e sem PII.
2. Tratar `messages.upsert` como allowlist do raw replay. Processar `contacts.upsert`, `connection.update` e `messages.delete` normalmente, mas sem reter payload bruto; guardar apenas contador agregado ou envelope mínimo de erro.
3. Persistir tipos desconhecidos somente quando falharem ou em amostragem limitada. Não manter payload integral de sucesso sem consumidor.

Impacto esperado: maior redução imediata, risco baixo porque os tipos removidos não são elegíveis ao replay atual. Manter logs agregados preserva diagnóstico operacional.

### P1 — retenção indexada e em lotes

Migration aplicada e validada em produção em 2026-09-18:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  zelochat_webhook_events_raw_processed_retention_idx
ON public.zelochat_webhook_events_raw (processed_at, id)
WHERE processed_at IS NOT NULL;
```

Foi implementada uma RPC de retenção que seleciona por índice com `LIMIT`, bloqueia com `FOR UPDATE SKIP LOCKED` e apaga lotes de 500 linhas, serialmente, com pausa de 100 ms entre lotes. Nenhuma limpeza histórica extraordinária foi executada durante a implantação.

Começar com sete dias para sucessos de `messages.upsert`; manter 21 dias para dead letter/falhas enquanto o suporte validar a necessidade. Retenção de três dias pode ser avaliada depois. Usar `processed_at` é semanticamente mais seguro que `received_at` para eventos que passaram dias aguardando replay; `received_at` só deve ser usado se o produto aceitar apagar logo após o processamento tardio.

### P1 — deduplicar antes do raw insert

Calcular fingerprint de um envelope canônico sanitizado e criar unicidade restrita ao contrato validado de `messages.upsert`. Em conflito, retornar o ID existente sem regravar payload nem marcar processamento novamente. Não usar apenas `wa_message_id`.

Implementado em 2026-09-18: cache curta em memória reduz redeliveries na mesma réplica, enquanto fingerprint SHA-256 de JSON canônico, RPC service-role e índice único parcial mantêm o banco como autoridade cross-replica. Payloads diferentes que reutilizam o mesmo `wa_message_id` permanecem distintos.

### P1 — reduzir escrita de sessão

1. Deduplicar a mensagem antes de atualizar a sessão.
2. Fazer update somente quando ao menos um valor material for distinto.
3. Consolidar `last_message`, `last_message_time`, `unread_count` e `updated_at` em uma operação atômica após insert novo.
4. Adicionar guards em marcar lida, foto, archive, pin, rename e perfil.
5. Depois de confirmar dependências, remover um dos dois índices idênticos em `(empresa_id, updated_at DESC)`.

### P2 — payload mínimo

Para replay, guardar envelope versionado com identificadores, direção, timestamp, tipo de mensagem e os campos estritamente necessários ao processador. Base64 já é removido no código atual; preservar essa proteção. Se for necessário investigar o payload integral, usar amostragem temporária e expiração curta.

### P3 — particionamento somente se ainda necessário

Não particionar agora. Com allowlist, sete dias, lotes e dedupe, o volume esperado é pequeno. Particionamento acrescentaria DDL, roteamento, migração e operação sem atacar a origem da escrita.

## Proposta mínima para permanecer no Free

1. Raw somente para `messages.upsert` replayável; demais tipos viram métrica agregada.
2. Sete dias para sucessos, 21 dias para falhas/dead letter.
3. Índice parcial `(processed_at, id)` e delete serial em lotes de 500.
4. Dedupe exato antes do insert bruto; depois de validar o contrato, chave idempotente de `messages.upsert` por tenant/tipo/ID.
5. Dedupe de mensagem antes de qualquer update de sessão, updates condicionais e remoção do índice duplicado.

Essa combinação ataca volume, frequência e custo por write. Upgrade de compute não é pré-requisito nem solução primária.

## Riscos de observabilidade e replay

- Filtrar eventos reduz a capacidade de reconstituir contatos, conexão e deletes. Mitigação: métricas agregadas, envelope de erro e amostragem temporária.
- Retenção curta reduz a janela de investigação. Mitigação: 21 dias para falhas/dead letter e export agregado sem PII.
- Fingerprint incorreta pode colapsar eventos distintos. Mitigação: modo observação primeiro, registrar `would_dedupe`, depois ativar apenas para contrato comprovado.
- Delete em lotes prolonga a limpeza. Isso é intencional: reduz picos de WAL e lock; monitorar backlog por idade.
- Índice concorrente ainda consome I/O durante construção. Criar fora do pico, monitorar e cancelar se pressionar o Nano.

## Rollout e rollback

1. Publicar somente métricas e modo sombra de filtro/dedupe por 7 dias.
2. Criar o índice concorrente fora do pico; validar o novo `EXPLAIN`.
3. Trocar o sweeper para um único lote pequeno por iteração, inicialmente ainda com 14/21 dias.
4. Ativar filtro de tipos por feature flag para o tenant dominante; observar 48–72 h; expandir.
5. Reduzir sucessos para sete dias depois de confirmar que nenhum suporte/replay depende da janela de 14 dias.
6. Ativar dedupe exata; deixar dedupe semântica por ID para uma etapa separada.
7. Otimizar sessões em rollout independente, com contadores de updates evitados.

Rollback: desligar flags de filtro/dedupe, restaurar retenção de 14 dias e manter o índice até estabilizar. A RPC em lotes pode voltar ao sweeper anterior sem restaurar dados apagados; por isso a redução de retenção deve ser a última etapa. Remover o índice somente depois do rollback estabilizado.

## Validação pós-correção

- Eventos/dia e bytes/dia por tipo e tenant, comparados com baseline de sete dias.
- Inserts, updates, deletes, `wal_bytes`, blocos sujos/escritos e autovacuum da raw.
- Percentual filtrado, `would_dedupe`, dedupe efetiva e colisões rejeitadas.
- Idade do item replayável mais antigo, quantidade due/leased/dead-letter e taxa de sucesso do replay.
- `EXPLAIN (ANALYZE, BUFFERS, WAL)` da RPC de lote em fixture ou transação com rollback; nunca medir com delete real irreversível.
- P95/duração e WAL por lote; confirmar ausência de pico no horário do sweeper.
- Updates de `zelochat_sessions` por mensagem nova, por duplicata e por conversa já lida; meta: zero update em duplicata/no-op.
- Repetir `supabase inspect db table-stats`, `outliers`, `index-stats`, `vacuum-stats`, `bloat` e `traffic-profile` após 7 e 30 dias.

## Consultas e comandos de comprovação

Executados pela CLI vinculada, somente leitura:

```bash
supabase projects list
supabase inspect db table-stats --linked
supabase inspect db outliers --linked
supabase inspect db index-stats --linked
supabase inspect db vacuum-stats --linked
supabase inspect db bloat --linked
supabase inspect db traffic-profile --linked
supabase inspect db calls --linked
supabase db query --linked "<SELECT agregado ou EXPLAIN sem ANALYZE>"
```

Consultas SQL de agregação usadas no diagnóstico, sem selecionar payload ou PII:

```sql
select event_type,
       count(*) as rows,
       round(100.0 * count(*) / sum(count(*)) over (), 2) as pct,
       round(avg(pg_column_size(payload))) as avg_payload_bytes,
       count(*) filter (where processed_at is null) as pending
from public.zelochat_webhook_events_raw
group by event_type
order by rows desc;

select encode(digest(empresa_id::text, 'sha256'), 'hex') as empresa_hash,
       encode(digest(instance, 'sha256'), 'hex') as instance_hash,
       count(*) as rows,
       count(*) filter (where processed_at is null) as pending
from public.zelochat_webhook_events_raw
group by 1, 2
order by rows desc;

select count(*) as duplicate_keys,
       sum(n) as rows_in_duplicate_keys,
       sum(n - 1) as excess_rows,
       max(n) as max_copies
from (
  select empresa_id, wa_message_id, count(*) n
  from public.zelochat_webhook_events_raw
  where wa_message_id is not null
  group by empresa_id, wa_message_id
  having count(*) > 1
) d;

explain (costs, verbose, format json)
delete from public.zelochat_webhook_events_raw
where processed_at is not null
  and processed_at < now() - interval '30 days';
```

Para `pg_cron`, foram lidos apenas metadados de `cron.job`. Nenhum job foi alterado.

## Segredos

A varredura sanitizada de código, migrations e jobs não encontrou credencial real convincente embutida. Os achados foram fixtures, placeholders ou fallbacks de teste, tratados como `<REDACTED>`. Nenhum valor foi copiado para este relatório.
