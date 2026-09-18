import { assert, assertEqual, runSuite } from './testHarness.js';
import {
  createRawWebhookRecorder,
  type RawWebhookInsert,
} from '../server/webhookLog.js';

function makeRecorder() {
  const rows: Parameters<RawWebhookInsert>[0][] = [];
  const recorder = createRawWebhookRecorder({
    insert: async (row) => {
      rows.push(row);
      return { id: `raw-${rows.length}`, inserted: true };
    },
    now: () => 1_000,
  });
  return { recorder, rows };
}

const lowValueBodies = [
  { event: 'contacts.upsert', data: { remoteJid: '5511999999999@s.whatsapp.net' } },
  { event: 'connection.update', data: { state: 'open' } },
  { event: 'messages.delete', data: { key: { id: 'deleted-1' } } },
];

await runSuite('Raw webhook persistence policy', [
  {
    name: 'authenticated low-value events skip raw persistence on the happy path',
    run: async () => {
      const { recorder, rows } = makeRecorder();
      for (const body of lowValueBodies) {
        const result = await recorder.record('instance-a', 'empresa-a', body, 'token_match');
        assertEqual(result.status, 'skipped', `${body.event} is intentionally skipped`);
        assertEqual(result.reason, 'low_value_event', `${body.event} exposes the skip reason`);
      }
      assertEqual(rows.length, 0, 'no low-value payload reached the database boundary');
    },
  },
  {
    name: 'token mismatches remain durable even for low-value event types',
    run: async () => {
      const { recorder, rows } = makeRecorder();
      const result = await recorder.record('instance-a', 'empresa-a', lowValueBodies[0], 'token_mismatch');
      assertEqual(result.status, 'persisted', 'security evidence is persisted');
      assertEqual(rows.length, 1, 'one security row reached the database boundary');
      assertEqual(rows[0]?.auth_status, 'token_mismatch', 'auth status is retained');
    },
  },
  {
    name: 'security evidence and forced failures never collide with normal message dedupe',
    run: async () => {
      const { recorder, rows } = makeRecorder();
      const body = { event: 'messages.upsert', data: { key: { id: 'wa-security' }, message: { conversation: 'oi' } } };
      const normal = await recorder.record('instance-a', 'empresa-a', body, 'token_match');
      const forged = await recorder.record('instance-a', 'empresa-a', body, 'token_mismatch');
      const forced = await recorder.record('instance-a', 'empresa-a', body, 'token_match', { forcePersist: true });
      assertEqual(normal.status, 'persisted', 'normal delivery is durable');
      assertEqual(forged.status, 'persisted', 'forged copy remains separate security evidence');
      assertEqual(forced.status, 'persisted', 'forced failure capture remains separately markable');
      assertEqual(rows.length, 3, 'all three evidence classes reach the database boundary');
      assert(rows[0]?.dedupe_fingerprint !== null, 'normal message owns the idempotency fingerprint');
      assertEqual(rows[1]?.dedupe_fingerprint, null, 'security evidence bypasses dedupe');
      assertEqual(rows[2]?.dedupe_fingerprint, null, 'forced failure evidence bypasses dedupe');
    },
  },
  {
    name: 'unknown authenticated successes are skipped while token-missing events remain durable',
    run: async () => {
      const { recorder, rows } = makeRecorder();
      const unknown = await recorder.record('instance-a', 'empresa-a', { event: 'new.provider.event', data: {} }, 'token_match');
      const rollout = await recorder.record('instance-a', 'empresa-a', lowValueBodies[1], 'token_missing');
      assertEqual(unknown.status, 'skipped', 'unknown success does not grow the replay log');
      assertEqual(unknown.reason, 'unsupported_event', 'unknown skip is observable');
      assertEqual(rollout.status, 'persisted', 'missing-token event remains observable');
      assertEqual(rows.length, 1, 'only rollout evidence was inserted');
    },
  },
  {
    name: 'same message id with a different payload is not collapsed',
    run: async () => {
      const { recorder, rows } = makeRecorder();
      const first = { event: 'messages.upsert', data: { key: { id: 'wa-shared' }, message: { conversation: 'primeiro' } } };
      const changed = { event: 'messages.upsert', data: { key: { id: 'wa-shared' }, message: { conversation: 'segundo' } } };
      const firstResult = await recorder.record('instance-a', 'empresa-a', first, 'token_match');
      const changedResult = await recorder.record('instance-a', 'empresa-a', changed, 'token_match');
      assertEqual(firstResult.status, 'persisted', 'first payload is durable');
      assertEqual(changedResult.status, 'persisted', 'distinct payload sharing the id remains durable');
      assertEqual(rows.length, 2, 'fingerprint, not message id alone, controls dedupe');
    },
  },
  {
    name: 'capture-all kill switch restores conservative persistence',
    run: async () => {
      const rows: Parameters<RawWebhookInsert>[0][] = [];
      const recorder = createRawWebhookRecorder({
        insert: async (row) => { rows.push(row); return { id: 'raw-capture-all', inserted: true }; },
        captureAll: () => true,
      });
      const result = await recorder.record('instance-a', 'empresa-a', lowValueBodies[0], 'token_match');
      const message = { event: 'messages.upsert', data: { key: { id: 'wa-capture-all' }, message: { conversation: 'debug' } } };
      const firstMessage = await recorder.record('instance-a', 'empresa-a', message, 'token_match');
      const repeatedMessage = await recorder.record('instance-a', 'empresa-a', message, 'token_match');
      assertEqual(result.status, 'persisted', 'kill switch preserves the full raw payload');
      assertEqual(firstMessage.status, 'persisted', 'kill switch persists the first message');
      assertEqual(repeatedMessage.status, 'persisted', 'kill switch persists repeated messages');
      assertEqual(rows.length, 3, 'capture-all sends every event to the database boundary');
      assertEqual(rows[1]?.dedupe_fingerprint, null, 'capture-all disables database dedupe');
      assertEqual(rows[2]?.dedupe_fingerprint, null, 'capture-all keeps repeated messages independently durable');
    },
  },
  {
    name: 'duplicate messages.upsert is skipped only after the first copy is durable',
    run: async () => {
      const { recorder, rows } = makeRecorder();
      const body = { event: 'messages.upsert', data: { key: { id: 'wa-1' }, message: { conversation: 'oi' } } };
      const first = await recorder.record('instance-a', 'empresa-a', body, 'token_match');
      const duplicate = await recorder.record('instance-a', 'empresa-a', body, 'token_match');
      assertEqual(first.status, 'persisted', 'first delivery is durable');
      assertEqual(duplicate.status, 'skipped', 'repeat delivery is skipped');
      assertEqual(duplicate.reason, 'duplicate_message', 'dedupe is observable');
      assertEqual(rows.length, 1, 'only one row reached the database boundary');
    },
  },
  {
    name: 'failed first insert never poisons message dedupe',
    run: async () => {
      let attempts = 0;
      const recorder = createRawWebhookRecorder({
        insert: async () => {
          attempts += 1;
          return attempts === 1 ? null : { id: 'raw-retry', inserted: true };
        },
        now: () => 1_000,
      });
      const body = { event: 'messages.upsert', data: { key: { id: 'wa-retry' }, message: { conversation: 'oi' } } };
      const failed = await recorder.record('instance-a', 'empresa-a', body, 'token_match');
      const retry = await recorder.record('instance-a', 'empresa-a', body, 'token_match');
      assertEqual(failed.status, 'failed', 'first insert reports a durability failure');
      assertEqual(retry.status, 'persisted', 'provider retry can become durable');
      assertEqual(attempts, 2, 'database insert was retried');
    },
  },
  {
    name: 'force persistence captures a low-value event after processing failure',
    run: async () => {
      const { recorder, rows } = makeRecorder();
      const skipped = await recorder.record('instance-a', 'empresa-a', lowValueBodies[2], 'token_match');
      const captured = await recorder.record('instance-a', 'empresa-a', lowValueBodies[2], 'token_match', { forcePersist: true });
      assertEqual(skipped.status, 'skipped', 'happy path starts without persistence');
      assertEqual(captured.status, 'persisted', 'failure path forces persistence');
      assertEqual(rows.length, 1, 'failure evidence reached the database boundary');
      assert(rows[0]?.event_type === 'messages.delete', 'captured row keeps its event type');
    },
  },
]);
