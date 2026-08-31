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

const nativeInlineAudio = await extractFromMeMessage({
  key: { id: 'native-audio-inline', remoteJid: jid, fromMe: true },
  message: {
    base64: Buffer.from('native-inline-audio').toString('base64'),
    audioMessage: { ptt: true, mimetype: 'audio/ogg; codecs=opus', seconds: 4 },
  },
});
assert.equal(nativeInlineAudio.payload.kind, 'audio');
assert.equal(nativeInlineAudio.preview, '[Áudio]');
assert.equal(nativeInlineAudio.fingerprint.length, 64);
assert.match(nativeInlineAudio.messageContent, /^__ZELOCHAT_MEDIA__:/);

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  assert.equal(String(input), 'https://storage.googleapis.com/whatsmiau/native-audio.ogg');
  return new Response(Buffer.from('native-audio-bytes'), {
    status: 200,
    headers: { 'content-type': 'audio/ogg' },
  });
}) as typeof fetch;
try {
  const nativeAudio = await extractFromMeMessage({
    key: {
      id: 'native-audio-media-url',
      remoteJid: jid,
      fromMe: true,
      participant: '5511888888888@s.whatsapp.net',
      addressingMode: 'lid',
    },
    message: {
      mediaUrl: 'https://storage.googleapis.com/whatsmiau/native-audio.ogg',
      audioMessage: {
        ptt: true,
        mimetype: 'audio/ogg; codecs=opus',
        seconds: 7,
        fileLength: String(Buffer.byteLength('native-audio-bytes')),
      },
    },
    messageTimestamp: 1_788_209_153,
  });
  assert.equal(nativeAudio.payload.kind, 'audio');
  assert.equal(nativeAudio.preview, '[Áudio]');
  assert.equal((nativeAudio as any).jobPayload.kind, 'text');
  assert.equal((nativeAudio as any).jobPayload.text, '[Áudio]');
  assert.match((nativeAudio as any).messageContent, /^__ZELOCHAT_MEDIA__:/);
  assert.match((nativeAudio as any).messageContent, /https:\/\/storage\.googleapis\.com\/whatsmiau\/native-audio\.ogg/);
  assert.ok(nativeAudio.fingerprint);
} finally {
  globalThis.fetch = originalFetch;
}

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
