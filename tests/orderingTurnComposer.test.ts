import assert from 'node:assert/strict';
import { composeOrderingTurn } from '../server/orderingTurnComposer.js';
import type { TimedComposerMessage } from '../server/orderingTurnComposer.js';

const messages = [
  { id: '1', role: 'user', kind: 'text', content: 'quero uma massa', preview: null, timestamp: '2026-01-01T10:00:00Z' },
  { id: '2', role: 'user', kind: 'text', content: 'talharim', preview: null, timestamp: '2026-01-01T10:00:01Z' },
  { id: '3', role: 'user', kind: 'audio', content: '[Áudio recebido]', preview: null, audio_transcript: 'molho branco', audio_transcript_status: 'done' as const, timestamp: '2026-01-01T10:00:02Z' },
] satisfies TimedComposerMessage[];
const composed = composeOrderingTurn(messages);
assert.equal(composed.text, 'quero uma massa\ntalharim\nmolho branco');
assert.deepEqual(composed.sourceMessageIds, ['1', '2', '3']);
assert.equal(composeOrderingTurn(messages, { consumedMessageIds: composed.consumedMessageIds }).text, '');
assert.deepEqual(composeOrderingTurn([{ ...messages[2], audio_transcript: null, audio_transcript_status: 'pending' }]).pendingAudioMessageIds, ['3']);

// PR C-6 / FN C3 — a failed audio is consumed once with its friendly reply
// and must never be replayed into a later turn's composition.
{
  const failedAudio = { id: 'af1', role: 'user', kind: 'audio', content: '[Áudio recebido]', preview: null, audio_transcript: null, audio_transcript_status: 'failed' as const, timestamp: '2026-01-01T10:00:00Z' };
  const composed = composeOrderingTurn([failedAudio]);
  assert.deepEqual(composed.failedAudioMessageIds, ['af1']);
  assert.deepEqual(composed.consumedMessageIds, ['af1'], 'failed audio id must be folded into consumedMessageIds');
  const next = composeOrderingTurn([failedAudio, { id: 'm2', role: 'user', kind: 'text', content: 'quero 2 coxinhas', preview: null, timestamp: '2026-01-01T10:00:05Z' }], { consumedMessageIds: composed.consumedMessageIds });
  assert.equal(next.text, 'quero 2 coxinhas', 'a subsequent turn must not re-surface the already-answered failed audio');
  assert.deepEqual(next.failedAudioMessageIds, []);
}

// PR I-1 / PR 1.13 — causal reassembly: out-of-order arrival, ordered
// provider timestamps compose in provider order; tie -> dbTimestamp -> id.
{
  const outOfOrderArrival: TimedComposerMessage[] = [
    { id: 'b', role: 'user', kind: 'text', content: 'B', preview: null, timestamp: '2026-01-01T10:00:05Z' },
    { id: 'a', role: 'user', kind: 'text', content: 'A', preview: null, timestamp: '2026-01-01T10:00:01Z' },
  ];
  assert.equal(composeOrderingTurn(outOfOrderArrival).text, 'A\nB', 'sorts by provider timestamp, not array/arrival order');
}
{
  // Same provider timestamp on both — must fall through to dbTimestamp, not
  // straight to a random id compare (the actual bug: messageTime() merged
  // providerTimestamp/dbTimestamp/timestamp into one number via `||`, so a
  // tie at the provider level discarded dbTimestamp entirely).
  const tied: TimedComposerMessage[] = [
    { id: 'z', role: 'user', kind: 'text', content: 'later-db', preview: null, timestamp: '2026-01-01T10:00:00Z', dbTimestamp: 2 },
    { id: 'a', role: 'user', kind: 'text', content: 'earlier-db', preview: null, timestamp: '2026-01-01T10:00:00Z', dbTimestamp: 1 },
  ];
  assert.equal(composeOrderingTurn(tied).text, 'earlier-db\nlater-db', 'tie on provider clock resolves by dbTimestamp');
}
{
  // Full tie (no dbTimestamp signal at all) — deterministic fallback to id.
  const fullTie: TimedComposerMessage[] = [
    { id: 'z', role: 'user', kind: 'text', content: 'z-content', preview: null, timestamp: '2026-01-01T10:00:00Z' },
    { id: 'a', role: 'user', kind: 'text', content: 'a-content', preview: null, timestamp: '2026-01-01T10:00:00Z' },
  ];
  assert.equal(composeOrderingTurn(fullTie).text, 'a-content\nz-content', 'full tie falls back to id order');
}

console.log('orderingTurnComposer tests passed');
