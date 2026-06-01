# ZeloChat Reliability Audit

> Ver também: [[CODE_REVIEW]] · [[FIXES_PROGRESS]] · [[ZeloChat.audit-report]] · [[ZeloChat.audit-ai-engine]]

## Executive Summary
- Reliability is stronger than the stale docs implied in three areas:
  - inbound dedupe by `wa_message_id`
  - early webhook ack
  - raw webhook event logging
- The main remaining gaps are around partial failures and supportability:
  - manual send can succeed upstream and fail to persist locally
  - audio reply can die after transcription timeout
  - raw webhook failures have no retry/replay worker
  - there is no persisted prompt/context snapshot for “why did the AI reply this?”
  - cross-tab realtime state still has important blind spots

## Current Failure-Handling Building Blocks
- Inbound dedupe:
  - `server/messageHandler.ts` upserts inbound user messages with `wa_message_id` uniqueness handling.
- Early webhook ack:
  - `server/router.ts:728-751`
- Raw webhook evidence:
  - `server/webhookLog.ts`
- AI failure escalation:
  - `server/escalation.ts` `recordAiFailure()`
- Order confirmation send-failure marker:
  - `server/ai.ts:581-600`
- Slow request logging:
  - `server/observability.ts`

## Confirmed Findings

[P1] Manual send path can send on WhatsApp and then fail to persist locally

Area:
Reliability

Status:
Confirmed bug

Evidence:
- File(s): `server/router.ts`, `server/messageHandler.ts`
- Function/component/route: `POST /api/send`, `addAssistantMessage()`
- Relevant behavior:
  - `server/router.ts:1146-1148` sends text/media to WhatsApp first.
  - `server/router.ts:1150-1154` only persists the assistant message after the send succeeds.
  - If `addAssistantMessage()` throws, the route falls into `server/router.ts:1155-1161` and returns an error even though the customer may already have received the message.
- Why the evidence supports the finding:
  - The lifecycle is not atomic and has no reconciliation path for “send succeeded, DB write failed”.

Why this matters:
- Technical impact:
  - Customer and local chat history can diverge permanently.
- Business impact:
  - Operators may resend a message the customer already received.
- Heavy-user impact:
  - More outbound traffic means more chances to hit intermittent DB failure after successful send.
- Customer/support impact:
  - Creates trust-damaging duplicate or confusing manual replies.

How to reproduce or validate:
1. Force WhatsApp send to succeed.
2. Fail `addAssistantMessage()` afterward.
3. Confirm the customer receives the message while the operator UI does not show it.

Recommended fix:
- Minimal safe fix:
  - Persist an outbound intent/status row before send and reconcile status after send.
- Long-term fix:
  - Model outbound sends as idempotent stateful jobs with `queued/sending/sent/failed`.
- DB migration/index/RLS change if needed:
  - Likely yes; explicit outbound lifecycle/status fields or a send-job table.
- Risk of the fix:
  - Medium; touches a hot operator path.

Confidence:
High

[P1] Audio transcription timeout permanently suppresses reply

Area:
Reliability

Status:
Confirmed bug

Evidence:
- File(s): `server/ai.ts`, `server/transcription.ts`, `server/messageHandler.ts`
- Function/component/route:
  - `waitForPendingAudioTranscriptions()`
  - `generateAndSendReply()`
  - `transcribeAudio()`
- Relevant behavior:
  - `server/ai.ts:2741-2745` aborts reply on timeout.
  - `server/transcription.ts:135-138` later persists the transcript only.
  - `server/messageHandler.ts:1895-1907` tracks the job but no later code re-arms reply generation.
- Why the evidence supports the finding:
  - There is a timeout abort path and no compensating retry/replay path.

Why this matters:
- Technical impact:
  - An inbound audio can remain unhandled forever.
- Business impact:
  - Lost lead or stalled order.
- Heavy-user impact:
  - More concurrent upstream load means more late transcriptions.
- Customer/support impact:
  - Hard to notice unless an operator manually inspects the thread.

How to reproduce or validate:
1. Delay transcription beyond timeout.
2. Send audio into AI-enabled session.
3. Confirm transcript appears later without any AI answer.

Recommended fix:
- Minimal safe fix:
  - Schedule a one-shot retry when transcription finishes.
- Long-term fix:
  - Formalize transcription and reply as a resilient state machine.
- DB migration/index/RLS change if needed:
  - Optional explicit processing-state fields.
- Risk of the fix:
  - Medium.

Confidence:
High

[P2] Raw webhook failures are recorded, but there is no retry/replay worker or support surface in this repo

Area:
Reliability

Status:
Confirmed risk

Evidence:
- File(s): `server/router.ts`, `server/webhookLog.ts`, `supabase/migrations/016_webhook_events_raw.sql`
- Function/component/route:
  - `recordRawWebhookEvent()`
  - `markWebhookEventProcessed()`
  - webhook handler
- Relevant behavior:
  - `server/router.ts:742-751` records the raw event and writes `processing_error`.
  - `server/webhookLog.ts` only inserts and marks processed.
  - Repo-wide code search in the current head only found `zelochat_webhook_events_raw` consumers in `server/router.ts` and `server/webhookLog.ts`; there is no replay worker, retry job, or operator UI in this repo.
- Why the evidence supports the finding:
  - The audit trail exists, but recovery is manual/out-of-band today.

Why this matters:
- Technical impact:
  - Processing failures are detectable but not recoverable automatically.
- Business impact:
  - A transient persistence or AI regression can still drop live work until humans intervene.
- Heavy-user impact:
  - More inbound events increase the queue of unrecovered failures.
- Customer/support impact:
  - Support cannot self-serve replay from the product UI.

How to reproduce or validate:
1. Force `processWebhookEvent()` to throw after raw event insert.
2. Inspect `zelochat_webhook_events_raw`.
3. Confirm the row records `processing_error` but no automatic replay occurs.

Recommended fix:
- Minimal safe fix:
  - Build an admin-only replay command or job for failed raw webhook rows.
- Long-term fix:
  - Move failed raw events into a proper dead-letter/replay workflow with correlation and operator tooling.
- DB migration/index/RLS change if needed:
  - Possibly a replay status / retry counter if replay becomes first-class.
- Risk of the fix:
  - Low to medium.

Confidence:
High

[P2] There is no persisted prompt/context snapshot or AI decision log for supportability

Area:
Reliability

Status:
Confirmed risk

Evidence:
- File(s): `server/aiUsage.ts`, `supabase/migrations/018_zelochat_ai_usage_daily.sql`, `server/ai.ts`
- Function/component/route:
  - aggregated AI usage recording
  - prompt assembly in `buildSystemInstruction()`
- Relevant behavior:
  - `supabase/migrations/018_zelochat_ai_usage_daily.sql:5-7` explicitly states the AI usage table stores no prompts, responses, names, phones, JIDs, or message IDs.
  - `server/aiUsage.ts:41-69` records only aggregate counters/tokens.
  - `server/ai.ts` builds prompt/context in memory and does not persist a support-oriented prompt/context snapshot in the current repo.
- Why the evidence supports the finding:
  - Current observability can answer “how much AI was used”, but not “why did the AI send this exact reply with this exact context?”

Why this matters:
- Technical impact:
  - Incident debugging lacks replayable decision evidence.
- Business impact:
  - Harder to defend or correct bad AI replies with confidence.
- Heavy-user impact:
  - More AI turns mean more opaque incidents to investigate.
- Customer/support impact:
  - Support cannot answer the most important AI audit questions quickly.

How to reproduce or validate:
1. Inspect the current repo for persisted prompt/context logging.
2. Compare with `zelochat_ai_usage_daily`.
3. Confirm only aggregate usage exists, not decision snapshots.

Recommended fix:
- Minimal safe fix:
  - Persist a redacted prompt/context summary with conversation ID, model, selected products/tags, and tool path.
- Long-term fix:
  - Build an audit log for AI decisions with retention/redaction controls and support UI.
- DB migration/index/RLS change if needed:
  - Yes; likely a new audit table with careful PII minimization.
- Risk of the fix:
  - Medium; must balance supportability with privacy.

Confidence:
High

[P2] WebSocket contract is incomplete for multi-attendant correctness

Area:
Reliability

Status:
Confirmed risk

Evidence:
- File(s): `server/router.ts`, `server/messageHandler.ts`, `src/hooks/useWhatsAppSessions.ts`, `server/ws.ts`
- Function/component/route:
  - `POST /api/sessions/:jid/auto-reply`
  - WebSocket event handling in `useWhatsAppSessions`
- Relevant behavior:
  - `server/router.ts:1947-1952` toggles auto-reply.
  - `server/messageHandler.ts:2053-2079` updates DB state but does not broadcast a dedicated event.
  - `src/hooks/useWhatsAppSessions.ts:265-285` only does optimistic local update for the current tab.
  - `server/ws.ts:5-21` defines no dedicated `auto_reply` or `session_deleted` event type.
- Why the evidence supports the finding:
  - Multi-tab or multi-attendant state can diverge until a later full refresh or unrelated event.

Why this matters:
- Technical impact:
  - State convergence is incomplete under concurrency.
- Business impact:
  - Manual/AI ownership can look different to different attendants.
- Heavy-user impact:
  - More tabs and attendants increase the chance of divergence.
- Customer/support impact:
  - Human takeover can look inconsistent during live service.

How to reproduce or validate:
1. Open the same conversation in two tabs.
2. Toggle manual/AI in one tab.
3. Confirm the other tab does not get an immediate dedicated realtime update.

Recommended fix:
- Minimal safe fix:
  - Add dedicated WebSocket events for `auto_reply` and `session_deleted`.
- Long-term fix:
  - Formalize a complete conversation-state event contract across tabs.
- DB migration/index/RLS change if needed:
  - No.
- Risk of the fix:
  - Low to medium.

Confidence:
High

## Observability Notes
- Good:
  - slow-request logger
  - raw webhook evidence
  - aggregated AI token usage
  - response-time metrics table
- Missing or incomplete:
  - correlation IDs across webhook -> persistence -> AI -> send
  - support UI for failed webhook replay
  - AI decision snapshots
  - message lifecycle statuses beyond `sent/delivered/read`
