import assert from 'node:assert/strict';
import { ZeloMenuInternalClient } from '../server/zeloMenuInternalClient.js';
import type { OrderingSnapshot } from '../src/domain/aiWhatsAppOrdering.js';

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

// GET snapshot lookup must scope by both empresaId and remoteJid — ZeloMenu
// (the authority) requires both and 400s with CONVERSA_INVALIDA otherwise.
const remoteJid = '5511999998888@s.whatsapp.net';
const getUrls: string[] = [];
const getClient = new ZeloMenuInternalClient({
  baseUrl: 'https://internal.example', apiKey: 'key', timeoutMs: 100,
  fetchImpl: async (url) => {
    getUrls.push(String(url));
    return new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } });
  },
  requestIdFactory: () => 'request',
});
await getClient.getOrdering('ordering-id', 'empresa-id', remoteJid);
assert.equal(getUrls.length, 1);
assert.match(getUrls[0], /empresaId=empresa-id/);
assert.match(getUrls[0], /remoteJid=5511999998888%40s\.whatsapp\.net/);

// Contract test: a fake fetch that mirrors ZeloMenu's authority behaviour —
// 400 CONVERSA_INVALIDA when remoteJid is absent from the URL, 200 with a
// snapshot when present. Proves the old (empresaId-only) URL shape would 400.
const fakeSnapshot: OrderingSnapshot = {
  orderingId: 'ordering-id',
  empresaId: 'empresa-id',
  remoteJid,
  state: 'cart_open',
  revision: 1,
  cart: { items: [] },
  customer: {},
  fulfillment: { type: 'pickup', asap: true },
  payment: { pixReceiptRequired: false, pixReceiptApproved: false },
  pricing: { subtotal: 0, deliveryFee: 0, discount: 0, total: 0 },
  revalidation: { checkedAt: new Date(0).toISOString(), ok: true, issues: [] },
  confirmationAction: null,
  requiresReview: false,
  order: null,
};
const authorityLikeClient = new ZeloMenuInternalClient({
  baseUrl: 'https://internal.example', apiKey: 'key', timeoutMs: 100,
  fetchImpl: async (url) => {
    const parsed = new URL(String(url));
    if (!parsed.searchParams.get('remoteJid')) {
      return new Response(JSON.stringify({ error: 'CONVERSA_INVALIDA' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(fakeSnapshot), { headers: { 'content-type': 'application/json' } });
  },
  requestIdFactory: () => 'request',
});
const result = await authorityLikeClient.getOrdering('ordering-id', 'empresa-id', remoteJid);
assert.equal(result.orderingId, 'ordering-id');
assert.equal(result.remoteJid, remoteJid);

console.log('zeloMenuInternalClient tests passed');
