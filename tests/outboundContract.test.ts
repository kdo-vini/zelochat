import assert from 'node:assert/strict';
import {
  policyForOrigin,
  validateOutboundPayload,
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
