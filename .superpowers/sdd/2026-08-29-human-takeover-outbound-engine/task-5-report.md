# Task 5 Report — dispatcher único e semântica de falha

Data: 2026-08-30

## Entregue

- Criado `server/conversationOutbound.ts` com `dispatchConversationOutbound` e factory injetável para testes.
- Envio humano pelo ZeloChat reserva a intenção via `begin_zelochat_human_outbound` antes de qualquer upload/envio, cancela debounce local após takeover e aguarda estado terminal por `CONVERSATION_SEND_WAIT_MS` (default 10s).
- Mídia é reservada como job `preparing`; o upload usa o job id e só depois atualiza o job para `queued` com payload persistido e fingerprint compatível com o provider adapter.
- Origem AI exige `AiTurnPermit`; o enqueue é uma RPC tenant-scoped que resolve `remoteJid→controle` no banco, exige mesmo `conversation_control_id`, modo `ai` e epoch, e reserva bolha+job/idempotência na mesma transação.
- `messageHandler` agora aceita lifecycle na criação de intenção (`origin`, `actorUserId`, `initialStatus`, `outboundJobId`) e expõe estados `failed_before_dispatch`, `delivery_uncertain` e `cancelled`.
- `OutboundWorker` ganhou `runBatch` com concorrência local limitada por conversa; o banco continua sendo o mutex autoritativo cross-replica.

## RED/GREEN

- RED confirmado:
  - `npx tsx tests/conversationOutbound.test.ts` falhou com `ERR_MODULE_NOT_FOUND` para `server/conversationOutbound.js`.
  - `npx tsx tests/conversationOutboundWorker.test.ts` falhou com `runBatch is not a function`.
- GREEN confirmado:
  - `npx tsx tests/conversationOutbound.test.ts`
  - `npx tsx tests/customerMessages.test.ts`
  - `npx tsx tests/conversationOutboundWorker.test.ts`
  - `npm run lint`

## Fora do escopo mantido

- Rotas humanas, CRM e callers de IA ainda não foram migrados para o dispatcher.
- Reconciliador/classificador `fromMe` ainda não foi implementado.
- Nenhum deploy, push ou aplicação de migration foi feito nesta task.

## Concerns

- `ZeloChat.memory` não existe na raiz como citado no `AGENTS.md`; a memória real usada foi `docs/ai/ZeloChat.memory.md`.
- O helper antigo `createAssistantMessageIntent` agora inicia em `queued` por padrão para alinhar com o lifecycle novo; callers legados ainda podem marcar sucesso/falha com os helpers existentes durante o rolling deploy.

## Fix Round 1 — P1s

- Mídia agora tem ownership/CAS explícito durante a preparação (`claim/complete/fail_zelochat_outbound_media_preparation`). Retries concorrentes da mesma idempotency key relêem o job existente; perdedores não fazem upload, não transformam `queued` válido em `failed_before_dispatch` e não retornam erro técnico.
- `begin_zelochat_human_outbound` retorna `takeover_applied` real junto do job: primeiro writer aplica takeover/evento/debounce; retry idempotente retorna o mesmo job com `takeover_applied=false`.
- `enqueue_zelochat_ai_outbound` foi adicionado como RPC atômica e tenant-scoped. O dispatcher rejeita permit de outro tenant/JID antes da RPC e a RPC ainda valida session/control/mode/epoch sob lock antes de reservar a mensagem e o job.
- Mídia AI com permit válido segue o mesmo ciclo seguro de mídia humana: job `preparing`, asset `outbound/<empresa>/<job>/<checksum>`, CAS `preparing→queued`.
- `broadcast dispatch_started` no worker ficou fail-soft/out-of-band: falha de WebSocket não impede o POST nem cria `delivery_uncertain` sem chamada ao transporte.
- Compatibilidade rolling mantida para `failed` e `failed_before_dispatch` na rota retry, `MessageBubble`, `ChatView`, `useWhatsAppSessions`, thread de mensagens CRM e helper de domínio.

## RED/GREEN — Fix Round 1

- RED confirmado:
  - `npx tsx tests/conversationOutbound.test.ts` falhou em mídia concorrente com erro técnico/estado nulo antes do CAS.
  - `npx tsx tests/conversationOutboundWorker.test.ts` falhou porque rejeição do broadcast abortava antes do POST.
  - `npx tsx tests/customerMessages.test.ts` falhou por ausência do helper `isRetryableOutboundFailure`.
- GREEN confirmado:
  - `npx tsx tests/conversationOutbound.test.ts`
  - `npx tsx tests/conversationOutboundWorker.test.ts`
  - `npx tsx tests/auditFixGuardrails.test.ts`
  - `npm run lint`
  - `npx tsx tests/customerMessages.test.ts`
  - `npx tsx tests/auditFixGuardrails.test.ts`
  - `npx tsx tests/retryFailedMessage.test.ts`
  - `npx tsx tests/outboundQueue.test.ts`
  - `npm run lint`

## Fix Round 2 — P1

- `enqueue_zelochat_ai_outbound` agora valida o caminho de idempotência existente antes de retornar: mesma `empresa_id`, `conversation_jid`, `conversation_control_id`, `control_epoch`, `outbound_origin` e fingerprint/payload esperados. Reuso divergente retorna vazio para o dispatcher suprimir, sem devolver job de outra conversa.
- Mídia passa a persistir `intent_payload_fingerprint` antes do upload; `payload_fingerprint` pode virar fingerprint de transporte após materialização, mas retries continuam comparando a intenção original.
- `claim_zelochat_outbound_media_preparation` exige a fingerprint de intenção, então payload de mídia divergente não adquire ownership de preparação nem chama upload/provider sobre job original.
- O dispatcher mantém validação defensiva local do job retornado pela RPC antes de preparar mídia, cobrindo rolling deploy e doubles de teste que retornem idempotência ampla demais.

## RED/GREEN — Fix Round 2

- RED confirmado:
  - `npx tsx tests/conversationOutbound.test.ts` falhou porque um retry AI com mesma idempotency key e JID/control divergente voltou como `queued` em vez de `suppressed`.
- GREEN confirmado:
  - `npx tsx tests/conversationOutbound.test.ts`
  - `npx tsx tests/conversationOutboundWorker.test.ts`
  - `npx tsx tests/auditFixGuardrails.test.ts`
  - `npm run lint`

## Fix Round 3 — P1 rolling deploy

- Preservado o overload legado `claim_zelochat_outbound_media_preparation(uuid, uuid, text, integer)` para réplicas antigas. Ele só claima mídia `preparing` no envelope legado esperado (`preparing/<zero-checksum>`, metadata mínima e intent nula ou igual ao fingerprint legado), enquanto o overload novo de 5 args continua autoritativo para adoção de fingerprint de intenção.
- Retry exato de mídia `preparing` criada antes do Round 2, com `intent_payload_fingerprint=null`, não é mais suprimido: o dispatcher aceita o envelope pre-R2 quando destino/controle/epoch/origem/payload legado batem, e o claim novo adota `intent_payload_fingerprint` atomicamente com `coalesce`.
- Depois da adoção, retries com payload de mídia divergente falham fechado e não sobrescrevem a intenção adotada, não adquirem ownership e não chamam upload/provider.

## RED/GREEN — Fix Round 3

- RED confirmado:
  - `npx tsx tests/conversationOutbound.test.ts` falhou porque retry exato de mídia pre-R2 voltou `suppressed` em vez de `queued`.
  - `npx tsx tests/conversationOutboundWorker.test.ts` falhou porque o overload legado de 4 args não estava presente/garantido.
- GREEN confirmado:
  - `npx tsx tests/conversationOutbound.test.ts`
  - `npx tsx tests/conversationOutboundWorker.test.ts`

## Fix Round 4 — P1 human media pre-R2

- O dispatcher novo agora rejeita toda mídia humana `preparing` sem `intent_payload_fingerprint` forte, inclusive retry aparentemente exato: metadata legada não prova os bytes da intenção original.
- A rejeição ocorre antes de claim/upload/provider e retorna `failed_before_dispatch` com copy amigável pedindo novo envio, sem alterar ownership, payload, fingerprint ou status do job legado.
- Jobs humanos novos com fingerprint forte continuam reutilizando a mesma idempotency key sem upload duplicado.
- O overload novo de 5 argumentos só pode adotar null-intent para `ai_auto|ai_followup`; o overload legado de 4 argumentos foi preservado sem alteração para réplicas antigas durante o rollout, e AI pre-R2 mantém o comportamento revisado.

## RED/GREEN — Fix Round 4

- RED confirmado:
  - `npx tsx tests/conversationOutbound.test.ts` retornou `queued` para retry humano pre-R2 em vez de falhar antes do claim.
  - `npx tsx tests/conversationOutboundWorker.test.ts` mostrou que o claim novo de 5 argumentos ainda não limitava adoção nula a origens AI.
- GREEN confirmado:
  - `npx tsx tests/conversationOutbound.test.ts`
  - `npx tsx tests/conversationOutboundWorker.test.ts`
  - `npx tsx tests/auditFixGuardrails.test.ts` (38 pass, 0 fail)
  - `npm run lint`
- A suíte unitária completa foi iniciada sem falhas nos blocos executados, mas interrompida no caminho lento conhecido por não fazer parte do gate deste round; a validação global permanece para a Task 11.
