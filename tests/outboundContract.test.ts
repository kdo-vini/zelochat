import assert from 'node:assert/strict';
import {
  policyForOrigin,
  validateOutboundPayload,
  hasRecentHumanOutbound,
  RECENT_HUMAN_OUTBOUND_HOLD_MS,
  type OutboundOrigin,
  type OutboundPayload,
  type PersistedOutboundPayload,
} from '../src/domain/outbound.js';

const takeover: OutboundOrigin[] = ['human_zelochat', 'human_native_whatsapp'];
for (const origin of takeover) assert.equal(policyForOrigin(origin), 'take_over');

const preserve: OutboundOrigin[] = [
  'ai_auto', 'ai_followup', 'system_handoff', 'system_transactional',
  'campaign', 'automation', 'internal_system',
];
for (const origin of preserve) assert.equal(policyForOrigin(origin), 'preserve_ai');

const validText: OutboundPayload = { kind: 'text', text: 'Olá' };
assert.equal(validateOutboundPayload(validText), null);
assert.equal(validateOutboundPayload({ kind: 'text', text: '  ' }), 'OUTBOUND_TEXT_EMPTY');
assert.equal(validateOutboundPayload({ kind: 'poll', name: 'Escolha', options: [], selectableCount: 1 }), 'OUTBOUND_POLL_EMPTY');
assert.equal(validateOutboundPayload({ kind: 'location', latitude: 91, longitude: 0 }), 'OUTBOUND_LOCATION_INVALID');
assert.equal(validateOutboundPayload({ kind: 'location', latitude: 0, longitude: -181 }), 'OUTBOUND_LOCATION_INVALID');
assert.equal(validateOutboundPayload({ kind: 'reaction', targetMessageId: '', emoji: '👍', targetFromMe: false }), 'OUTBOUND_REACTION_TARGET_MISSING');
assert.equal(validateOutboundPayload({
  kind: 'media',
  attachment: { type: 'image', fileName: 'foto.jpg', mimeType: '', sizeBytes: 1, dataUrl: 'data:image/jpeg;base64,AA==' },
}), 'OUTBOUND_ATTACHMENT_MIME_MISSING');

const quote = { waMessageId: 'wa-1', fromMe: false, remoteJid: '5511999999999@s.whatsapp.net' };
const persistedMedia: PersistedOutboundPayload = {
  kind: 'media', storagePath: 'outbound/media-1', mimeType: 'image/jpeg', fileName: 'foto.jpg',
  sizeBytes: 10, checksum: 'abc', quoted: quote,
};
const persistedAudio: PersistedOutboundPayload = {
  kind: 'audio', storagePath: 'outbound/audio-1', mimeType: 'audio/ogg', fileName: 'audio.ogg',
  sizeBytes: 10, checksum: 'def', ptt: true, quoted: quote,
};
const persistedSticker: PersistedOutboundPayload = {
  kind: 'sticker', storagePath: 'outbound/sticker-1', mimeType: 'image/webp', fileName: 'sticker.webp',
  sizeBytes: 10, checksum: 'ghi', quoted: quote,
};
assert.deepEqual(persistedMedia.quoted, quote);
assert.deepEqual(persistedAudio.quoted, quote);
assert.deepEqual(persistedSticker.quoted, quote);

const malformedPayloads = [
  null,
  undefined,
  {},
  { kind: 'text' },
  { kind: 'audio', attachment: { mimeType: 'audio/ogg' } },
  { kind: 'media', attachment: { mimeType: 'image/jpeg', type: 'image' } },
  { kind: 'sticker', attachment: { mimeType: 'image/webp', fileName: 'x.webp' } },
  { kind: 'buttons', text: 'oi' },
  { kind: 'contact', displayName: 'Ana' },
  { kind: 'list', body: 'menu', buttonText: 'Ver' },
  { kind: 'location', latitude: '0', longitude: 0 },
  { kind: 'reaction', targetMessageId: 'wa-1', emoji: '👍' },
  { kind: 'poll', name: 'Escolha', options: ['A'] },
] as unknown as OutboundPayload[];
for (const malformed of malformedPayloads) {
  assert.doesNotThrow(() => validateOutboundPayload(malformed));
  assert.notEqual(validateOutboundPayload(malformed), null);
}

{
  const now = Date.parse('2026-09-19T22:10:24.000Z');
  const simone = [
    { role: 'user', timestamp: '2026-09-19T22:08:45.000Z' },
    { role: 'assistant', outboundOrigin: 'ai_auto' as const, timestamp: '2026-09-19T22:09:47.000Z' },
    { role: 'assistant', outboundOrigin: 'human_native_whatsapp' as const, timestamp: '2026-09-19T22:09:59.000Z' },
    { role: 'user', timestamp: '2026-09-19T22:10:23.000Z' },
  ];
  assert.equal(hasRecentHumanOutbound(simone, now), true, 'Simone: dona wrote 25s before "Valor"');
  assert.equal(hasRecentHumanOutbound(simone, now + RECENT_HUMAN_OUTBOUND_HOLD_MS), false, 'hold expires');
  assert.equal(hasRecentHumanOutbound(simone.filter((m) => m.outboundOrigin !== 'human_native_whatsapp'), now), false, 'AI outbound does not hold');
}

{
  const now = Date.parse('2026-09-19T22:10:24.000Z');
  const fromZelochat = [
    { role: 'assistant', outboundOrigin: 'human_zelochat' as const, timestamp: '2026-09-19T22:09:59.000Z' },
    { role: 'user', timestamp: '2026-09-19T22:10:23.000Z' },
  ];
  assert.equal(hasRecentHumanOutbound(fromZelochat, now), true, 'operator typing in ZeloChat also holds');
}

{
  // Paulinho: the owner's native welcome existed on the phone at 19:42:41,
  // but the fromMe webhook (and therefore the human_native_whatsapp row)
  // only landed at 19:43:15 — after the AI had already sent. Without that
  // row the hold cannot see the takeover; this documents the remaining race.
  const now = Date.parse('2026-09-19T22:42:55.000Z');
  const paulinhoBeforeFromMe = [
    { role: 'user', timestamp: '2026-09-19T22:41:59.000Z' },
    { role: 'assistant', outboundOrigin: 'ai_auto' as const, timestamp: '2026-09-19T22:42:10.000Z' },
  ];
  assert.equal(hasRecentHumanOutbound(paulinhoBeforeFromMe, now), false, 'Paulinho: no human row yet, hold cannot fire');
  const paulinhoAfterFromMe = [
    ...paulinhoBeforeFromMe,
    { role: 'assistant', outboundOrigin: 'human_native_whatsapp' as const, timestamp: '2026-09-19T22:42:41.000Z' },
  ];
  assert.equal(hasRecentHumanOutbound(paulinhoAfterFromMe, now), true, 'once fromMe is persisted, the next enqueue is held');
}
