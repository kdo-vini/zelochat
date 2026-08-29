# Engine de tomada humana e outbound — Design aprovado

**Data:** 2026-08-29  
**Status:** aprovado em conversa; pronto para planejamento e execução  
**Escopo:** todos os P1/P2 confirmados na revisão de envio humano, corrida da IA, `fromMe` e lifecycle de outbound

## 1. Problema

Hoje, enviar uma mensagem como empresa e colocar a conversa em modo Manual são operações independentes. Um operador pode responder pelo ZeloChat ou pelo WhatsApp nativo enquanto a IA está no debounce, aguardando o modelo ou prestes a chamar o transporte. O resultado possível é o cliente receber uma resposta humana e outra automática para o mesmo turno.

O sistema também não guarda uma origem durável para todo outbound. Mensagens humanas, IA e notificações compartilham `role='assistant'`; rotas especiais não usam o mesmo lifecycle; e o webhook `fromMe` depende parcialmente de memória local para distinguir eco do servidor de envio humano.

## 2. Objetivo e invariantes

A entrega deve garantir:

1. Todo outbound humano conversacional assume a conversa antes do envio.
2. Takeover humano mantém `status` da sessão; ele não cria escalonamento artificial.
3. Retomar a IA é sempre uma ação explícita e cria uma nova geração de controle.
4. Depois que o takeover é confirmado, nenhum novo outbound de IA pode ser autorizado.
5. Para envios feitos pelo ZeloChat, se um outbound de IA já havia sido autorizado, ele é serializado antes da mensagem humana; nunca aparece depois dela por uma corrida entre réplicas.
6. Debounce e cancelamento em memória são otimizações de UX, não a garantia de segurança.
7. Todo outbound tem origem, política de takeover, lifecycle e idempotência duráveis.
8. Eco do servidor nunca é confundido com humano; envio humano nativo nunca é confundido com eco.
9. Mensagens transacionais, campanhas e automações não pausam a IA por conta própria.
10. Falha ou entrega ambígua nunca é apresentada como “não enviada” com retry cego.

## 3. Limite físico da garantia

Uma chamada que já alcançou o transporte não pode ser revogada pelo ZeloChat. A linearização ocorrerá quando o job muda atomicamente de `sending` para `dispatch_started`, imediatamente antes da chamada externa.

- Se o takeover vencer antes do claim da IA, o job de IA é cancelado e não chama o transporte.
- Se a IA vencer antes do takeover, seu job termina ou é reconciliado antes de o job humano daquela conversa ser enviado.
- A rota humana aguarda o próprio job até um prazo curto e pode responder `202` se o worker ainda estiver processando.

Esse contrato evita a ordem mais confusa — humano primeiro e IA depois — sem manter uma transação PostgreSQL aberta durante uma chamada de rede.

O WhatsApp nativo está fora da fila do ZeloChat: a mensagem física já saiu do celular antes de o webhook chegar. Nesse caminho, a garantia começa no commit do takeover: nenhum novo dispatch de IA é autorizado depois dele. Uma IA que alcançou o transporte durante o atraso do webhook é uma limitação física observada por métrica, não algo que o servidor consiga revogar.

## 4. Classificação de outbound

```ts
export type OutboundOrigin =
  | 'human_zelochat'
  | 'human_native_whatsapp'
  | 'ai_auto'
  | 'ai_followup'
  | 'system_handoff'
  | 'system_transactional'
  | 'campaign'
  | 'automation'
  | 'internal_system';

export type TakeoverPolicy = 'take_over' | 'preserve_ai';
```

| Origem | Exemplos | Política |
|---|---|---|
| `human_zelochat` | compositor, resposta rápida, CRM, mídia, vCard, lista, localização, reação, enquete e retry manual | `take_over` |
| `human_native_whatsapp` | texto, mídia, contato, localização, sticker ou reação enviados no celular | `take_over` |
| `ai_auto` / `ai_followup` | resposta e follow-ups produzidos pela IA | `preserve_ai`, mas exigem geração vigente |
| `system_handoff` | mensagem automática de encaminhamento após escalonamento | `preserve_ai`, permitida com modo Manual |
| `system_transactional` | status/aceite de pedido, notificações e despacho | `preserve_ai` |
| `campaign` / `automation` | CRM outbound existente | `preserve_ai` |
| `internal_system` | integração autenticada servidor-servidor | `preserve_ai` |

Read receipts, presença, atualizações de entrega e artefatos de protocolo não são outbound conversacional. Revogação de mensagem também não assume a conversa. Uma reação genuinamente feita pelo humano assume, pois já representa atuação manual sobre o atendimento.

## 5. Módulos e seams

### 5.1 `conversationControl`

Módulo profundo que esconde família de JIDs, epoch, auditoria, compatibilidade com `auto_reply` e cancelamento de jobs antigos.

```ts
export interface AiTurnPermit {
  empresaId: string;
  conversationControlId: string;
  remoteJid: string;
  epoch: string;
  triggerMessageId: string;
}

export type TakeoverSource =
  | 'zelochat_operator'
  | 'native_whatsapp'
  | 'explicit_manual_toggle'
  | 'escalation';

export async function beginAiTurn(params: {
  empresaId: string;
  remoteJid: string;
  inboundMessageId: string;
}): Promise<AiTurnPermit | null>;

export async function claimHumanTakeover(params: {
  empresaId: string;
  remoteJid: string;
  actorUserId: string | null;
  source: TakeoverSource;
  sourceMessageId?: string | null;
}): Promise<ConversationControlSnapshot>;

export async function resumeAiConversation(params: {
  empresaId: string;
  remoteJid: string;
  actorUserId: string;
}): Promise<ConversationControlSnapshot>;
```

O chamador não conhece membros da família. O banco mantém um `conversation_control_id` canônico e durável; sessões e jobs referenciam esse ID. Uma função SQL de identidade usa `person:<pessoa_id>` quando há vínculo canônico e, caso contrário, `phone:<contact_key>` com a mesma normalização brasileira de `buildContactKey`. Trigger/RPC com lock funde controles quando uma sessão ganha `pessoa_id`; conflito usa “humano vence” e epoch máximo + 1, reatribuindo referências ao controle vencedor. Uma nova variação é vinculada ao controle antes de ficar elegível para IA.

### 5.2 `conversationOutbound`

Único seam para efeitos externos dirigidos a uma conversa.

```ts
export interface QuotedContext {
  waMessageId: string;
  fromMe: boolean;
  remoteJid: string;
  previewText?: string;
}

export interface ConversationOutboundRequest {
  empresaId: string;
  remoteJid: string;
  actorUserId: string | null;
  origin: OutboundOrigin;
  takeoverPolicy: TakeoverPolicy;
  idempotencyKey: string;
  payload: OutboundPayload;
  aiPermit?: AiTurnPermit;
  messageId?: string | null;
}

export type DispatchResult =
  | { state: 'sent'; jobId: string; messageId: string | null; providerMessageId: string }
  | { state: 'queued'; jobId: string; messageId: string | null }
  | { state: 'failed_before_dispatch'; jobId: string; messageId: string | null; friendlyMessage: string }
  | { state: 'delivery_uncertain'; jobId: string; messageId: string | null; friendlyMessage: string }
  | { state: 'suppressed'; jobId: string; messageId: string | null; reason: 'paused' | 'stale_epoch' };

export async function dispatchConversationOutbound(
  request: ConversationOutboundRequest,
): Promise<DispatchResult>;
```

O módulo aplica takeover quando necessário, cria mensagem/ledger, enfileira, aguarda terminal por prazo limitado e retorna resultado estável. Rotas não chamam adaptadores de WhatsApp diretamente.

### 5.3 `outboundWorker`

O worker existente será aprofundado para suportar jobs conversacionais sem perder as regras de campanha/automação. O claim bloqueia a mesma row canônica de controle usada pelo takeover e garante apenas um job `sending|dispatch_started` por `conversation_control_id` em todas as réplicas.

O worker:

1. reclama lease vencida;
2. faz claim atômico do próximo job elegível;
3. revalida epoch/modo para jobs de IA sob lock da row de controle;
4. grava `dispatch_started_at` antes da chamada externa;
5. envia pelo adapter apropriado ao payload;
6. persiste `sent`, `failed_before_dispatch` ou `delivery_uncertain` condicionado ao `lease_owner`;
7. atualiza a bolha da mensagem quando existe;
8. libera o próximo job da conversa.

Lease vencida em `sending`, antes do transporte, pode ser reclamada. Lease vencida em `dispatch_started` vira `delivery_uncertain`, nunca retry automático. A conversa entra em hold até eco/reconciliação ou liberação explícita e auditada; jobs seguintes continuam queued.

### 5.4 `fromMeProcessor`

Classifica e processa `messages.upsert` com `fromMe=true` de forma aguardada.

Ordem de classificação:

1. `wa_message_id` já ligado a job/mensagem do servidor: eco/duplicata.
2. ID rastreado pelo processo que acabou de receber a resposta externa: eco legado a reparar.
3. Job `dispatch_started` com mesmo controle/fingerprint, mas ainda sem ID: correlação pendente; bloquear novos AI dispatches, aguardar o ID e nunca decidir somente pelo fingerprint.
4. Sem candidato do servidor e payload humano visível: envio humano nativo.
5. Receipt, presença, grupo, broadcast ou artefato: ignorar.

Como todo envio do servidor cria o job antes do transporte, a corrida antiga deixa de depender apenas do instante em que `wa_message_id` é gravado. O fingerprint é SHA-256 de uma representação canônica por tipo, mas funciona como candidato, não como prova: um humano pode enviar conteúdo byte-idêntico. Correlação pendente espera o ID retornado pelo transporte; se o job receber outro ID, o evento vira humano. Se o wrapper nunca fornecer ID, o evento fica em hold/dead-letter e aquele tipo não entra em `enforce`. Payload sem fingerprint reproduzível também permanece em erro/replay até existir fixture real validada.

## 6. Persistência

Uma migration aditiva criará ou estenderá:

### `zelochat_conversation_ai_control`

- `id uuid` canônico, `empresa_id` e `identity_key` tenant-scoped unique;
- `mode`: `ai | human`;
- `epoch bigint` monotônico;
- hold de correlação/entrega incerta;
- `changed_at`, `changed_by_actor`, `changed_source`;
- `latest_inbound_message_id` e `latest_takeover_message_id` opcionais.

### `zelochat_conversation_control_events`

- evento auditável `ai_turn_started | human_takeover | ai_resumed | ai_job_suppressed`;
- empresa, JID, epoch, ator, origem, mensagem/job relacionado e horário;
- server-only; retenção operacional definida no runbook.

### `zelochat_sessions`

- `conversation_control_id` obrigatório após backfill;
- `auto_reply` continua como projeção compatível para UI, métricas e código legado;
- takeover/resume atualiza todas as rows da família na mesma RPC;
- não usar `status='escalated'` para takeover comum.

### `zelochat_messages`

- `outbound_origin` obrigatório para novas mensagens de saída;
- `outbound_actor_user_id` opcional;
- vínculo opcional ao job;
- lifecycle canônico inclui `preparing`, `queued`, `sending`, `dispatch_started`, `sent`, `failed_before_dispatch`, `delivery_uncertain`, `cancelled`; `failed` é aceito apenas durante rolling deploy e removido na migration de limpeza.

### `zelochat_outbound_jobs`

- `job_type` passa a aceitar `conversation`;
- adiciona `conversation_control_id`, JID de transporte, message ID, origem, policy, payload persistido por referência, epoch esperado e causa de supressão;
- adiciona `payload_fingerprint` para abrir a correlação pendente; o ID externo continua sendo a prova definitiva;
- idempotência tenant-scoped é adicionada antes de remover a unicidade global, preservando writers antigos durante rolling deploy;
- índice parcial impede dois jobs `sending|dispatch_started` para o mesmo controle;
- jobs de campanha/automação são backfilled sem alterar seu comportamento.

Mídia nunca é gravada como Data URL no JSONB. Antes do enqueue, bytes são enviados ao bucket existente em um caminho imutável ligado ao job; o payload persistido contém somente `storage_path`, MIME, nome, tamanho e checksum. O asset é removido apenas após estado terminal + período de graça. Resposta externa `2xx` sem message ID é `delivery_uncertain`, nunca `sent`.

Todas as RPCs usam `SECURITY DEFINER`, `set search_path = public, pg_temp`, validação tenant-scoped e grants somente para `service_role`.

## 7. Fluxos

### 7.1 Operador envia pelo ZeloChat

1. Rota resolve ator, empresa e `clientes.comunicar`, e recebe idempotency key gerada pelo cliente por intenção.
2. Uma RPC `begin_human_conversation_outbound` reserva a chave; somente o primeiro writer incrementa epoch, muda modo para humano, projeta `auto_reply=false`, registra auditoria, cria mensagem/job e cancela IA queued/stale.
3. Backend cancela debounce/presença local.
4. `dispatchConversationOutbound` cria a intenção e enfileira a mensagem humana.
5. Worker respeita a ordem da conversa e envia.
6. UI recebe `conversation_mode_changed` e lifecycle da mensagem.
7. Falha do transporte não reativa a IA.

### 7.2 Operador envia pelo WhatsApp nativo

1. A resposta HTTP continua rápida após gravar o raw event; um processor/replayer leased executa `fromMeProcessor` at-least-once.
2. Se for eco, vincula/repara e não muda o modo.
3. Se for humano e o webhook tiver autenticação forte, uma RPC idempotente persiste mensagem/job como `sent` e executa takeover na mesma transação. Evento sem token válido fica somente em shadow/alerta.
4. Após commit, cancela debounce local e transmite mensagem + modo Manual.
5. Falha ou correlação pendente marca o raw webhook para replay com attempt, lease, backoff e dead-letter.

### 7.3 Cliente envia e a IA responde

1. Mensagem inbound nova e deduplicada chama `beginAiTurn`; redelivery não avança epoch.
2. Debouncer recebe `AiTurnPermit` e coalesce somente localmente.
3. Todos os caminhos customer-facing da IA exigem o permit antes de tool effect e enqueue.
4. RPC de enqueue rejeita epoch antigo ou modo humano.
5. Worker repete a validação no claim.
6. Job suprimido não chama o transporte e registra métrica/auditoria.

### 7.4 Toggle e escalonamento

- Toggle Manual chama o mesmo takeover do envio humano.
- Toggle IA chama `resumeAiConversation`; jobs antigos nunca são restaurados.
- Escalonamento chama takeover com `source='escalation'`, altera `status` separadamente e envia handoff com origem `system_handoff`, autorizado mesmo no modo humano.

## 8. Falhas e UX

| Estado | Copy | Ação |
|---|---|---|
| `preparing` / `queued` / `sending` / `dispatch_started` | “Enviando…” | aguardar atualização em tempo real |
| `failed_before_dispatch` | “Mensagem não enviada.” | retry idempotente permitido |
| `delivery_uncertain` | “Não foi possível confirmar a entrega.” | nova cópia somente após confirmação explícita |
| `suppressed` de IA | não aparece como bolha ao cliente | métrica/log interno |

Erros consumidos pela UI não expõem nomes de fornecedores, endpoints, webhooks, upstream, timeout ou erro bruto.

`delivery_uncertain` mantém hold da conversa. A UI informa que um envio anterior está sendo confirmado e deixa a nova mensagem queued; somente eco/reconciliação ou uma liberação manual explícita e auditada remove o hold.

## 9. Observabilidade

Métricas mínimas:

- takeovers por `source`;
- tempo takeover → envio humano;
- jobs de IA suprimidos por epoch/modo;
- jobs por estado e idade do mais antigo;
- leases vencidos/stuck;
- decisões `fromMe`: eco, reparo, humano, duplicata, ignorado;
- entrega incerta por tipo de payload;
- atraso timestamp nativo → commit do takeover;
- correlações `fromMe` pendentes/dead-letter;
- divergência mensagem ↔ job ↔ ID externo.

Logs usam empresa/JID redigido e IDs técnicos, nunca conteúdo integral do cliente.

## 10. Rollout e rollback

1. Aplicar migration e verificação SQL antes do backend.
2. Publicar observação compatível em modo `shadow`, gravando somente decisões `would_*` e sem takeover/job conversacional.
3. Validar classificação `fromMe` com payloads sanitizados de tenant de teste.
4. Ativar `enforce` por empresa no compositor principal e CRM.
5. Ativar IA enfileirada e testes de corrida em tenant piloto.
6. Migrar todos os payloads especiais, transacionais, gerenciais, campanhas e automações; o guardrail global de bypass precisa estar verde.
7. Só então ativar `fromMe=enforce`; até esse gate, nativo permanece shadow.
8. Ativar globalmente após métricas e fila estáveis.

Rollback retorna a flag para `shadow`, desliga globalmente os auto-replies enquanto o caminho de emergência estiver ativo, mantém ledger e conversas já tomadas em modo Manual, e nunca reativa IA automaticamente. Migration não é revertida.

## 11. Critérios finais de aceite

- Texto/mídia/áudio/resposta rápida/CRM/retry e payloads especiais humanos assumem a conversa.
- Envio humano nativo assume a conversa sem criar escalonamento.
- Eco rápido de painel, IA, handoff ou sistema não assume a conversa.
- Nenhum customer-facing send da IA contorna o dispatcher.
- Duas réplicas não enviam dois jobs simultâneos para a mesma conversa canônica.
- Takeover durante debounce ou modelo impede o outbound da IA.
- No ZeloChat, se a IA já estava `dispatch_started`, a mensagem humana não a ultrapassa; no WhatsApp nativo, a garantia começa no commit do webhook.
- Falha do envio humano mantém a conversa em modo Manual.
- Mensagens transacionais/campanhas/automações não pausam a IA.
- Toda mudança tem teste red → green, documentação de sprint e rollout verificável.
