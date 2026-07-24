// Regression tests for audio auto-reply gating.
// Run via: npx tsx tests/audioTranscriptionRearm.test.ts

import { __audioTranscriptionWaitForTests } from '../server/messageHandler.js';
import { assert, pass, fail } from './testHarness.js';

const { pendingAudioMessagesForNextReply } = __audioTranscriptionWaitForTests;

console.log('\nAudio transcription wait/re-arm eligibility');

{
  const pending = pendingAudioMessagesForNextReply([
    { id: 'u1', role: 'user', kind: 'audio', audio_transcript_status: 'pending' },
  ]);
  assert(pending.map((m) => m.id).join(',') === 'u1', 'pending audio after last assistant blocks reply');
}

{
  const pending = pendingAudioMessagesForNextReply([
    { id: 'u1', role: 'user', kind: 'audio', audio_transcript_status: 'done' },
  ]);
  assert(pending.length === 0, 'done audio unblocks reply');
}

{
  const pending = pendingAudioMessagesForNextReply([
    { id: 'u1', role: 'user', kind: 'audio', audio_transcript_status: 'failed' },
  ]);
  assert(pending.length === 0, 'failed audio unblocks reply so the fallback path can continue');
}

{
  const pending = pendingAudioMessagesForNextReply([
    { id: 'old-audio', role: 'user', kind: 'audio', audio_transcript_status: 'pending' },
    { id: 'assistant', role: 'assistant', kind: 'text', audio_transcript_status: null },
  ]);
  assert(pending.length === 0, 'audio before last assistant is ignored');
}

{
  const pending = pendingAudioMessagesForNextReply([
    { id: 'old-audio', role: 'user', kind: 'audio', audio_transcript_status: 'done' },
    { id: 'assistant', role: 'assistant', kind: 'text', audio_transcript_status: null },
    { id: 'new-audio', role: 'user', kind: 'audio', audio_transcript_status: 'pending' },
  ]);
  assert(pending.map((m) => m.id).join(',') === 'new-audio', 'only audio after latest assistant is considered');
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
