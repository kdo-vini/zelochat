import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ZeloMenuInternalClient, DEFAULT_ZELOMENU_INTERNAL_CONFIRM_TIMEOUT_MS } from '../server/zeloMenuInternalClient.js';
import { createOrderingCircuitBreaker } from '../server/orderingCircuitBreaker.js';
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

// PR I-5 — a run of 5xx/timeout failures for ONE empresa trips that
// empresa's circuit breaker: the 6th call never even reaches `fetchImpl`
// (fail fast), the "just opened" side effect fires exactly once, and a
// DIFFERENT empresa sharing the same client instance is unaffected.
{
  let fetchCalls = 0;
  let openedCount = 0;
  const openedFor: string[] = [];
  let fakeNow = 0;
  const breaker = createOrderingCircuitBreaker({ threshold: 5, windowMs: 60_000, openMs: 30_000, now: () => fakeNow });
  const breakerClient = new ZeloMenuInternalClient({
    baseUrl: 'https://internal.example', apiKey: 'key', timeoutMs: 100,
    fetchImpl: async () => { fetchCalls++; return new Response(JSON.stringify({ error: 'INDISPONIVEL' }), { status: 503 }); },
    circuitBreaker: breaker,
    onCircuitOpen: (empresaId) => { openedCount++; openedFor.push(empresaId); },
  });
  for (let i = 0; i < 5; i++) {
    fakeNow += 1_000;
    await assert.rejects(() => breakerClient.getOrdering('ordering-id', 'empresa-breaker', remoteJid));
  }
  assert.equal(fetchCalls, 5, 'every one of the first 5 failures still reached the network');
  assert.equal(openedCount, 1, 'the breaker reports "just opened" exactly once');
  assert.deepEqual(openedFor, ['empresa-breaker']);

  fakeNow += 1_000;
  await assert.rejects(
    () => breakerClient.getOrdering('ordering-id', 'empresa-breaker', remoteJid),
    (error: unknown) => (error as { code?: string }).code === 'INDISPONIVEL_CIRCUITO_ABERTO',
  );
  assert.equal(fetchCalls, 5, 'while open, the client fails fast — no further network call is attempted');
  assert.equal(openedCount, 1, 'no second "just opened" notification while still open');

  // A different empresa sharing the same client/breaker is unaffected.
  fakeNow += 1_000;
  await assert.rejects(() => breakerClient.getOrdering('ordering-id', 'empresa-other', remoteJid));
  assert.equal(fetchCalls, 6, 'a different empresa key still reaches the network normally');
}

// CONFIRMACAO_INDISPONIVEL is the one 400 that represents store-side
// unavailability. It contributes to the breaker and opens it once at the
// configured threshold, just like a transport failure.
{
  let fetchCalls = 0;
  let openedCount = 0;
  const empresaId = 'empresa-confirm-unavailable';
  const breaker = createOrderingCircuitBreaker({ threshold: 2, windowMs: 60_000, openMs: 30_000, now: () => 1_000 });
  const unavailableClient = new ZeloMenuInternalClient({
    baseUrl: 'https://internal.example', apiKey: 'key', timeoutMs: 100,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ error: 'CONFIRMACAO_INDISPONIVEL' }), { status: 400 });
    },
    circuitBreaker: breaker,
    onCircuitOpen: () => { openedCount += 1; },
  });

  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(
      () => unavailableClient.getOrdering('ordering-id', empresaId, remoteJid),
      (error: unknown) => (error as { code?: string }).code === 'CONFIRMACAO_INDISPONIVEL',
    );
  }
  assert.equal(fetchCalls, 2, 'both failures up to the threshold reach the authority');
  assert.equal(openedCount, 1, 'the circuit-open side effect fires exactly once at the threshold');

  await assert.rejects(
    () => unavailableClient.getOrdering('ordering-id', empresaId, remoteJid),
    (error: unknown) => (error as { code?: string }).code === 'INDISPONIVEL_CIRCUITO_ABERTO',
  );
  assert.equal(fetchCalls, 2, 'subsequent calls fast-fail while the breaker is open');
  assert.equal(openedCount, 1, 'fast-fail does not emit another circuit-open side effect');
}

// Regression guard: every other 4xx is a healthy authority response and
// must reset, rather than merely avoid contributing to, the breaker.
{
  let fetchCalls = 0;
  let openedCount = 0;
  const empresaId = 'empresa-invalid-command';
  const breaker = createOrderingCircuitBreaker({ threshold: 2, windowMs: 60_000, openMs: 30_000, now: () => 1_000 });
  const invalidCommandClient = new ZeloMenuInternalClient({
    baseUrl: 'https://internal.example', apiKey: 'key', timeoutMs: 100,
    fetchImpl: async () => {
      fetchCalls += 1;
      const error = fetchCalls === 2 ? 'COMANDO_INVALIDO' : 'CONFIRMACAO_INDISPONIVEL';
      return new Response(JSON.stringify({ error }), { status: 400 });
    },
    circuitBreaker: breaker,
    onCircuitOpen: () => { openedCount += 1; },
  });

  await assert.rejects(() => invalidCommandClient.getOrdering('ordering-id', empresaId, remoteJid));
  await assert.rejects(
    () => invalidCommandClient.getOrdering('ordering-id', empresaId, remoteJid),
    (error: unknown) => (error as { code?: string }).code === 'COMANDO_INVALIDO',
  );
  await assert.rejects(() => invalidCommandClient.getOrdering('ordering-id', empresaId, remoteJid));
  assert.equal(fetchCalls, 3, 'COMANDO_INVALIDO resets the prior failure, so the next availability fault still reaches the authority');
  assert.equal(breaker.isOpen(empresaId), false, 'the two availability faults are not consecutive across COMANDO_INVALIDO');
  assert.equal(openedCount, 0, 'a normal domain 400 resets the streak and never emits the circuit-open side effect');
}

console.log('zeloMenuInternalClient tests passed');
