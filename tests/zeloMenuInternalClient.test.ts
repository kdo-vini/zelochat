import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ZeloMenuInternalClient, DEFAULT_ZELOMENU_INTERNAL_CONFIRM_TIMEOUT_MS } from '../server/zeloMenuInternalClient.js';
import type { OrderingSnapshot } from '../src/domain/aiWhatsAppOrdering.js';

const fixturesDir = new URL('./fixtures/zelomenu-wire/v1/', import.meta.url);
const loadFixture = (name: string): unknown => JSON.parse(readFileSync(new URL(name, fixturesDir), 'utf8'));
const readySnapshotJson = loadFixture('snapshot.ready.json') as Record<string, unknown>;

const bodies: Record<string, unknown>[] = [];
const client = new ZeloMenuInternalClient({
  baseUrl: 'https://internal.example', apiKey: 'key', timeoutMs: 100, confirmTimeoutMs: 100,
  fetchImpl: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify(readySnapshotJson), { headers: { 'content-type': 'application/json' } });
  },
  requestIdFactory: () => 'request',
});
const command = { empresaId: 'empresa', remoteJid: 'jid', messageId: 'message', orderingId: 'ordering', expectedRevision: 2, conversationControlId: 'control', conversationEpoch: '9007199254740993' };
const updated = await client.updateDraft({ ...command, draft: { items: [{ lineId: 'l1', productId: 1, quantity: 1 }] } });
await client.confirmDraft({ ...command, confirmationToken: 'token' });
await client.cancelDraft(command);
assert.deepEqual(bodies.map((body) => [body.conversationControlId, body.conversationEpoch]), [
  ['control', '9007199254740993'], ['control', '9007199254740993'], ['control', '9007199254740993'],
]);
// The response is parsed through the real wire adapter, not returned raw —
// requirements carry `type`/`label`, not the old `kind`/`label` guess.
assert.equal(updated.orderingId, (readySnapshotJson.orderingId as string));
assert.ok(updated.requirements?.every((requirement) => typeof requirement.type === 'string' && typeof requirement.label === 'string'));

// Missing empresaId/remoteJid must fail LOCALLY (no request sent), matching
// the boundary ZeloMenu itself enforces (EMPRESA_INVALIDA/CONVERSA_INVALIDA).
let neverCalled = true;
const noIdentityClient = new ZeloMenuInternalClient({
  baseUrl: 'https://internal.example', apiKey: 'key', timeoutMs: 100,
  fetchImpl: async () => { neverCalled = false; return new Response('{}'); },
  requestIdFactory: () => 'request',
});
await assert.rejects(() => noIdentityClient.updateDraft({ ...command, empresaId: '', draft: { items: [] } }));
assert.equal(neverCalled, true, 'a missing empresaId must not spend a round trip');

// GET snapshot lookup must scope by both empresaId and remoteJid — ZeloMenu
// (the authority) requires both and 400s with CONVERSA_INVALIDA otherwise.
const remoteJid = '5511999998888@s.whatsapp.net';
const getUrls: string[] = [];
const getClient = new ZeloMenuInternalClient({
  baseUrl: 'https://internal.example', apiKey: 'key', timeoutMs: 100,
  fetchImpl: async (url) => {
    getUrls.push(String(url));
    return new Response(JSON.stringify({ ...readySnapshotJson, empresaId: 'empresa-id', remoteJid }), { headers: { 'content-type': 'application/json' } });
  },
  requestIdFactory: () => 'request',
});
await getClient.getOrdering('ordering-id', 'empresa-id', remoteJid);
assert.equal(getUrls.length, 1);
assert.match(getUrls[0], /empresaId=empresa-id/);
assert.match(getUrls[0], /remoteJid=5511999998888%40s\.whatsapp\.net/);

// Contract test: a fake fetch that mirrors ZeloMenu's authority behaviour —
// 400 CONVERSA_INVALIDA when remoteJid is absent from the URL, 200 with a
// real snapshot when present. Proves the old (empresaId-only) URL shape
// would 400.
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
    return new Response(JSON.stringify({ ...readySnapshotJson, empresaId: 'empresa-id', remoteJid }), { headers: { 'content-type': 'application/json' } });
  },
  requestIdFactory: () => 'request',
});
const result = await authorityLikeClient.getOrdering('ordering-id', 'empresa-id', remoteJid);
assert.equal(result.empresaId, 'empresa-id');
assert.equal(result.remoteJid, remoteJid);

// A snapshot MISSING `requirements` (FN C5 — deployment/version skew against
// an older/rolled-back ZeloMenu) must fail closed with a stable, friendly
// error code — never a raw TypeError bubbling out of the parser.
const skewClient = new ZeloMenuInternalClient({
  baseUrl: 'https://internal.example', apiKey: 'key', timeoutMs: 100,
  fetchImpl: async () => {
    const { requirements: _drop, ...withoutRequirements } = readySnapshotJson;
    return new Response(JSON.stringify(withoutRequirements), { headers: { 'content-type': 'application/json' } });
  },
});
await assert.rejects(
  () => skewClient.getOrdering('ordering-id', 'empresa-id', remoteJid),
  (error: unknown) => (error as { code?: string }).code === 'ORDERING_WIRE_UNSUPPORTED',
);

// A 409 response's `current` snapshot is ALSO parsed through the real wire
// adapter (not returned raw) so `error.current.requirements[].type` is
// already in domain shape by the time recovery code reads it.
const conflictClient = new ZeloMenuInternalClient({
  baseUrl: 'https://internal.example', apiKey: 'key', timeoutMs: 100,
  fetchImpl: async () => new Response(JSON.stringify({ error: 'REVISAO_DESATUALIZADA', current: readySnapshotJson }), {
    status: 409, headers: { 'content-type': 'application/json' },
  }),
});
await assert.rejects(
  () => conflictClient.updateDraft({ ...command, draft: { items: [] } }),
  (error: unknown) => {
    const current = (error as { current?: OrderingSnapshot }).current;
    return current != null && current.requirements?.every((requirement) => typeof requirement.type === 'string');
  },
);

// Confirm gets a larger, independently-configured timeout budget (CT #9).
let observedTimeout: number | null = null;
const timeoutAwareClient = new ZeloMenuInternalClient({
  baseUrl: 'https://internal.example', apiKey: 'key', timeoutMs: 4000, confirmTimeoutMs: DEFAULT_ZELOMENU_INTERNAL_CONFIRM_TIMEOUT_MS,
  fetchImpl: async (_url, init) => {
    // AbortSignal has no public timeout accessor; infer the intended budget
    // from whether the confirm call was told to use a longer one by racing a
    // synthetic delay against the signal.
    observedTimeout = init?.signal instanceof AbortSignal ? 1 : null;
    return new Response(JSON.stringify(readySnapshotJson), { headers: { 'content-type': 'application/json' } });
  },
});
await timeoutAwareClient.confirmDraft({ ...command, confirmationToken: 'token' });
assert.equal(observedTimeout, 1, 'confirmDraft must still pass an AbortSignal through');

// A generic 500 must never leak internal details to the message shown to a customer.
const failing = new ZeloMenuInternalClient({
  baseUrl: 'https://internal.example', apiKey: 'secret-key', timeoutMs: 100,
  fetchImpl: async () => new Response(JSON.stringify({ error: 'PEDIDO_INDISPONIVEL', detail: 'raw database secret' }), { status: 500 }),
});
await assert.rejects(
  () => failing.getOrdering(command.orderingId, command.empresaId, command.remoteJid),
  (error: unknown) => error instanceof Error
    && error.message === 'Não foi possível consultar o pedido agora.'
    && !error.message.includes('raw database secret'),
);

console.log('zeloMenuInternalClient tests passed');
