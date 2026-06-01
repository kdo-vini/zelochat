# ZeloChat AI Engine Audit

> Ver também: [[CODE_REVIEW]] · [[FIXES_PROGRESS]] · [[ZeloChat.audit-report]] · [[ZeloChat.audit-reliability]]

## Executive Summary
- The current AI engine has meaningful guardrails: pending-order confirmation logic, global AI kill-switch, escalation flow, audio transcription pipeline, business-hours blocking, and Pix receipt validation.
- The main remaining risks are context correctness and operational fallback:
  - active-order status drift
  - customer history filtered after tiny enterprise-wide top-N slices
  - disableable human-escalation built-ins
  - stock-blind catalog availability
  - stale/lossy browser sync overriding backend runtime config
  - audio transcription timeout with no automatic rearm

## Current AI Runtime Shape
- Main entry: `server/ai.ts` `generateAndSendReply()`
- Runtime configuration:
  - `server/configStore.ts`
  - `empresa_perfil.ai_enabled`
  - `empresa_perfil.ai_mode`
  - `empresa_perfil.ai_schedule_start`
  - `empresa_perfil.ai_schedule_end`
- Prompt composition:
  - products + catalog hierarchy
  - owner instructions
  - tags
  - blocked dates
  - daily context
  - customer history summary
  - active order summary
  - session profile/context
- Tooling:
  - order creation/confirmation
  - order consultation
  - escalation/manager notification
  - Pix receipt validation

## Confirmed Findings

[P1] Audio transcription timeout can leave the customer without any automatic reply

Area:
AI Engine

Status:
Confirmed bug

Evidence:
- File(s): `server/ai.ts`, `server/messageHandler.ts`, `server/transcription.ts`, `server/index.ts`
- Function/component/route:
  - `waitForPendingAudioTranscriptions()`
  - `generateAndSendReply()`
  - `transcribeAudio()`
  - webhook auto-reply scheduling in `server/index.ts`
- Relevant behavior:
  - `server/ai.ts:2741-2745` aborts the AI reply when audio transcription wait times out.
  - `server/transcription.ts:135-138` later persists a finished transcript and broadcasts `message_update`.
  - `server/transcription.ts` does not re-schedule AI reply when transcription completes.
- Why the evidence supports the finding:
  - The timeout path exists, but there is no companion path that re-arms the auto-reply once the transcript arrives.

Why this matters:
- Technical impact:
  - Audio messages can become orphaned in the automation pipeline.
- Business impact:
  - Customers can be silently ignored after sending audio with order/address details.
- Heavy-user impact:
  - Queue delay or upstream slowness increases occurrence.
- Customer/support impact:
  - Operators have no deterministic automatic recovery path.

How to reproduce or validate:
1. Force an audio transcription to take longer than `AUDIO_TRANSCRIPTION_WAIT_MS`.
2. Send the audio into an AI-enabled conversation.
3. Confirm the transcript lands later but no AI reply is sent.

Recommended fix:
- Minimal safe fix:
  - Re-schedule reply on successful transcription completion if the conversation is still eligible.
- Long-term fix:
  - Model transcription + AI reply as an idempotent job/state machine.
- DB migration/index/RLS change if needed:
  - Optional processing-state field per message.
- Risk of the fix:
  - Medium; must avoid duplicate replies when newer customer turns arrive while waiting.

Confidence:
High

[P1] Operators can disable built-in human-escalation triggers for complaint/human-request scenarios

Area:
AI Engine

Status:
Confirmed risk

Evidence:
- File(s): `server/triggers.ts`, `src/components/views/AIConfigsView.tsx`, `server/ai.ts`
- Function/component/route:
  - `fetchActiveTriggers()`
  - built-in trigger toggle UI
  - trigger-driven reply flow in `generateAndSendReply()`
- Relevant behavior:
  - `server/triggers.ts` filters out disabled built-ins.
  - `src/components/views/AIConfigsView.tsx` exposes a toggle that explicitly disables automatic escalation for those built-ins.
  - Outside the pending-order branch, the AI engine relies on trigger/tool behavior rather than a hard pre-model rule for “quero falar com humano”, complaint, or offensive language.
- Why the evidence supports the finding:
  - A tenant can remove deterministic escalation behavior from exactly the scenarios where automation should fail safe.

Why this matters:
- Technical impact:
  - Safety behavior becomes configuration-dependent instead of mandatory.
- Business impact:
  - Angry or explicit human-request conversations can stay trapped in automation.
- Heavy-user impact:
  - More live conversations means more escalation-worthy edge cases.
- Customer/support impact:
  - Raises churn risk and manual damage control workload.

How to reproduce or validate:
1. Disable the relevant built-in escalation triggers in AI settings.
2. Send a complaint or explicit human-request message outside a pending-order flow.
3. Confirm the path depends on model behavior rather than a server-side mandatory block.

Recommended fix:
- Minimal safe fix:
  - Make critical human-escalation built-ins non-disableable.
- Long-term fix:
  - Add mandatory pre-model server-side fallbacks for complaint/offense/human-request classes.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Low.

Confidence:
High

[P1] Active-order prompt context ignores `out_for_delivery`

Area:
AI Engine

Status:
Confirmed bug

Evidence:
- File(s): `server/ai.ts`, `src/types.ts`
- Function/component/route: `fetchActiveOrdersForCustomer()`
- Relevant behavior:
  - `server/ai.ts:1726-1731` filters active orders with `['pending', 'preparing', 'ready', 'dispatched']`.
  - `src/types.ts:141-153` defines the current product status enum as `pending`, `preparing`, `ready`, `out_for_delivery`, `delivered`.
- Why the evidence supports the finding:
  - The AI lookup references a legacy status that the current app enum does not use.

Why this matters:
- Technical impact:
  - In-route deliveries disappear from AI context.
- Business impact:
  - “Cadê meu pedido?” flows can answer without the actual current state.
- Heavy-user impact:
  - More live deliveries means more incorrect context opportunities.
- Customer/support impact:
  - Support and customers can get contradictory order status answers.

How to reproduce or validate:
1. Create an order with status `out_for_delivery`.
2. Trigger AI reply for that customer.
3. Confirm the order does not appear in the active-order block.

Recommended fix:
- Minimal safe fix:
  - Replace `dispatched` with `out_for_delivery`.
- Long-term fix:
  - Share order-status constants across frontend, backend, and prompt helpers.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Low.

Confidence:
High

[P1] Customer history and active-order context are taken from enterprise-wide top-N slices before phone filtering

Area:
AI Engine

Status:
Confirmed risk

Evidence:
- File(s): `server/ai.ts`
- Function/component/route:
  - `fetchCustomerHistory()`
  - `fetchActiveOrdersForCustomer()`
- Relevant behavior:
  - `server/ai.ts:1688-1699` loads the latest 30 orders for the empresa, then filters by phone in memory.
  - `server/ai.ts:1726-1737` loads the latest 20 active orders for the empresa, then filters by phone in memory.
- Why the evidence supports the finding:
  - Under concurrent traffic, the target customer can fall outside the global top-N window even when valid history/orders exist in the database.

Why this matters:
- Technical impact:
  - The prompt loses correct customer memory and active-order context.
- Business impact:
  - AI can repeat questions or miss an open order.
- Heavy-user impact:
  - This gets worse as tenant activity increases.
- Customer/support impact:
  - Customers experience the AI as forgetful or inconsistent.

How to reproduce or validate:
1. Seed many recent orders for different customers.
2. Make the target customer's order/history older than the global top-N slice.
3. Trigger the AI and inspect the missing customer-specific context.

Recommended fix:
- Minimal safe fix:
  - Filter by phone in SQL before `limit`.
- Long-term fix:
  - Introduce normalized customer-phone columns and indexes for customer-centric lookups.
- DB migration/index/RLS change if needed:
  - Likely a normalized phone column/index on order history tables.
- Risk of the fix:
  - Low to medium.

Confidence:
High

[P1] AI runtime ignores stock-controlled availability

Area:
AI Engine

Status:
Confirmed risk

Evidence:
- File(s): `src/hooks/useCatalog.ts`, `server/configStore.ts`, `server/ai.ts`, `server/aiHealth.ts`
- Function/component/route:
  - catalog hydration in `loadAiSettingsFromDb()`
  - prompt product resolution
- Relevant behavior:
  - `src/hooks/useCatalog.ts:24-27, 94-97, 116-119` reads `controlar_estoque` and `estoque_atual`.
  - `server/configStore.ts:430-432` hydrates only `id, nome, preco, id_categoria, id_subcategoria, eh_item_por_unidade, ocultar_no_pdv`.
  - `server/configStore.ts:216-223` marks availability only from `ocultar_no_pdv`.
  - `server/ai.ts` uses that filtered product list for order resolution.
- Why the evidence supports the finding:
  - A product can be stock-controlled and out of stock while still being treated as available by the AI runtime.

Why this matters:
- Technical impact:
  - Availability validation is incomplete.
- Business impact:
  - AI can promise unavailable items.
- Heavy-user impact:
  - Stock-sensitive operations suffer more during rush hour.
- Customer/support impact:
  - More manual apology and order correction work.

How to reproduce or validate:
1. Set `controlar_estoque = true` and `estoque_atual = 0` on a product.
2. Keep `ocultar_no_pdv = false`.
3. Trigger an order flow and confirm the AI still treats the product as available.

Recommended fix:
- Minimal safe fix:
  - Hydrate stock fields and derive availability from both hidden and stock state.
- Long-term fix:
  - Revalidate stock at pending-order creation and confirmation time.
- DB migration/index/RLS change if needed:
  - No DB migration required for the first step.
- Risk of the fix:
  - Medium; changes product availability semantics for live order flows.

Confidence:
High

[P1] `/api/sync-config` allows stale and lossy browser snapshots to overwrite backend AI runtime context

Area:
AI Engine

Status:
Confirmed risk

Evidence:
- File(s): `src/AppShell.tsx`, `server/router.ts`, `server/configStore.ts`, `src/hooks/useCatalog.ts`
- Function/component/route:
  - `syncConfigToServer()`
  - `POST /api/sync-config`
  - `ensureAiSettingsHydrated()`
- Relevant behavior:
  - `src/AppShell.tsx:619-658` posts profile fields, `products`, and `catalogHierarchy` to `/api/sync-config`.
  - `server/router.ts:2288-2299` forwards that payload directly into `setConfig()`.
  - `server/configStore.ts:487-495` reuses hydrated config for up to five minutes.
  - `src/hooks/useCatalog.ts:51-53` caps catalog rows at `500/1000/2000`, so the browser snapshot can already be truncated.
- Why the evidence supports the finding:
  - A stale browser can overwrite fresher backend runtime state, and capped catalog snapshots can shrink what the AI sees.

Why this matters:
- Technical impact:
  - Runtime AI context can drift away from the shared source of truth.
- Business impact:
  - AI can answer with stale prices, stale hours, stale Pix key, or missing products.
- Heavy-user impact:
  - Larger catalogs are more likely to be truncated by the browser snapshot.
- Customer/support impact:
  - Operators see the AI say one thing while Zelo PDV says another.

How to reproduce or validate:
1. Open a browser tab with older catalog/profile data.
2. Change catalog/profile data through Zelo PDV or another client.
3. Let the stale tab call `/api/sync-config` and inspect the backend runtime config used by AI.

Recommended fix:
- Minimal safe fix:
  - Stop mirroring `products` and `catalogHierarchy` from the browser into backend runtime config.
- Long-term fix:
  - Treat shared DB reads as the only source of truth and use explicit invalidation/versioning.
- DB migration/index/RLS change if needed:
  - Optional version/hash field on catalog/profile snapshots.
- Risk of the fix:
  - Medium; changes current config sync behavior and may increase backend reads.

Confidence:
High

[P2] `dailyContext` is inserted into the system prompt without sanitization or a size cap

Area:
AI Engine

Status:
Confirmed risk

Evidence:
- File(s): `server/ai.ts`, `src/components/views/AIConfigsView.tsx`, `src/services/openaiService.ts`
- Function/component/route:
  - `buildSystemInstruction()`
  - daily-context editing/generation flow
- Relevant behavior:
  - `server/ai.ts:1984-1986` injects `cfg.dailyContext.map((c) => c.text)` directly into the system prompt.
  - Unlike `aiInstructions` and several order fields, this block does not pass through `safeForPrompt()`.
- Why the evidence supports the finding:
  - Owner-managed daily context can inflate or distort the system prompt without server-side sanitization.

Why this matters:
- Technical impact:
  - Larger or malformed daily context raises cost and prompt-conflict risk.
- Business impact:
  - Operational notices can unintentionally destabilize live customer replies.
- Heavy-user impact:
  - Businesses with frequent daily overrides are more exposed.
- Customer/support impact:
  - Debugging “why the AI changed behavior today” remains difficult.

How to reproduce or validate:
1. Save a large or malformed daily-context entry.
2. Trigger AI reply generation.
3. Inspect prompt assembly and confirm raw daily-context text is injected.

Recommended fix:
- Minimal safe fix:
  - Sanitize and cap each daily-context entry before prompt assembly.
- Long-term fix:
  - Use a structured manager-assistant flow for operational notices and store validated context only.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Low.

Confidence:
High

[P2] Simulator only exercises a narrow subset of real runtime conditions

Area:
AI Engine

Status:
Product suggestion

Evidence:
- File(s): `src/components/views/AIConfigsView.tsx`, `server/aiSimulator.ts`
- Function/component/route: AI simulator request/response flow
- Relevant behavior:
  - The simulator only overrides a small subset of config and does not model full runtime context such as active orders, blocked dates, delivery config, or real catalog/pending-order state.
- Why the evidence supports the finding:
  - Passing simulator output today does not mean the same conversation will behave the same way in production.

Why this matters:
- Technical impact:
  - Simulated behavior diverges from real runtime behavior.
- Business impact:
  - Operators can trust a simulator result that is not representative.
- Heavy-user impact:
  - More operational rules make simulator drift more visible.
- Customer/support impact:
  - Lowers confidence in AI configuration tooling.

How to reproduce or validate:
1. Configure blocked dates, delivery rules, or Pix rules.
2. Run the simulator with only message/instructions overrides.
3. Compare simulator output to real live-flow behavior.

Recommended fix:
- Minimal safe fix:
  - Clearly label simulator scope as base-prompt/tone only.
- Long-term fix:
  - Pass structured runtime overrides or a replayable conversation fixture into the simulator.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Low.

Confidence:
High

## Deeper Review Still Needed
- Review `server/managerAssistant.ts` and the full daily-context write path if that flow is expanded.
- Measure real prompt token footprint for larger catalogs.
- Confirm live data/status migration completeness for legacy order statuses.
