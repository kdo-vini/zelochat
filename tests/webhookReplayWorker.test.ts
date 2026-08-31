import assert from 'node:assert/strict';
import { WebhookReplayWorker, webhookReplayBackoffMs, type WebhookReplayEvent } from '../server/webhookReplayWorker.js';

const row = (attemptCount: number): WebhookReplayEvent => ({
  id: 'raw-1', empresaId: 'empresa-1', payload: { data: { key: { id: 'native-1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: true }, message: { conversation: 'Oi' } } },
  authStatus: 'token_match', attemptCount, leaseOwner: 'worker-a',
});

assert.equal(webhookReplayBackoffMs(1), 5_000);
assert.equal(webhookReplayBackoffMs(4), 40_000);

{
  const calls: string[] = [];
  const worker = new WebhookReplayWorker({
    claim: async () => row(1),
    process: async () => { calls.push('process'); },
    complete: async () => { calls.push('complete'); return true; },
    fail: async () => { calls.push('fail'); return true; },
  });
  assert.equal(await worker.runOnce('worker-a'), true);
  assert.deepEqual(calls, ['process', 'complete']);
}

{
  let failure: { deadLetter: boolean; retryAt: Date | null } | null = null;
  const worker = new WebhookReplayWorker({
    claim: async () => row(2),
    process: async () => { throw new Error('FROM_ME_PENDING_CORRELATION'); },
    complete: async () => true,
    fail: async (_event, input) => { failure = input; return true; },
    now: () => new Date('2026-08-30T12:00:00.000Z'),
  });
  assert.equal(await worker.runOnce('worker-a'), false);
  assert.equal(failure?.deadLetter, false);
  assert.equal(failure?.retryAt?.toISOString(), '2026-08-30T12:00:10.000Z');
}

{
  let deadLetter = false;
  const worker = new WebhookReplayWorker({
    claim: async () => row(8),
    process: async () => { throw new Error('still pending'); },
    complete: async () => true,
    fail: async (_event, input) => { deadLetter = input.deadLetter; return true; },
  });
  assert.equal(await worker.runOnce('worker-a'), false);
  assert.equal(deadLetter, true);
}

{
  let processCalls = 0;
  const claimed = row(1);
  let available = true;
  const worker = new WebhookReplayWorker({
    claim: async () => { if (!available) return null; available = false; return claimed; },
    process: async () => { processCalls += 1; },
    complete: async () => true,
    fail: async () => true,
  });
  assert.deepEqual(await Promise.all([worker.runOnce('worker-a'), worker.runOnce('worker-b')]), [true, false]);
  assert.equal(processCalls, 1);
}

console.log('webhookReplayWorker: ok');
