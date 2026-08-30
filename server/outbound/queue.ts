import type { OutboundOrigin, OutboundPayload, OutboundState, PersistedOutboundPayload } from '../../src/domain/outbound.js';
import { nextRetryAt } from './policy.js';

/** `failed` remains readable while old replicas drain; new writers never emit it. */
export type OutboundStatus = OutboundState | 'failed';

interface OutboundJobInputBase {
  id?: string;
  empresaId: string;
  instanceKey: string;
  recipientId?: string;
  automationDispatchId?: string;
  campaignId?: string;
  idempotencyKey: string;
  phone?: string | null;
  text: string;
  conversationControlId?: string;
  conversationJid?: string;
  messageId?: string;
  origin?: OutboundOrigin;
  payload?: OutboundPayload | PersistedOutboundPayload;
  payloadFingerprint?: string;
  controlEpoch?: string;
}
export type OutboundJobInput =
  | (OutboundJobInputBase & { jobType: 'conversation'; conversationControlId: string; conversationJid: string; origin: 'ai_auto' | 'ai_followup'; payload: PersistedOutboundPayload; payloadFingerprint: string; controlEpoch: string })
  | (OutboundJobInputBase & { jobType: 'conversation'; conversationControlId: string; conversationJid: string; origin: Exclude<OutboundOrigin, 'campaign' | 'automation' | 'ai_auto' | 'ai_followup'>; payload: PersistedOutboundPayload; payloadFingerprint: string; controlEpoch?: string })
  | (OutboundJobInputBase & { jobType?: 'campaign'; origin?: 'campaign' | 'internal_system' })
  | (OutboundJobInputBase & { jobType: 'automation'; origin?: 'automation' | 'internal_system' });

interface StoredOutboundJobBase {
  id: string;
  empresaId: string;
  instanceKey: string;
  recipientId?: string;
  automationDispatchId?: string;
  campaignId?: string;
  jobType: 'conversation' | 'campaign' | 'automation';
  idempotencyKey: string;
  phone?: string | null;
  text: string;
  conversationControlId?: string;
  conversationJid?: string;
  messageId?: string;
  origin: OutboundOrigin;
  payload: OutboundPayload | PersistedOutboundPayload;
  payloadFingerprint: string;
  controlEpoch?: string;
  status: OutboundStatus;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
  attempts: number;
  suppressionReason?: string | null;
}

type ConversationJobBase = StoredOutboundJobBase & {
  jobType: 'conversation';
  conversationControlId: string;
  conversationJid: string;
  origin: Exclude<OutboundOrigin, 'campaign' | 'automation'>;
  payloadFingerprint: string;
  payload: PersistedOutboundPayload;
};
export type ConversationOutboundJob =
  | (ConversationJobBase & { origin: 'ai_auto' | 'ai_followup'; controlEpoch: string })
  | (ConversationJobBase & { origin: Exclude<ConversationJobBase['origin'], 'ai_auto' | 'ai_followup'>; controlEpoch?: string });
export type CampaignOutboundJob = StoredOutboundJobBase & { jobType: 'campaign'; origin: 'campaign' | 'internal_system'; campaignId?: string };
export type AutomationOutboundJob = StoredOutboundJobBase & { jobType: 'automation'; origin: 'automation' | 'internal_system'; automationDispatchId?: string };
export type OutboundJob = ConversationOutboundJob | CampaignOutboundJob | AutomationOutboundJob;

type LegacyStoredJob = Omit<OutboundJob, 'jobType' | 'origin' | 'payload' | 'payloadFingerprint'>
  & Partial<Pick<OutboundJob, 'jobType' | 'origin' | 'payload' | 'payloadFingerprint'>>;

export interface OutboundJobStore {
  insert(job: OutboundJobInput): Promise<OutboundJob | LegacyStoredJob>;
  claim(workerId: string, leaseMs: number): Promise<OutboundJob | LegacyStoredJob | null>;
  startTransport?(id: string, empresaId: string, leaseOwner: string): Promise<boolean>;
  markSent(id: string, messageId: string, empresaId?: string, leaseOwner?: string): Promise<boolean | void>;
  markDeliveryUncertain?(id: string, reason: string, empresaId: string, leaseOwner: string): Promise<boolean>;
  markFailed(id: string, reason: string, retryAt: Date | null, empresaId?: string, leaseOwner?: string): Promise<boolean | void>;
  releaseExpired(): Promise<void>;
  defer?(id: string, reason: string, retryAt?: Date, empresaId?: string, leaseOwner?: string): Promise<boolean | void>;
  markSuppressed?(id: string, reason: string, empresaId?: string, leaseOwner?: string): Promise<boolean | void>;
}

const succeeded = (result: boolean | void): boolean => result !== false;
const mediaKeys = new Set(['kind','storagePath','mimeType','fileName','sizeBytes','checksum','caption','ptt','quoted']);
export function assertQueueablePayload(payload: OutboundPayload | PersistedOutboundPayload): void {
  const record = payload as unknown as Record<string, unknown>;
  if (['media','audio','sticker'].includes(String(record.kind)) && (
    typeof record.storagePath !== 'string' || typeof record.mimeType !== 'string' || typeof record.fileName !== 'string'
    || typeof record.sizeBytes !== 'number' || typeof record.checksum !== 'string'
    || Object.keys(record).some((key) => !mediaKeys.has(key))
    || (record.kind === 'audio' && typeof record.ptt !== 'boolean')
    || (record.kind !== 'audio' && 'ptt' in record)
    || (record.kind !== 'media' && 'caption' in record)
    || ('caption' in record && typeof record.caption !== 'string')
  )) throw new Error('OUTBOUND_MEDIA_NOT_QUEUEABLE');
}
export function assertOutboundJobShape(job: OutboundJob): void {
  if (job.jobType === 'conversation') {
    if (!job.conversationControlId || !job.conversationJid || !job.origin || !job.payloadFingerprint) throw new Error('OUTBOUND_CONVERSATION_SHAPE_INVALID');
    if (['campaign','automation'].includes(job.origin as string)) throw new Error('OUTBOUND_CONVERSATION_ORIGIN_INVALID');
    if ((job.origin === 'ai_auto' || job.origin === 'ai_followup') && !job.controlEpoch) throw new Error('OUTBOUND_CONVERSATION_EPOCH_REQUIRED');
    const payload = job.payload as unknown as Record<string, unknown>;
    if (['media','audio','sticker'].includes(String(payload.kind)) && ('attachment' in payload || 'dataUrl' in payload)) throw new Error('OUTBOUND_CONVERSATION_PAYLOAD_NOT_PERSISTED');
  }
  if (job.jobType === 'campaign' && !['campaign','internal_system'].includes(job.origin)) throw new Error('OUTBOUND_CAMPAIGN_ORIGIN_INVALID');
  if (job.jobType === 'automation' && !['automation','internal_system'].includes(job.origin)) throw new Error('OUTBOUND_AUTOMATION_ORIGIN_INVALID');
  assertQueueablePayload(job.payload);
}
const normalizeJob = (job: OutboundJob | LegacyStoredJob): OutboundJob => {
  const jobType = job.jobType ?? 'campaign';
  const normalized = {
    ...job,
    jobType,
    origin: job.origin ?? (jobType === 'automation' ? 'automation' : 'campaign'),
    payload: job.payload ?? { kind: 'text', text: job.text },
    payloadFingerprint: job.payloadFingerprint ?? '',
  } as OutboundJob;
  assertOutboundJobShape(normalized);
  return normalized;
};

export class OutboundQueue {
  private readonly seen = new Map<string, OutboundJob>();
  constructor(private readonly store: OutboundJobStore, private readonly maxAttempts = 3) {}

  async enqueue(input: OutboundJobInput): Promise<OutboundJob> {
    const dedupeKey = `${input.empresaId}:${input.idempotencyKey}`;
    const existing = this.seen.get(dedupeKey);
    if (existing) return existing;
    const job = normalizeJob(await this.store.insert({ ...input, text: input.text.trim() }));
    this.seen.set(dedupeKey, job);
    return job;
  }

  async claim(workerId: string, leaseMs = 120_000): Promise<OutboundJob | null> {
    const job = await this.store.claim(workerId, leaseMs);
    return job ? normalizeJob(job) : null;
  }

  async startTransport(job: OutboundJob): Promise<boolean> {
    if (!job.leaseOwner) return false;
    if (!this.store.startTransport) return true; // rolling compatibility for old/test stores
    return this.store.startTransport(job.id, job.empresaId, job.leaseOwner);
  }

  async complete(job: OutboundJob, messageId: string): Promise<boolean> {
    if (!messageId.trim()) throw new Error('A mensagem precisa ter um identificador de envio.');
    if (!job.leaseOwner) return false;
    return succeeded(await this.store.markSent(job.id, messageId, job.empresaId, job.leaseOwner));
  }

  async deliveryUncertain(job: OutboundJob, reason: string): Promise<boolean> {
    if (!job.leaseOwner || !this.store.markDeliveryUncertain) return false;
    return this.store.markDeliveryUncertain(job.id, reason, job.empresaId, job.leaseOwner);
  }

  async fail(job: OutboundJob, reason: string): Promise<boolean> {
    if (!job.leaseOwner) return false;
    if (job.status === 'dispatch_started') return this.deliveryUncertain(job, reason);
    const retryAt = job.attempts >= this.maxAttempts ? null : nextRetryAt(job.attempts, new Date());
    return succeeded(await this.store.markFailed(job.id, reason, retryAt, job.empresaId, job.leaseOwner));
  }

  async failBeforeDispatch(job: OutboundJob, reason: string): Promise<boolean> {
    if (!job.leaseOwner) return false;
    return succeeded(await this.store.markFailed(job.id, reason, null, job.empresaId, job.leaseOwner));
  }

  async defer(job: OutboundJob, reason: string, retryAt = new Date(Date.now() + 60_000)): Promise<boolean> {
    if (!job.leaseOwner) return false;
    if (this.store.defer) return succeeded(await this.store.defer(job.id, reason, retryAt, job.empresaId, job.leaseOwner));
    return succeeded(await this.store.markFailed(job.id, reason, retryAt, job.empresaId, job.leaseOwner));
  }

  async suppress(job: OutboundJob, reason: string): Promise<boolean> {
    if (!job.leaseOwner) return false;
    if (this.store.markSuppressed) return succeeded(await this.store.markSuppressed(job.id, reason, job.empresaId, job.leaseOwner));
    return succeeded(await this.store.markFailed(job.id, reason, null, job.empresaId, job.leaseOwner));
  }

  releaseExpired(): Promise<void> { return this.store.releaseExpired(); }
}
