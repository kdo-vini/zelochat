import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateSweepCandidate } from '../server/subscriptionSweeper.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-09-14T17:30:00.000Z');
const graceMs = 7 * DAY;
const daysAgo = (days: number) => now - days * DAY;

// Casa dos Salgados, 2026-09-14: ZeloChat cancelled, only a 'pdv' row left,
// last customer message 2026-07-30. Used to be skipped as "never subscribed".
{
  const decision = evaluateSweepCandidate({ subscription: null, lastInboundAt: Date.parse('2026-07-30T18:22:15Z'), now, graceMs });
  assert.equal(decision.candidate, true, 'no ZeloChat subscription and idle past grace is swept');
  assert.equal(decision.endedAt, Date.parse('2026-07-30T18:22:15Z'), 'the last inbound message anchors the grace period');
}
assert.equal(
  evaluateSweepCandidate({ subscription: null, lastInboundAt: daysAgo(2), now, graceMs }).candidate,
  false,
  'recent activity without a ZeloChat row waits for the grace period',
);
assert.equal(
  evaluateSweepCandidate({ subscription: null, lastInboundAt: null, now, graceMs }).candidate,
  false,
  'no subscription and no message history is left alone',
);

// Existing behavior for ZeloChat subscribers is unchanged.
assert.equal(evaluateSweepCandidate({ subscription: { status: 'active', expiry: daysAgo(-20) }, lastInboundAt: null, now, graceMs }).candidate, false, 'active subscriber is kept');
assert.equal(evaluateSweepCandidate({ subscription: { status: 'canceled', expiry: daysAgo(3) }, lastInboundAt: null, now, graceMs }).candidate, false, 'cancelled within grace is kept');
assert.equal(evaluateSweepCandidate({ subscription: { status: 'canceled', expiry: daysAgo(8) }, lastInboundAt: null, now, graceMs }).candidate, true, 'cancelled past grace is swept');
assert.equal(evaluateSweepCandidate({ subscription: { status: 'active', expiry: daysAgo(10) }, lastInboundAt: null, now, graceMs }).candidate, true, 'expired Pix period (status still active) past grace is swept');
assert.equal(evaluateSweepCandidate({ subscription: { status: 'canceled', expiry: null }, lastInboundAt: daysAgo(100), now, graceMs }).candidate, false, 'a ZeloChat row with no expiry is never swept');

// The destructive path must delete the exact pointer it read. Resolving it
// through getInstanceForEmpresa can return the fleet-wide FALLBACK_INSTANCE.
{
  const source = readFileSync('server/instanceManager.ts', 'utf8');
  const start = source.indexOf('export async function deleteInstance');
  const rest = source.slice(start);
  const body = rest.slice(0, rest.search(/\r?\n\}\r?\n/));
  assert.ok(start >= 0, 'deleteInstance exists');
  assert.match(body, /deleteInstance\(empresaId: string, instance: string\)/, 'deleteInstance takes the captured instance');
  assert.doesNotMatch(body, /getInstanceForEmpresa|FALLBACK_INSTANCE/, 'deleteInstance never resolves the instance name itself');
  assert.match(body, /\.eq\('whatsmiau_instance', instance\)/, 'the pointer is cleared only if it still names the deleted instance');
  const sweeper = readFileSync('server/subscriptionSweeper.ts', 'utf8');
  assert.match(sweeper, /deleteInstance\(c\.empresaId, c\.instance\)/, 'the sweeper passes the instance it scanned');
}

console.log('subscriptionSweeper tests passed');
