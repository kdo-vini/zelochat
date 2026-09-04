// PR 1.30/1.31 — one structured, PII-free log line per canonical ordering
// stage, correlated by empresaId + a hashed conversation key (never the raw
// JID), so a failure can be tied to a conversation without exposing phone,
// name, address, or message text. `buildOrderingMetricLine` is the pure
// function under `metric()` — exported specifically so this shape can be
// unit tested without a live turn (this codebase's test suite has no
// Supabase mocking, so exercising every real call site end to end is out of
// scope here — see tests/aiWhatsAppOrdering.test.ts's static guard for the
// call-site wiring).
//
// Run via: npx tsx tests/aiOrderingMetrics.test.ts

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildOrderingMetricLine, ORDERING_METRIC_STAGES } from '../server/aiWhatsAppOrdering.js';

console.log('\nEmits every required field, no PII');
{
  const line = buildOrderingMetricLine({
    stage: 'confirm',
    outcome: 'handled',
    empresaId: 'empresa-1',
    jid: '5511999998888@s.whatsapp.net',
    orderingId: 'ordering-1',
    revision: 3,
    startedAt: Date.now() - 25,
  });
  assert.equal(line.stage, 'confirm');
  assert.equal(line.outcome, 'handled');
  assert.equal(line.empresaId, 'empresa-1');
  assert.equal(line.orderingId, 'ordering-1');
  assert.equal(line.revision, 3);
  assert.equal(line.errorCode, null, 'errorCode defaults to null when not supplied');
  assert.equal(typeof line.durationMs, 'number');
  assert.ok((line.durationMs as number) >= 0);

  const serialized = JSON.stringify(line);
  assert.ok(!serialized.includes('5511999998888'), 'the raw phone/JID must never appear in the log line');
  assert.ok(!serialized.includes('@s.whatsapp.net'), 'not even the JID suffix leaks');
}

console.log('\nThe conversation key is a stable, non-reversible hash of the JID — first 12 hex of sha256');
{
  const jid = '5514998360854@s.whatsapp.net';
  const line = buildOrderingMetricLine({ stage: 'summary', outcome: 'sent', empresaId: 'e', jid });
  const expected = createHash('sha256').update(jid, 'utf8').digest('hex').slice(0, 12);
  assert.equal(line.conversationKey, expected);
  assert.equal((line.conversationKey as string).length, 12);
  assert.match(line.conversationKey as string, /^[0-9a-f]{12}$/);

  // Same JID always hashes the same; a different JID never collides in this test.
  const again = buildOrderingMetricLine({ stage: 'summary', outcome: 'sent', empresaId: 'e', jid });
  assert.equal(again.conversationKey, line.conversationKey, 'deterministic — the same conversation always hashes to the same key');
  const other = buildOrderingMetricLine({ stage: 'summary', outcome: 'sent', empresaId: 'e', jid: '5511111111111@s.whatsapp.net' });
  assert.notEqual(other.conversationKey, line.conversationKey);
}

console.log('\norderingId/revision/errorCode default to null (JSON-stable shape) rather than being omitted');
{
  const line = buildOrderingMetricLine({ stage: 'entry', outcome: 'sent', empresaId: 'e', jid: 'j' });
  assert.ok('orderingId' in line && line.orderingId === null);
  assert.ok('revision' in line && line.revision === null);
  assert.ok('errorCode' in line && line.errorCode === null);
}

console.log('\nerrorCode is carried through for escalate/suppress stages');
{
  const line = buildOrderingMetricLine({ stage: 'escalate', outcome: 'failed_closed', empresaId: 'e', jid: 'j', errorCode: 'INDISPONIVEL' });
  assert.equal(line.errorCode, 'INDISPONIVEL');
}

console.log('\nORDERING_METRIC_STAGES documents exactly the 10 canonical stages, no more, no less');
{
  assert.deepEqual(
    [...ORDERING_METRIC_STAGES].sort(),
    ['cancel', 'compose', 'confirm', 'entry', 'escalate', 'plan', 'requirement', 'suppress', 'summary', 'update'].sort(),
  );
}

console.log('aiOrderingMetrics tests passed');
