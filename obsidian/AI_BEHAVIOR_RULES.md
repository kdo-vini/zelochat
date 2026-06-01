# ZeloChat — Comportamento geral da IA

Fonte viva para decisões de atendimento automático. Use junto com [[CLAUDE]], [[CURRENT]] e [[FIXES_PROGRESS]].

## Princípio

A IA do ZeloChat deve operar como atendente de WhatsApp, não como chatbot genérico. Quando houver pedido, pagamento, estoque ou confirmação em jogo, decisões de estado precisam ser determinísticas sempre que possível.

Regra prática:

```text
mensagem do cliente + contexto da conversa + pending order
  → decisão operacional
  → só então OpenAI, se ainda precisar de linguagem/entendimento aberto
```

## Confirmação de pedido

Confirmações aceitas em contexto de pedido pendente:

- Texto claro: `sim`, `ok`, `fechado`, `pode confirmar`, `certinho`, `perfeito`, `combinado`, `com certeza`.
- Respostas de encerramento após pergunta de observação: `obrigado`, `valeu`, `boa noite`, `até amanhã`.
- Emoji explícito de consentimento: `👍`, `✅`, `👌`, `🙏`.

Não confirmar só com entusiasmo/reação genérica:

- `🔥`, `❤️`, `💕`, `👏`, `😊`.

Esses sinais podem indicar simpatia, elogio ou reação visual, não autorização para fechar pedido com dinheiro envolvido.

## Observações e loops

Quando a IA já perguntou:

> Gostaria de alterar algo, ou tem alguma observação a fazer?

As respostas abaixo significam "sem alteração" e devem avançar o fluxo, não repetir resumo:

- `nada`
- `sem obs`
- `sem observação`
- `sem alteração`
- `nada não`
- `não muda nada`
- `não, deixa como tá`

Se esse padrão aparece depois da pergunta de observação, o backend deve forçar a chamada de `criar_pedido` em vez de deixar a OpenAI responder texto livre e repetir o resumo.

## Alteração durante pedido pendente

Frases com confirmação + alteração não são confirmação final:

- `sim, sem cebola`
- `fechou, só coloca troco pra 50`
- `certo, mas troca a coca`
- `confirmar só se trocar o refri`

Frases de cancelamento parcial também não cancelam o pedido inteiro:

- `cancelar só a coca`
- `cancela a coca`
- `cancela a entrega, vou retirar`
- `cancelar a observação`

Comportamento esperado: preservar o texto da alteração, limpar a pendência antiga e processar a edição no mesmo turno com a IA, usando o resumo anterior como base. Não pedir para o cliente repetir o que ele acabou de dizer.

## Hard buttons vs linguagem natural

Botão real ou label exato:

- `CONFIRM_ORDER`
- `CANCEL_ORDER`
- `Confirmar`
- `Confirmar pedido`
- `Cancelar`
- `Cancelar pedido`

Linguagem natural não é hard button:

- `confirmar mais tarde?`
- `confirmar horário de amanhã`
- `cancelar só a coca`

Essas frases devem cair no classificador de turno, não no short-circuit de botão.

## Áudio e reações

Áudio transcrito deve ser tratado como texto do cliente no guardrail de pending order. Ex:

- áudio: `sim` → confirmação, se há pending order.
- áudio: `sim, mas sem cebola` → edição, não confirmação.

Reação de WhatsApp (`reactionMessage`) ainda precisa de política explícita por mensagem alvo. Decisão atual a perseguir no audit: reação `👍` no resumo do pedido deve confirmar ou pedir confirmação explícita, mas não ser ignorada silenciosamente.

## Estoque

Ver [[CLAUDE]] seção "Estoque no cardápio".

Resumo:

- `controlar_estoque=false`: IA trata como produto sem limite de estoque.
- `controlar_estoque=true` e `estoque_atual<=0`: produto não entra no cardápio da IA.
- `controlar_estoque=true` e `estoque_atual=N`: IA não pode abrir nem confirmar pedido acima de N unidades, somando linhas repetidas do mesmo produto.

## Testes de regressão

Arquivo principal: `tests/aiTurnDecision.test.ts`.

Também cobrem esse comportamento:

- `tests/conversationState.test.ts`
- `tests/conversationEdgeCases.test.ts`
- `tests/routerWebhookGuardrails.test.ts`
- `tests/aiPromptGuardrails.test.ts`

Qualquer mudança em confirmação, observação, pending order, botão, reação ou áudio deve adicionar caso nessa suíte antes de mexer em prompt.
