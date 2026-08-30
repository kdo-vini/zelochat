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
  - JSONB keeps only immutable reference/metadata/checksum; preflight downloads bytes for checksum/fingerprint and creates an HTTPS signed transport URL.
  - Terminal cleanup observes an explicit grace period and runs idempotently from the production worker sweeper.
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

## Fix round 1/5

All eleven review findings were addressed without implementing Task 5+:

- Media ingestion now accepts inline bytes only before enqueue or HTTPS sources from the approved storage allowlist, refuses redirects/non-HTTPS/private arbitrary sources, applies a 10-second timeout and a 25 MiB streaming/decoded cap, and verifies size/checksum. Provider media receives a seven-day signed HTTPS storage URL; Data URLs never enter queue JSONB or provider POSTs.
- `ProviderAdapter.prepare` performs payload/vCard validation, media download/checksum, and fingerprint verification. The worker calls it before `startTransport`; after the fence it calls `send`, whose only external operation is the provider POST through an already-resolved `instanceKey`. Preflight errors finalize as `failed_before_dispatch` with zero attempts.
- TypeScript input/stored jobs are discriminated by `jobType` and AI origin requires a string epoch. Migration 065 adds job-type and exact media JSONB checks; queued media accepts only `storagePath`, `mimeType`, `fileName`, `sizeBytes`, `checksum`, and kind-specific metadata.
- Claims no longer increment attempts. `start_zelochat_outbound_transport` increments atomically, operational deferrals preserve attempts, and the lease sweeper terminalizes legacy/max-attempt queued rows.
- Automation jobs with `pessoa_id = null` remain eligible through `phone_snapshot`; a regression covers this abandoned-cart contract.
- Shared WhatsApp wrappers return `string | null` on successful HTTP responses and never turn missing provider IDs into 500s. Only the adapter maps null to `delivery_uncertain`.
- Release/start/complete/fail/suppress paths acquire rollout gate, canonical control, then job. Migration 064 control merge installs the uncertain loser as the winner's `hold_job_id` before duplicate controls are removed; claims continue to honor the hold.
- Campaign and automation recipient lifecycle now supports and preserves `delivery_uncertain` on immediate post-fence failure and lease expiry. Stale AI cancellation also updates the linked message lifecycle.
- Terminal media cleanup is wired into worker startup plus an hourly, idempotent grace-period sweep using `media_cleaned_at`.
- Added an opt-in local-Postgres/RPC interleaving test. It captures a stale candidate, concurrently holds the rollout gate while epoch/mode changes, then verifies both workers claim nothing and the stale job is cancelled. Without local credentials it reports an explicit skip.
- Moved WhatsApp formatting into a lightweight module so backend wrapper probes avoid loading browser-facing date formatting dependencies; public behavior is unchanged.

### RED/GREEN and verification commands

Initial focused run after changing wrapper semantics exposed the stale guardrail expectation:

```text
.\node_modules\.bin\tsx.cmd tests/auditFixGuardrails.test.ts
27 pass, 1 fail
FAIL manual outbound success records only a real provider message id
```

The guardrail was updated to require `extractWhatsmiauMessageId(...) ?? null`. Final focused command:

```text
.\node_modules\.bin\tsx.cmd tests/conversationOutboundWorker.test.ts;
.\node_modules\.bin\tsx.cmd tests/outboundQueue.test.ts;
.\node_modules\.bin\tsx.cmd tests/auditFixGuardrails.test.ts;
.\node_modules\.bin\tsx.cmd tests/crmHardening.test.ts;
.\node_modules\.bin\tsx.cmd tests/customerRollout.test.ts;
.\node_modules\.bin\tsx.cmd tests/conversationControl.test.ts;
.\node_modules\.bin\tsx.cmd tests/conversationOutboundRpc.integration.test.ts
```

Output:

```text
conversationOutboundWorker: ok
outboundQueue: ok
Audit fix guardrails: 29 pass, 0 fail
crmHardening: ok
customerRollout: ok
Conversation control tests passed
conversationOutboundRpc integration: SKIP (LOCAL_OUTBOUND_TEST_DATABASE_URL ausente)
```

Type/lint check:

```text
npm run lint
> tsc --noEmit
exit 0
```

Repository hygiene:

```text
git diff --check
exit 0
```

## Fix round 2/5

Os nove achados restantes/novos foram corrigidos sem antecipar o dispatcher ou callers da Task 5:

- `start_zelochat_outbound_transport` adquire o gate e o controle canônico, relê o job com lease sob lock e revalida hold, modo e epoch imediatamente antes de `dispatch_started`. Takeover humano ou epoch de IA obsoleto durante o preflight cancela/projeta o job e impede o POST.
- O CHECK de shape agora é fail-closed para `job_type`, `outbound_origin`, objeto/payload kind e campos obrigatórios da conversa. Uma bridge temporária deriva origin/payload somente para inserts legados de campanha/automação durante rolling deploy; conversa nunca recebe defaults. O mapper não converte origem nula de conversa em `internal_system`; a união TypeScript aceita somente `PersistedOutboundPayload` para conversa e o runtime rejeita mídia com `attachment`/`dataUrl`.
- O merge da migration 064 preserva primeiro o hold existente do vencedor, depois holds dos perdedores e por fim o job incerto mais antigo. Antes de apagar controles perdedores, projeta `delivery_uncertain` nas mensagens. `release_zelochat_outbound_hold` seleciona deterministicamente a próxima ambiguidade, sem liberar a conversa enquanto outra entrega incerta existir.
- Storage path é ligado exatamente a `outbound/<empresa_id>/<job_id>/<checksum>` no CHECK SQL, no preflight e no cleanup. O sweeper consulta somente `media|audio|sticker`, estados terminais após grace e `media_cleaned_at is null`, com marcação CAS idempotente.
- Normalização/validação do JID, formatação, validação por kind e serialização do body ocorrem em `prepareWhatsAppHttpRequest`. Depois do fence, `sendPreparedWhatsAppHttpRequest` executa o request já preparado e interpreta o ID real; JID inválido falha antes do dispatch.
- Job sem `phone_snapshot` e sem `conversation_jid` terminaliza explicitamente como `failed_before_dispatch`, sem permanecer `queued`/`sending` com zero tentativas.
- Contact/list/location/reaction/poll retornam erro PT-BR amigável e sem nome/status/resposta técnica; logs guardam somente código/status redigidos.
- O teste Postgres opt-in usa sessões `psql`, markers e `pg_stat_activity.wait_event_type='Lock'`: cobre claim bloqueado entre candidate/control, takeover entre claim/start e a ordem oposta em que o starter lineariza primeiro. Não usa sleep como sincronização e encerra sessões abertas no cleanup.

### Testes e saídas

Comando focado:

```powershell
$tests = @(
  'tests/conversationOutboundWorker.test.ts',
  'tests/outboundQueue.test.ts',
  'tests/auditFixGuardrails.test.ts',
  'tests/crmHardening.test.ts',
  'tests/customerRollout.test.ts',
  'tests/conversationControl.test.ts',
  'tests/conversationOutboundRpc.integration.test.ts'
)
foreach ($test in $tests) {
  npx tsx $test
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Saída:

```text
conversationOutboundWorker: ok
outboundQueue: ok
Audit fix guardrails: 34 pass, 0 fail
crmHardening: ok
customerRollout: ok
Conversation control tests passed
conversationOutboundRpc integration: SKIP (LOCAL_OUTBOUND_TEST_DATABASE_URL ausente)
exit 0
```

Typecheck/lint:

```text
npm run lint
> tsc --noEmit
exit 0
```

O teste RPC real permaneceu em skip explícito porque não havia credencial Postgres local. Nenhuma migration foi aplicada, e nenhum provider, deploy ou ambiente de produção foi chamado.

## Concerns

- No `LOCAL_OUTBOUND_TEST_DATABASE_URL` or local `psql` was available, so migration 065 was not applied and the opt-in real-Postgres interleaving test skipped explicitly. Structural lock-order/RPC guardrails are green, but rollout still requires that local transaction test before migration application.
- Provider helper probes used the existing `key.id` response shape through an in-process Axios adapter, including a 2xx-without-ID case. No live provider call was made, so per-helper production response shapes still require sanitized sandbox fixtures before enforcement.
- Migration 065 must be applied before this backend. The migration-064 global gate remains intentionally conservative during rolling deploy.
- Task 5 dispatcher/callers and later `fromMe` reconciliation remain intentionally unimplemented; do not enable enforcement yet.
