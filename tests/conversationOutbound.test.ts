import { createHash } from 'node:crypto';
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
  intentPayloadFingerprint?: string | null;
  providerMessageId?: string | null;
  suppressionReason?: 'paused' | 'stale_epoch' | null;
  takeoverApplied?: boolean;
  preparationOwner?: string | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ZERO_CHECKSUM = '0'.repeat(64);

class FakeRepo {
  readonly calls: string[] = [];
  readonly jobs = new Map<string, StoredJob>();
  readonly mediaPersisted: string[] = [];
  readonly enqueueAiRequests: Array<{ empresaId: string; remoteJid: string; permitRemoteJid: string }> = [];
  readonly enqueueSystemRequests: Array<{ origin: string; remoteJid: string }> = [];
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
      intentPayloadFingerprint: params.payloadFingerprint,
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

  async enqueueSystemOutbound(params: {
    empresaId: string;
    remoteJid: string;
    idempotencyKey: string;
    origin: 'system_handoff' | 'system_transactional' | 'internal_system';
    payload: PersistedOutboundPayload;
    payloadFingerprint: string;
  }): Promise<StoredJob> {
    this.calls.push('enqueue-system-outbound');
    this.enqueueSystemRequests.push({ origin: params.origin, remoteJid: params.remoteJid });
    const existing = this.find(params.empresaId, params.idempotencyKey);
    if (existing) return existing;
    const job: StoredJob = {
      id: `job-${this.nextId++}`,
      messageId: params.origin === 'internal_system' ? null : `message-${this.nextId++}`,
      empresaId: params.empresaId,
      remoteJid: params.remoteJid,
      idempotencyKey: params.idempotencyKey,
      origin: params.origin,
      conversationControlId: params.origin === 'internal_system' ? undefined : 'control-1',
      status: 'queued',
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
    if (intentPayloadFingerprint && !job.intentPayloadFingerprint) job.intentPayloadFingerprint = intentPayloadFingerprint;
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
function legacyMediaFingerprint(payload: Extract<OutboundPayload, { kind: 'media' | 'audio' | 'sticker' }>): string {
  return createHash('sha256').update(JSON.stringify({
    kind: payload.kind,
    fileName: payload.attachment.fileName,
    mimeType: payload.attachment.mimeType,
  })).digest('hex');
}

function legacyPreparingMediaPayload(payload: Extract<OutboundPayload, { kind: 'media' | 'audio' | 'sticker' }>): PersistedOutboundPayload {
  return {
    kind: payload.kind,
    storagePath: `preparing/${ZERO_CHECKSUM}`,
    mimeType: payload.attachment.mimeType,
    fileName: payload.attachment.fileName,
    sizeBytes: 1,
    checksum: ZERO_CHECKSUM,
    ...(payload.kind === 'audio' ? { ptt: payload.ptt } : {}),
    ...(payload.kind === 'media' && payload.caption ? { caption: payload.caption } : {}),
    ...('quoted' in payload && payload.quoted ? { quoted: payload.quoted } : {}),
  } as PersistedOutboundPayload;
}

function addPreR2AiMediaJob(repo: FakeRepo, payload: Extract<OutboundPayload, { kind: 'media' | 'audio' | 'sticker' }>): StoredJob {
  const job: StoredJob = {
    id: 'job-pre-r2',
    messageId: 'message-pre-r2',
    empresaId: 'e1',
    remoteJid: 'j1',
    idempotencyKey: 'ai-media-pre-r2',
    origin: 'ai_auto',
    conversationControlId: 'control-1',
    controlEpoch: '7',
    status: 'preparing',
    payload: legacyPreparingMediaPayload(payload),
    payloadFingerprint: legacyMediaFingerprint(payload),
    intentPayloadFingerprint: null,
    preparationOwner: null,
  };
  repo.jobs.set(job.id, job);
  return job;
}

function addPreR2HumanMediaJob(repo: FakeRepo, payload: Extract<OutboundPayload, { kind: 'media' | 'audio' | 'sticker' }>): StoredJob {
  const job: StoredJob = {
    id: 'job-human-pre-r2',
    messageId: 'message-human-pre-r2',
    empresaId: 'e1',
    remoteJid: 'j1',
    idempotencyKey: 'human-media-pre-r2',
    origin: 'human_zelochat',
    conversationControlId: 'control-1',
    controlEpoch: '7',
    status: 'preparing',
    payload: legacyPreparingMediaPayload(payload),
    payloadFingerprint: legacyMediaFingerprint(payload),
    intentPayloadFingerprint: null,
    preparationOwner: null,
  };
  repo.jobs.set(job.id, job);
  return job;
}

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
    enqueueSystemOutbound: repo.enqueueSystemOutbound.bind(repo),
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
    broadcastMessageIntent: async () => undefined,
  } as any);
}

{
  const repo = new FakeRepo();
  const result = await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1', remoteJid: 'j1', actorUserId: null,
    origin: 'system_handoff', takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'handoff-1', payload: textPayload,
  });
  assert.equal(result.state, 'queued');
  assert.deepEqual(repo.enqueueSystemRequests, [{ origin: 'system_handoff', remoteJid: 'j1' }]);
}

{
  const repo = new FakeRepo();
  const result = await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1', remoteJid: '5511999999999@s.whatsapp.net', actorUserId: null,
    origin: 'internal_system', takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'manager-1', payload: textPayload,
  });
  assert.equal(result.state, 'queued');
  assert.equal([...repo.jobs.values()][0].messageId, null, 'notificação interna não cria bolha na conversa do cliente');
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

for (const retryKind of ['exact', 'divergent'] as const) {
  const repo = new FakeRepo();
  const originalMedia: Extract<OutboundPayload, { kind: 'media' }> = {
    kind: 'media',
    attachment: { type: 'image', mimeType: 'image/png', fileName: 'foto.png', dataUrl: 'data:image/png;base64,b3JpZ2luYWw=' },
    caption: 'Foto legada',
  };
  const retryMedia: Extract<OutboundPayload, { kind: 'media' }> = retryKind === 'exact'
    ? originalMedia
    : {
        kind: 'media',
        attachment: { type: 'image', mimeType: 'image/png', fileName: 'foto.png', dataUrl: 'data:image/png;base64,b3V0cmE=' },
        caption: 'Foto divergente',
      };
  const job = addPreR2HumanMediaJob(repo, originalMedia);
  const originalJob = structuredClone(job);

  const result = await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: 'u1',
    origin: 'human_zelochat',
    takeoverPolicy: 'take_over',
    idempotencyKey: 'human-media-pre-r2',
    payload: retryMedia,
  });

  assert.equal(result.state, 'failed_before_dispatch');
  assert.match(result.friendlyMessage, /envie.*novamente/i);
  assert.equal(repo.calls.includes('claim-media-preparation'), false, `${retryKind}: dispatcher novo não toma ownership`);
  assert.equal(repo.uploadCount, 0, `${retryKind}: retry sem prova forte não chama upload/provider`);
  assert.equal(repo.calls.includes('mark-prepared'), false, `${retryKind}: retry não sobrescreve payload`);
  assert.deepEqual(job, originalJob, `${retryKind}: job humano pre-R2 permanece inalterado`);
}

{
  const repo = new FakeRepo();
  const mediaPayload: Extract<OutboundPayload, { kind: 'media' }> = {
    kind: 'media',
    attachment: { type: 'image', mimeType: 'image/png', fileName: 'foto.png', dataUrl: 'data:image/png;base64,bm92YQ==' },
    caption: 'Foto nova',
  };
  const dispatch = dispatcher(repo, 1);
  const first = await dispatch.dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: 'u1',
    origin: 'human_zelochat',
    takeoverPolicy: 'take_over',
    idempotencyKey: 'human-media-strong',
    payload: mediaPayload,
  });
  const retry = await dispatch.dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: 'u1',
    origin: 'human_zelochat',
    takeoverPolicy: 'take_over',
    idempotencyKey: 'human-media-strong',
    payload: mediaPayload,
  });

  assert.equal(first.state, 'queued');
  assert.deepEqual(retry, first, 'job novo com fingerprint forte reutiliza a mesma intenção');
  assert.equal(repo.jobs.size, 1);
  assert.equal(repo.uploadCount, 1, 'retry forte não repete upload');
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
  const intents: Array<{ empresaId: string; remoteJid: string; messageId: string | null }> = [];
  const dispatch = createConversationOutboundDispatcher({
    sendWaitMs: 1,
    beginHumanOutbound: repo.beginHumanOutbound.bind(repo),
    enqueueAiOutbound: repo.enqueueAiOutbound.bind(repo),
    enqueueSystemOutbound: repo.enqueueSystemOutbound.bind(repo),
    claimMediaPreparation: repo.claimMediaPreparation.bind(repo),
    markPrepared: repo.markPrepared.bind(repo),
    markFailedBeforeDispatch: repo.markFailedBeforeDispatch.bind(repo),
    readJob: repo.readJob.bind(repo),
    cancelPendingReply: async () => undefined,
    fingerprintPayload: async (payload) => `${payload.kind}-fingerprint`,
    broadcastMessageIntent: async (job) => {
      intents.push({ empresaId: job.empresaId, remoteJid: job.remoteJid, messageId: job.messageId });
    },
  });
  const first = await dispatch.dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-same-key',
    payload: textPayload,
    aiPermit: permit,
  });
  const retry = await dispatch.dispatchConversationOutbound({
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
  assert.deepEqual(intents, [
    { empresaId: 'e1', remoteJid: 'j1', messageId: [...repo.jobs.values()][0].messageId },
    { empresaId: 'e1', remoteJid: 'j1', messageId: [...repo.jobs.values()][0].messageId },
  ], 'a resposta automática persistida precisa gerar um evento de nova mensagem para a conversa aberta; a tela deduplica tentativas idempotentes pelo ID da mensagem');
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
  const mediaPayload: Extract<OutboundPayload, { kind: 'media' }> = {
    kind: 'media',
    attachment: { type: 'image', mimeType: 'image/png', fileName: 'foto.png', dataUrl: 'data:image/png;base64,b3JpZ2luYWw=' },
    caption: 'Foto legada',
  };
  const job = addPreR2AiMediaJob(repo, mediaPayload);
  const result = await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-media-pre-r2',
    payload: mediaPayload,
    aiPermit: aiPermit(),
  });
  assert.equal(result.state, 'queued', 'retry exato de mídia pre-R2 não deve ser suprimido');
  assert.equal(repo.uploadCount, 1);
  assert.equal(job.status, 'queued');
  assert.notEqual(job.intentPayloadFingerprint, null, 'claim novo adota fingerprint de intenção uma vez');
}

{
  const repo = new FakeRepo();
  const mediaPayload: Extract<OutboundPayload, { kind: 'media' }> = {
    kind: 'media',
    attachment: { type: 'image', mimeType: 'image/png', fileName: 'foto.png', dataUrl: 'data:image/png;base64,b3JpZ2luYWw=' },
    caption: 'Foto legada',
  };
  const job = addPreR2AiMediaJob(repo, mediaPayload);
  const dispatch = dispatcher(repo, 1);
  const first = dispatch.dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-media-pre-r2',
    payload: mediaPayload,
    aiPermit: aiPermit(),
  });
  const second = dispatch.dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-media-pre-r2',
    payload: mediaPayload,
    aiPermit: aiPermit(),
  });
  await Promise.all([first, second]);
  assert.equal(repo.uploadCount, 1, 'adoção concorrente não duplica upload/preparação');
  assert.equal(job.status, 'queued');
  assert.notEqual(job.intentPayloadFingerprint, null);
}

{
  const repo = new FakeRepo();
  const originalMedia: Extract<OutboundPayload, { kind: 'media' }> = {
    kind: 'media',
    attachment: { type: 'image', mimeType: 'image/png', fileName: 'foto.png', dataUrl: 'data:image/png;base64,b3JpZ2luYWw=' },
    caption: 'Foto legada',
  };
  const changedMedia: Extract<OutboundPayload, { kind: 'media' }> = {
    kind: 'media',
    attachment: { type: 'image', mimeType: 'image/png', fileName: 'foto.png', dataUrl: 'data:image/png;base64,b3V0cmE=' },
    caption: 'Foto divergente',
  };
  const job = addPreR2AiMediaJob(repo, originalMedia);
  const divergent = await dispatcher(repo, 1).dispatchConversationOutbound({
    empresaId: 'e1',
    remoteJid: 'j1',
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: 'ai-media-pre-r2',
    payload: changedMedia,
    aiPermit: aiPermit(),
  });
  assert.deepEqual(divergent, { state: 'suppressed', jobId: null, messageId: null, reason: 'stale_epoch' });
  assert.equal(repo.uploadCount, 0);
  assert.equal(job.status, 'preparing');
  assert.equal(job.intentPayloadFingerprint, null);
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
