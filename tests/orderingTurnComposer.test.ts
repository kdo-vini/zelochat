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

console.log('orderingTurnComposer tests passed');
