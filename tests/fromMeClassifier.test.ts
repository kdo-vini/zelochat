import assert from 'node:assert/strict';
import { classifyFromMe, extractFromMeMessage } from '../server/fromMe.js';
import { fingerprintOutboundPayload } from '../server/outbound/providerAdapter.js';

const jid = '5511999999999@s.whatsapp.net';
const textData = (id: string, text = 'Olá') => ({
  key: { id, remoteJid: jid, fromMe: true },
  message: { conversation: text },
  messageTimestamp: 1_788_102_000,
});

const text = await extractFromMeMessage(textData('native-1'));
assert.equal(text.payload.kind, 'text');
assert.equal(text.preview, 'Olá');
assert.equal(text.fingerprint, await fingerprintOutboundPayload({ kind: 'text', text: 'Olá' }));

assert.deepEqual(classifyFromMe(text, {
  existingMessage: { origin: 'human_native_whatsapp', jobId: 'native-job' },
}), { kind: 'duplicate' });

assert.deepEqual(classifyFromMe(text, {
  providerJob: { id: 'server-job', messageId: 'server-message' },
}), { kind: 'server_echo', jobId: 'server-job', repair: false });

assert.deepEqual(classifyFromMe(text, { legacyTracked: true }), {
  kind: 'server_echo', jobId: 'legacy:native-1', repair: true,
});

assert.deepEqual(classifyFromMe(text, {
  pendingJob: { id: 'pending-job', payloadFingerprint: text.fingerprint, providerMessageId: null },
}), { kind: 'pending_correlation', jobId: 'pending-job' });

const different = await extractFromMeMessage(textData('native-2', 'Mensagem humana'));
assert.deepEqual(classifyFromMe(different, {
  pendingJob: { id: 'pending-job', payloadFingerprint: text.fingerprint, providerMessageId: null },
}), { kind: 'native_human' });

const media = await extractFromMeMessage({
  key: { id: 'media-1', remoteJid: jid, fromMe: true },
  message: { imageMessage: { mimetype: 'image/png', caption: 'Foto', base64: Buffer.from('same-bytes').toString('base64') } },
});
assert.equal(media.payload.kind, 'media');
assert.ok(media.fingerprint);
assert.deepEqual(classifyFromMe(media, {
  pendingJob: { id: 'pending-media', payloadFingerprint: media.fingerprint, providerMessageId: null },
}), { kind: 'pending_correlation', jobId: 'pending-media' });

for (const ignored of [
  { key: { id: 'device', remoteJid: jid, fromMe: true }, message: { deviceSentMessage: { message: { conversation: 'eco multi-device' } } } },
  { key: { id: 'group', remoteJid: '120363@g.us', fromMe: true }, message: { conversation: 'grupo' } },
  { key: { id: 'broadcast', remoteJid: 'status@broadcast', fromMe: true }, message: { conversation: 'status' } },
  { key: { id: 'receipt', remoteJid: jid, fromMe: true }, message: { protocolMessage: { type: 'RECEIPT' } } },
  { key: { id: 'presence', remoteJid: jid, fromMe: true }, message: { senderKeyDistributionMessage: {} } },
]) {
  const extracted = await extractFromMeMessage(ignored);
  assert.deepEqual(classifyFromMe(extracted, {}), { kind: 'ignore_protocol_artifact' });
}

await assert.rejects(
  () => extractFromMeMessage({ key: { id: 'media-no-bytes', remoteJid: jid, fromMe: true }, message: { imageMessage: { mimetype: 'image/jpeg' } } }),
  /FROM_ME_FINGERPRINT_UNAVAILABLE/,
);

console.log('fromMeClassifier: ok');
