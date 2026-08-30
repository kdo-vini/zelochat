import assert from 'node:assert/strict';
import { OutboundQueue, type OutboundJobStore } from '../server/outbound/queue.js';
import { canStartCampaign, CAMPAIGN_LIMITS, createRateLimiter } from '../server/outbound/policy.js';

const jobs = new Map<string, any>();
const store: OutboundJobStore = {
  async insert(job) { const row = { ...job, id: job.id ?? `job-${jobs.size + 1}`, status: 'queued' as const, attempts: 0 }; jobs.set(row.id, row); return row; },
  async claim(workerId, _leaseMs) { const row = [...jobs.values()].find((item) => item.status === 'queued'); if (!row) return null; row.status = 'sending'; row.leaseOwner = workerId; row.leaseExpiresAt = new Date(Date.now() + 60_000).toISOString(); return row; },
  async startTransport(id, empresaId, leaseOwner) { const row = jobs.get(id); if (!row || row.empresaId !== empresaId || row.leaseOwner !== leaseOwner || row.status !== 'sending') return false; row.status = 'dispatch_started'; return true; },
  async markSent(id, messageId, empresaId, leaseOwner) { const row = jobs.get(id); if (!row || row.empresaId !== empresaId || row.leaseOwner !== leaseOwner) return false; row.status = 'sent'; row.providerMessageId = messageId; row.leaseOwner = null; return true; },
  async markFailed(id, reason, retryAt) { const row = jobs.get(id); row.status = retryAt ? 'queued' : 'failed'; row.lastError = reason; row.nextAttemptAt = retryAt?.toISOString() ?? null; },
  async releaseExpired() { for (const row of jobs.values()) if (row.status === 'sending' && row.leaseExpiresAt < new Date().toISOString()) row.status = 'queued'; },
};
const queue = new OutboundQueue(store);
await queue.enqueue({ empresaId: 'e1', instanceKey: 'i1', recipientId: 'p1', campaignId: 'c1', idempotencyKey: 'c1:p1', text: 'Olá' });
await queue.enqueue({ empresaId: 'e1', instanceKey: 'i1', recipientId: 'p1', campaignId: 'c1', idempotencyKey: 'c1:p1', text: 'Olá' });
assert.equal(jobs.size, 1, 'a mesma intenção não duplica');
const claimed = await queue.claim('worker-1');
assert.equal(claimed?.status, 'sending');
assert.equal(await queue.claim('worker-2'), null, 'não há segundo job para a mesma intenção');
assert.equal(await queue.startTransport(claimed!), true);
assert.equal(await queue.complete({ ...claimed!, status: 'dispatch_started', leaseOwner: 'worker-2' }, 'provider-1'), false, 'worker sem lease não finaliza');
assert.equal(await queue.complete({ ...claimed!, status: 'dispatch_started' }, 'provider-1'), true);

await queue.enqueue({ empresaId: 'e2', instanceKey: 'i2', recipientId: 'p2', campaignId: 'c2', idempotencyKey: 'c1:p1', text: 'Outro tenant' });
assert.equal(jobs.size, 2, 'idempotência em memória é tenant-scoped');

assert.equal(canStartCampaign({ activeStartsLastMinute: 11, dailySent: 49, requested: 1 }), true);
assert.equal(canStartCampaign({ activeStartsLastMinute: 12, dailySent: 0, requested: 1 }), false);
assert.equal(canStartCampaign({ activeStartsLastMinute: 0, dailySent: 0, requested: CAMPAIGN_LIMITS.hardDailyCap + 1 }), false);
const limiter = createRateLimiter(1, 60_000, () => 1_000);
assert.equal(limiter.allow('i1'), true);
assert.equal(limiter.allow('i1'), false);
console.log('outboundQueue: ok');
