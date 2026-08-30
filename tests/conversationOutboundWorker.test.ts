import assert from 'node:assert/strict';
import axios from 'axios';
import { readFileSync } from 'node:fs';
import type { PersistedOutboundPayload } from '../src/domain/outbound.js';
import { OutboundQueue, type OutboundJob, type OutboundJobInput, type OutboundJobStore } from '../server/outbound/queue.js';
import { OutboundWorker } from '../server/outbound/worker.js';
import { createProviderAdapter, fingerprintOutboundPayload, type ProviderDispatchResult } from '../server/outbound/providerAdapter.js';
import { createOutboundMediaStore, type OutboundMediaStorage } from '../server/outbound/mediaStore.js';

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
});

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
      row.status = 'sending'; row.leaseOwner = workerId; row.leaseExpiresAt = new Date(this.now + leaseMs).toISOString(); row.attempts += 1;
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
    row.status = 'dispatch_started'; this.observeActive(row.conversationControlId); return true;
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
  async dispatch(job: OutboundJob): Promise<ProviderDispatchResult> {
    this.calls.push(`${job.empresaId}:${job.id}`); await this.blockers.get(job.id); return { state: 'sent', providerMessageId: `provider-${job.id}` };
  }
}

function worker(store: SharedLeaseStore, transport: RecordingTransport): OutboundWorker {
  return new OutboundWorker({ queue: new OutboundQueue(store), transport, getStatus: async () => 'connected', getRolloutFlags: async () => ({ crm: true, campaigns: true, automations: true }), validate: async () => ({ action: 'send' }) });
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

// Probe each real helper: the provider's key.id response is returned, never synthesized.
{
  phase = 'provider probes';
  process.env.WHATSMIAU_INSTANCE = 'probe-instance'; const whatsapp = await import('../server/whatsapp.js'); const previousAdapter = axios.defaults.adapter; const paths: string[] = [];
  axios.defaults.adapter = async (config) => { const url = String(config.url); paths.push(url); const endpoint = url.split('/message/')[1]?.split('/')[0] ?? 'unknown'; return { data: { key: { id: `probe-${endpoint}` } }, status: 200, statusText: 'OK', headers: {}, config }; };
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
  } finally { axios.defaults.adapter = previousAdapter; }
}

// Media persists before enqueue; JSONB has only an immutable reference and cleanup honors grace.
{
  phase = 'media store';
  const objects = new Map<string, Uint8Array>(); const removed: string[] = [];
  const storage: OutboundMediaStorage = { async upload(path, bytes) { objects.set(path, Uint8Array.from(bytes)); }, async download(path) { const bytes = objects.get(path); if (!bytes) throw new Error('missing'); return bytes; }, async remove(path) { objects.delete(path); removed.push(path); } };
  const mediaStore = createOutboundMediaStore(storage);
  const persisted = await mediaStore.persistPayload({ empresaId: 'e1', jobId: 'j-media', payload: { kind: 'media', attachment: { type: 'image', mimeType: 'image/png', fileName: 'foto.png', dataUrl: 'data:image/png;base64,aGVsbG8=' } } });
  assert.equal(JSON.stringify(persisted).includes('data:'), false);
  assert.match((persisted as PersistedMediaPayload).storagePath, /^outbound\/e1\/j-media\/[a-f0-9]{64}$/);
  const materialized = await mediaStore.materialize(persisted as PersistedMediaPayload); assert.equal(Buffer.from(materialized.bytes).toString(), 'hello');
  assert.equal(await mediaStore.cleanupTerminal(persisted as PersistedMediaPayload, { terminalAtMs: 1_000, graceMs: 5_000, nowMs: 5_999 }), false);
  assert.equal(await mediaStore.cleanupTerminal(persisted as PersistedMediaPayload, { terminalAtMs: 1_000, graceMs: 5_000, nowMs: 6_000 }), true); assert.equal(removed.length, 1);
}

// Fingerprints normalize text, and 2xx/void/missing ID is delivery_uncertain.
{
  phase = 'fingerprints';
  assert.equal(await fingerprintOutboundPayload({ kind: 'text', text: 'Olá\r\n' }), await fingerprintOutboundPayload({ kind: 'text', text: 'Olá\n' }));
  const adapter = createProviderAdapter({ text: async () => undefined, media: async () => undefined, audio: async () => undefined, sticker: async () => undefined, buttons: async () => undefined, contact: async () => undefined, list: async () => undefined, location: async () => undefined, reaction: async () => undefined, poll: async () => undefined, materializeMedia: async () => ({ bytes: new Uint8Array(), dataUrl: 'data:application/octet-stream;base64,', mimeType: 'application/octet-stream' }) });
  assert.deepEqual(await adapter.dispatch(conversationJob()), { state: 'delivery_uncertain', reason: 'PROVIDER_MESSAGE_ID_MISSING' });
}

// Migration guardrails freeze the rollout lock order and lease fencing contract.
{
  phase = 'migration guardrails';
  const sql = readFileSync('supabase/migrations/065_conversation_outbound_claims.sql', 'utf8');
  const claim = sql.slice(sql.indexOf('create or replace function public.claim_zelochat_outbound_job'), sql.indexOf('create or replace function public.begin_zelochat_human_outbound'));
  assert(claim.indexOf('zelochat_conversation_control_rollout_gate()') < claim.indexOf('select j.id, j.conversation_control_id'));
  assert(claim.indexOf('from public.zelochat_conversation_ai_control c') < claim.indexOf('for update skip locked'));
  assert.match(claim, /order by j\.next_attempt_at, j\.created_at, j\.id/);
  for (const name of ['begin_zelochat_human_outbound', 'start_zelochat_outbound_transport', 'complete_zelochat_outbound_job', 'fail_zelochat_outbound_job', 'suppress_zelochat_outbound_job']) {
    assert(sql.includes(`create or replace function public.${name}`));
  }
  assert(sql.includes("j.lease_owner = p_lease_owner"));
  assert(sql.includes('zelochat_outbound_jobs_payload_no_data_url'));
}

console.log('conversationOutboundWorker: ok');
clearTimeout(watchdog);
process.exit(0);
