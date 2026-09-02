# Hybrid WhatsApp Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o fluxo existente do ZeloChat em uma conversa híbrida que aceita texto, áudio e controles interativos, aplica tudo ao rascunho canônico do ZeloMenu e nunca confirma dados incompletos ou presumidos.

**Architecture:** O handler de pedidos passa a operar sobre uma rajada causal de entradas e um estado conversacional serializado. O modelo só produz um patch estruturado com IDs permitidos; o ZeloMenu devolve requisitos e readiness. Um apresentador determinístico escolhe texto, botões ou lista para a próxima pergunta. Todos os efeitos usam a fila durável e carregam o permit de conversa até a mutação canônica.

**Tech Stack:** TypeScript, Express, OpenAI structured tools, WhatsApp provider adapter, Supabase, custom unit harness, Vite.

**Spec:** `docs/superpowers/specs/2026-09-02-hybrid-conversational-ordering-design.md`

## Global Constraints

- Este plano consome o contrato implementado por `ZeloMenu/docs/superpowers/plans/2026-09-02-conversation-ordering-authority.md`; não duplicar validação canônica no ZeloChat.
- Texto e áudio são sempre alternativas válidas a botões/listas.
- A saudação contém URL visível e exatamente um botão `Pedir por aqui`; não inclui botão de atendimento humano.
- Nunca expor nomes de fornecedor, endpoints, timeouts ou erros técnicos em copy consumida pelo cliente.
- A confirmação contém `Confirmar`, `Alterar` e `Cancelar` e só aparece com `readyForConfirmation=true`.
- Persistir estado/pointer antes de enfileirar qualquer controle que dependa dele.
- Toda mutação ou envio de IA exige permit atual; tomada humana vence em todas as corridas.
- Toda mudança de produção começa por um teste que falha pelo motivo esperado.
- Não ativar cliente, publicar branch, fazer deploy ou alterar banco conectado neste plano.

---

### Task 1: Adopt the canonical partial-order contract

**Files:**
- Modify: `src/domain/aiWhatsAppOrdering.ts`
- Modify: `server/zeloMenuInternalClient.ts`
- Modify: `tests/aiWhatsAppOrdering.test.ts`
- Create: `tests/zeloMenuInternalClient.test.ts`

**Interfaces:**
- Adds `lineId`, `OrderingRequirement`, `readyForConfirmation`, rich modifier rules and `displayPrice` to local contract types.
- Adds `conversationControlId` and decimal-string `conversationEpoch` to update/confirm/cancel requests.

- [ ] **Step 1: Add a failing client-body test that captures `fetch` and expects permit fields on all three mutation methods.**
- [ ] **Step 2: Add compile-time/runtime fixture tests for a partial `Monte Sua Massa` snapshot with required and optional requirements.**
- [ ] **Step 3: Run `npx tsx tests/zeloMenuInternalClient.test.ts` and `npx tsx tests/aiWhatsAppOrdering.test.ts`; confirm missing fields/arguments fail.**
- [ ] **Step 4: Extend types and client methods.** Keep epochs as strings end-to-end; retain request timeout and friendly error mapping.
- [ ] **Step 5: Run both focused tests and `npm run lint`.**
- [ ] **Step 6: Commit with `git commit -m "feat: consume partial canonical ordering contract"`.**

### Task 2: Normalize all supported interactive replies into one action

**Files:**
- Create: `server/whatsappInteractive.ts`
- Create: `tests/whatsappInteractive.test.ts`
- Modify: `server/messageHandler.ts`
- Modify: `server/router.ts`
- Modify: `tests/routerWebhookGuardrails.test.ts`

**Interfaces:**
- Produces `normalizeIncomingInteractive(payload): { id: string; title: string | null; source: 'button' | 'list' | 'template' | 'native_flow' } | null`.
- Accepts provider wrappers already handled by `messageHandler`; caps ID at 128 chars and title at 240 chars.

- [ ] **Step 1: Add table-driven failing fixtures for reply button, list `singleSelectReply.selectedRowId`, template quick reply and native-flow response.** Assert all four yield the same semantic action ID.
- [ ] **Step 2: Add failing abuse cases for oversized IDs, unexpected JSON, 1000 rows and control characters; expect `null` without throw.**
- [ ] **Step 3: Run `npx tsx tests/whatsappInteractive.test.ts` and confirm list/template/native paths are not normalized uniformly.**
- [ ] **Step 4: Implement the pure normalizer and make router/message extraction consume it before legacy display text.** Do not delete compatibility for existing confirmation labels.
- [ ] **Step 5: Run the focused tests plus `npx tsx tests/orderConfirmationPipeline.test.ts`.**
- [ ] **Step 6: Commit with `git commit -m "feat: normalize WhatsApp interactive replies"`.**

### Task 3: Send the approved entry action without losing an order in the greeting

**Files:**
- Modify: `src/domain/aiWhatsAppOrdering.ts`
- Modify: `server/aiWhatsAppOrdering.ts`
- Modify: `server/ai.ts`
- Modify: `tests/aiWhatsAppOrdering.test.ts`
- Modify: `tests/aiSimulatorOrdering.test.ts`

**Interfaces:**
- Produces an entry payload `{ text, buttons: [{ id: 'AI_ORDER_START', displayText: 'Pedir por aqui' }] }`.
- `AI_ORDER_START` is a deterministic action and retry-idempotent.

- [ ] **Step 1: Add an exact failing test for `Oi`: URL is visible, exactly one button exists, label is `Pedir por aqui`, and no canonical cart mutation occurs.**
- [ ] **Step 2: Add a failing test for `Oi, quero uma Coca 2 L`: the URL remains in the first response context and catalog/order handling occurs in the same turn rather than returning after greeting.**
- [ ] **Step 3: Add a failing retry test for two copies of the same start-button message ID; expect one outbound response.**
- [ ] **Step 4: Run both focused test files and observe the current text-only/early-return behavior.**
- [ ] **Step 5: Return a structured entry payload, dispatch it through `dispatchConversationOutbound`, and separate pure greeting intent from greeting-plus-order intent.** Button response: `Pode escrever ou mandar um áudio com o que você quer pedir.`
- [ ] **Step 6: Run focused tests and `npm run lint`.**
- [ ] **Step 7: Commit with `git commit -m "feat: offer written ordering from the greeting"`.**

### Task 4: Compose unhandled text and completed audio into one causal turn

**Files:**
- Create: `server/orderingTurnComposer.ts`
- Create: `tests/orderingTurnComposer.test.ts`
- Modify: `server/aiWhatsAppOrdering.ts`
- Modify: `server/messageHandler.ts`

**Interfaces:**
- Produces `composeOrderingTurn(messages, state): { text: string; sourceMessageIds: string[]; nextCursor: ... }`.
- Consumes completed audio transcript instead of `[Áudio]` preview; pending audio blocks only until its bounded deadline.
- Orders by provider timestamp, then database timestamp, then stable message ID.

- [ ] **Step 1: Add failing tests for three text fragments (`quero uma massa` / `talharim` / `molho branco`) and assert one composed input with three IDs.**
- [ ] **Step 2: Add failing mixed text/audio tests where transcript completion is out of order and timestamps tie.** Assert deterministic order and no duplicate consumption after restart.
- [ ] **Step 3: Add a failing history test proving an older completed transcript is visible to the planner, while the placeholder is not.**
- [ ] **Step 4: Run `npx tsx tests/orderingTurnComposer.test.ts` and confirm the module/behavior is absent.**
- [ ] **Step 5: Implement a pure composer and serialize its consumed-message cursor in ordering state.** Never concatenate assistant/tool messages into customer intent.
- [ ] **Step 6: Wire the composer before catalog query/planning and run the focused tests plus `npx tsx tests/audioTranscriptionRearm.test.ts`.**
- [ ] **Step 7: Commit with `git commit -m "feat: compose fragmented text and audio orders"`.**

### Task 5: Plan relational patches and preserve all information given early

**Files:**
- Create: `server/orderingPatchPlanner.ts`
- Create: `tests/orderingPatchPlanner.test.ts`
- Modify: `server/zeloMenuInternalClient.ts`
- Modify: `server/aiWhatsAppOrdering.ts`
- Modify: `tests/aiWhatsAppOrdering.test.ts`

**Interfaces:**
- Produces `ConversationOrderPatch` with stable `lineId` and structured group selections.
- Model tool IDs are constrained by `product -> group -> option`; correction searches use the new requested product phrase.

- [ ] **Step 1: Add a failing deterministic planner test for one utterance containing mass, protein, sauce, two sides and paid bife.** Expect every recognized ID in one patch and no question for already supplied choices.
- [ ] **Step 2: Add a failing cross-product injection test: a globally valid option under the wrong product is rejected before HTTP mutation.**
- [ ] **Step 3: Add a failing correction test: `adiciona uma Coca` after a mass order searches `Coca`, assigns a new stable line ID and preserves the mass line.**
- [ ] **Step 4: Add a failing two-identical-lines test for `na segunda massa, troca para sugo`.** Only the addressed `lineId` changes.
- [ ] **Step 5: Run `npx tsx tests/orderingPatchPlanner.test.ts` and observe current whole-draft/global-allowlist limitations.**
- [ ] **Step 6: Define the structured model tool and pure validation layer.** Merge patch into `snapshotToDraft` by line ID; never use notes as a substitute for product/group/option selection.
- [ ] **Step 7: Run planner and handler tests plus `npm run lint`.**
- [ ] **Step 8: Commit with `git commit -m "feat: apply relational order patches from natural language"`.**

### Task 6: Ask only the next canonical requirement with natural controls

**Files:**
- Create: `src/domain/orderingRequirementPresenter.ts`
- Create: `tests/orderingRequirementPresenter.test.ts`
- Modify: `src/domain/aiWhatsAppOrdering.ts`
- Modify: `server/aiWhatsAppOrdering.ts`
- Modify: `server/conversationOutbound.ts`

**Interfaces:**
- Produces `OrderingReplyPayload` as text, up to three buttons, or a single-select list.
- Conversation state stores `offeredOptionalRequirementIds` and `declinedOptionalRequirementIds`.

- [ ] **Step 1: Add exact failing copy tests for required mass (3 buttons), required sauce (4–10 options as list), and a large group (plain text with a filter request).**
- [ ] **Step 2: Add failing multi-select tests proving accompaniments accept text/audio rather than a sequence of single-select list taps.**
- [ ] **Step 3: Add failing optional policy tests: all optional groups are offered once in compact text; `sem extras` marks them declined; the next turn does not ask again.**
- [ ] **Step 4: Add a failing one-option required group test; expect deterministic auto-selection and disclosure in the next response.**
- [ ] **Step 5: Run `npx tsx tests/orderingRequirementPresenter.test.ts` and confirm no requirements presenter exists.**
- [ ] **Step 6: Implement deterministic presentation and state transitions.** Show price deltas for paid options and cardinality (`até 2`, `escolha 1`); never show `R$ 0,00` for a substitution-priced parent.
- [ ] **Step 7: Wire the presenter after every canonical update and add durable list support to the outbound union.**
- [ ] **Step 8: Run focused tests and `npx tsx tests/conversationOutbound.test.ts`.**
- [ ] **Step 9: Commit with `git commit -m "feat: guide customers through canonical order requirements"`.**

### Task 7: Make review, confirmation, alteration and cancellation complete

**Files:**
- Modify: `src/domain/aiWhatsAppOrdering.ts`
- Modify: `src/domain/conversationState.ts`
- Modify: `server/aiWhatsAppOrdering.ts`
- Modify: `server/router.ts`
- Modify: `tests/aiWhatsAppOrdering.test.ts`
- Modify: `tests/aiTurnDecision.test.ts`
- Modify: `tests/orderConfirmationPipeline.test.ts`

**Interfaces:**
- Confirmation buttons are exactly `Confirmar`, `Alterar`, `Cancelar`.
- Adds cancel action ID bound to the current ordering/revision semantics without exposing identifiers.
- Exact summary includes all canonical fields and surfaces `requiresReview`, fee-to-confirm and revalidation issues.

- [ ] **Step 1: Add a failing exact summary test containing two lines, every modifier, a paid extra, delivery address, fee, payment, observation and total.**
- [ ] **Step 2: Add failing blocked-summary tests: requirements pending, `deliveryFeeToConfirm`, `requiresReview` or revalidation issue must omit confirmation token/buttons and explain the next action.**
- [ ] **Step 3: Add failing button tests for the three labels and deterministic full cancellation.** Partial cancellation text remains an edit.
- [ ] **Step 4: Add table-driven failing confirmation tests for `pode`, `fechado`, `certinho`, `show`, `👍`; add negative cases `sim, mas...`, `fechado, só...`, and prompt-injection text.**
- [ ] **Step 5: Add failing concurrent `button + sim` and duplicate-click tests; expect one canonical confirm call and one final outbound.**
- [ ] **Step 6: Run the three focused tests and observe missing cancel/summary/slang behavior.**
- [ ] **Step 7: Implement conservative context-bound classification and complete rendering.** `não` after a summary asks what to change; explicit `Cancelar` cancels all.
- [ ] **Step 8: Persist the latest pointer/state before dispatching the summary buttons, then run tests and `npm run lint`.**
- [ ] **Step 9: Commit with `git commit -m "feat: complete canonical order review actions"`.**

### Task 8: Bound every audio failure path and guarantee a response

**Files:**
- Modify: `server/transcription.ts`
- Modify: `server/messageHandler.ts`
- Modify: `server/ai.ts`
- Modify: `tests/audioTranscriptionRearm.test.ts`
- Create: `tests/audioOrderingFailures.test.ts`

**Interfaces:**
- Produces settled result codes `done | missing_key | empty | unsupported | too_large | timeout | failed`.
- Maximum accepted audio is 5 MB; wait budget is configurable/injectable and bounded for tests.

- [ ] **Step 1: Add failing cases for missing key, zero bytes, unsupported MIME, >5 MB, timeout and service failure.** Each must settle, re-arm once, and produce friendly text or controlled handoff.
- [ ] **Step 2: Add a failing success case proving one audio creates one draft and one summary even if the settled callback fires twice.**
- [ ] **Step 3: Add a fake-clock test proving no path waits 90 seconds and no conversation remains pending indefinitely.**
- [ ] **Step 4: Run `npx tsx tests/audioOrderingFailures.test.ts` and confirm silent/long-wait paths.**
- [ ] **Step 5: Return typed outcomes from transcription, centralize settle/idempotency and use the same composer path as text.** Customer copy: ask to type the order when recoverable; transfer only after the bounded consecutive-failure policy.
- [ ] **Step 6: Run audio-focused tests and `npm run lint`.**
- [ ] **Step 7: Commit with `git commit -m "fix: keep audio ordering responsive on every failure"`.**

### Task 9: Carry the current permit through every canonical side effect

**Files:**
- Modify: `server/aiWhatsAppOrdering.ts`
- Modify: `server/zeloMenuInternalClient.ts`
- Modify: `server/conversationControl.ts`
- Modify: `tests/aiTakeoverRace.test.ts`
- Modify: `tests/aiWhatsAppOrdering.test.ts`

**Interfaces:**
- Every update/confirm/cancel call sends `conversationControlId` and `epoch` from the same `AiTurnPermit` used by outbound.
- A canonical `AI_TURN_REVOKED` response is a clean suppression, not a customer-visible failure.

- [ ] **Step 1: Add failing race tests for takeover after planner, during update, before pointer persistence and before outbound.** Assert zero post-takeover mutation/outbound.
- [ ] **Step 2: Add a failing test that verifies the exact permit passed to update/confirm/cancel.**
- [ ] **Step 3: Run both focused tests and confirm mutation currently lacks the atomic permit.**
- [ ] **Step 4: Thread the permit through all client calls, recheck before non-atomic local work, and suppress `AI_TURN_REVOKED` without escalation.**
- [ ] **Step 5: Run `npm run test:takeover`, handler tests and `npm run lint`.**
- [ ] **Step 6: Commit with `git commit -m "fix: stop order mutations after human takeover"`.**

### Task 10: Remove silence and tenant leaks from edge paths

**Files:**
- Modify: `server/ai.ts`
- Modify: `server/router.ts`
- Modify: `server/customers/orderingContext.ts`
- Modify: `tests/aiOutboundGuardrails.test.ts`
- Modify: `tests/customerOrderResolution.test.ts`
- Create: `tests/aiRapidTurns.test.ts`

**Interfaces:**
- The anti-spam policy returns/enqueues a deterministic outcome for every accepted inbound; it never silently discards the fourth turn.
- Short order references are resolved by empresa + canonical JID/customer scope.

- [ ] **Step 1: Add a failing fake-clock test with four customer turns in 60 seconds; assert four terminal outcomes and no silent drop.**
- [ ] **Step 2: Add a failing cross-tenant/cross-customer test where the same short order suffix exists twice; assert no data from the other conversation appears.**
- [ ] **Step 3: Add a failing payload-boundary test for excessive buttons/list rows/body length before outbound persistence.**
- [ ] **Step 4: Run focused tests and observe the current three-reply cap and broad short-ID lookup.**
- [ ] **Step 5: Replace silent drop with coalescing/queued guidance, scope order lookup, and fail closed on invalid interactive payloads.**
- [ ] **Step 6: Run focused tests, `npx tsx tests/conversationEdgeCases.test.ts`, and `npm run lint`.**
- [ ] **Step 7: Commit with `git commit -m "fix: answer rapid turns without crossing customer scope"`.**

### Task 11: Record the user-facing feature and complete local verification

**Files:**
- Modify: `CURRENT.md`
- Modify: `FIXES_PROGRESS.md`
- Modify: `INCIDENTS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/ai/ZeloChat.memory.md`
- Modify: `src/data/changelog.ts`

**Interfaces:**
- Documents the canonical requirements/state contract for future agents and a single meaningful PT-BR changelog entry.

- [ ] **Step 1: Add required sprint/fix entries with final file:line references.** Add incidents and inline `// FIX 2026-09-02: ...` comments for P0/P1 customer-visible races/silence fixed by Tasks 8–10.
- [ ] **Step 2: Document the non-obvious ownership boundary, optional-once policy and permit requirement in `CLAUDE.md` and memory.**
- [ ] **Step 3: Add one changelog entry (respecting max 4/day) describing pedidos por texto/áudio with guided choices; no provider names.**
- [ ] **Step 4: Run every focused ordering/audio/takeover test, then `npm run lint`, `npm run build`, and `git diff --check`.**
- [ ] **Step 5: Run `npm test` and classify only the already-recorded baseline failures; do not accept any new failing file.** Baseline repair is Task 9 of the offline harness plan.
- [ ] **Step 6: Scan customer copy with `rg -n "Whatsmiau|OpenAI|Supabase|endpoint|webhook|upstream|timeout" src server` and inspect every newly touched match.** Internal logs/imports are allowed; customer strings are not.
- [ ] **Step 7: Commit with `git commit -m "docs: record hybrid WhatsApp ordering"`. Do not push or deploy.**
