# ZLM-310 — IA do ZeloChat para de criar pedidos (fonte única no ZeloMenu)

**Data:** 2026-06-25
**Decisão:** D-106 (ver `ZELOMENU_LINEAR_PLAN.md`)
**Repo:** ZeloChat (`/home/vinicius/code/zelochat`)
**Status:** implementado, `tsc` limpo, testes verdes (exceto 2 drifts pré-existentes não relacionados)

---

## Por quê

Cada loja agora tem cardápio próprio no ZeloMenu (`menu.zelopdv.com.br/{slug}`).
Manter a IA do WhatsApp montando pedido em paralelo criava **duas fontes** de
pedido (WhatsApp-AI e ZeloMenu) com semânticas, cálculo de taxa e estado
divergentes. A decisão D-106 unifica: **pedido nasce só no ZeloMenu**; a IA
apenas orienta, redireciona, consulta status e dá suporte pós-venda.

O commit anterior (`29e2198`) já tinha trocado o **prompt** e tirado a tool da
stack, mas o trabalho estava incompleto e quebrado:

1. **Link quebrado (bloqueador):** o prompt mandava enviar
   `menu.zelopdv.com.br/{slug}`, mas `{slug}` era texto literal — o slug nunca
   era injetado. A IA mandava um link inválido ou, seguindo a instrução de
   "descubra o slug", chamava uma tool que não retorna slug e travava.
2. **Bug latente (OpenAI 400):** `forceCreateOrderFromObservationAck` ainda
   forçava `tool_choice: { name: 'criar_pedido' }` numa tool que não estava mais
   no array `tools` → a API da OpenAI rejeita a request (400) sempre que essa
   flag fosse `true`.
3. **Código morto:** handler de `criar_pedido`, `setPendingOrder`, cluster de
   detecção de observação, imports do fluxo de carrinho — tudo órfão.

## O que mudou

### 1. Slug injetado de verdade (corrige o link)
- `server/configStore.ts`
  - `BusinessConfig.zelomenuSlug: string | null` (novo campo; default `null`).
  - `loadAiSettingsFromDb` carrega `empresa_perfil.zelomenu_slug` por uma **query
    isolada e fail-soft**, deliberadamente FORA da cadeia de `select` com
    fallback multi-variante — uma coluna ausente nunca pode silenciar a
    hidratação (que silenciaria a IA inteira). Falha → `slug = null`.
- `server/ai.ts`
  - `getZeloMenuPublicBaseUrl()`: base do storefront, default
    `https://menu.zelopdv.com.br`, override `ZELOMENU_PUBLIC_BASE_URL`.
  - `buildSystemInstruction` monta o link real com
    `buildPublicStoreUrl(getZeloMenuPublicBaseUrl(), cfg.zelomenuSlug)`.
  - **Sem slug → o prompt instrui a IA a escalar para humano**
    (`dispatch_trigger`/`escalate_human`), nunca a enviar link quebrado.

### 2. Remoção do fluxo de criação de pedido pela IA
- Tool `criar_pedido` (`CREATE_ORDER_TOOL`) removida da definição e da stack
  (`tools` em `generateAndSendReply`). Restam `CONSULT_ORDER_TOOL` +
  `DISPATCH_TRIGGER_TOOL` (+ `APPLY_TAG_TOOL` quando há auto-tags).
- Handler de `criar_pedido` (~396 linhas) removido.
- `setPendingOrder` removido (único caller era o handler).
- `forceCreateOrderFromObservationAck` (flag, mensagem de sistema e o override de
  `tool_choice`) removido — **fim do bug latente OpenAI 400**.
- Cluster de detecção de "ack de observação" removido
  (`ORDER_OBSERVATION_ACK_INTENTS`, `normalizeLooseIntentText`,
  `looksLikeObservationPrompt`, `looksLikeOrderSummaryBeforeObservation`,
  `isImplicitNoObservationReply`, `shouldForceCreateOrderAfterObservationPrompt`).
- Imports órfãos removidos (`openWhatsAppCartSession`, `buildWhatsAppCartLinkMessage`,
  `buildPublicCartUrl`, `resolveProductBySemantic`, `shouldFinalizeAfterObservationAck`,
  `type SemanticResolution`).

### 3. Rede de segurança dormente (retida de propósito)
`confirmPendingOrder`, `cancelPendingOrder`, `getPendingOrder`, o guardrail de
pending-order em `generateAndSendReply` e os atalhos de botão (hard/soft
confirm/cancel) em `router.ts` foram **mantidos**. Justificativa: nada mais cria
pending rows, então essas funções drenam qualquer pedido pendente que já exista
no DB no momento do deploy (via TTL `PENDING_ORDER_TTL_MIN`) e depois viram
no-op (`getPendingOrder` sempre retorna `null`). Removê-las do hot-path P0 do
webhook seria risco de regressão puro, sem ganho funcional.

### 4. Simulador alinhado
- `server/aiSimulator.ts`: removidos `CREATE_ORDER_TOOL` e o dry-run de
  `criar_pedido`. `SimulateResult.wouldCreateOrder` mantido (sempre `false`) por
  compatibilidade com o frontend (`src/components/views/AIConfigsView.tsx`).

### 5. Testes
- `tests/aiZeloMenuGuardrails.test.ts` — reescrito: agora trava a **ausência** do
  código de criação de pedido e a **presença** do link via slug.
- `tests/aiPromptGuardrails.test.ts` — reescrito o caso de pedido: valida a regra
  de redirecionamento, a URL real da loja no prompt, e o fallback de escalação
  quando não há slug.
- `tests/aiSchedule.test.ts` — fixture `makeConfig` ganhou `zelomenuSlug`.

## Comportamento resultante da IA

| Cliente diz | IA faz |
|---|---|
| "quero fazer um pedido" | manda o link `menu.zelopdv.com.br/{slug}` |
| "qual o preço de X?" | "os preços estão no cardápio online, por lá você monta e vê o valor" |
| "vocês entregam? quanto é a taxa?" | "a taxa aparece no cardápio quando você informa o endereço" |
| "cadê meu pedido?" | chama `consultar_pedido` e responde o status |
| (loja sem slug configurado) | escala para humano (`escalate_human`) |

## Fonte única de pedidos

Todo pedido nasce no ZeloMenu (`public_order`):
`zelochat_orders.source='zelomenu'` e `pedidos.origem='zelomenu'` (D-096).
A origem `source='whatsapp'` deixa de produzir pedidos novos.

## Validação

- `npx tsc --noEmit` → **0 erros**.
- `npm run test:unit` → verde, exceto **2 falhas pré-existentes e não
  relacionadas** (confirmadas com as mudanças em stash):
  - `tests/auditFixGuardrails.test.ts` — espera env `WEBHOOK_ALLOW_MISSING_TOKEN_DURING_ROLLOUT`; o código usa `WEBHOOK_REQUIRE_TOKEN` (drift de auth de webhook, já listado em `CURRENT.md` › Em aberto).
  - `tests/zelomenuSlug.test.ts` — espera URL com prefixo `/menu/`; produção usa raiz limpa (D-006).
- ~661 linhas de código removidas em `server/ai.ts`.

## Pendências de operação (não código)

- **Garantir que toda loja ativa tem `empresa_perfil.zelomenu_slug` setado** antes
  do cutover. Sem slug, a IA daquela loja escala todo pedido para humano (degradação
  segura, mas não é o fluxo desejado).
- Confirmar `ZELOMENU_PUBLIC_BASE_URL` no deploy se o storefront não estiver em
  `menu.zelopdv.com.br`.
