// PR 1.9 / M-11 / M-12 / M-13 / PR C-6 — audio ordering failure handling.
// Run via: npx tsx tests/audioOrderingFailures.test.ts

import assert from 'node:assert/strict';
import { isAcceptedAudioMime } from '../server/transcription.js';
import { shouldCountTranscriptionFailure } from '../server/messageHandler.js';
import { serializeOrderingState } from '../src/domain/aiWhatsAppOrdering.js';
import { tryHandleAiWhatsAppOrdering, type OrderingClient } from '../server/aiWhatsAppOrdering.js';
import { ZeloMenuInternalError } from '../server/zeloMenuInternalClient.js';
import type { StoredSession } from '../server/messageHandler.js';
import type { AiTurnPermit } from '../server/conversationControl.js';

console.log('\nMIME allowlist accepts real WhatsApp audio variants (M-11)');
for (const mime of ['audio/ogg; codecs=opus', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr']) {
  assert.equal(isAcceptedAudioMime(mime), true, `${mime} must be accepted`);
}
assert.equal(isAcceptedAudioMime('image/png'), false, 'unrelated mime types stay rejected');
assert.equal(isAcceptedAudioMime('audio/x-totally-made-up'), false, 'unknown audio subtype stays rejected');

console.log('\nmissing_key does not burn the escalation budget (M-12)');
assert.equal(shouldCountTranscriptionFailure('missing_key'), false, 'ops-level misconfiguration is not the customer\'s fault');
assert.equal(shouldCountTranscriptionFailure('done'), false, 'a success is never counted as a failure');
for (const outcome of ['empty', 'unsupported', 'too_large', 'timeout', 'failed'] as const) {
  assert.equal(shouldCountTranscriptionFailure(outcome), true, `${outcome} is a real per-message failure and must still count`);
}

console.log('\nOne failed audio must not lock the conversation into repeating "não consegui ouvir" (PR C-6)');
{
  const fakePermit: AiTurnPermit = {
    empresaId: 'empresa-1',
    conversationControlId: 'control-1',
    remoteJid: '5511999999999@s.whatsapp.net',
    epoch: '0',
    triggerMessageId: 'm-last',
  };

  // Turn 1's state, as persisted by the FIXED audio-failure branch: the
  // failed audio id is already folded into consumedMessageIds.
  const pointerAfterTurn1 = serializeOrderingState({ orderingId: 'stale-order', revision: 1, consumedMessageIds: ['af1'] });

  const session: StoredSession = {
    id: 'session-1',
    customerName: 'Cliente',
    customerPhone: '5511999999999',
    lastMessage: 'tem coxinha?',
    lastMessageTime: new Date(0).toISOString(),
    unreadCount: 0,
    status: 'active',
    autoReply: true,
    messages: [
      {
        id: 'af1', waMessageId: 'af1', role: 'user', kind: 'audio',
        content: '[Áudio recebido]', preview: '[Áudio recebido]',
        audio_transcript: null, audio_transcript_status: 'failed',
        timestamp: new Date(0).toISOString(),
      },
      {
        id: 't1', waMessageId: 't1', role: 'tool', kind: 'text',
        content: pointerAfterTurn1, preview: pointerAfterTurn1,
        timestamp: new Date(0).toISOString(),
      },
      {
        id: 'm2', waMessageId: 'm2', role: 'user', kind: 'text',
        content: 'tem coxinha?', preview: 'tem coxinha?',
        timestamp: new Date(1000).toISOString(),
      },
    ],
  };

  // The pointer's orderingId is stale/unknown to ZeloMenu (simulating that it
  // was never a real order, or has since closed) — loadCanonicalSnapshot must
  // gracefully fall back to `current: null` on a 404, same as production.
  const client: OrderingClient = {
    searchCatalog: async () => ({ total: 0, ambiguous: false, results: [] }),
    updateDraft: async () => { throw new Error('not exercised in this test'); },
    getOrdering: async () => { throw new ZeloMenuInternalError('PEDIDO_NAO_ENCONTRADO', 404, 'req-1'); },
    confirmDraft: async () => { throw new Error('not exercised in this test'); },
    cancelDraft: async () => { throw new Error('not exercised in this test'); },
  };

  const result = await tryHandleAiWhatsAppOrdering(
    fakePermit.remoteJid,
    fakePermit.empresaId,
    session,
    fakePermit,
    { menuUrl: null, storeOpen: null },
    { dryRun: true, client },
  );

  assert.equal(result.handled, true);
  assert.doesNotMatch(
    result.response ?? '',
    /não consegui ouvir/i,
    'the already-consumed failed audio must not be re-detected on the next turn',
  );
}

console.log('\naudioOrderingFailures tests passed');
