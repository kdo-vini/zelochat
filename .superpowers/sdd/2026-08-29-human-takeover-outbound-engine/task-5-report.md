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
  - `npx tsx tests/customerMessages.test.ts`
  - `npx tsx tests/auditFixGuardrails.test.ts`
  - `npx tsx tests/retryFailedMessage.test.ts`
  - `npx tsx tests/outboundQueue.test.ts`
  - `npm run lint`
