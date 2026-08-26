import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canSendCampaignNow, campaignDailyLimit, campaignStartKey } from '../server/campaigns/service.js';
import { OutboundQueue, type OutboundJobStore } from '../server/outbound/queue.js';
import { evaluateAutomationCandidate } from '../server/automations/evaluator.js';
import { getDefaultAutomationRule } from '../server/automations/rules.js';

const migration = readFileSync('supabase/migrations/055_campaign_queue_hardening.sql', 'utf8');
assert.doesNotMatch(readFileSync('server/campaigns/service.ts', 'utf8'), /getOwnJid/);
assert.doesNotMatch(readFileSync('server/automations/router.ts', 'utf8'), /getOwnJid/);
assert.match(migration, /campaign.*status.*running/i);
assert.match(migration, /scheduled_at.*now\(\)/i);
assert.match(migration, /recipient.*status.*queued/i);

assert.equal(canSendCampaignNow({ status: 'scheduled', scheduledAt: '2026-08-26T12:00:00.000Z' }, new Date('2026-08-26T11:59:00.000Z')), false);
assert.equal(canSendCampaignNow({ status: 'scheduled', scheduledAt: '2026-08-26T12:00:00.000Z' }, new Date('2026-08-26T12:00:00.000Z')), true);
assert.equal(canSendCampaignNow({ status: 'paused', scheduledAt: null }, new Date()), false);
assert.equal(campaignDailyLimit(50), 50);
assert.equal(campaignDailyLimit(999), 200);
assert.equal(campaignStartKey('empresa-1', 'inst-1'), 'empresa-1:inst-1');

const rows = new Map<string, any>();
const store: OutboundJobStore = {
  async insert(input) { const row = { ...input, id: `j${rows.size + 1}`, status: 'queued' as const, attempts: 0 }; rows.set(row.id, row); return row; },
  async claim() { const row = [...rows.values()].find((item) => item.status === 'queued'); if (!row) return null; row.status = 'sending'; row.attempts += 1; return row; },
  async markSent() {}, async markFailed() {}, async releaseExpired() {},
  async defer(id) { rows.get(id).status = 'queued'; rows.get(id).attempts -= 1; },
};
const queue = new OutboundQueue(store);
const job = await queue.enqueue({ empresaId: 'e', instanceKey: 'i', idempotencyKey: 'k', phone: '5511999999999', text: 'oi' });
const claimed = await queue.claim('w');
await queue.defer(claimed!, 'desconectado');
assert.equal(rows.get(job.id).status, 'queued');
assert.equal(rows.get(job.id).attempts, 0);

const rule = { ...getDefaultAutomationRule('birthday'), enabled: true, message: 'Oi' };
assert.equal(evaluateAutomationCandidate('birthday', { pessoaId: 'p', phone: '5511', birthday: { day: 26, month: 8 }, optedOut: true }, rule, new Date('2026-08-26T13:00:00.000Z')).suppressionReason, 'opt_out');
console.log('crmHardening: ok');
