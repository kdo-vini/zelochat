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
  status: JobStatus;
  payload: PersistedOutboundPayload;
  payloadFingerprint: string;
  providerMessageId?: string | null;
  suppressionReason?: 'paused' | 'stale_epoch' | null;
  takeoverApplied?: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeRepo {
  readonly calls: string[] = [];
  readonly jobs = new Map<string, StoredJob>();
  readonly mediaPersisted: string[] = [];
  beginCount = 0;
  eventCount = 0;
  takeoverShouldFail = false;
  aiPermitCurrent = true;
  nextId = 1;

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
    if (existing) return existing;
    this.beginCount += 1;
    this.eventCount += 1;
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
      takeoverApplied: true,
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
  }): Promise<StoredJob> {
    this.calls.push('enqueue-ai-outbound');
    const existing = this.find(params.empresaId, params.idempotencyKey);
    if (existing) return existing;
    const job: StoredJob = {
      id: `job-${this.nextId++}`,
      messageId: `message-${this.nextId++}`,
      empresaId: params.empresaId,
      remoteJid: params.remoteJid,
      idempotencyKey: params.idempotencyKey,
      origin: 'ai_auto',
      status: 'queued',
      payload: params.payload,
      payloadFingerprint: params.payloadFingerprint,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async markPrepared(jobId: string, payload: PersistedOutboundPayload, payloadFingerprint: string): Promise<StoredJob> {
    this.calls.push('mark-prepared');
    const job = this.jobs.get(jobId);
    assert(job);
    job.payload = payload;
    job.payloadFingerprint = payloadFingerprint;
    job.status = 'queued';
    return job;
  }

  async markFailedBeforeDispatch(jobId: string): Promise<StoredJob> {
    this.calls.push('mark-failed-before-dispatch');
    const job = this.jobs.get(jobId);
    assert(job);
    job.status = 'failed_before_dispatch';
    return job;
  }

  async isAiPermitCurrent(_permit: AiTurnPermit): Promise<boolean> {
    this.calls.push('check-ai-permit');
    return this.aiPermitCurrent;
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

function dispatcher(repo: FakeRepo, waitMs = 30) {
  return createConversationOutboundDispatcher({
    sendWaitMs: waitMs,
    beginHumanOutbound: repo.beginHumanOutbound.bind(repo),
    enqueueAiOutbound: repo.enqueueAiOutbound.bind(repo),
    markPrepared: repo.markPrepared.bind(repo),
    markFailedBeforeDispatch: repo.markFailedBeforeDispatch.bind(repo),
    readJob: repo.readJob.bind(repo),
    isAiPermitCurrent: repo.isAiPermitCurrent.bind(repo),
    cancelPendingReply: async () => { repo.calls.push('cancel-debounce'); },
    persistMediaPayload: async ({ empresaId, jobId }) => {
      repo.calls.push('upload-media');
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
  });
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
  repo.aiPermitCurrent = false;
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
  repo.aiPermitCurrent = false;
  const permit: AiTurnPermit = {
    empresaId: 'e1',
    conversationControlId: 'control-1',
    remoteJid: 'j1',
    epoch: '7',
    triggerMessageId: 'inbound-1',
  };
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
  assert.deepEqual(repo.calls, ['check-ai-permit']);
  assert.equal(repo.jobs.size, 0);
}

console.log('conversationOutbound: ok');
process.exit(0);
