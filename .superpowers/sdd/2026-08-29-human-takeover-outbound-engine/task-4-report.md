# Task 4 Report — Conversation-serialized outbound worker

Date: 2026-08-30

## Status

DONE_WITH_CONCERNS

Task 4 is implemented locally. No deploy, push, production migration, dispatcher Task 5, or future caller migration was performed. `.codex-remote-attachments/` was preserved.

## Implemented

- Added `supabase/migrations/065_conversation_outbound_claims.sql`.
  - `claim_zelochat_outbound_job` acquires migration 064's temporary rollout gate first, selects due jobs in `(next_attempt_at, created_at, id)` order, locks canonical conversation control before the job row, re-evaluates mode/epoch/active lease, cancels stale AI jobs, and returns at most one job.
  - Expired `sending` leases can retry before transport; expired `dispatch_started` leases become `delivery_uncertain` and place the canonical control on hold without another POST.
  - Added tenant/lease-owner-fenced begin/start/complete/fail/suppress RPCs. Human intent idempotency is reserved before takeover with a transaction advisory key; only the first writer changes epoch and creates audit/message/job rows.
  - Added a database constraint rejecting persisted Data URLs.
- Generalized `server/outbound/queue.ts` and `server/outbound/worker.ts` for conversation/campaign/automation jobs.
  - Conversation jobs bypass CRM rollout decisions; campaigns and automations retain them.
  - All new production finalizations include `id + empresa_id + lease_owner`.
  - `dispatch_started` is committed before transport; missing IDs and post-linearization errors are uncertain.
- Added `server/outbound/providerAdapter.ts`.
  - Exhaustive switch for text, media, audio, sticker, buttons, contact, list, location, reaction, and poll.
  - SHA-256 fingerprints use canonical type-specific representations.
  - Provider helpers return only IDs extracted from response data; no synthetic ID is generated.
- Added `server/outbound/mediaStore.ts`.
  - Upload path is `zelochat-media/outbound/<empresa>/<job>/<sha256>`.
  - JSONB keeps only immutable reference/metadata/checksum; bytes are materialized only at transport time.
  - Terminal cleanup observes an explicit grace period.
- Added shared-store two-worker tests, lease fencing, epoch suppression, uncertain delivery/hold, alternate-JID serialization, independent-control progress, wrapper response probes, media durability, fingerprint, and migration lock-order guardrails.
- Updated CURRENT, FIXES_PROGRESS, and ZeloChat memory with the confirmed architecture and remaining rollout gates.

## TDD evidence

RED observed before implementation:

```text
actual [false, false] !== expected [true, false]
```

The old worker treated `conversation` as a disabled CRM rollout job and had no canonical conversation claim/fencing contract.

GREEN:

```text
conversationOutboundWorker: ok
outboundQueue: ok
Audit fix guardrails: 28 pass, 0 fail
crmHardening: ok
customerRollout: ok
Conversation control tests passed
npm run lint: exit 0
```

## Review

Local standards/spec review completed without subagents, as explicitly required by the task. It found and corrected a database head-of-line issue: a held/active first conversation candidate could originally prevent another conversation from being selected; candidate discovery now excludes held/active controls and still re-evaluates after the canonical lock.

## Concerns

- No local `SUPABASE_URL` / service-role credentials or `psql`/Supabase CLI were available, so migration 065 was not applied and the requested real-Postgres interleaving probe could not run. Structural lock-order/RPC guardrails are green, but rollout still requires the real transaction test.
- Provider helper probes used the existing `key.id` response shape through an in-process Axios adapter. No live provider call was made, so the new sticker endpoint and per-helper production response shapes still require sanitized sandbox fixtures before enforcement.
- Migration 065 must be applied before this backend. The migration-064 global gate remains intentionally conservative during rolling deploy.
- Task 5 dispatcher/callers and later `fromMe` reconciliation remain intentionally unimplemented; do not enable enforcement yet.
