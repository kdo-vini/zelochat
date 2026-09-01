# Issue #22 — Simulador canônico da IA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o simulador de atendimento percorrer o mesmo fluxo canônico de pedidos usado pelo WhatsApp em modo dry-run, sem envio ou gravação, para que respostas de cardápio, modificadores, pedido escrito e handoff sejam fiéis e consistentes.

**Architecture:** Extrair a decisão canônica já existente em `server/aiWhatsAppOrdering.ts` para aceitar um modo `dryRun` e um cliente interno injetável. Nesse modo, leitura do catálogo e planejamento podem ocorrer, mas dispatcher, persistência de ponteiro, alteração/confirmação/cancelamento de carrinho e escalação são substituídos por resultados observáveis. `server/aiSimulator.ts` constrói uma sessão efêmera com o histórico informado, aplica a mesma entrada/agenda da produção e só chama o modelo genérico quando o roteador canônico não tratar a mensagem.

**Tech Stack:** TypeScript, Express, OpenAI Chat Completions, cliente HTTP interno do ZeloMenu, testes unitários `tsx` com `tests/testHarness.ts`.

**Spec:** [Issue #22 — Simulador de IA diverge do fluxo real](https://github.com/kdo-vini/zelochat/issues/22)

## Global Constraints

- O endpoint `/api/ai/simulate` continua sem enviar WhatsApp, criar/alterar pedidos, gravar mensagens ou escalar uma conversa real.
- O simulador deve usar o catálogo interno autenticado como fonte de verdade; não pode reconstruir opções a partir do prompt achatado.
- A rota de produção continua chamando `tryHandleAiWhatsAppOrdering` antes do modelo genérico em modo restaurante.
- Toda nova resposta ao cliente deve permanecer em português brasileiro, natural e sem inventar itens, preços, IDs ou disponibilidade.
- Não habilitar a IA da Bem Servido nem enviar mensagens reais durante a implementação.
- Manter `wouldCreateOrder: false` e o contrato JSON existente do frontend.

---

### Task 1: Criar o seam canônico de dry-run

**Files:**
- Modify: `server/aiWhatsAppOrdering.ts:40-380`
- Test: `tests/aiWhatsAppOrdering.test.ts`

**Interfaces:**
- Produces `AiOrderingHandlerOptions` com `dryRun?: boolean` e `client?: OrderingClient`.
- Produces `OrderingClient`, uma interface estrutural com `searchCatalog`, `updateDraft`, `getOrdering`, `confirmDraft` e `cancelDraft`; `ZeloMenuInternalClient` continua implementando-a.
- Extends `tryHandleAiWhatsAppOrdering(..., options?: AiOrderingHandlerOptions)` sem alterar o comportamento padrão de produção.

- [ ] **Step 1: Write the failing test**

Adicionar ao teste de ordering uma fake client que registra chamadas e uma chamada dry-run para uma consulta de mistura. O teste deve exigir que a resposta venha de `renderCatalogReply`, contenha todas as opções retornadas e que nenhuma operação mutante seja executada:

```ts
const calls: string[] = [];
const client = {
  searchCatalog: async () => ({
    total: 1, ambiguous: false,
    results: [{
      productId: 879, publicName: 'Marmita do dia', currentPrice: 18,
      matchReason: 'modifier_group', ambiguous: false,
      modifierGroups: [{
        id: 'mistura', name: 'Escolha a mistura', minSelections: 1, maxSelections: 1,
        options: [
          { id: 'm1', name: 'Carne de panela', priceDelta: 0 },
          { id: 'm2', name: 'Bisteca de porco', priceDelta: 0 },
        ],
      }],
    }],
  }),
  updateDraft: async () => { calls.push('updateDraft'); throw new Error('dry-run mutation'); },
  getOrdering: async () => { calls.push('getOrdering'); throw new Error('dry-run mutation'); },
  confirmDraft: async () => { calls.push('confirmDraft'); throw new Error('dry-run mutation'); },
  cancelDraft: async () => { calls.push('cancelDraft'); throw new Error('dry-run mutation'); },
} satisfies OrderingClient;
const result = await tryHandleAiWhatsAppOrdering(
  'simulator@s.whatsapp.net', 'empresa-sim', sessionWith('oq tem de mistura hoje?'),
  fakePermit, { menuUrl: 'https://menu.zelopdv.com.br/bemservido', storeOpen: true },
  { dryRun: true, client },
);
assert.equal(result.handled, true);
assert.match(result.response ?? '', /Carne de panela/);
assert.match(result.response ?? '', /Bisteca de porco/);
assert.deepEqual(calls, []);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/aiWhatsAppOrdering.test.ts`

Expected: FAIL because `tryHandleAiWhatsAppOrdering` does not accept dry-run options and the test cannot inject the catalog client.

- [ ] **Step 3: Write minimal implementation**

1. Define/export `OrderingClient` and `AiOrderingHandlerOptions`.
2. Type `loadCanonicalSnapshot` and the handler client parameter against `OrderingClient`.
3. Add `dryRun` to `dispatchAiPayload`, `sendText`, `persistPointer`, `sendSummary`, `transferOnFailure` and `completeConfirmation`; return before dispatcher/Supabase/escalation whenever `dryRun` is true.
4. Resolve `const client = options?.client ?? ZeloMenuInternalClient.fromEnv()`.
5. Keep the current live path as the default when `options` is omitted.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/aiWhatsAppOrdering.test.ts`

Expected: PASS, including the existing production-path guardrails.

- [ ] **Step 5: Commit**

```bash
git add server/aiWhatsAppOrdering.ts tests/aiWhatsAppOrdering.test.ts
git commit -m "refactor: expose canonical ordering dry-run seam"
```

### Task 2: Route the simulator through the canonical handler

**Files:**
- Modify: `server/aiSimulator.ts:1-180`
- Test: `tests/aiSimulatorOrdering.test.ts` (create)

**Interfaces:**
- Consumes `tryHandleAiWhatsAppOrdering` with `{ dryRun: true }` from Task 1.
- Produces the existing `SimulateResult` contract and the note `Simulação — resposta do fluxo canônico; nenhuma mensagem foi enviada e nenhum dado foi gravado` when canonical handling occurs.

- [ ] **Step 1: Write the failing test**

Create a focused test that stubs `ZeloMenuInternalClient.fromEnv` through the new handler client seam and calls the simulator adapter with a restaurant config. Assert that a greeting returns the exact public URL plus written-order option, a catalog query renders canonical options, and the generic model is not needed for those cases. Also assert the simulator builds a `StoredSession` only in memory and preserves user/assistant history order.

Required cases:

```ts
assert.match(await simulateCanonical('boa tarde, estão atendendo?'), /https:\/\/menu\.zelopdv\.com\.br\/bemservido/);
assert.match(await simulateCanonical('boa tarde, estão atendendo?'), /pedido por escrito/i);
assert.match(await simulateCanonical('oq tem de mistura hoje?'), /Bisteca de porco/);
assert.match(await simulateCanonical('oq tem de mistura hoje?'), /Carne de panela/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/aiSimulatorOrdering.test.ts`

Expected: FAIL because `simulateAtendimento` currently calls the generic OpenAI prompt directly and never invokes the canonical handler.

- [ ] **Step 3: Write minimal implementation**

1. Import `tryHandleAiWhatsAppOrdering`, `resolveWeeklyStatus`, `getEmpresaTimezone`, `buildPublicStoreUrl` and `getZeloMenuPublicBaseUrl` from existing modules; export `resolveWeeklyStatus` from `server/ai.ts` only if needed to avoid duplicating schedule logic.
2. Build an ephemeral `StoredSession` with a synthetic JID/message IDs, `status: 'active'`, `autoReply: true`, and the sanitized `conversationHistory` plus current user turn.
3. Build a scoped synthetic `AiTurnPermit`; the dry-run path must never call permit validation because side effects are disabled.
4. Skip canonical routing for `zelochatMode === 'general'`; otherwise call `tryHandleAiWhatsAppOrdering` before fetching triggers or calling the generic model, using the same menu URL and `resolveWeeklyStatus(...).open` as production.
5. Return the canonical response immediately when `handled` is true; use `toolCallsMade: []`, `wouldCreateOrder: false`, and the canonical simulation note.
6. If no client is configured or the canonical handler returns `handled: false`, preserve the current generic-model fallback.
7. Keep schedule guard execution before canonical routing and retain the existing 2,000-character/20-message caps.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/aiSimulatorOrdering.test.ts`

Expected: PASS; canonical greeting/catalog cases no longer reach the generic model.

- [ ] **Step 5: Commit**

```bash
git add server/aiSimulator.ts server/ai.ts tests/aiSimulatorOrdering.test.ts
git commit -m "fix: make simulator use canonical ordering flow"
```

### Task 3: Make dry-run order planning acknowledge supplied choices

**Files:**
- Modify: `server/aiWhatsAppOrdering.ts:160-370`
- Modify: `src/domain/aiWhatsAppOrdering.ts:275-335`
- Test: `tests/aiSimulatorOrdering.test.ts`

**Interfaces:**
- Consumes the canonical catalog result and `OrderingDraft` generated by the existing planner.
- Produces a side-effect-free draft preview that asks only for the first missing fulfillment/payment field and never asks again for modifiers already selected.

- [ ] **Step 1: Write the failing test**

Add dry-run cases for:

```ts
assert.equal(
  await simulateCanonical('posso escolher arroz e feijão juntos ou tenho que escolher um?'),
  /opcional.*até 2/i,
);
assert.match(
  await simulateCanonical('quero uma marmita P de bisteca com arroz, feijão, farofa e purê'),
  /entrega ou retirada/i,
);
assert.doesNotMatch(
  await simulateCanonical('quero uma marmita P de bisteca com arroz, feijão, farofa e purê'),
  /quer.*feijão|quer.*farofa/i,
);
```

The fixture must expose a base group with `minSelections: 0, maxSelections: 2` and all accompaniment options. No assertion may depend on a model-generated item name absent from the fixture.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/aiSimulatorOrdering.test.ts`

Expected: FAIL because dry-run currently falls through to the generic prompt, which uses “arroz ou feijão?” and repeats already supplied choices.

- [ ] **Step 3: Write minimal implementation**

1. Ensure `renderCatalogReply` filters only the requested modifier group and renders every returned option; use the actual `selectionRule` (`opcional; escolha até 2`) for the base group.
2. In the dry-run branch, call the existing `planDraft` only with the canonical catalog and sanitized conversation history. If it returns a draft, apply `applyOrderingDefaults` and call `draftMissingQuestion`.
3. Return the missing fulfillment/payment question directly. Do not call `updateDraft` in dry-run.
4. If the draft is complete, return a deterministic preview built from catalog IDs/names and selected options, ending with `Posso confirmar?`; do not claim an order was created.
5. If planning returns no valid draft, render the canonical catalog reply instead of asking the generic model to invent choices.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/aiSimulatorOrdering.test.ts`

Expected: PASS for base cardinality, supplied modifier preservation and accompaniment completeness.

- [ ] **Step 5: Commit**

```bash
git add server/aiWhatsAppOrdering.ts src/domain/aiWhatsAppOrdering.ts tests/aiSimulatorOrdering.test.ts
git commit -m "fix: preserve canonical modifier choices in simulator"
```

### Task 4: Add regression coverage for availability, handoff and fallback boundaries

**Files:**
- Modify: `tests/aiSimulatorOrdering.test.ts`
- Modify: `tests/aiWhatsAppOrdering.test.ts`
- Modify: `src/domain/aiWhatsAppOrdering.ts:40-55` only if the human-intent classifier needs a precedence fix

**Interfaces:**
- Consumes the canonical dry-run result from Tasks 1–3.
- Produces stable tests for item absence, delivery guidance, human escalation and generic-mode fallback.

- [ ] **Step 1: Write the failing test**

Cover these assertions:

```ts
assert.match(await simulateCanonical('tem salmão hoje?'), /não encontrei|não temos/i);
assert.match(await simulateCanonical('quero entrega, quanto fica a taxa?'), /cardápio|endereço/i);
const human = await simulateCanonical('quero falar com um atendente humano');
assert.match(human.reply, /atendente|humano/i);
assert.deepEqual(human.toolCallsMade, ['dispatch_trigger']);
assert.equal((await simulateGeneral('quero uma marmita')).toolCallsMade.includes('buscar_cardapio'), false);
```

Also assert that a canonical human request is not reclassified as `catalog_or_order` when an explicit human phrase is present.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/aiSimulatorOrdering.test.ts`

Expected: FAIL if the dry-run exposes only the raw tool placeholder or if the order classifier intercepts the explicit human request.

- [ ] **Step 3: Write minimal implementation**

1. In dry-run, map `dispatch_trigger` to the same customer-facing handoff text production uses while preserving `toolCallsMade: ['dispatch_trigger']`; do not call `escalateSession`.
2. Give explicit human-request phrases precedence in `classifyOrderingTurn` so `quero falar com atendente`, `chama um humano` and equivalent phrases return `none` and reach the built-in trigger path.
3. Keep delivery fee copy informational: direct the customer to the cardápio/address calculation and never invent a fee.
4. Keep general mode on the generic path; it must not access the restaurant catalog client.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/aiSimulatorOrdering.test.ts tests/aiWhatsAppOrdering.test.ts`

Expected: PASS with no side-effect calls.

- [ ] **Step 5: Commit**

```bash
git add src/domain/aiWhatsAppOrdering.ts server/aiWhatsAppOrdering.ts tests/aiSimulatorOrdering.test.ts tests/aiWhatsAppOrdering.test.ts
git commit -m "test: cover simulator availability and human handoff"
```

### Task 5: Document, verify and prepare rollout

**Files:**
- Modify: `FIXES_PROGRESS.md` (new dated entry)
- Modify: `CURRENT.md` (move issue #22 from open to completed or record remaining rollout gate)
- Modify: `INCIDENTS.md` (new incident entry only if the final behavior is customer-visible P1)
- Modify: `docs/ai/ZeloChat.memory.md` (confirmed architecture/risk)

- [ ] **Step 1: Run focused tests**

Run: `npx tsx tests/aiWhatsAppOrdering.test.ts`; `npx tsx tests/aiSimulatorOrdering.test.ts`; `npx tsx tests/aiPromptGuardrails.test.ts`; `npx tsx tests/aiZeloMenuGuardrails.test.ts`; `npx tsx tests/aiSimulatorScheduleGuard.test.ts`.

Expected: all focused suites pass with zero failures.

- [ ] **Step 2: Run static checks and build**

Run: `npm run lint`; `npx tsc --noEmit -p server/tsconfig.json`; `npm run build`.

Expected: exit code 0 for all three commands.

- [ ] **Step 3: Verify no side effects in the route**

Run the simulator endpoint against a local test config or focused route test and assert no calls to outbound dispatch, `zelochat_messages`, ordering mutation endpoints or escalation RPCs. Confirm the response still contains `simulationNote` and `wouldCreateOrder: false`.

- [ ] **Step 4: Update documentation**

Record the cause/fix with exact file paths and the remaining production gate: Bem Servido stays `ai_enabled=false` until this published build and the authenticated internal catalog integration pass a controlled conversation.

- [ ] **Step 5: Review the diff and commit**

```bash
git diff --check
git status --short
git log -5 --oneline
git add FIXES_PROGRESS.md CURRENT.md INCIDENTS.md docs/ai/ZeloChat.memory.md
git commit -m "docs: record canonical simulator parity fix"
```

- [ ] **Step 6: Publish only after explicit rollout approval**

Run the production deployment workflow only after the focused tests, lint, server typecheck and build are green. Keep AI disabled for Bem Servido until a human-controlled WhatsApp test confirms entry link, complete modifier selection, delivery question and human handoff.

