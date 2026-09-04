// Regression tests for audio auto-reply gating.
// Run via: npx tsx tests/audioTranscriptionRearm.test.ts

import {
  __audioTranscriptionWaitForTests,
  __audioWaitActiveForTests,
  shouldRearmAfterAudioTranscription,
} from '../server/messageHandler.js';
import { assert, pass, fail } from './testHarness.js';

const { pendingAudioMessagesForNextReply } = __audioTranscriptionWaitForTests;
const { markAudioWaitActive, markAudioWaitInactive, isAudioWaitActive } = __audioWaitActiveForTests;

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

console.log('\nFN I6 — settle re-arm must not fence an in-flight wait');

{
  // Fresh key: nothing marked active yet.
  assert(isAudioWaitActive('e1', 'j1@s.whatsapp.net') === false, 'inactive by default');
}

{
  const empresaId = 'e2';
  const jid = 'j2@s.whatsapp.net';
  markAudioWaitActive(`${empresaId}:${jid}`);
  assert(isAudioWaitActive(empresaId, jid) === true, 'marked active becomes visible');

  // The settle callback's guard: while a wait is active for this jid, it
  // must short-circuit BEFORE ever touching the database (no SUPABASE_URL is
  // configured in this test process — a real getSession() call would throw).
  const rearm = await shouldRearmAfterAudioTranscription(empresaId, jid, 'any-message-id');
  assert(rearm === false, 'no rearm while a wait is actively polling for this jid');

  markAudioWaitInactive(`${empresaId}:${jid}`);
  assert(isAudioWaitActive(empresaId, jid) === false, 'unmarking clears the active state');
}

{
  // Refcounted: two overlapping waits for the same jid must both unmark
  // before the jid is considered idle again.
  const key = 'e3:j3@s.whatsapp.net';
  markAudioWaitActive(key);
  markAudioWaitActive(key);
  assert(isAudioWaitActive('e3', 'j3@s.whatsapp.net') === true, 'active while either wait still holds it');
  markAudioWaitInactive(key);
  assert(isAudioWaitActive('e3', 'j3@s.whatsapp.net') === true, 'still active after only one of two unmarks');
  markAudioWaitInactive(key);
  assert(isAudioWaitActive('e3', 'j3@s.whatsapp.net') === false, 'idle once both waits unmark');
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
