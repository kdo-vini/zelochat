import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AUTOMATION_KINDS,
  DEFAULT_AUTOMATION_TIMEZONE,
  getDefaultAutomationRule,
  idempotencyKeyFor,
  validateAutomationRule,
} from '../server/automations/rules.js';
import { evaluateAutomationCandidate, isWithinAutomationWindow } from '../server/automations/evaluator.js';

const migration = readFileSync(resolve('supabase/migrations/054_customer_automations.sql'), 'utf8');
const hardeningMigration = readFileSync(resolve('supabase/migrations/056_automation_limits_and_lease_terminal.sql'), 'utf8');

for (const kind of AUTOMATION_KINDS) {
  const rule = getDefaultAutomationRule(kind);
  assert.equal(rule.enabled, false, `${kind} começa desativada`);
  assert.equal(rule.timezone, DEFAULT_AUTOMATION_TIMEZONE);
  assert.equal(validateAutomationRule(kind, rule).ok, true);
  assert.equal(rule.dailyLimit, 50);
}
assert.equal(validateAutomationRule('birthday', { ...getDefaultAutomationRule('birthday'), dailyLimit: 0 }).ok, false);
assert.equal(validateAutomationRule('birthday', { ...getDefaultAutomationRule('birthday'), dailyLimit: 201 }).ok, false);
assert.equal(validateAutomationRule('birthday', { ...getDefaultAutomationRule('birthday'), config: { ...getDefaultAutomationRule('birthday').config, dailyLimit: 80 } }).ok, true);

assert.equal(idempotencyKeyFor('birthday', { pessoaId: 'p1', year: 2026 }), 'birthday:p1:2026');
assert.equal(idempotencyKeyFor('reactivation', { pessoaId: 'p1', cycle: '2026-08' }), 'reactivation:p1:2026-08');
assert.equal(idempotencyKeyFor('post_purchase', { pessoaId: 'p1', orderId: 'o1' }), 'post_purchase:p1:o1');
assert.equal(idempotencyKeyFor('vip', { pessoaId: 'p1', thresholdVersion: 2 }), 'vip:p1:v2');
assert.equal(idempotencyKeyFor('abandoned_cart', { cartId: 'c1' }), 'abandoned_cart:c1');

assert.equal(isWithinAutomationWindow(new Date('2026-08-26T13:00:00.000Z'), { start: '09:00', end: '12:00' }), true);
assert.equal(isWithinAutomationWindow(new Date('2026-08-26T11:00:00.000Z'), { start: '09:00', end: '12:00' }), false);

const common = { pessoaId: 'p1', phone: '5511999999999', conflict: false, blocked: false };
const enabled = (kind: any) => ({ ...getDefaultAutomationRule(kind), enabled: true, message: 'Olá!' });
assert.equal(evaluateAutomationCandidate('birthday', { ...common, birthday: { day: 26, month: 8 } }, enabled('birthday'), new Date('2026-08-26T13:00:00.000Z')).status, 'eligible');
assert.equal(evaluateAutomationCandidate('birthday', { ...common, phone: null, birthday: { day: 26, month: 8 } }, enabled('birthday'), new Date('2026-08-26T13:00:00.000Z')).suppressionReason, 'missing_phone');
assert.equal(evaluateAutomationCandidate('reactivation', { ...common, lastDeliveredAt: '2026-07-01T12:00:00.000Z', openOrder: true }, enabled('reactivation'), new Date('2026-08-26T13:00:00.000Z')).suppressionReason, 'open_order');
assert.equal(evaluateAutomationCandidate('reactivation', { ...common, lastDeliveredAt: '2026-07-01T12:00:00.000Z', promotionalContactAt: '2026-08-25T12:00:00.000Z' }, enabled('reactivation'), new Date('2026-08-26T13:00:00.000Z')).suppressionReason, 'recent_promotion');
assert.equal(evaluateAutomationCandidate('reactivation', { ...common, lastDeliveredAt: '2026-07-01T12:00:00.000Z', recentAutomationSentAt: '2026-08-10T12:00:00.000Z' }, enabled('reactivation'), new Date('2026-08-26T13:00:00.000Z')).suppressionReason, 'cooldown');
assert.equal(evaluateAutomationCandidate('abandoned_cart', { ...common, cart: { id: 'c1', state: 'confirmed_waiting_review', updatedAt: '2026-08-26T09:00:00.000Z' } }, enabled('abandoned_cart'), new Date('2026-08-26T13:00:00.000Z')).status, 'suppressed');

assert.match(migration, /zelochat_automation_rules/i);
assert.match(migration, /zelochat_automation_dispatches/i);
assert.match(migration, /unique\s*\(rule_id,\s*event_key\)/i);
assert.match(migration, /America\/Sao_Paulo/);
assert.match(migration, /enabled\s+boolean\s+not null\s+default\s+false/i);
assert.match(hardeningMigration, /daily_limit/i);
assert.match(hardeningMigration, /release_zelochat_expired_leases/i);
assert.match(readFileSync(resolve('supabase/migrations/058_automation_dispatch_jobs.sql'), 'utf8'), /automation_dispatch_id.*references.*zelochat_automation_dispatches/i);
const leaseDispatchMigration = readFileSync(resolve('supabase/migrations/059_automation_dispatch_lease_terminal.sql'), 'utf8');
assert.match(leaseDispatchMigration, /returning id, recipient_id, automation_dispatch_id, job_type/i);
assert.match(leaseDispatchMigration, /t\.automation_dispatch_id\s*=\s*d\.id/i);
assert.doesNotMatch(leaseDispatchMigration, /t\.recipient_id\s*=\s*d\.id/i);
console.log('customerAutomations: ok');
