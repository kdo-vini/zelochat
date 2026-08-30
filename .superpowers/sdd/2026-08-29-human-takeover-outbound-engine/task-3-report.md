# Task 3 Report — Conversation Control RPCs and Runtime Seam

Date: 2026-08-30

## Status

DONE_WITH_CONCERNS

Task 3 is implemented and committed locally. No deploy and no push were performed. `.codex-remote-attachments/` was left untouched.

## Implemented

- Added `supabase/migrations/064_conversation_control_rpcs.sql`.
  - Adds service-role-only RPCs:
    - `ensure_zelochat_conversation_control(p_empresa_id uuid, p_remote_jid text)`
    - `advance_zelochat_ai_epoch_for_inbound(p_empresa_id uuid, p_remote_jid text, p_message_id uuid)`
    - `pause_zelochat_ai_for_human(p_empresa_id uuid, p_remote_jid text, p_actor_user_id uuid, p_source text, p_message_id uuid default null)`
    - `resume_zelochat_ai(p_empresa_id uuid, p_remote_jid text, p_actor_user_id uuid)`
    - `check_zelochat_ai_epoch(p_empresa_id uuid, p_remote_jid text, p_expected_epoch bigint)`
  - RPC callers do not supply family arrays. The database resolves the canonical control from `empresa_id + remote_jid`, takes an advisory transaction lock for the identity key, locks control rows, projects `auto_reply`, and returns a canonical snapshot.
  - Duplicate controls are merged under ordered row locks. Human mode wins; when a merge occurs, the epoch becomes `greatest(epoch) + 1`, sessions/jobs/events are reassigned, and a `controls_merged` event is recorded.
  - `pause_zelochat_ai_for_human` cancels only queued jobs whose `outbound_origin` is `ai_auto` or `ai_followup`. Resume does not restore jobs.
  - Inbound AI turn dedupe checks the audit event by `message_id`, not only the latest inbound pointer, so a redelivery of an older inbound message does not advance epoch again.

- Added `server/conversationControl.ts`.
  - Exposes `ConversationControlSnapshot`, `AiTurnPermit`, `beginAiTurn`, `claimHumanTakeover`, `resumeAiConversation`, `ensureConversationControl`, and `isAiPermitCurrent`.
  - Normalizes Postgres `bigint` epochs to TypeScript strings.
  - Fails closed for AI permits: `beginAiTurn` returns `null` on RPC failure or human mode, and `isAiPermitCurrent` returns `false` on RPC failure.
  - Supports fake-repository tests through injected `rpc`, `resolveFamilyJids`, and `cancelPendingReply`.
  - Keeps runtime imports for Supabase/debouncer lazy so the unit test remains standalone.

- Updated `server/messageHandler.ts`.
  - Exports only `fetchSessionFamilyJids` as the adapter seam; the family rows remain private.
  - `ensureSession` calls `ensureConversationControl` before returning, so a newly created JID variation inherits the existing canonical control and mode.
  - `setAutoReply` is now a compatibility wrapper:
    - `enabled=false` calls `claimHumanTakeover(source='explicit_manual_toggle')`.
    - `enabled=true` calls `resumeAiConversation`.
    - It emits `conversation_mode_changed` after the RPC returns.

- Updated `server/escalation.ts`.
  - `escalateSession` calls `claimHumanTakeover(source='escalation')` before writing `status='escalated'`.
  - Removed the direct `auto_reply=false` write from the escalation status update.
  - Emits `conversation_mode_changed` after takeover/status handling.

- Updated `server/ws.ts`.
  - Added `conversation_mode_changed` to the typed WS event union.

- Added/finished `tests/conversationControl.test.ts`.
  - Covers takeover, repeated takeover, resume epoch advance, duplicate inbound dedupe, fail-closed RPC behavior, same-tenant isolation, new JID variation inheriting canonical human control, and migration guardrails.

## Checks

Passing:

- `npx tsx tests/conversationControl.test.ts`
- `npx tsx tests/replyDebouncer.test.ts`
- `npx tsx tests/auditFixGuardrails.test.ts`
- `npm run lint`

Attempted but not completed:

- `npm test`
  - Progressed through several files successfully, including `accessErrorMapping`, `accountDeletionReliability`, `aiConfigsViewGuardrails`, `aiPromptGuardrails`, `aiRouteGuards`, `aiSchedule`, `aiScheduleEdgeCases`, and `aiScheduleWizard`.
  - It then hung at `tests/aiSimulatorScheduleGuard.test.ts`. Running that file isolated with the same runner envs (`WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1`, `ZELOCHAT_DISABLE_WHATSAPP_NETWORK=1`) also produced no output after 30 seconds, so the full suite was interrupted and not rerun.

## Review Notes

- The `/review` skill normally requires parallel subagents, but the task explicitly said not to create subagents. I performed the standards/spec review locally instead.
- No future outbound dispatcher or `fromMe` callers were migrated. The new seam is ready for those later tasks, but this commit intentionally stops at Task 3.
- The route-level auto-reply toggle still calls `setAutoReply` with the legacy signature, so sub-user audit for explicit resume/toggle falls back to the owner if no actor is supplied. The module signature supports an explicit actor for future caller cleanup.

## Commit

Planned commit message:

`feat(chat): add atomic human takeover and AI epoch`

## Fix Round 1/5 — CHANGES_REQUESTED

Date: 2026-08-30

Status: DONE_WITH_CONCERNS

Review findings addressed:

- P1 family split: `ensure_zelochat_conversation_control` now builds the canonical family from both `person:*` identity and the unresolved phone/contact key. If any session in the contact family has `pessoa_id`, the canonical control becomes `person:<pessoa_id>` and unresolved `phone:*` controls are merged into it. The test for a new JID variation no longer pre-associates the JID; the fake repo resolves it by normalized contact key.
- P1 rolling deploy compatibility: migration 064 now adds `trg_zelochat_conversation_control_session_bridge`. Legacy inserts and identity updates call `ensure` inside the same database transaction; legacy direct `auto_reply` writes become audited control transitions with epoch advancement and family projection. Legacy `auto_reply=false` also cancels queued AI jobs.
- P1 tenant validation: `advance`, `pause`, and `resume` validate `p_message_id` against `zelochat_messages.empresa_id`; `pause`/`resume` validate actor ownership or active sub-user membership through `empresa_perfil`/`access_users`.
- P2 toggle actor: `/api/sessions/:jid/auto-reply` now resolves `requireActorAccess(req)` and passes `access.actorUserId` to `setAutoReply`.
- P2 merge with active jobs: before reassigning losing controls, active `sending|dispatch_started` jobs on losing controls are moved to `delivery_uncertain` with `suppression_reason='controls_merged_active_job'`, avoiding the partial unique index collision.
- P2 deadlock risk: identity advisory locks are now acquired after collecting all candidate identity keys and always in sorted order; control row locks remain ordered by control id.
- P2 epoch shape: TypeScript no longer accepts numeric epochs from RPC responses; only string and `bigint` are accepted.
- P2 log hygiene: `conversationControl` warning logs redact remote JIDs.

Commands run:

```powershell
npx tsx tests/conversationControl.test.ts
npx tsx tests/replyDebouncer.test.ts
npx tsx tests/auditFixGuardrails.test.ts
npm run lint
```

Observed outputs:

- `tests/conversationControl.test.ts`: `Conversation control tests passed`
- `tests/replyDebouncer.test.ts`: `12 pass, 0 fail`
- `tests/auditFixGuardrails.test.ts`: `28 pass, 0 fail`
- `npm run lint`: exited with code 0 (`tsc --noEmit`)

Not rerun:

- `npm test`, per instruction for this review round. Previous full-suite attempt hung at `tests/aiSimulatorScheduleGuard.test.ts`.

Remaining concerns:

- The SQL migration has guardrail coverage in unit tests but was not applied to a live Postgres instance in this round.
- Future dispatcher/fromMe callers remain intentionally unmigrated for later tasks.

## Fix Round 2/5 — Lock-order rereview

Date: 2026-08-30

Status: DONE

Review finding addressed:

- P1/P2 rolling-deploy deadlock: migration 064 now uses a single lock direction for conversation control paths: session rows first, identity advisory locks second, control rows last. The new internal helper `zelochat_lock_conversation_session_family` locks the canonical session family deterministically by `zelochat_sessions.id`. `ensure_zelochat_conversation_control` calls it before advisory locks and before any control row lock. The legacy `zelochat_conversation_control_session_bridge` documents that PostgreSQL already holds the triggering session row, then locks the remaining projected family before reading/updating the canonical control. This preserves the atomic compatibility bridge while removing the new-path control→session inversion that caused the rereview finding.

Guardrail added:

- `tests/conversationControl.test.ts` now has `Test 10`, a source-level lock-order guardrail. A live concurrent-transaction DB harness is not present in this task suite, so the guardrail freezes the migration structure directly: `ensure` must call the session-family lock before `pg_advisory_xact_lock`, control locks must come after advisory locks, the bridge must lock the session family before selecting the control row, and the helper must lock rows using `order by s.id for update`.

Commands run:

```powershell
npx tsx tests/conversationControl.test.ts
npx tsx tests/auditFixGuardrails.test.ts
npx tsx tests/conversationOutboundSchema.test.ts
npm run lint
```

Observed outputs:

- `tests/conversationControl.test.ts`: `Conversation control tests passed`
- `tests/auditFixGuardrails.test.ts`: `28 pass, 0 fail`
- `tests/conversationOutboundSchema.test.ts`: exited with code 0
- `npm run lint`: exited with code 0 (`tsc --noEmit`)

Not rerun:

- Full `npm test`, per review-round instruction to avoid the previously hanging complete suite.

Remaining concerns:

- The lock-order regression is covered by source-level guardrails, not by a live PostgreSQL deadlock simulation.
- Future dispatcher/fromMe callers remain intentionally unmigrated for later tasks.

## Fix Round 3/5 — Gate before first session row lock

Date: 2026-08-30

Status: DONE

Review finding addressed:

- The round 2 session-family ordering still allowed a deadlock because the legacy `AFTER ROW` bridge necessarily starts after PostgreSQL has already locked an arbitrary `zelochat_sessions` row. Migration 064 now adds `zelochat_conversation_control_rollout_gate()`, a temporary global transaction advisory lock, and a `BEFORE STATEMENT` trigger on the same `zelochat_sessions` INSERT/UPDATE columns handled by the bridge. That statement trigger acquires the gate before PostgreSQL visits/locks individual session rows. The public control RPCs and `ensure_zelochat_conversation_control` acquire the same gate at the start, before any session/control row lock. The projection and session-family helpers also acquire the same gate before writing/locking session rows.

Trade-off documented:

- The rollout gate intentionally serializes relevant session INSERT/UPDATE statements and conversation-control RPCs globally while legacy `auto_reply` writers and the compatibility bridge coexist. This is a temporary rolling-deploy cost chosen to prove no path enters with an arbitrary row lock before joining the shared lock order. After old direct writers are gone, a future cleanup can remove the compatibility bridge/gate and restore finer-grained concurrency.

Guardrail updated:

- `tests/conversationControl.test.ts` `Test 10` now verifies the structural gate, not only comments/order inside the `AFTER ROW` trigger:
  - the advisory key is declared once in `zelochat_conversation_control_rollout_gate`;
  - `trg_zelochat_conversation_control_session_statement_gate` is a `BEFORE STATEMENT` trigger for the relevant session writes;
  - the statement gate trigger is installed before the `AFTER ROW` bridge;
  - `ensure`, `advance`, `pause`, `resume`, and `check` acquire the rollout gate before `ensure` calls or row locks;
  - projection/session-family helpers acquire the same gate before session writes/`for update`.

Commands run:

```powershell
npx tsx tests/conversationControl.test.ts
npx tsx tests/auditFixGuardrails.test.ts
npx tsx tests/conversationOutboundSchema.test.ts
npm run lint
```

Observed outputs:

- `tests/conversationControl.test.ts`: `Conversation control tests passed`
- `tests/auditFixGuardrails.test.ts`: `28 pass, 0 fail`
- `tests/conversationOutboundSchema.test.ts`: exited with code 0
- `npm run lint`: exited with code 0 (`tsc --noEmit`)

Not rerun:

- Full `npm test`, per review-round instruction to avoid the previously hanging complete suite.

Remaining concerns:

- The deadlock regression is still covered by source-level guardrails rather than a live PostgreSQL concurrent transaction simulation.
- The global advisory gate is intentionally conservative and may reduce concurrency for relevant session writes during the rolling-deploy compatibility window.
- Future dispatcher/fromMe callers remain intentionally unmigrated for later tasks.
