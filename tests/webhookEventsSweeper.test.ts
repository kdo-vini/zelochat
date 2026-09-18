import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sweepWebhookEvents } from '../server/webhookEventsSweeper.js';

type RpcResult = {
  data: Array<{
    processed_deleted: number;
    unprocessed_deleted: number;
    update_stragglers_deleted: number;
  }> | null;
  error: { message: string } | null;
};

const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
let inFlight = 0;
let maxInFlight = 0;
const results: RpcResult[] = [
  {
    data: [{ processed_deleted: 400, unprocessed_deleted: 75, update_stragglers_deleted: 25 }],
    error: null,
  },
  {
    data: [{ processed_deleted: 3, unprocessed_deleted: 0, update_stragglers_deleted: 0 }],
    error: null,
  },
  {
    data: [{ processed_deleted: 0, unprocessed_deleted: 0, update_stragglers_deleted: 0 }],
    error: null,
  },
];

const client = {
  async rpc(name: string, args: Record<string, unknown>): Promise<RpcResult> {
    calls.push({ name, args });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
    return results.shift()!;
  },
};

const pauses: number[] = [];
const summary = await sweepWebhookEvents(client, async (milliseconds) => { pauses.push(milliseconds); });

assert.equal(maxInFlight, 1, 'retention batches must never run in parallel');
assert.equal(calls.length, 3, 'sweeper continues until the RPC returns an empty batch');
assert.deepEqual(pauses, [100, 100], 'non-empty batches yield before the next delete transaction');
assert.ok(calls.every((call) => call.name === 'purge_zelochat_webhook_events_raw_batch'));
assert.ok(calls.every((call) => call.args.p_batch_size === 500));
assert.deepEqual(summary, {
  batches: 2,
  processed: 403,
  unprocessed: 75,
  updateStragglers: 25,
  total: 503,
});

const processedBefore = Date.parse(String(calls[0].args.p_processed_before));
const unprocessedBefore = Date.parse(String(calls[0].args.p_unprocessed_before));
const retentionGapDays = Math.round((processedBefore - unprocessedBefore) / 86_400_000);
assert.equal(retentionGapDays, 14, 'successful events retain 7 days; failed/stuck events retain 21 days');

const migration = readFileSync('supabase/migrations/20260918044906_optimize_webhook_raw_io.sql', 'utf8');
assert.match(migration, /for update skip locked/i);
assert.match(migration, /pg_try_advisory_xact_lock/i);
assert.match(migration, /security invoker/i);
assert.match(migration, /revoke all on function[\s\S]*from public/i);
assert.match(migration, /grant execute on function[\s\S]*to service_role/i);
assert.match(
  migration,
  /zelochat_webhook_events_raw_processed_retention_idx[\s\S]*where processed_at is not null/i,
);
assert.match(migration, /create index concurrently/i, 'production index builds must not block webhook writes');
assert.match(
  migration,
  /drop index concurrently if exists public\.idx_zelochat_sessions_empresa_updated/i,
  'duplicate session activity index is removed without blocking writes',
);
assert.match(migration, /dedupe_fingerprint text/i, 'raw events store a canonical idempotency fingerprint');
assert.match(
  migration,
  /create unique index concurrently[\s\S]*zelochat_webhook_events_raw_message_fingerprint_uidx/i,
  'cross-replica message dedupe is database-enforced',
);
assert.match(migration, /create or replace function public\.record_zelochat_raw_webhook/i);
assert.match(
  migration,
  /revoke all on function public\.record_zelochat_raw_webhook[\s\S]*from authenticated/i,
  'browser roles cannot invoke the raw writer RPC',
);
assert.match(migration, /create or replace function public\.zelochat_apply_inbound_session_activity/i);
assert.match(migration, /p_last_message_time text/i);
assert.match(
  migration,
  /set last_message = p_last_message,[\s\S]*unread_count = coalesce\(unread_count, 0\) \+ 1/i,
  'session preview and unread count change in one database update',
);

console.log('webhookEventsSweeper tests passed');
