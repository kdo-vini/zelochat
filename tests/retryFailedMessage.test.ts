import { strict as assert } from 'node:assert';
import {
  buildFailedMessageRetryPayload,
  retryFailedAssistantMessage,
  type FailedAssistantMessageRecord,
} from '../server/failedMessageRetry.js';
import { serializeStructuredMessage } from '../src/domain/chat.js';

const message: FailedAssistantMessageRecord = {
  id: 'failed-message',
  content: 'Olá, posso ajudar?',
  quoted_wa_id: null,
  quoted_from_me: null,
  quoted_preview: null,
};

async function run(): Promise<void> {
  let claimCalls = 0;
  let sendCalls = 0;
  const succeeded: Array<[string, string | undefined]> = [];
  const failed: Array<[string, string]> = [];

  const sent = await retryFailedAssistantMessage(message, '5511999999999@s.whatsapp.net', {
    claim: async () => { claimCalls += 1; return true; },
    send: async (payload) => {
      sendCalls += 1;
      assert.equal(payload.jid, '5511999999999@s.whatsapp.net');
      assert.equal(payload.text, 'Olá, posso ajudar?');
      assert.equal(payload.attachment, undefined);
      return 'wa-retry-id';
    },
    markSucceeded: async (messageId, waMessageId) => { succeeded.push([messageId, waMessageId]); },
    markFailed: async (messageId, error) => { failed.push([messageId, error]); },
    getErrorMessage: () => 'não deveria ser chamado',
  });
  assert.deepEqual(sent, { type: 'sent', waMessageId: 'wa-retry-id' });
  assert.equal(claimCalls, 1, 'a retry must claim the record once before sending');
  assert.equal(sendCalls, 1, 'a successful retry sends exactly once');
  assert.deepEqual(succeeded, [['failed-message', 'wa-retry-id']]);
  assert.deepEqual(failed, []);

  const busy = await retryFailedAssistantMessage(message, '5511999999999@s.whatsapp.net', {
    claim: async () => false,
    send: async () => { throw new Error('must not send when another retry owns the message'); },
    markSucceeded: async () => { throw new Error('must not mark success without sending'); },
    markFailed: async () => { throw new Error('must not mark failure without sending'); },
    getErrorMessage: () => 'erro',
  });
  assert.deepEqual(busy, { type: 'already_sending' });

  const providerFailure = await retryFailedAssistantMessage(message, '5511999999999@s.whatsapp.net', {
    claim: async () => true,
    send: async () => { throw new Error('provider unavailable'); },
    markSucceeded: async () => { throw new Error('must not mark success after a send failure'); },
    markFailed: async (messageId, error) => { failed.push([messageId, error]); },
    getErrorMessage: (error) => error instanceof Error ? 'Não foi possível enviar agora.' : 'erro',
  });
  assert.equal(providerFailure.type, 'send_failed');
  assert.deepEqual(failed, [['failed-message', 'Não foi possível enviar agora.']]);

  const media = buildFailedMessageRetryPayload({
    ...message,
    content: serializeStructuredMessage({
      text: 'Veja o arquivo',
      attachment: {
        type: 'document',
        mimeType: 'application/pdf',
        fileName: 'cardapio.pdf',
        dataUrl: 'https://files.example/cardapio.pdf',
      },
    }),
    quoted_wa_id: 'quoted-id',
    quoted_from_me: true,
    quoted_preview: 'Mensagem anterior',
  }, '5511999999999@s.whatsapp.net');
  assert(media, 'a persisted media message can be retried');
  assert.equal(media.attachment?.fileName, 'cardapio.pdf');
  assert.deepEqual(media.quoted, {
    waMessageId: 'quoted-id',
    fromMe: true,
    remoteJid: '5511999999999@s.whatsapp.net',
    previewText: 'Mensagem anterior',
  });

  const empty = await retryFailedAssistantMessage({ ...message, content: null }, '5511999999999@s.whatsapp.net', {
    claim: async () => { throw new Error('empty messages must not be claimed'); },
    send: async () => { throw new Error('empty messages must not be sent'); },
    markSucceeded: async () => { throw new Error('empty messages must not be marked'); },
    markFailed: async () => { throw new Error('empty messages must not be marked'); },
    getErrorMessage: () => 'erro',
  });
  assert.deepEqual(empty, { type: 'not_retryable' });
}

run().then(
  () => console.log('retryFailedMessage behavior tests passed'),
  (error) => { console.error(error); process.exit(1); },
);
