# Task 6 — relatório de implementação

Status: concluída localmente em 2026-08-30. Sem deploy, push ou alteração de anexos.

## Entregue

- `AiTurnPermit` nasce somente de inbound respondível persistido e atravessa debounce, endpoint direto, modelos, tools, fallbacks e helpers mutantes.
- `server/ai.ts` não cria mensagens pelo transporte direto; `enqueueAutomatedText` usa `ai_auto|ai_followup` com epoch e idempotência ligada ao trigger.
- Modelos e writes automáticos revalidam o permit antes/depois de etapas assíncronas relevantes; takeover concorrente retorna `null` e não cria job AI.
- Escalação toma a conversa e enfileira o texto contextual ao cliente como `system_handoff`; aviso ao gerente é um job detached `internal_system`, sem bolha/controle da conversa do cliente.
- Presença, read receipt e revogação permanecem efeitos diretos de protocolo.
- A migration 065 ganhou o enqueue idempotente de origens system e o worker exclui `internal_system` somente do rollout de CRM, preservando a fila durável.

## RED / GREEN

- RED: os guardrails novos detectaram sends customer-facing diretos e ausência do permit no scheduler/endpoint/helpers do estado inicial.
- GREEN: corridas determinísticas cobrem takeover por operador ZeloChat, WhatsApp nativo, toggle Manual e escalação, além de pre-model, tool follow-up, fallback de trigger, Pix e pending.

## Verificação

- `npx tsx tests/aiTakeoverRace.test.ts` — PASS.
- `npx tsx tests/aiOutboundGuardrails.test.ts` — PASS.
- `npx tsx tests/aiToolPlan.test.ts` — 23 pass, 0 fail.
- `npx tsx tests/conversationState.test.ts` — 118 pass, 0 fail.
- `npx tsx tests/replyDebouncer.test.ts` — 12 pass, 0 fail.
- `npx tsx tests/conversationOutbound.test.ts` — PASS.
- `npx tsx tests/conversationOutboundSchema.test.ts` — PASS.
- `npm run lint` — PASS.
- `git diff --check` — PASS (somente avisos de normalização LF/CRLF do checkout).

## Review — P0/P1 corrigidos no ciclo

- P0: acknowledgements contextuais de Pix eram tentados como AI depois do próprio takeover e seriam suprimidos pelo epoch; agora o texto viaja no `system_handoff` da escalação.
- P1: handoff em JID alternativo da mesma família podia não achar o controle por igualdade direta; o RPC resolve a família canônica antes do lock.
- P1: confirmação de pedido, transição Pix, aceite automático e atualização de perfil revalidam o permit imediatamente antes do write/model relevante.
- P1: `internal_system` inicialmente cairia no gate de campanhas; o worker agora o trata como notificação operacional durable, fora apenas do rollout CRM.

## P2/P3 para review final

- P2: mutations não-outbound (tag/pedido/Pix/perfil) usam recheck imediatamente anterior, mas não compartilham uma transação SQL com o epoch; uma RPC CAS por mutation eliminaria a janela residual entre check e write.
- P2: falha antes da criação do job `system_handoff` fica em log e no evento de escalação, mas ainda não possui alerta operacional dedicado/retry de intenção.
- P3: `server/ai.ts` permanece monolítico e torna os testes que o importam lentos; extrair o executor fenceado e os helpers de outbound reduziria startup e simplificaria mocks.

## Rollout

Aplicar a migration 065 antes do backend. Manter enforcement desligado até Task 7 e reconciliação `fromMe`; não houve execução de migration remota nesta tarefa.
