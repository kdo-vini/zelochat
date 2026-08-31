import assert from 'node:assert/strict';
import axios from 'axios';
import { readFileSync } from 'node:fs';
import type { PersistedOutboundPayload } from '../src/domain/outbound.js';
import { OutboundQueue, assertOutboundJobShape, type OutboundJob, type OutboundJobInput, type OutboundJobStore } from '../server/outbound/queue.js';
import { OutboundWorker, canUseAutomationPhoneSnapshot } from '../server/outbound/worker.js';
import { createProviderAdapter, fingerprintOutboundPayload, type ProviderDispatchResult } from '../server/outbound/providerAdapter.js';
import { createOutboundMediaStore, type OutboundMediaStorage } from '../server/outbound/mediaStore.js';
import { prepareWhatsAppHttpRequest } from '../server/whatsapp.js';

process.on('uncaughtException', (error) => { console.error(error); process.exit(1); });
process.on('unhandledRejection', (error) => { console.error(error); process.exit(1); });
let phase = 'bootstrap';
const watchdog = setTimeout(() => { console.error(`conversationOutboundWorker hung at ${phase}`); process.exit(1); }, 10_000);

type Control = { mode: 'ai' | 'human'; epoch: string; holdJobId: string | null };
type PersistedMediaPayload = Extract<PersistedOutboundPayload, { storagePath: string }>;

const conversationJob = (overrides: Partial<OutboundJob> = {}): OutboundJob => ({
  id: 'j1', empresaId: 'e1', instanceKey: 'instance-1', idempotencyKey: 'e1:j1', jobType: 'conversation',
  conversationControlId: 'control-1', conversationJid: '5511999999999@s.whatsapp.net', messageId: 'message-j1',
  origin: 'human_zelochat', payload: { kind: 'text', text: 'Olá' }, payloadFingerprint: 'fingerprint-j1',
  status: 'queued', leaseOwner: null, attempts: 0, phone: '5511999999999', text: 'Olá', ...overrides,
} as OutboundJob);

assert.equal(canUseAutomationPhoneSnapshot({ ...conversationJob(), jobType: 'automation', origin: 'automation', phone: '5511999999999' } as OutboundJob, null), true);
assert.throws(() => assertOutboundJobShape(conversationJob({ payload: { kind: 'media', attachment: { type: 'image', mimeType: 'image/png', fileName: 'raw.png', dataUrl: 'data:image/png;base64,eA==' } } } as Partial<OutboundJob>)), /OUTBOUND_CONVERSATION_PAYLOAD_NOT_PERSISTED|OUTBOUND_MEDIA_NOT_QUEUEABLE/);

class SharedLeaseStore implements OutboundJobStore {
  readonly rows = new Map<string, OutboundJob>();
  readonly controls = new Map<string, Control>();
  now = Date.parse('2026-08-30T12:00:00.000Z');
  maxActiveByControl = new Map<string, number>();

  constructor(seed: OutboundJob[], controls: Record<string, Control> = {}) {
    for (const row of seed) this.rows.set(row.id, structuredClone(row));
    for (const [id, control] of Object.entries(controls)) this.controls.set(id, { ...control });
  }
  async insert(input: OutboundJobInput): Promise<OutboundJob> {
    const existing = [...this.rows.values()].find((row) => row.empresaId === input.empresaId && row.idempotencyKey === input.idempotencyKey);
    if (existing) return structuredClone(existing);
    const row = conversationJob({ ...input, id: input.id ?? `job-${this.rows.size + 1}`, status: 'queued', attempts: 0 } as Partial<OutboundJob>);
    this.rows.set(row.id, row); return structuredClone(row);
  }
  async claim(workerId: string, leaseMs: number): Promise<OutboundJob | null> {
    const candidates = [...this.rows.values()].filter((row) => row.status === 'queued').sort((a, b) => a.id.localeCompare(b.id));
    for (const row of candidates) {
      if (row.conversationControlId) {
        const control = this.controls.get(row.conversationControlId);
        if (!control || control.holdJobId) continue;
        const active = [...this.rows.values()].some((other) => other.id !== row.id && other.conversationControlId === row.conversationControlId && (other.status === 'sending' || other.status === 'dispatch_started'));
        if (active) continue;
        if ((row.origin === 'ai_auto' || row.origin === 'ai_followup') && (control.mode !== 'ai' || control.epoch !== row.controlEpoch)) {
          row.status = 'cancelled'; row.suppressionReason = control.mode !== 'ai' ? 'paused' : 'stale_epoch'; return null;
        }
      }
      row.status = 'sending'; row.leaseOwner = workerId; row.leaseExpiresAt = new Date(this.now + leaseMs).toISOString();
      this.observeActive(row.conversationControlId); return structuredClone(row);
    }
    return null;
  }
  private observeActive(controlId?: string): void {
    if (!controlId) return;
    const count = [...this.rows.values()].filter((row) => row.conversationControlId === controlId && (row.status === 'sending' || row.status === 'dispatch_started')).length;
    this.maxActiveByControl.set(controlId, Math.max(this.maxActiveByControl.get(controlId) ?? 0, count));
  }
  async startTransport(id: string, empresaId: string, leaseOwner: string): Promise<boolean> {
    const row = this.rows.get(id); if (!row || row.empresaId !== empresaId || row.leaseOwner !== leaseOwner || row.status !== 'sending') return false;
    if (row.conversationControlId) {
      const control = this.controls.get(row.conversationControlId);
      const held = Boolean(control?.holdJobId);
      const staleAi = (row.origin === 'ai_auto' || row.origin === 'ai_followup') && (!control || control.mode !== 'ai' || control.epoch !== row.controlEpoch);
      if (staleAi) { Object.assign(row, { status: 'cancelled', suppressionReason: control?.mode !== 'ai' ? 'paused' : 'stale_epoch', leaseOwner: null, leaseExpiresAt: null }); return false; }
      if (held) { Object.assign(row, { status: 'queued', suppressionReason: null, leaseOwner: null, leaseExpiresAt: null }); return false; }
    }
    row.status = 'dispatch_started'; row.attempts += 1; this.observeActive(row.conversationControlId); return true;
  }
  async markSent(id: string, providerMessageId: string, empresaId?: string, leaseOwner?: string): Promise<boolean> {
    const row = this.rows.get(id); if (!row || (empresaId && row.empresaId !== empresaId) || (leaseOwner && row.leaseOwner !== leaseOwner)) return false;
    Object.assign(row, { status: 'sent', providerMessageId, leaseOwner: null, leaseExpiresAt: null }); return true;
  }
  async markDeliveryUncertain(id: string, reason: string, empresaId: string, leaseOwner: string): Promise<boolean> {
    const row = this.rows.get(id); if (!row || row.empresaId !== empresaId || row.leaseOwner !== leaseOwner) return false;
    Object.assign(row, { status: 'delivery_uncertain', lastError: reason, leaseOwner: null, leaseExpiresAt: null });
    if (row.conversationControlId) { const control = this.controls.get(row.conversationControlId); if (control) control.holdJobId = row.id; }
    return true;
  }
  async markFailed(id: string, reason: string, retryAt: Date | null, empresaId?: string, leaseOwner?: string): Promise<boolean> {
    const row = this.rows.get(id); if (!row || (empresaId && row.empresaId !== empresaId) || (leaseOwner && row.leaseOwner !== leaseOwner)) return false;
    Object.assign(row, { status: retryAt ? 'queued' : 'failed_before_dispatch', lastError: reason, nextAttemptAt: retryAt?.toISOString(), leaseOwner: null, leaseExpiresAt: null }); return true;
  }
  async defer(id: string, reason: string, retryAt = new Date(this.now + 60_000), empresaId?: string, leaseOwner?: string): Promise<boolean> { return this.markFailed(id, reason, retryAt, empresaId, leaseOwner); }
  async markSuppressed(id: string, reason: string, empresaId?: string, leaseOwner?: string): Promise<boolean> {
    const row = this.rows.get(id); if (!row || (empresaId && row.empresaId !== empresaId) || (leaseOwner && row.leaseOwner !== leaseOwner)) return false;
    Object.assign(row, { status: 'cancelled', suppressionReason: reason, leaseOwner: null, leaseExpiresAt: null }); return true;
  }
  async releaseExpired(): Promise<void> {
    for (const row of this.rows.values()) {
      if (!row.leaseExpiresAt || Date.parse(row.leaseExpiresAt) >= this.now) continue;
      if (row.status === 'sending') Object.assign(row, { status: 'queued', leaseOwner: null, leaseExpiresAt: null });
      else if (row.status === 'dispatch_started') {
        Object.assign(row, { status: 'delivery_uncertain', leaseOwner: null, leaseExpiresAt: null });
        if (row.conversationControlId) this.controls.get(row.conversationControlId)!.holdJobId = row.id;
      }
    }
  }
}

class RecordingTransport {
  readonly calls: string[] = []; private blockers = new Map<string, Promise<void>>(); private releases = new Map<string, () => void>();
  block(id: string): void { this.blockers.set(id, new Promise((resolve) => this.releases.set(id, resolve))); }
  release(id: string): void { this.releases.get(id)?.(); }
  callsFor(key: string): number { return this.calls.filter((call) => call === key).length; }
  async prepare(job: OutboundJob) { return { job, request: { url: 'https://provider.test/send', body: JSON.stringify({ text: job.text }), headers: {} } }; }
  async send(prepared: { job: OutboundJob }): Promise<ProviderDispatchResult> {
    const job = prepared.job;
    this.calls.push(`${job.empresaId}:${job.id}`); await this.blockers.get(job.id); return { state: 'sent', providerMessageId: `provider-${job.id}` };
  }
}

function worker(store: SharedLeaseStore, transport: RecordingTransport): OutboundWorker {
  return new OutboundWorker({ queue: new OutboundQueue(store), transport, getStatus: async () => 'connected', getRolloutFlags: async () => ({ crm: true, campaigns: true, automations: true }), validate: async () => ({ action: 'send' }), broadcastStatus: async () => undefined });
}

// Two replicas cannot send the same conversational intent.
{
  phase = 'same intent';
  const store = new SharedLeaseStore([conversationJob()], { 'control-1': { mode: 'human', epoch: '8', holdJobId: null } });
  const transport = new RecordingTransport(); transport.block('j1');
  const runA = worker(store, transport).runOnce('a'); await new Promise((resolve) => setImmediate(resolve));
  const runB = worker(store, transport).runOnce('b'); transport.release('j1');
  assert.deepEqual(await Promise.all([runA, runB]), [true, false]); assert.equal(transport.callsFor('e1:j1'), 1);
}

// Alternate JIDs still share the canonical-control mutex.
{
  phase = 'alternate jids';
  const first = conversationJob({ id: 'j1', conversationJid: '5511888888888@s.whatsapp.net' });
  const second = conversationJob({ id: 'j2', idempotencyKey: 'e1:j2', conversationJid: '5511988888888@s.whatsapp.net' });
  const store = new SharedLeaseStore([first, second], { 'control-1': { mode: 'human', epoch: '8', holdJobId: null } });
  const transport = new RecordingTransport(); transport.block('j1'); const firstRun = worker(store, transport).runOnce('a'); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await worker(store, transport).runOnce('b'), false); transport.release('j1'); assert.equal(await firstRun, true);
  assert.equal(store.maxActiveByControl.get('control-1'), 1); assert.equal(await worker(store, transport).runOnce('b'), true);
}

// Takeover epoch 7 -> 8 cancels queued AI 7.
{
  phase = 'stale epoch';
  const store = new SharedLeaseStore([conversationJob({ origin: 'ai_auto', controlEpoch: '7' })], { 'control-1': { mode: 'human', epoch: '8', holdJobId: null } });
  const transport = new RecordingTransport(); assert.equal(await worker(store, transport).runOnce('a'), false);
  assert.equal(store.rows.get('j1')?.status, 'cancelled'); assert.equal(transport.calls.length, 0);
}

// Operational deferrals never consume a transport attempt.
{
  phase = 'deferral attempts';
  const deferred = { ...conversationJob(), jobType: 'campaign', origin: 'campaign', conversationControlId: undefined, conversationJid: undefined } as OutboundJob;
  const store = new SharedLeaseStore([deferred]); const transport = new RecordingTransport();
  const outboundWorker = new OutboundWorker({ queue: new OutboundQueue(store), transport, getRolloutFlags: async () => ({ crm: true, campaigns: false, automations: true }), broadcastStatus: async () => undefined });
  assert.equal(await outboundWorker.runOnce('defer'), false); assert.equal(store.rows.get('j1')?.attempts, 0); assert.equal(store.rows.get('j1')?.status, 'queued');
}

// Transactional messages without a session bypass campaign rollout, while the
// same destination remains independent across tenants.
{
  phase = 'tenant-scoped transactional destination';
  const jid = '5511777777777@s.whatsapp.net';
  const transactional = (id: string, empresaId: string): OutboundJob => ({
    ...conversationJob({ id, empresaId, idempotencyKey: `${empresaId}:${id}` }),
    jobType: 'transactional',
    origin: 'system_transactional',
    conversationControlId: undefined,
    conversationJid: jid,
    messageId: undefined,
  } as unknown as OutboundJob);
  const store = new SharedLeaseStore([transactional('j1', 'e1'), transactional('j2', 'e2')]);
  const transport = new RecordingTransport();
  transport.block('j1');
  const outboundWorker = new OutboundWorker({
    queue: new OutboundQueue(store),
    transport,
    getStatus: async () => 'connected',
    getRolloutFlags: async () => ({ crm: true, campaigns: false, automations: false }),
    validate: async () => ({ action: 'send' }),
    broadcastStatus: async () => undefined,
  });
  const first = outboundWorker.runOnce('transactional-e1');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await outboundWorker.runOnce('transactional-e2'), true);
  transport.release('j1');
  assert.equal(await first, true);
  assert.deepEqual(transport.calls.sort(), ['e1:j1', 'e2:j2']);
}

// Only pre-transport expiry retries; post-linearization becomes uncertain without a second POST.
{
  phase = 'preflight failure';
  const store = new SharedLeaseStore([conversationJob()], { 'control-1': { mode: 'human', epoch: '8', holdJobId: null } });
  const transport = { async prepare() { throw new Error('OUTBOUND_CONTACT_VCARD_INVALID'); }, async send(): Promise<ProviderDispatchResult> { throw new Error('send must not run'); } };
  const outboundWorker = new OutboundWorker({ queue: new OutboundQueue(store), transport, getStatus: async () => 'connected', validate: async () => ({ action: 'send' }), broadcastStatus: async () => undefined });
  assert.equal(await outboundWorker.runOnce('preflight'), false);
  assert.equal(store.rows.get('j1')?.status, 'failed_before_dispatch'); assert.equal(store.rows.get('j1')?.attempts, 0);
}

// Status broadcast is out-of-band; a WebSocket failure after startTransport must not block the POST.
{
  phase = 'broadcast fail-soft';
  const store = new SharedLeaseStore([conversationJob()], { 'control-1': { mode: 'human', epoch: '8', holdJobId: null } });
  let posts = 0;
  const transport = {
    async prepare(job: OutboundJob) { return { job, request: { url: 'https://provider.test/send', body: '{}', headers: {} } }; },
    async send(): Promise<ProviderDispatchResult> { posts++; return { state: 'sent', providerMessageId: 'provider-j1' }; },
  };
  const outboundWorker = new OutboundWorker({
    queue: new OutboundQueue(store),
    transport,
    getStatus: async () => 'connected',
    validate: async () => ({ action: 'send' }),
    broadcastStatus: async (_empresaId, _messageId, status) => {
      if (status === 'dispatch_started') throw new Error('WS_CLOSED');
    },
  });
  assert.equal(await outboundWorker.runOnce('broadcast'), true);
  assert.equal(posts, 1);
  assert.equal(store.rows.get('j1')?.status, 'sent');
}

// A hold installed after claim/preflight returns the same intent to queued.
{
  phase = 'hold during preflight';
  const store = new SharedLeaseStore([conversationJob()], { 'control-1': { mode: 'human', epoch: '8', holdJobId: null } });
  let posts = 0; let installHold = true;
  const transport = {
    async prepare(job: OutboundJob) { if (installHold) { store.controls.get('control-1')!.holdJobId = 'uncertain-before-j1'; installHold = false; } return { job, request: { url: 'https://provider.test/send', body: '{}', headers: {} } }; },
    async send(): Promise<ProviderDispatchResult> { posts++; return { state: 'sent', providerMessageId: 'must-not-send' }; },
  };
  const heldWorker = new OutboundWorker({ queue: new OutboundQueue(store), transport, getStatus: async () => 'connected', validate: async () => ({ action: 'send' }), broadcastStatus: async () => undefined });
  assert.equal(await heldWorker.runOnce('held'), false); assert.equal(posts, 0);
  assert.equal(store.rows.get('j1')?.status, 'queued'); assert.equal(store.rows.get('j1')?.attempts, 0); assert.equal(store.rows.get('j1')?.leaseOwner, null);
  assert.equal(await heldWorker.runOnce('still-held'), false); assert.equal(posts, 0);
  store.controls.get('control-1')!.holdJobId = null;
  assert.equal(await heldWorker.runOnce('released'), true); assert.equal(posts, 1); assert.equal(store.rows.get('j1')?.status, 'sent');
}

// A takeover committed while deterministic preflight runs is revalidated by startTransport.
{
  phase = 'takeover during preflight';
  const store = new SharedLeaseStore([conversationJob({ origin: 'ai_auto', controlEpoch: '7' })], { 'control-1': { mode: 'ai', epoch: '7', holdJobId: null } });
  let posts = 0;
  const transport = {
    async prepare(job: OutboundJob) { store.controls.set('control-1', { mode: 'human', epoch: '8', holdJobId: null }); return { job, request: { url: 'https://provider.test/send', body: '{}', headers: {} } }; },
    async send(): Promise<ProviderDispatchResult> { posts++; return { state: 'sent', providerMessageId: 'must-not-send' }; },
  };
  const outboundWorker = new OutboundWorker({ queue: new OutboundQueue(store), transport, getStatus: async () => 'connected', validate: async () => ({ action: 'send' }), broadcastStatus: async () => undefined });
  assert.equal(await outboundWorker.runOnce('takeover'), false); assert.equal(posts, 0);
  assert.equal(store.rows.get('j1')?.status, 'cancelled'); assert.equal(store.rows.get('j1')?.suppressionReason, 'paused');
}

// JID/body validation is part of prepare and missing recipients cannot remain queued forever.
{
  phase = 'preflight recipient validation';
  let posts = 0;
  const textFingerprint = await fingerprintOutboundPayload({ kind: 'text', text: 'Olá' });
  const invalidStore = new SharedLeaseStore([conversationJob({ conversationJid: 'invalid-jid', payloadFingerprint: textFingerprint })], { 'control-1': { mode: 'human', epoch: '8', holdJobId: null } });
  const adapter = createProviderAdapter({ prepareRequest: prepareWhatsAppHttpRequest, sendPrepared: async () => { posts++; return 'unexpected'; }, prepareMedia: async () => { throw new Error('unexpected media'); } });
  assert.equal(await new OutboundWorker({ queue: new OutboundQueue(invalidStore), transport: adapter, getStatus: async () => 'connected', validate: async () => ({ action: 'send' }), broadcastStatus: async () => undefined }).runOnce('invalid-jid'), false);
  assert.equal(invalidStore.rows.get('j1')?.status, 'failed_before_dispatch'); assert.equal(posts, 0);

  const missing = { ...conversationJob(), jobType: 'campaign', origin: 'campaign', conversationControlId: undefined, conversationJid: undefined, phone: null } as OutboundJob;
  const missingStore = new SharedLeaseStore([missing]);
  assert.equal(await worker(missingStore, new RecordingTransport()).runOnce('missing-recipient'), false);
  assert.equal(missingStore.rows.get('j1')?.status, 'failed_before_dispatch'); assert.equal(missingStore.rows.get('j1')?.attempts, 0);
}

// Claimed rows with null/raw media payloads terminalize before provider prepare/send.
{
  phase = 'invalid claimed payload boundary';
  for (const [id, payload] of [
    ['null-payload', null],
    ['raw-media', { kind: 'media', attachment: { dataUrl: 'data:image/png;base64,eA==' } }],
  ] as const) {
    const invalid = conversationJob({ id, idempotencyKey: `e1:${id}`, payload } as unknown as Partial<OutboundJob>);
    const invalidStore = new SharedLeaseStore([invalid], { 'control-1': { mode: 'human', epoch: '8', holdJobId: null } });
    const invalidTransport = new RecordingTransport();
    assert.equal(await worker(invalidStore, invalidTransport).runOnce(`worker-${id}`), false);
    assert.equal(invalidStore.rows.get(id)?.status, 'failed_before_dispatch'); assert.equal(invalidTransport.calls.length, 0);
  }
}

// Only pre-transport expiry retries; post-linearization becomes uncertain without a second POST.
{
  phase = 'expired leases';
  const before = conversationJob({ status: 'sending', leaseOwner: 'dead', leaseExpiresAt: '2026-08-30T11:59:00.000Z' });
  const store = new SharedLeaseStore([before], { 'control-1': { mode: 'human', epoch: '8', holdJobId: null } }); const transport = new RecordingTransport();
  assert.equal(await worker(store, transport).runOnce('new'), true); assert.equal(transport.callsFor('e1:j1'), 1);
  const after = conversationJob({ id: 'j2', idempotencyKey: 'e1:j2', status: 'dispatch_started', leaseOwner: 'dead', leaseExpiresAt: '2026-08-30T11:59:00.000Z' });
  const storeAfter = new SharedLeaseStore([after], { 'control-1': { mode: 'human', epoch: '8', holdJobId: null } }); const transportAfter = new RecordingTransport();
  assert.equal(await worker(storeAfter, transportAfter).runOnce('new'), false); assert.equal(storeAfter.rows.get('j2')?.status, 'delivery_uncertain');
  assert.equal(storeAfter.controls.get('control-1')?.holdJobId, 'j2'); assert.equal(transportAfter.calls.length, 0);
}

// An in-flight AI dispatch finishes before the human job.
{
  phase = 'ai before human';
  const ai = conversationJob({ id: 'a-ai', origin: 'ai_auto', controlEpoch: '7', status: 'dispatch_started', leaseOwner: 'a', leaseExpiresAt: '2026-08-30T12:01:00.000Z' });
  const human = conversationJob({ id: 'b-human', idempotencyKey: 'e1:human' });
  const store = new SharedLeaseStore([ai, human], { 'control-1': { mode: 'human', epoch: '8', holdJobId: null } }); const transport = new RecordingTransport();
  assert.equal(await worker(store, transport).runOnce('b'), false); assert.equal(store.rows.get('b-human')?.status, 'queued');
  assert.equal(await store.markSent('a-ai', 'provider-ai', 'e1', 'a'), true); assert.equal(await worker(store, transport).runOnce('b'), true);
}

// Different controls progress independently.
{
  phase = 'different controls';
  const c1 = conversationJob({ id: 'j1', conversationControlId: 'control-1' });
  const c2 = conversationJob({ id: 'j2', idempotencyKey: 'e1:j2', conversationControlId: 'control-2', conversationJid: '5521999999999@s.whatsapp.net' });
  const store = new SharedLeaseStore([c1, c2], { 'control-1': { mode: 'human', epoch: '8', holdJobId: null }, 'control-2': { mode: 'human', epoch: '3', holdJobId: null } });
  const transport = new RecordingTransport(); transport.block('j1'); const firstRun = worker(store, transport).runOnce('a'); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await worker(store, transport).runOnce('b'), true); transport.release('j1'); assert.equal(await firstRun, true);
}

// Lease fencing rejects finalization by a different worker.
{
  phase = 'lease fencing';
  const row = conversationJob({ status: 'dispatch_started', leaseOwner: 'owner-a' });
  const store = new SharedLeaseStore([row], { 'control-1': { mode: 'human', epoch: '8', holdJobId: null } });
  assert.equal(await new OutboundQueue(store).complete({ ...row, leaseOwner: 'owner-b' }, 'provider-id'), false);
  assert.equal(store.rows.get('j1')?.status, 'dispatch_started');
}

// A single process can use its global concurrency on different conversations.
{
  phase = 'batch different controls';
  const c1 = conversationJob({ id: 'j1', conversationControlId: 'control-1' });
  const c2 = conversationJob({ id: 'j2', idempotencyKey: 'e1:j2', conversationControlId: 'control-2', conversationJid: '5521999999999@s.whatsapp.net' });
  const store = new SharedLeaseStore([c1, c2], { 'control-1': { mode: 'human', epoch: '8', holdJobId: null }, 'control-2': { mode: 'human', epoch: '3', holdJobId: null } });
  const transport = new RecordingTransport();
  assert.equal(await worker(store, transport).runBatch('batch', 2), 2);
  assert.equal(transport.calls.length, 2);
}

// Probe each real helper: the provider's key.id response is returned, never synthesized.
{
  phase = 'provider probes';
  process.env.WHATSMIAU_INSTANCE = 'probe-instance'; const whatsapp = await import('../server/whatsapp.js'); const previousAdapter = axios.defaults.adapter; const paths: string[] = []; let omitId = false;
  axios.defaults.adapter = async (config) => { const url = String(config.url); paths.push(url); const endpoint = url.split('/message/')[1]?.split('/')[0] ?? 'unknown'; return { data: omitId ? { accepted: true } : { key: { id: `probe-${endpoint}` } }, status: 200, statusText: 'OK', headers: {}, config }; };
  try {
    const jid = '5511999999999@s.whatsapp.net';
    assert.equal(await whatsapp.sendTextMessage(jid, 'oi'), 'probe-sendText');
    assert.equal(await whatsapp.sendMediaMessage(jid, { mediatype: 'image', mimetype: 'image/png', media: 'https://example.invalid/a.png' }), 'probe-sendMedia');
    assert.equal(await whatsapp.sendWhatsAppAudio(jid, 'https://example.invalid/a.ogg'), 'probe-sendWhatsAppAudio');
    assert.equal(await whatsapp.sendContactMessage(jid, { fullName: 'Ana', phoneNumber: '5511999999999' }), 'probe-sendContact');
    assert.equal(await whatsapp.sendListMessage(jid, { description: 'Itens', buttonText: 'Ver', sections: [{ title: 'A', rows: [{ title: 'B', rowId: 'b' }] }] }), 'probe-sendList');
    assert.equal(await whatsapp.sendLocationMessage(jid, { latitude: -23.5, longitude: -46.6 }), 'probe-sendLocation');
    assert.equal(await whatsapp.sendReaction(jid, 'target-1', '👍'), 'probe-sendReaction');
    assert.equal(await whatsapp.sendPollMessage(jid, { name: 'Escolha', values: ['A', 'B'] }), 'probe-sendPoll');
    assert.equal(await whatsapp.sendButtonMessage(jid, '', 'Escolha', '', [{ id: 'a', displayText: 'A' }]), 'probe-sendButtons');
    assert.equal(await whatsapp.sendStickerMessage(jid, 'https://example.invalid/a.webp'), 'probe-sendSticker'); assert.equal(paths.length, 10);
    omitId = true; assert.equal(await whatsapp.sendTextMessage(jid, 'sem id'), null);
  } finally { axios.defaults.adapter = previousAdapter; }
}

// Media persists before enqueue; JSONB has only an immutable reference and cleanup honors grace.
{
  phase = 'media store';
  const objects = new Map<string, Uint8Array>(); const removed: string[] = [];
  const storage: OutboundMediaStorage = { async upload(path, bytes) { objects.set(path, Uint8Array.from(bytes)); }, async download(path) { const bytes = objects.get(path); if (!bytes) throw new Error('missing'); return bytes; }, async transportUrl(path) { return `https://media.example.test/${path}`; }, async remove(path) { objects.delete(path); removed.push(path); } };
  const mediaStore = createOutboundMediaStore(storage);
  await assert.rejects(mediaStore.persistPayload({ empresaId: 'e1', jobId: 'evil', payload: { kind: 'media', attachment: { type: 'image', mimeType: 'image/png', fileName: 'evil.png', dataUrl: 'https://127.0.0.1/private' } } }), /OUTBOUND_MEDIA_SOURCE_NOT_ALLOWED/);
  const persisted = await mediaStore.persistPayload({ empresaId: 'e1', jobId: 'j-media', payload: { kind: 'media', attachment: { type: 'image', mimeType: 'image/png', fileName: 'foto.png', dataUrl: 'data:image/png;base64,aGVsbG8=' } } });
  assert.equal(JSON.stringify(persisted).includes('data:'), false);
  assert.match((persisted as PersistedMediaPayload).storagePath, /^outbound\/e1\/j-media\/[a-f0-9]{64}$/);
  const binding = { empresaId: 'e1', jobId: 'j-media' };
  const materialized = await mediaStore.prepare(persisted as PersistedMediaPayload, binding); assert.equal(Buffer.from(materialized.bytes).toString(), 'hello'); assert.match(materialized.transportUrl, /^https:\/\//);
  await assert.rejects(mediaStore.prepare(persisted as PersistedMediaPayload, { empresaId: 'other', jobId: 'j-media' }), /OUTBOUND_MEDIA_STORAGE_PATH_INVALID/);
  assert.equal(await mediaStore.cleanupTerminal(persisted as PersistedMediaPayload, binding, { terminalAtMs: 1_000, graceMs: 5_000, nowMs: 5_999 }), false);
  assert.equal(await mediaStore.cleanupTerminal(persisted as PersistedMediaPayload, binding, { terminalAtMs: 1_000, graceMs: 5_000, nowMs: 6_000 }), true); assert.equal(removed.length, 1);
}

// Fingerprints normalize text, and 2xx/void/missing ID is delivery_uncertain.
{
  phase = 'fingerprints';
  assert.equal(await fingerprintOutboundPayload({ kind: 'text', text: 'Olá\r\n' }), await fingerprintOutboundPayload({ kind: 'text', text: 'Olá\n' }));
  const preparedRequest = prepareWhatsAppHttpRequest({ kind: 'text', jid: '5511999999999@s.whatsapp.net', instance: 'instance-1', text: '**Olá**' });
  assert.equal(JSON.parse(preparedRequest.body).text, '*Olá*');
  const adapter = createProviderAdapter({ prepareRequest: prepareWhatsAppHttpRequest, sendPrepared: async () => undefined, prepareMedia: async () => ({ bytes: new Uint8Array(), transportUrl: 'https://media.example.test/a', mimeType: 'application/octet-stream' }) });
  assert.deepEqual(await adapter.send(await adapter.prepare(conversationJob({ payloadFingerprint: '' }))), { state: 'delivery_uncertain', reason: 'PROVIDER_MESSAGE_ID_MISSING' });
}

// Migration guardrails freeze the global lock order and lease fencing contract.
{
  phase = 'migration guardrails';
  const sql = readFileSync('supabase/migrations/065_conversation_outbound_claims.sql', 'utf8').replace(/\r\n/g, '\n');
  const claim = sql.slice(sql.indexOf('create or replace function public.claim_zelochat_outbound_job'), sql.indexOf('create or replace function public.begin_zelochat_human_outbound'));
  assert(claim.indexOf('zelochat_conversation_control_lock_gate()') < claim.indexOf('select j.id, j.conversation_control_id'));
  assert(claim.indexOf('from public.zelochat_conversation_ai_control c') < claim.indexOf('for update skip locked'));
  assert.match(claim, /order by j\.next_attempt_at, j\.created_at, j\.id/);
  for (const name of ['begin_zelochat_human_outbound', 'start_zelochat_outbound_transport', 'complete_zelochat_outbound_job', 'fail_zelochat_outbound_job', 'suppress_zelochat_outbound_job']) {
    assert(sql.includes(`create or replace function public.${name}`));
  }
  assert(sql.includes('create or replace function public.enqueue_zelochat_ai_outbound'));
  assert(sql.includes('create or replace function public.claim_zelochat_outbound_media_preparation'));
  assert(sql.includes('create or replace function public.complete_zelochat_outbound_media_preparation'));
  assert(sql.includes('intent_payload_fingerprint'));
  assert(sql.includes('create or replace function public.claim_zelochat_outbound_media_preparation(\n  p_id uuid,\n  p_empresa_id uuid,\n  p_owner text,\n  p_lease_seconds integer default 120\n)'));
  assert(sql.includes('grant execute on function public.claim_zelochat_outbound_media_preparation(uuid, uuid, text, integer) to service_role'));
  assert(sql.includes('grant execute on function public.claim_zelochat_outbound_media_preparation(uuid, uuid, text, text, integer) to service_role'));
  const legacyMediaClaim = sql.slice(sql.indexOf('create or replace function public.claim_zelochat_outbound_media_preparation(\n  p_id uuid,\n  p_empresa_id uuid,\n  p_owner text,\n  p_lease_seconds integer default 120\n)'), sql.indexOf('create or replace function public.claim_zelochat_outbound_media_preparation(\n  p_id uuid,\n  p_empresa_id uuid,\n  p_owner text,\n  p_intent_payload_fingerprint text'));
  assert(legacyMediaClaim.includes('j.intent_payload_fingerprint is null or j.intent_payload_fingerprint = j.payload_fingerprint'));
  assert(legacyMediaClaim.includes("j.payload->>'storagePath' = 'preparing/' || repeat('0', 64)"));
  const aiEnqueue = sql.slice(sql.indexOf('create or replace function public.enqueue_zelochat_ai_outbound'), sql.indexOf('create or replace function public.start_zelochat_outbound_transport'));
  assert(aiEnqueue.includes('where s.empresa_id = p_empresa_id'));
  assert(aiEnqueue.includes('s.remote_jid = p_remote_jid'));
  assert(aiEnqueue.includes('c.id = p_conversation_control_id'));
  assert(aiEnqueue.includes("c.mode = 'ai'"));
  assert(aiEnqueue.includes('c.epoch = p_control_epoch'));
  assert(aiEnqueue.includes('v_existing.conversation_jid = p_remote_jid'));
  assert(aiEnqueue.includes('v_existing.conversation_control_id = p_conversation_control_id'));
  assert(aiEnqueue.includes('v_existing.control_epoch = p_control_epoch'));
  assert(aiEnqueue.includes('v_existing.outbound_origin = p_origin'));
  assert(aiEnqueue.includes('coalesce(v_existing.intent_payload_fingerprint, v_existing.payload_fingerprint) = p_payload_fingerprint'));
  assert(aiEnqueue.includes('for update'));
  assert(aiEnqueue.indexOf('insert into public.zelochat_messages') < aiEnqueue.indexOf('insert into public.zelochat_outbound_jobs'));
  const mediaClaim = sql.slice(sql.indexOf('p_intent_payload_fingerprint text'), sql.indexOf('create or replace function public.complete_zelochat_outbound_media_preparation'));
  assert(mediaClaim.includes('p_intent_payload_fingerprint text'));
  assert(mediaClaim.includes('j.intent_payload_fingerprint = p_intent_payload_fingerprint'));
  assert(mediaClaim.includes('j.intent_payload_fingerprint is null'));
  assert(mediaClaim.includes("j.outbound_origin in ('ai_auto','ai_followup')"));
  assert(mediaClaim.includes("j.payload->>'storagePath' = 'preparing/' || repeat('0', 64)"));
  assert(mediaClaim.includes('coalesce(j.intent_payload_fingerprint, p_intent_payload_fingerprint)'));
  assert(sql.includes("j.lease_owner = p_lease_owner"));
  assert(sql.includes('zelochat_outbound_jobs_payload_no_data_url'));
  assert(sql.includes('zelochat_outbound_jobs_conversation_shape_check'));
  assert(sql.includes('zelochat_outbound_jobs_media_shape_check'));
  const rollingBridge = sql.slice(sql.indexOf('create or replace function public.zelochat_outbound_job_rolling_bridge'), sql.indexOf('alter table public.zelochat_outbound_jobs drop constraint if exists zelochat_outbound_jobs_conversation_shape_check'));
  assert(rollingBridge.includes("new.job_type in ('campaign', 'automation')"));
  assert(!rollingBridge.includes("new.job_type = 'conversation'"));
  assert(rollingBridge.includes("jsonb_build_object('kind', 'text', 'text', coalesce(new.message, ''))"));
  assert(sql.includes("payload->>'storagePath' = 'outbound/' || empresa_id::text || '/' || id::text"));
  assert(sql.includes('create or replace function public.release_zelochat_outbound_hold'));
  const releaseHold = sql.slice(sql.indexOf('create or replace function public.release_zelochat_outbound_hold'), sql.indexOf('create or replace function public.suppress_zelochat_outbound_job'));
  assert(releaseHold.includes("j.status = 'delivery_uncertain'")); assert(releaseHold.includes('order by j.transport_started_at nulls last, j.created_at, j.id'));
  assert(sql.includes("set outbound_status = 'cancelled', outbound_error = null"));
  assert(sql.indexOf('attempts = j.attempts + 1') > sql.indexOf('create or replace function public.start_zelochat_outbound_transport'));
  for (const name of ['start_zelochat_outbound_transport', 'complete_zelochat_outbound_job', 'fail_zelochat_outbound_job', 'suppress_zelochat_outbound_job']) {
    const body = sql.slice(sql.indexOf(`create or replace function public.${name}`));
    assert(body.indexOf('zelochat_conversation_control_lock_gate()') < body.indexOf('update public.zelochat_outbound_jobs'));
    assert(body.indexOf('for update') < body.indexOf('update public.zelochat_outbound_jobs'));
  }
  const mergeSql = readFileSync('supabase/migrations/064_conversation_control_rpcs.sql', 'utf8').replace(/\r\n/g, '\n');
  assert(mergeSql.includes("hold_reason = 'delivery_uncertain', hold_job_id = v_uncertain_hold_job_id"));
  assert(mergeSql.includes('v_winner_hold_job_id'));
  assert(mergeSql.includes("set outbound_status = 'delivery_uncertain', outbound_error = 'Não foi possível confirmar a entrega.'"));
  const start = sql.slice(sql.indexOf('create or replace function public.start_zelochat_outbound_transport'), sql.indexOf('create or replace function public.complete_zelochat_outbound_job'));
  assert(start.includes('v_control.hold_job_id is not null'));
  assert(start.includes("v_control.mode <> 'ai' or v_job.control_epoch is distinct from v_control.epoch"));
  assert(start.includes("set status = 'queued'"));
  assert(start.includes("set outbound_status = 'queued', outbound_error = null"));
  const mediaSource = readFileSync('server/outbound/mediaStore.ts', 'utf8');
  assert(mediaSource.includes(".in('payload->>kind', ['media','audio','sticker'])"));
  const integrationSource = readFileSync('tests/conversationOutboundRpc.integration.test.ts', 'utf8');
  assert(!integrationSource.includes('pg_sleep')); assert(!integrationSource.includes('setTimeout'));
  assert(integrationSource.includes("wait_event_type='Lock'"));
  const workerSource = readFileSync('server/outbound/worker.ts', 'utf8');
  const queueSource = readFileSync('server/outbound/queue.ts', 'utf8');
  assert(!workerSource.includes('row.payload ??'));
  assert(!queueSource.includes('payload: job.payload ??'));
}

console.log('conversationOutboundWorker: ok');
clearTimeout(watchdog);
process.exit(0);
