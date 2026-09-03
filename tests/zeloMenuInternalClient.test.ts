import assert from 'node:assert/strict';
import { ZeloMenuInternalClient } from '../server/zeloMenuInternalClient.js';

const bodies: Record<string, unknown>[] = [];
const client = new ZeloMenuInternalClient({
  baseUrl: 'https://internal.example', apiKey: 'key', timeoutMs: 100,
  fetchImpl: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } });
  },
  requestIdFactory: () => 'request',
});
const command = { empresaId: 'empresa', remoteJid: 'jid', messageId: 'message', orderingId: 'ordering', expectedRevision: 2, conversationControlId: 'control', conversationEpoch: '9007199254740993' };
await client.updateDraft({ ...command, draft: { items: [{ productId: 1, quantity: 1 }] } });
await client.confirmDraft({ ...command, confirmationToken: 'token' });
await client.cancelDraft(command);
assert.deepEqual(bodies.map((body) => [body.conversationControlId, body.conversationEpoch]), [
  ['control', '9007199254740993'], ['control', '9007199254740993'], ['control', '9007199254740993'],
]);
console.log('zeloMenuInternalClient tests passed');
