# Offline Conversation Runtime Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provar offline, com conversas reais reproduzíveis, que pedidos simples e montáveis funcionam por texto, áudio e interativos sob retries, reinícios e corridas, sem depender de dois números ou de uma loja ativa.

**Architecture:** Extrair uma composição do runtime sem side effects e injetar relógio, IDs, persistência, catálogo/ordering, modelo, transcritor e dispatcher. Um runner stateful alimenta fixtures de webhook versionadas e registra respostas/efeitos. A rede é bloqueada por padrão. Cenários determinísticos comparam copy exata; cenários de extração validam ferramentas, IDs e invariantes.

**Tech Stack:** TypeScript, Node test harness, fake clock/repositories, Vitest-compatible fixture data, Playwright only for local UI shell, Supabase local integration where required.

**Spec:** `docs/superpowers/specs/2026-09-02-hybrid-conversational-ordering-design.md`

## Global Constraints

- O runner usa o mesmo handler, normalizador, composer, presenter e fila que produção; não reimplementa a lógica para “passar o teste”.
- Nenhuma chamada de rede é permitida sem fake registrado; acesso acidental encerra o cenário com erro.
- IDs, relógio e ordem de jobs são determinísticos.
- Fixtures não contêm dados reais da cliente voluntária.
- Copy determinística é validada por igualdade; prosa do modelo não é snapshotada.
- Cada cenário afirma resposta ao cliente, mutações canônicas, mensagens enfileiradas, estado final e ausência de efeitos proibidos.
- Nenhum teste chama `/api/healthz` como evidência de integração.
- Não ativar cliente, enviar mensagem real, publicar ou fazer deploy.

---

### Task 1: Extract a side-effect-free runtime composition root

**Files:**
- Create: `server/conversationRuntime.ts`
- Create: `tests/conversationRuntime.test.ts`
- Modify: `server/index.ts`
- Modify: `server/router.ts`
- Modify: `server/ai.ts`
- Modify: `server/messageHandler.ts`

**Interfaces:**
- Produces `createConversationRuntime(deps)` with injectable `clock`, `ids`, `repository`, `orderingClient`, `planner`, `transcriber`, `dispatcher`, `scheduler`, and `logger`.
- Production `server/index.ts` constructs real dependencies only after import-safe definitions are loaded.

- [ ] **Step 1: Add a failing import test proving importing `conversationRuntime` does not bind a port, read required env, register a webhook or start workers.**
- [ ] **Step 2: Add a failing dependency test that sends one normalized text event using only fakes and receives one terminal result.**
- [ ] **Step 3: Run `npx tsx tests/conversationRuntime.test.ts` and confirm current concrete imports/side effects prevent composition.**
- [ ] **Step 4: Extract the smallest dependency interfaces and delegate production calls through them.** Preserve current startup order and critical docstrings in `server/index.ts`.
- [ ] **Step 5: Run the focused test, router/message tests, `npm run lint`, and a production build.**
- [ ] **Step 6: Commit with `git commit -m "refactor: make conversation runtime injectable"`.**

### Task 2: Version provider webhook fixtures and one canonical event shape

**Files:**
- Create: `tests/fixtures/whatsapp/text.json`
- Create: `tests/fixtures/whatsapp/audio.json`
- Create: `tests/fixtures/whatsapp/button.json`
- Create: `tests/fixtures/whatsapp/list.json`
- Create: `tests/fixtures/whatsapp/template.json`
- Create: `tests/fixtures/whatsapp/native-flow.json`
- Create: `tests/fixtures/whatsapp/retry.json`
- Create: `tests/fixtures/whatsapp/from-me.json`
- Create: `tests/fixtures/whatsapp/wrapped.json`
- Create: `tests/webhookFixtureContract.test.ts`
- Modify: `server/messageHandler.ts`

**Interfaces:**
- Every fixture normalizes to `CanonicalInboundEvent` with event/message ID, empresa/instance lookup key, JID, timestamp, kind, text/interactive/media and `fromMe`.

- [ ] **Step 1: Add failing table-driven tests loading every JSON fixture and asserting the exact canonical event.**
- [ ] **Step 2: Add duplicate/retry assertions: the retry has the same canonical message ID but a different delivery envelope ID.**
- [ ] **Step 3: Run `npx tsx tests/webhookFixtureContract.test.ts` and confirm no public canonical normalizer handles all fixtures.**
- [ ] **Step 4: Extract/compose existing helpers into one bounded normalizer.** Keep raw payload only in the raw-event store, never in logs or model input.
- [ ] **Step 5: Run fixture, media and interactive tests.**
- [ ] **Step 6: Commit with `git commit -m "test: freeze WhatsApp webhook contracts"`.**

### Task 3: Build the stateful scenario runner with a hard network deny

**Files:**
- Create: `tests/support/conversationScenario.ts`
- Create: `tests/support/fakeConversationRepository.ts`
- Create: `tests/support/fakeOrderingClient.ts`
- Create: `tests/conversationScenarioHarness.test.ts`

**Interfaces:**
- Scenario API exposes `customer.text`, `customer.audio`, `customer.action`, `human.takeover`, `clock.advance`, `runtime.restart`, `ordering.changeCatalog`, and assertions over replies/effects/state.
- Global fake `fetch` throws `UNREGISTERED_NETWORK:<url>` unless explicitly registered.

- [ ] **Step 1: Add a failing red scenario for `Oi` and a deliberate unregistered HTTP call.** The first should record a reply; the second must fail the test.
- [ ] **Step 2: Add failing restart and clock tests proving durable state survives while in-memory jobs do not duplicate.**
- [ ] **Step 3: Run `npx tsx tests/conversationScenarioHarness.test.ts` and confirm support modules are absent.**
- [ ] **Step 4: Implement deterministic fakes and a transcript renderer showing `Cliente`, `IA`, actions and canonical effects.**
- [ ] **Step 5: Run the focused harness test twice and verify byte-identical output.**
- [ ] **Step 6: Commit with `git commit -m "test: add stateful offline conversation harness"`.**

### Task 4: Freeze simple-product production scenarios

**Files:**
- Create: `tests/fixtures/catalog/bem-servido-sanitized.ts`
- Create: `tests/scenarios/simpleProductOrdering.test.ts`

**Interfaces:**
- Consumes the same artificial ID ranges as the ZeloMenu fixture and provides Coke regular/zero in 2 L, 600 ml and 350 ml can variants plus paused/out-of-stock controls.

- [ ] **Step 1: Add a recursive privacy assertion rejecting UUIDs, phone-like strings, real URLs and forbidden identity keys.**
- [ ] **Step 2: Write exact scenarios: `Oi`; start button retry; `Oi, quero Coca`; regular versus zero; size choice; stock-controlled zero excluded; stock-disabled zero included; paused publication excluded.**
- [ ] **Step 3: Assert every choice stores the selected SKU ID, never a generic Coke note, and final summary/order totals match the fixture.**
- [ ] **Step 4: Run `npx tsx tests/scenarios/simpleProductOrdering.test.ts` and fix only shared runtime/feature defects exposed by the scenarios.**
- [ ] **Step 5: Commit with `git commit -m "test: cover simple product ordering conversations"`.**

### Task 5: Freeze configurable-product production scenarios

**Files:**
- Create: `tests/scenarios/configurableProductOrdering.test.ts`

**Interfaces:**
- Uses `Monte Sua Massa`: mass `substituir`, required sauce, optional proteins (0–2), sides (0–3), paid extra (0–1).

- [ ] **Step 1: Add exact text scenarios for one-detail-per-turn and all-details-in-one-turn.** Assert the latter skips every already satisfied question.
- [ ] **Step 2: Add an equivalent full-audio scenario and assert the same canonical draft/summary as text.**
- [ ] **Step 3: Add optional scenarios: accept selections, `sem extras`, offer only once after restart, and no optional group blocking confirmation.**
- [ ] **Step 4: Add limits and pricing scenarios: too many proteins/sides, repeated quantity beyond max, R$ 22 minimum display, Talharim substitution, and `Bife acebolado + R$ 12,00`.**
- [ ] **Step 5: Add two-identical-lines and targeted-correction scenarios using stable line IDs.**
- [ ] **Step 6: Run `npx tsx tests/scenarios/configurableProductOrdering.test.ts` and repair only production modules, never weaken assertions.**
- [ ] **Step 7: Commit with `git commit -m "test: cover configurable product conversations"`.**

### Task 6: Cover review actions, stale state and catalog changes

**Files:**
- Create: `tests/scenarios/orderReviewAndCorrection.test.ts`

**Interfaces:**
- Exercises exact three-button review and canonical revision/token behavior.

- [ ] **Step 1: Add confirmation variants `Confirmar`, `pode`, `fechado`, `certinho`, `show`, `👍`; every scenario creates exactly one order and one final reply.**
- [ ] **Step 2: Add simultaneous `button + sim`, duplicate delivery, stale token, and retry-after-restart scenarios.**
- [ ] **Step 3: Add alteration and cancellation: full cancel button, partial item removal, `sim, mas troca`, and old button after edit.**
- [ ] **Step 4: Add price, availability, stock, delivery fee and review-state changes between summary and confirmation; assert no false confirmation.**
- [ ] **Step 5: Run the focused file and fix only production behavior.**
- [ ] **Step 6: Commit with `git commit -m "test: cover order review races and corrections"`.**

### Task 7: Cover audio, takeover, replay and rapid-turn reliability

**Files:**
- Create: `tests/scenarios/conversationReliability.test.ts`
- Modify: `tests/webhookReplayWorker.test.ts`
- Modify: `tests/aiTakeoverRace.test.ts`

**Interfaces:**
- Raw inbound event states distinguish persisted, processing, processed and retryable failure for all inbound kinds.

- [ ] **Step 1: Add audio failure scenarios for no key, empty, unsupported, >5 MB, timeout and failed transcription; assert bounded reply/no silence.**
- [ ] **Step 2: Add fragmented text/audio with out-of-order completion, equal timestamps and restart; assert one causal patch.**
- [ ] **Step 3: Add takeover during model, mutation and outbound; assert zero forbidden effects.**
- [ ] **Step 4: Add crash after raw persistence and crash during handler for text/audio/interactive; restart and assert exactly-once logical outcome.**
- [ ] **Step 5: Add four rapid turns and ensure the fourth receives or schedules a deterministic response.**
- [ ] **Step 6: Run the focused tests and repair production durability/rate behavior without test-only bypasses.**
- [ ] **Step 7: Commit with `git commit -m "test: cover conversation reliability under failures"`.**

### Task 8: Verify exact outbound bodies and lifecycle

**Files:**
- Create: `tests/conversationOrderingOutboundContract.test.ts`
- Modify: `server/outbound/providerAdapter.ts`
- Modify: `server/outbound/queue.ts`
- Modify: `tests/conversationOutboundIntegration.test.ts`

**Interfaces:**
- Freezes exact provider-adapter request bodies for entry button, choice buttons, list and three-button confirmation while keeping provider names internal.
- Lifecycle is `queued -> claimed -> sent` or an explicit retryable/uncertain failure; pointer/state exists before `queued`.

- [ ] **Step 1: Add failing snapshots of normalized adapter bodies and enforce button/list limits.**
- [ ] **Step 2: Add a failing crash-after-provider-send case with echo correlation and no duplicate logical response.**
- [ ] **Step 3: Add a failing assertion that `ZELOCHAT_DISABLE_WHATSAPP_NETWORK=1` blocks every text/media/button/list send route.**
- [ ] **Step 4: Run focused outbound tests and observe uncovered direct send/network paths.**
- [ ] **Step 5: Route all ordering payloads through the durable adapter, centralize the network kill switch and preserve lifecycle evidence.**
- [ ] **Step 6: Run `npm run test:takeover`, outbound contract tests and `npm run lint`.**
- [ ] **Step 7: Commit with `git commit -m "test: verify ordering outbound contracts and lifecycle"`.**

### Task 9: Repair the inherited baseline and obsolete journey route

**Files:**
- Modify: `tests/auditFixGuardrails.test.ts`
- Modify: `tests/manualOutboundRoutes.test.ts`
- Modify: `tests/fromMeProcessor.test.ts`
- Modify: `tests/conversationOutboundIntegration.test.ts`
- Modify: `server/router.ts`
- Modify: `server/fromMeProcessor.ts`
- Modify: `server/conversationOutbound.ts`
- Modify: `server/messageHandler.ts`
- Modify: `tests/customerRollout.test.ts`
- Modify: `server/outbound/worker.ts`
- Modify: `tests/e2e-ai-customer-journey.spec.ts`

**Interfaces:**
- Restores the pre-feature unit baseline to zero failing files without deleting guardrails.
- E2E uses the current webhook/runtime entry rather than legacy `/webhook` returning 410.

- [ ] **Step 1: Re-run `npx tsx tests/auditFixGuardrails.test.ts` and record the exact four failures: DB-backed fromMe echo check, intent-before-send, failure persistence and post-send DB-status handling.**
- [ ] **Step 2: Inspect whether each assertion represents a real regression or stale source-string coupling.** For real behavior gaps, add behavioral tests before fixing production; for stale source coupling, replace it with a behavior assertion rather than weakening the requirement.
- [ ] **Step 3: Re-run `npx tsx tests/customerRollout.test.ts`, identify the zero-versus-one contract, and add a focused behavioral red test for the intended rollout behavior before changing code/test.**
- [ ] **Step 4: Run both tests green, then run `npm test` and confirm no failing unit file remains.**
- [ ] **Step 5: Update the journey spec to invoke the current canonical webhook/runtime seam and run `npm run test:e2e:customer-journey` against the local fake composition.** Do not require a real phone or provider network.
- [ ] **Step 6: Commit with `git commit -m "fix: restore conversation test baseline"`.**

### Task 10: Add one production-readiness command and pilot evidence report

**Files:**
- Create: `scripts/verify-conversation-ordering.ts`
- Create: `tests/verifyConversationOrderingScript.test.ts`
- Modify: `package.json`
- Create: `docs/runbooks/CONVERSATION_ORDERING_PILOT.md`
- Modify: `CURRENT.md`
- Modify: `FIXES_PROGRESS.md`
- Modify: `docs/ai/ZeloChat.memory.md`

**Interfaces:**
- Adds `npm run verify:conversation-ordering` that executes privacy checks, focused scenarios, full unit suite, typecheck and build with network disabled.
- Produces a machine-readable summary with pass/fail/skip counts and no customer data.

- [ ] **Step 1: Add `tests/verifyConversationOrderingScript.test.ts` with a fake process runner.** Assert a failed child command makes the verifier return non-zero, later commands do not run, and the generated environment contains the hard network-disable flag.
- [ ] **Step 2: Implement the verifier using explicit argument arrays, inherited output and deterministic environment flags.** Do not shell-concatenate user input.
- [ ] **Step 3: Write the pilot runbook: prerequisites, offline gates, migration/deploy authorization boundary, client enable switch, first-order checklist, metrics, rollback switch and evidence capture.** Do not include credentials.
- [ ] **Step 4: Run `npm run verify:conversation-ordering` twice and retain the concise final counts in the task report.**
- [ ] **Step 5: Run `git diff --check`, inspect `git status --short`, and scan fixtures/reports for secrets and real identifiers.**
- [ ] **Step 6: Update sprint/progress/memory with final file:line evidence.**
- [ ] **Step 7: Commit with `git commit -m "test: add offline ordering production gate"`. Do not push, deploy, contact or enable the pilot client.**
