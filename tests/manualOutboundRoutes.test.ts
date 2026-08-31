import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { createConversationOutboundDispatcher } from '../server/conversationOutbound.js';
import type { OutboundPayload } from '../src/domain/outbound.js';

const router = readFileSync(new URL('../server/router.ts', import.meta.url), 'utf8');
const customerRouter = readFileSync(new URL('../server/customers/router.ts', import.meta.url), 'utf8');
const waApi = readFileSync(new URL('../src/services/waApi.ts', import.meta.url), 'utf8');
const customerApi = readFileSync(new URL('../src/services/customerApi.ts', import.meta.url), 'utf8');

function routeBlock(source: string, route: string): string {
  const needle = route.includes(':')
    ? new RegExp(`(?:router|customerRouter)\\.post\\('${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`)
    : `router.post('${route}'`;
  const start = typeof needle === 'string' ? source.indexOf(needle) : source.search(needle);
  assert.notEqual(start, -1, `${route} exists`);
  const nextRoute = source.indexOf('\nrouter.', start + 1);
  const nextCustomerRoute = source.indexOf('\ncustomerRouter.', start + 1);
  const stops = [nextRoute, nextCustomerRoute].filter((index) => index > start);
  const end = stops.length ? Math.min(...stops) : source.length;
  return source.slice(start, end);
}

const routeSources = [
  { route: '/api/send', source: router },
  { route: '/api/customers/:personId/messages', source: customerRouter },
  { route: '/api/send-contact', source: router },
  { route: '/api/send/list', source: router },
  { route: '/api/send/location', source: router },
  { route: '/api/send/reaction', source: router },
  { route: '/api/send/poll', source: router },
  { route: '/api/messages/:id/retry', source: router },
] as const;

for (const item of routeSources) {
  const block = routeBlock(item.source, item.route);
  assert.match(block, /dispatchConversationOutbound\s*\(/, `${item.route} uses the outbound dispatcher`);
  assert.match(block, /origin:\s*'human_zelochat'/, `${item.route} records human_zelochat origin`);
  assert.match(block, /takeoverPolicy:\s*'take_over'/, `${item.route} takes over before dispatch`);
  assert.match(block, /requireActorPermission\(req,\s*'clientes\.comunicar'\)/, `${item.route} requires communication permission`);
  assert.doesNotMatch(block, /\b(sendTextMessage|sendMediaMessage|sendWhatsAppAudio|sendContactMessage|sendListMessage|sendLocationMessage|sendReaction|sendPollMessage)\s*\(/, `${item.route} does not call transport directly`);
}

for (const source of [waApi, customerApi]) {
  assert.match(source, /crypto\.randomUUID\(\)/, 'frontend services create client idempotency keys');
  assert.match(source, /idempotencyKey/, 'frontend services send idempotency keys');
}

const payload: OutboundPayload = { kind: 'text', text: 'Oi' };
let beginCount = 0;
let cancelCount = 0;
const modeEvents: Array<{ empresaId: string; sessionIds: string[]; epoch: string }> = [];
const jobs = new Map<string, any>();
const dispatch = createConversationOutboundDispatcher({
  sendWaitMs: 0,
  beginHumanOutbound: async (params) => {
    beginCount += 1;
    const existing = jobs.get(params.idempotencyKey);
    if (existing) return { ...existing, takeoverApplied: false };
    const job = {
      id: 'job-1',
      messageId: 'message-1',
      empresaId: params.empresaId,
      remoteJid: params.remoteJid,
      idempotencyKey: params.idempotencyKey,
      origin: 'human_zelochat',
      status: 'sent',
      payload: params.payload,
      payloadFingerprint: params.payloadFingerprint,
      intentPayloadFingerprint: params.payloadFingerprint,
      providerMessageId: 'provider-1',
      remoteJids: [params.remoteJid, '5511888888888@s.whatsapp.net'],
      controlEpoch: '9',
      takeoverApplied: true,
    };
    jobs.set(params.idempotencyKey, job);
    return job;
  },
  readJob: async (jobId) => [...jobs.values()].find((job) => job.id === jobId) ?? null,
  cancelPendingReply: async () => { cancelCount += 1; },
  broadcastConversationModeChanged: (event) => { modeEvents.push(event); },
});

const first = await dispatch.dispatchConversationOutbound({
  empresaId: 'empresa-1',
  remoteJid: '5511999999999@s.whatsapp.net',
  actorUserId: 'actor-1',
  origin: 'human_zelochat',
  takeoverPolicy: 'take_over',
  idempotencyKey: 'same-http-intent',
  payload,
});
const second = await dispatch.dispatchConversationOutbound({
  empresaId: 'empresa-1',
  remoteJid: '5511999999999@s.whatsapp.net',
  actorUserId: 'actor-1',
  origin: 'human_zelochat',
  takeoverPolicy: 'take_over',
  idempotencyKey: 'same-http-intent',
  payload,
});

assert.deepEqual(second, first, 'lost HTTP response retry with the same key returns the same job/message');
assert.equal(beginCount, 2, 'both HTTP attempts reach the idempotent reservation');
assert.equal(modeEvents.length, 1, 'takeover emits one causal mode event');
assert.deepEqual(
  (({ empresaId, sessionIds, epoch }) => ({ empresaId, sessionIds, epoch }))(modeEvents[0]),
  { empresaId: 'empresa-1', sessionIds: ['5511999999999@s.whatsapp.net', '5511888888888@s.whatsapp.net'], epoch: '9' },
  'takeover event is scoped to the whole family',
);
assert.equal(jobs.size, 1, 'only one durable job is created for the repeated intent');
assert.equal(cancelCount, 1, 'takeover side effect happens only on the first reservation');

console.log('manual outbound route matrix passed');
