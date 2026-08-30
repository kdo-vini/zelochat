import assert from 'node:assert/strict';
import type { AiTurnPermit } from '../server/conversationControl.js';
import { createConversationOutboundDispatcher } from '../server/conversationOutbound.js';
import type { OutboundPayload, PersistedOutboundPayload } from '../src/domain/outbound.js';

process.on('uncaughtException', (error) => { console.error(error); process.exit(1); });
process.on('unhandledRejection', (error) => { console.error(error); process.exit(1); });

type JobStatus = 'preparing' | 'queued' | 'sending' | 'dispatch_started' | 'sent' | 'failed_before_dispatch' | 'delivery_uncertain' | 'cancelled';
type StoredJob = {
  id: string;
  messageId: string | null;
  empresaId: string;
  remoteJid: string;
  idempotencyKey: string;
  origin: string;
  conversationControlId?: string;
  controlEpoch?: string;
  status: JobStatus;
  payload: PersistedOutboundPayload;
  payloadFingerprint: string;
  intentPayloadFingerprint?: string;
  providerMessageId?: string | null;
  suppressionReason?: 'paused' | 'stale_epoch' | null;
  takeoverApplied?: boolean;
  preparationOwner?: string | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeRepo {
  readonly calls: string[] = [];
  readonly jobs = new Map<string, StoredJob>();
  readonly mediaPersisted: string[] = [];
  readonly enqueueAiRequests: Array<{ empresaId: string; remoteJid: string; permitRemoteJid: string }> = [];
  beginCount = 0;
  eventCount = 0;
  cancelDebounceCount = 0;
  uploadCount = 0;
  takeoverShouldFail = false;
  nextId = 1;
  private humanMode = false;

  async beginHumanOutbound(params: {
    empresaId: string;
    remoteJid: string;
    actorUserId: string | null;
    idempotencyKey: string;
    payload: PersistedOutboundPayload;
    payloadFingerprint: string;
  }): Promise<StoredJob> {
    this.calls.push('begin-human-outbound');
    if (this.takeoverShouldFail) throw new Error('ACTOR_NOT_IN_TENANT');
    const existing = this.find(params.empresaId, params.idempotencyKey);
    if (existing) return { ...existing, takeoverApplied: false };
    this.beginCount += 1;
    const takeoverApplied = !this.humanMode;
    if (takeoverApplied) {
      this.eventCount += 1;
      this.humanMode = true;
    }
    const job: StoredJob = {
      id: `job-${this.nextId++}`,
      messageId: `message-${this.nextId++}`,
      empresaId: params.empresaId,
      remoteJid: params.remoteJid,
      idempotencyKey: params.idempotencyKey,
      origin: 'human_zelochat',
      status: params.payload.kind === 'media' || params.payload.kind === 'audio' || params.payload.kind === 'sticker' ? 'preparing' : 'queued',
      payload: params.payload,
      payloadFingerprint: params.payloadFingerprint,
      takeoverApplied,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async enqueueAiOutbound(params: {
    empresaId: string;
    remoteJid: string;
    idempotencyKey: string;
    payload: PersistedOutboundPayload;
    payloadFingerprint: string;
    aiPermit: AiTurnPermit;
  }): Promise<StoredJob> {
    this.calls.push('enqueue-ai-outbound');
    this.enqueueAiRequests.push({ empresaId: params.empresaId, remoteJid: params.remoteJid, permitRemoteJid: params.aiPermit.remoteJid });
    const existing = this.find(params.empresaId, params.idempotencyKey);
    if (existing) return existing;
    const job: StoredJob = {
      id: `job-${this.nextId++}`,
      messageId: `message-${this.nextId++}`,
      empresaId: params.empresaId,
      remoteJid: params.remoteJid,
      idempotencyKey: params.idempotencyKey,
      origin: 'ai_auto',
      conversationControlId: params.aiPermit.conversationControlId,
      controlEpoch: params.aiPermit.epoch,
      status: params.payload.kind === 'media' || params.payload.kind === 'audio' || params.payload.kind === 'sticker' ? 'preparing' : 'queued',
      payload: params.payload,
      payloadFingerprint: params.payloadFingerprint,
      intentPayloadFingerprint: params.payloadFingerprint,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async claimMediaPreparation(jobId: string, _empresaId: string, owner: string, intentPayloadFingerprint?: string): Promise<StoredJob | null> {
    this.calls.push('claim-media-preparation');
    const job = this.jobs.get(jobId);
    assert(job);
    if (job.status !== 'preparing') return null;
    if (intentPayloadFingerprint && job.intentPayloadFingerprint && job.intentPayloadFingerprint !== intentPayloadFingerprint) return null;
    if (job.preparationOwner && job.preparationOwner !== owner) return null;
    job.preparationOwner = owner;
    return job;
  }

  async markPrepared(jobId: string, payload: PersistedOutboundPayload, payloadFingerprint: string, _empresaId?: string, owner?: string): Promise<StoredJob | null> {
    this.calls.push('mark-prepared');
    const job = this.jobs.get(jobId);
    assert(job);
    if (job.status !== 'preparing') return null;
    if (job.preparationOwner && job.preparationOwner !== owner) return null;
    job.payload = payload;
    job.payloadFingerprint = payloadFingerprint;
    job.status = 'queued';
    job.preparationOwner = null;
    return job;
  }

  async markFailedBeforeDispatch(jobId: string, _empresaId?: string, _reason?: string, owner?: string): Promise<StoredJob | null> {
    this.calls.push('mark-failed-before-dispatch');
    const job = this.jobs.get(jobId);
    assert(job);
    if (job.status !== 'preparing') return null;
    if (job.preparationOwner && job.preparationOwner !== owner) return null;
    job.status = 'failed_before_dispatch';
    job.preparationOwner = null;
    return job;
  }

  async readJob(jobId: string): Promise<StoredJob | null> {
    if (this.calls[this.calls.length - 1] !== 'wait-terminal') this.calls.push('wait-terminal');
    return this.jobs.get(jobId) ?? null;
  }

  private find(empresaId: string, idempotencyKey: string): StoredJob | undefined {
    return [...this.jobs.values()].find((job) => job.empresaId === empresaId && job.idempotencyKey === idempotencyKey);
  }
}

const textPayload = { kind: 'text', text: 'Olá' } satisfies OutboundPayload;
const aiPermit = (overrides: Partial<AiTurnPermit> = {}): AiTurnPermit => ({
  empresaId: 'e1',
  conversationControlId: 'control-1',
  remoteJid: 'j1',
  epoch: '7',
  triggerMessageId: 'inbound-1',
  ...overrides,
});

function dispatcher(repo: FakeRepo, waitMs = 30) {
  return createConversationOutboundDispatcher({
    sendWaitMs: waitMs,
    beginHumanOutbound: repo.beginHumanOutbound.bind(repo),
    enqueueAiOutbound: repo.enqueueAiOutbound.bind(repo),
    claimMediaPreparation: repo.claimMediaPreparation.bind(repo),
    markPrepared: repo.markPrepared.bind(repo),
    markFailedBeforeDispatch: repo.markFailedBeforeDispatch.bind(repo),
    readJob: repo.readJob.bind(repo),
    cancelPendingReply: async () => { repo.cancelDebounceCount += 1; repo.calls.push('cancel-debounce'); },
    persistMediaPayload: async ({ empresaId, jobId }) => {
      repo.calls.push('upload-media');
      repo.uploadCount += 1;
      repo.mediaPersisted.push(`${empresaId}/${jobId}`);
      return {
        kind: 'media',
        storagePath: `outbound/${empresaId}/${jobId}/${'a'.repeat(64)}`,
        mimeType: 'image/png',
        fileName: 'foto.png',
        sizeBytes: 5,
        checksum: 'a'.repeat(64),
      };
    },
    fingerprintPayload: async (payload) => `${payload.kind}-fingerprint`,
  } as any);
}

{
  const repo = new FakeRepo();
  void dispatcher(repo).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: 'u1',
    origin: 'human_zelochat',
    takeoverPolicy: 'take_over',
    idempotencyKey: 'request-1',
    payload: textPayload,
  });
  await sleep(0);
  assert.deepEqual(repo.calls.slice(0, 3), ['begin-human-outbound', 'cancel-debounce', 'wait-terminal']);
}

{
  const repo = new FakeRepo();
  repo.takeoverShouldFail = true;
  await assert.rejects(dispatcher(repo).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: 'u1',
    origin: 'human_zelochat',
    takeoverPolicy: 'take_over',
    idempotencyKey: 'request-2',
    payload: textPayload,
  }), /Não foi possível preparar a mensagem/);
  assert.deepEqual(repo.calls, ['begin-human-outbound']);
  assert.equal(repo.jobs.size, 0);
}

{
  const repo = new FakeRepo();
  const dispatch = dispatcher(repo);
  const first = dispatch.dispatchConversationOutbound({ empresaId: 'e1', remoteJid: 'j1', actorUserId: 'u1', origin: 'human_zelochat', takeoverPolicy: 'take_over', idempotencyKey: 'same-key', payload: textPayload });
  const second = dispatch.dispatchConversationOutbound({ empresaId: 'e1', remoteJid: 'j1', actorUserId: 'u1', origin: 'human_zelochat', takeoverPolicy: 'take_over', idempotencyKey: 'same-key', payload: textPayload });
  await Promise.all([first, second]);
  assert.equal(repo.jobs.size, 1);
  assert.equal(repo.beginCount, 1);
  assert.equal(repo.eventCount, 1);
  assert.equal(repo.cancelDebounceCount, 1, 'retry idempotente não cancela debounce de novo');
}

{
  const repo = new FakeRepo();
  const resultPromise = dispatcher(repo, 100).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: 'u1',
    origin: 'human_zelochat',
    takeoverPolicy: 'take_over',
    idempotencyKey: 'send-fails',
    payload: textPayload,
  });
  await sleep(0);
  const [job] = repo.jobs.values();
  job.status = 'failed_before_dispatch';
  const result = await resultPromise;
  assert.equal(result.state, 'failed_before_dispatch');
  assert.equal(repo.eventCount, 1, 'falha de envio não desfaz modo humano nem cria novo takeover');
}

{
  for (const status of ['sent', 'failed_before_dispatch', 'delivery_uncertain'] as const) {
    const repo = new FakeRepo();
    const resultPromise = dispatcher(repo, 100).dispatchConversationOutbound({
      empresaId: 'e1',
      remoteJid: 'j1',
      actorUserId: 'u1',
      origin: 'human_zelochat',
      takeoverPolicy: 'take_over',
      idempotencyKey: `terminal-${status}`,
      payload: textPayload,
    });
    await sleep(0);
    const [job] = repo.jobs.values();
    job.status = status;
    job.providerMessageId = status === 'sent' ? 'wa-1' : null;
    const result = await resultPromise;
    assert.equal(result.state, status);
  }
}

{
  const repo = new FakeRepo();
  const result = await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: 'u1',
    origin: 'human_zelochat',
    takeoverPolicy: 'take_over',
    idempotencyKey: 'timeout',
    payload: textPayload,
  });
  assert.equal(result.state, 'queued');
  const [job] = repo.jobs.values();
  job.status = 'sent';
  job.providerMessageId = 'wa-late';
  assert.equal((await repo.readJob(job.id))?.status, 'sent', 'worker/WebSocket pode concluir depois do 202');
}

{
  const repo = new FakeRepo();
  const mediaPayload: OutboundPayload = {
    kind: 'media',
    attachment: { type: 'image', mimeType: 'image/png', fileName: 'foto.png', dataUrl: 'data:image/png;base64,aGVsbG8=' },
    caption: 'Foto',
  };
  const result = await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: 'u1',
    origin: 'human_zelochat',
    takeoverPolicy: 'take_over',
    idempotencyKey: 'media',
    payload: mediaPayload,
  });
  assert.equal(repo.calls.indexOf('begin-human-outbound') < repo.calls.indexOf('upload-media'), true);
  assert.equal(repo.calls.indexOf('upload-media') < repo.calls.indexOf('mark-prepared'), true);
  assert.deepEqual(repo.mediaPersisted, ['e1/job-1']);
  assert.equal([...repo.jobs.values()][0].status, 'queued');
  assert.equal(result.state, 'queued');
}

{
  const repo = new FakeRepo();
  const mediaPayload: OutboundPayload = {
    kind: 'media',
    attachment: { type: 'image', mimeType: 'image/png', fileName: 'foto.png', dataUrl: 'data:image/png;base64,aGVsbG8=' },
    caption: 'Foto',
  };
  const dispatch = dispatcher(repo, 1);
  const first = dispatch.dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: 'u1',
    origin: 'human_zelochat',
    takeoverPolicy: 'take_over',
    idempotencyKey: 'media-concurrent',
    payload: mediaPayload,
  });
  const second = dispatch.dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: 'u1',
    origin: 'human_zelochat',
    takeoverPolicy: 'take_over',
    idempotencyKey: 'media-concurrent',
    payload: mediaPayload,
  });
  await Promise.all([first, second]);
  assert.equal(repo.jobs.size, 1);
  assert.equal(repo.uploadCount, 1, 'somente o dono da preparação faz upload');
  assert.equal([...repo.jobs.values()][0].status, 'queued', 'perdedor não transforma queued válido em failed');
  assert.equal(repo.calls.includes('mark-failed-before-dispatch'), false);
}

{
  const repo = new FakeRepo();
  const result = await dispatcher(repo).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-no-permit',
    payload: textPayload,
  });
  assert.deepEqual(result, { state: 'suppressed', jobId: null, messageId: null, reason: 'stale_epoch' });
  assert.deepEqual(repo.calls, []);
  assert.equal(repo.jobs.size, 0);
}

{
  const repo = new FakeRepo();
  const permit = aiPermit({ remoteJid: 'other-jid' });
  const result = await dispatcher(repo).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-stale-permit',
    payload: textPayload,
    aiPermit: permit,
  });
  assert.deepEqual(result, { state: 'suppressed', jobId: null, messageId: null, reason: 'stale_epoch' });
  assert.deepEqual(repo.calls, []);
  assert.equal(repo.jobs.size, 0);
  assert.equal(repo.enqueueAiRequests.length, 0, 'permit de outro JID não chega ao enqueue atômico');
}

{
  const repo = new FakeRepo();
  const permit = aiPermit();
  const first = await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-same-key',
    payload: textPayload,
    aiPermit: permit,
  });
  const retry = await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-same-key',
    payload: textPayload,
    aiPermit: permit,
  });
  assert.equal(first.state, 'queued');
  assert.deepEqual(retry, first);
  assert.equal(repo.jobs.size, 1);
}

{
  const repo = new FakeRepo();
  await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-divergent-key',
    payload: textPayload,
    aiPermit: aiPermit(),
  });
  const divergent = await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j2',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-divergent-key',
    payload: textPayload,
    aiPermit: aiPermit({ remoteJid: 'j2', conversationControlId: 'control-2' }),
  });
  assert.deepEqual(divergent, { state: 'suppressed', jobId: null, messageId: null, reason: 'stale_epoch' });
  assert.equal(repo.jobs.size, 1);
  assert.equal([...repo.jobs.values()][0].remoteJid, 'j1');
  assert.equal(repo.uploadCount, 0);
}

{
  const repo = new FakeRepo();
  await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-control-key',
    payload: textPayload,
    aiPermit: aiPermit(),
  });
  const divergent = await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-control-key',
    payload: textPayload,
    aiPermit: aiPermit({ conversationControlId: 'control-2' }),
  });
  assert.deepEqual(divergent, { state: 'suppressed', jobId: null, messageId: null, reason: 'stale_epoch' });
  assert.equal(repo.jobs.size, 1);
  assert.equal([...repo.jobs.values()][0].conversationControlId, 'control-1');
  assert.equal(repo.uploadCount, 0);
}

{
  const repo = new FakeRepo();
  await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-epoch-key',
    payload: textPayload,
    aiPermit: aiPermit(),
  });
  const divergent = await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-epoch-key',
    payload: textPayload,
    aiPermit: aiPermit({ epoch: '8' }),
  });
  assert.deepEqual(divergent, { state: 'suppressed', jobId: null, messageId: null, reason: 'stale_epoch' });
  assert.equal(repo.jobs.size, 1);
  assert.equal([...repo.jobs.values()][0].controlEpoch, '7');
}

{
  const repo = new FakeRepo();
  const originalMedia: OutboundPayload = {
    kind: 'media',
    attachment: { type: 'image', mimeType: 'image/png', fileName: 'foto.png', dataUrl: 'data:image/png;base64,b3JpZ2luYWw=' },
    caption: 'Foto A',
  };
  const changedMedia: OutboundPayload = {
    kind: 'media',
    attachment: { type: 'image', mimeType: 'image/png', fileName: 'foto.png', dataUrl: 'data:image/png;base64,b3V0cmE=' },
    caption: 'Foto B',
  };
  await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-media-divergent',
    payload: originalMedia,
    aiPermit: aiPermit(),
  });
  const [job] = repo.jobs.values();
  job.status = 'preparing';
  job.preparationOwner = null;
  repo.uploadCount = 0;
  repo.mediaPersisted.length = 0;
  const divergent = await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-media-divergent',
    payload: changedMedia,
    aiPermit: aiPermit(),
  });
  assert.deepEqual(divergent, { state: 'suppressed', jobId: null, messageId: null, reason: 'stale_epoch' });
  assert.equal(repo.uploadCount, 0, 'payload divergente não prepara nem chama upload/provider');
  assert.equal(job.status, 'preparing');
  assert.equal(job.preparationOwner, null);
}

{
  const repo = new FakeRepo();
  const permit = aiPermit();
  const mediaPayload: OutboundPayload = {
    kind: 'media',
    attachment: { type: 'image', mimeType: 'image/png', fileName: 'foto.png', dataUrl: 'data:image/png;base64,aGVsbG8=' },
    caption: 'Foto da IA',
  };
  const result = await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-media',
    payload: mediaPayload,
    aiPermit: permit,
  });
  assert.equal(result.state, 'queued');
  assert.deepEqual(repo.mediaPersisted, ['e1/job-1']);
  assert.equal([...repo.jobs.values()][0].status, 'queued');
}

console.log('conversationOutbound: ok');
process.exit(0);
