import assert from 'node:assert/strict';
import {
  policyForOrigin,
  validateOutboundPayload,
  type OutboundOrigin,
  type OutboundPayload,
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

