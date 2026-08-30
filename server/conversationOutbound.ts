import { createHash, randomUUID } from 'node:crypto';
import type { AiTurnPermit } from './conversationControl.js';
import { getServiceSupabase } from './supabase.js';
import { cancelPendingReply } from './replyDebouncer.js';
import {
  createOutboundMediaStore,
  type OutboundMediaStore,
} from './outbound/mediaStore.js';
import {
  fingerprintOutboundPayload,
} from './outbound/providerAdapter.js';
import {
  validateOutboundPayload,
  type OutboundOrigin,
  type OutboundPayload,
  type PersistedOutboundPayload,
  type TakeoverPolicy,
} from '../src/domain/outbound.js';

const parsedConversationSendWaitMs = Number.parseInt(process.env.CONVERSATION_SEND_WAIT_MS || '10000', 10);
export const CONVERSATION_SEND_WAIT_MS = Number.isFinite(parsedConversationSendWaitMs) && parsedConversationSendWaitMs >= 0
  ? parsedConversationSendWaitMs
  : 10_000;

type TerminalState = 'sent' | 'failed_before_dispatch' | 'delivery_uncertain' | 'cancelled';
type JobState = 'preparing' | 'queued' | 'sending' | 'dispatch_started' | TerminalState;

export interface ConversationOutboundRequest {
  empresaId: string;
  remoteJid: string;
  actorUserId: string | null;
  origin: OutboundOrigin;
  takeoverPolicy: TakeoverPolicy;
  idempotencyKey: string;
  payload: OutboundPayload;
  aiPermit?: AiTurnPermit;
  messageId?: string | null;
}

export type DispatchResult =
  | { state: 'sent'; jobId: string; messageId: string | null; providerMessageId: string }
  | { state: 'queued'; jobId: string; messageId: string | null }
  | { state: 'failed_before_dispatch'; jobId: string; messageId: string | null; friendlyMessage: string }
  | { state: 'delivery_uncertain'; jobId: string; messageId: string | null; friendlyMessage: string }
  | { state: 'suppressed'; jobId: string | null; messageId: string | null; reason: 'paused' | 'stale_epoch' };

export interface ConversationOutboundJobSnapshot {
  id: string;
  messageId: string | null;
  empresaId: string;
  remoteJid: string;
  idempotencyKey: string;
  origin: OutboundOrigin;
  status: JobState;
  payload: PersistedOutboundPayload;
  payloadFingerprint: string;
  intentPayloadFingerprint?: string | null;
  conversationControlId?: string | null;
  controlEpoch?: string | null;
  providerMessageId?: string | null;
  suppressionReason?: 'paused' | 'stale_epoch' | string | null;
  takeoverApplied?: boolean;
}

type BeginHumanOutbound = (params: {
  empresaId: string;
  remoteJid: string;
  actorUserId: string | null;
  idempotencyKey: string;
  payload: PersistedOutboundPayload;
  payloadFingerprint: string;
  messageText: string;
}) => Promise<ConversationOutboundJobSnapshot>;

type EnqueueAiOutbound = (params: {
  empresaId: string;
  remoteJid: string;
  idempotencyKey: string;
  payload: PersistedOutboundPayload;
  payloadFingerprint: string;
  aiPermit: AiTurnPermit;
  messageText: string;
  origin: 'ai_auto' | 'ai_followup';
}) => Promise<ConversationOutboundJobSnapshot | null>;

type SystemOutboundOrigin = 'system_handoff' | 'system_transactional' | 'internal_system';

type EnqueueSystemOutbound = (params: {
  empresaId: string;
  remoteJid: string;
  idempotencyKey: string;
  payload: PersistedOutboundPayload;
  payloadFingerprint: string;
  messageText: string;
  origin: SystemOutboundOrigin;
}) => Promise<ConversationOutboundJobSnapshot | null>;

export interface ConversationOutboundDependencies {
  sendWaitMs?: number;
  beginHumanOutbound?: BeginHumanOutbound;
  enqueueAiOutbound?: EnqueueAiOutbound;
  enqueueSystemOutbound?: EnqueueSystemOutbound;
  claimMediaPreparation?: (
    jobId: string,
    empresaId: string,
    owner: string,
    intentPayloadFingerprint: string,
  ) => Promise<ConversationOutboundJobSnapshot | null>;
  markPrepared?: (
    jobId: string,
    payload: PersistedOutboundPayload,
    payloadFingerprint: string,
    empresaId: string,
    owner: string,
  ) => Promise<ConversationOutboundJobSnapshot | null>;
  markFailedBeforeDispatch?: (
    jobId: string,
    empresaId: string,
    reason: string,
    owner?: string,
  ) => Promise<ConversationOutboundJobSnapshot | null>;
  readJob?: (jobId: string, empresaId: string) => Promise<ConversationOutboundJobSnapshot | null>;
  cancelPendingReply?: (empresaId: string, remoteJid: string) => void | Promise<void>;
  persistMediaPayload?: (params: {
    empresaId: string;
    jobId: string;
    payload: OutboundPayload;
  }) => Promise<PersistedOutboundPayload>;
  fingerprintPayload?: (
    payload: PersistedOutboundPayload,
    binding?: { empresaId: string; jobId: string },
  ) => Promise<string>;
}

const MEDIA_KINDS = new Set(['media', 'audio', 'sticker']);
const TERMINAL_STATES = new Set<JobState>(['sent', 'failed_before_dispatch', 'delivery_uncertain', 'cancelled']);
const FRIENDLY_NOT_SENT = 'Mensagem não enviada.';
const FRIENDLY_UNCERTAIN = 'Não foi possível confirmar a entrega.';
const FRIENDLY_PREPARE_FAILED = 'Não foi possível preparar a mensagem para envio.';
const FRIENDLY_RETRY_REQUIRED = 'Não foi possível validar esta tentativa. Envie a mensagem novamente.';

function isMediaPayload(payload: OutboundPayload): payload is Extract<OutboundPayload, { kind: 'media' | 'audio' | 'sticker' }> {
  return payload.kind === 'media' || payload.kind === 'audio' || payload.kind === 'sticker';
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableJsonValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableJsonValue(item)]),
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

function internalHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function legacyMediaIntentFingerprint(payload: Extract<OutboundPayload, { kind: 'media' | 'audio' | 'sticker' }>): string {
  return createHash('sha256').update(JSON.stringify({
    kind: payload.kind,
    fileName: payload.attachment.fileName,
    mimeType: payload.attachment.mimeType,
  })).digest('hex');
}

function messagePreview(payload: OutboundPayload): string {
  switch (payload.kind) {
    case 'text':
      return payload.text;
    case 'media':
      return payload.caption?.trim() || '[Mídia]';
    case 'audio':
      return '[Áudio]';
    case 'sticker':
      return '[Figurinha]';
    case 'buttons':
      return payload.text;
    case 'contact':
      return `[Contato] ${payload.displayName}`;
    case 'list':
      return payload.body;
    case 'location':
      return payload.name ? `[Localização] ${payload.name}` : '[Localização]';
    case 'reaction':
      return payload.emoji;
    case 'poll':
      return `[Enquete] ${payload.name}`;
    default:
      return '[Mensagem]';
  }
}

function asPersistablePayload(payload: OutboundPayload): PersistedOutboundPayload {
  if (!isMediaPayload(payload)) return payload as PersistedOutboundPayload;
  const attachment = payload.attachment;
  const checksum = '0'.repeat(64);
  return {
    kind: payload.kind,
    storagePath: `preparing/${checksum}`,
    mimeType: attachment.mimeType,
    fileName: attachment.fileName,
    sizeBytes: 1,
    checksum,
    ...(payload.kind === 'audio' ? { ptt: payload.ptt } : {}),
    ...(payload.kind === 'media' && payload.caption ? { caption: payload.caption } : {}),
    ...('quoted' in payload && payload.quoted ? { quoted: payload.quoted } : {}),
  } as PersistedOutboundPayload;
}

function mapRow(row: Record<string, any>): ConversationOutboundJobSnapshot {
  const source = row.result && typeof row.result === 'object'
    ? row.result as Record<string, any>
    : (row.job && typeof row.job === 'object') ? row.job as Record<string, any> : row;
  return {
    id: source.id,
    messageId: source.message_id ?? source.messageId ?? null,
    empresaId: source.empresa_id ?? source.empresaId,
    remoteJid: source.conversation_jid ?? source.remoteJid,
    idempotencyKey: source.idempotency_key ?? source.idempotencyKey,
    origin: source.outbound_origin ?? source.origin,
    status: source.status,
    payload: source.payload,
    payloadFingerprint: source.payload_fingerprint ?? source.payloadFingerprint ?? '',
    intentPayloadFingerprint: source.intent_payload_fingerprint ?? source.intentPayloadFingerprint ?? null,
    conversationControlId: source.conversation_control_id ?? source.conversationControlId ?? null,
    controlEpoch: source.control_epoch != null ? String(source.control_epoch) : source.controlEpoch != null ? String(source.controlEpoch) : null,
    providerMessageId: source.provider_message_id ?? source.providerMessageId ?? null,
    suppressionReason: source.suppression_reason ?? source.suppressionReason ?? null,
    takeoverApplied: row.takeover_applied ?? row.takeoverApplied ?? source.takeover_applied ?? source.takeoverApplied ?? false,
  };
}

function isExpectedAiJob(
  job: ConversationOutboundJobSnapshot,
  request: ConversationOutboundRequest & { origin: 'ai_auto' | 'ai_followup'; aiPermit: AiTurnPermit },
  expectedPayload: PersistedOutboundPayload,
  expectedIntentFingerprint: string,
  expectedLegacyMediaFingerprint?: string | null,
): boolean {
  if (job.empresaId !== request.empresaId) return false;
  if (job.remoteJid !== request.remoteJid) return false;
  if (job.origin !== request.origin) return false;
  if (job.conversationControlId !== request.aiPermit.conversationControlId) return false;
  if (job.controlEpoch !== String(request.aiPermit.epoch)) return false;

  if (job.intentPayloadFingerprint === expectedIntentFingerprint) {
    if (MEDIA_KINDS.has(expectedPayload.kind)) return job.payload?.kind === expectedPayload.kind;
    return stableStringify(job.payload) === stableStringify(expectedPayload);
  }
  if (
    MEDIA_KINDS.has(expectedPayload.kind)
    && job.status === 'preparing'
    && !job.intentPayloadFingerprint
    && expectedLegacyMediaFingerprint
    && job.payloadFingerprint === expectedLegacyMediaFingerprint
  ) {
    return stableStringify(job.payload) === stableStringify(expectedPayload);
  }
  if ((job.intentPayloadFingerprint ?? job.payloadFingerprint) !== expectedIntentFingerprint) return false;
  if (MEDIA_KINDS.has(expectedPayload.kind)) return job.payload?.kind === expectedPayload.kind;
  return stableStringify(job.payload) === stableStringify(expectedPayload);
}

function isExpectedHumanJob(
  job: ConversationOutboundJobSnapshot,
  request: ConversationOutboundRequest,
  expectedPayload: PersistedOutboundPayload,
  expectedIntentFingerprint: string,
): boolean {
  if (job.empresaId !== request.empresaId) return false;
  if (job.remoteJid !== request.remoteJid) return false;
  if (job.idempotencyKey !== request.idempotencyKey) return false;
  if (job.origin !== 'human_zelochat') return false;

  if (MEDIA_KINDS.has(expectedPayload.kind)) {
    return job.intentPayloadFingerprint === expectedIntentFingerprint
      && job.payload?.kind === expectedPayload.kind;
  }

  if ((job.intentPayloadFingerprint ?? job.payloadFingerprint) !== expectedIntentFingerprint) return false;
  return stableStringify(job.payload) === stableStringify(expectedPayload);
}

function isExpectedSystemJob(
  job: ConversationOutboundJobSnapshot,
  request: ConversationOutboundRequest & { origin: SystemOutboundOrigin },
  expectedPayload: PersistedOutboundPayload,
  expectedIntentFingerprint: string,
): boolean {
  if (job.empresaId !== request.empresaId) return false;
  if (job.remoteJid !== request.remoteJid) return false;
  if (job.idempotencyKey !== request.idempotencyKey) return false;
  if (job.origin !== request.origin) return false;
  if ((job.intentPayloadFingerprint ?? job.payloadFingerprint) !== expectedIntentFingerprint) return false;
  if (MEDIA_KINDS.has(expectedPayload.kind)) return job.payload?.kind === expectedPayload.kind;
  return stableStringify(job.payload) === stableStringify(expectedPayload);
}

function retryRequiredResult(job: ConversationOutboundJobSnapshot): DispatchResult {
  return {
    state: 'failed_before_dispatch',
    jobId: job.id,
    messageId: job.messageId,
    friendlyMessage: FRIENDLY_RETRY_REQUIRED,
  };
}

function resultFromJob(job: ConversationOutboundJobSnapshot): DispatchResult {
  if (job.status === 'sent' && job.providerMessageId?.trim()) {
    return {
      state: 'sent',
      jobId: job.id,
      messageId: job.messageId,
      providerMessageId: job.providerMessageId,
    };
  }
  if (job.status === 'failed_before_dispatch') {
    return {
      state: 'failed_before_dispatch',
      jobId: job.id,
      messageId: job.messageId,
      friendlyMessage: FRIENDLY_NOT_SENT,
    };
  }
  if (job.status === 'delivery_uncertain') {
    return {
      state: 'delivery_uncertain',
      jobId: job.id,
      messageId: job.messageId,
      friendlyMessage: FRIENDLY_UNCERTAIN,
    };
  }
  if (job.status === 'cancelled') {
    return {
      state: 'suppressed',
      jobId: job.id,
      messageId: job.messageId,
      reason: job.suppressionReason === 'paused' ? 'paused' : 'stale_epoch',
    };
  }
  return { state: 'queued', jobId: job.id, messageId: job.messageId };
}

function assertDispatchInput(request: ConversationOutboundRequest): void {
  if (!request.empresaId || !request.remoteJid) throw new Error(FRIENDLY_PREPARE_FAILED);
  if (!request.idempotencyKey.trim()) throw new Error(FRIENDLY_PREPARE_FAILED);
  const payloadError = validateOutboundPayload(request.payload);
  if (payloadError) throw new Error(FRIENDLY_PREPARE_FAILED);
}

async function waitForTerminal(
  job: ConversationOutboundJobSnapshot,
  deps: Required<Pick<ConversationOutboundDependencies, 'readJob'>>,
  waitMs: number,
): Promise<DispatchResult> {
  const deadline = Date.now() + Math.max(waitMs, 0);
  let current = job;
  while (Date.now() <= deadline) {
    current = await deps.readJob(job.id, job.empresaId) ?? current;
    if (TERMINAL_STATES.has(current.status)) return resultFromJob(current);
    if (waitMs === 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))));
  }
  return { state: 'queued', jobId: job.id, messageId: job.messageId };
}

async function defaultBeginHumanOutbound(params: Parameters<BeginHumanOutbound>[0]): Promise<ConversationOutboundJobSnapshot> {
  const { data, error } = await getServiceSupabase().rpc('begin_zelochat_human_outbound', {
    p_empresa_id: params.empresaId,
    p_remote_jid: params.remoteJid,
    p_actor_user_id: params.actorUserId,
    p_source: 'zelochat_operator',
    p_idempotency_key: params.idempotencyKey,
    p_payload: params.payload,
    p_payload_fingerprint: params.payloadFingerprint,
    p_message_text: params.messageText,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('OUTBOUND_JOB_NOT_CREATED');
  return mapRow(row);
}

async function defaultEnqueueAiOutbound(params: Parameters<EnqueueAiOutbound>[0]): Promise<ConversationOutboundJobSnapshot | null> {
  const { data, error } = await getServiceSupabase().rpc('enqueue_zelochat_ai_outbound', {
    p_empresa_id: params.empresaId,
    p_remote_jid: params.remoteJid,
    p_conversation_control_id: params.aiPermit.conversationControlId,
    p_control_epoch: params.aiPermit.epoch,
    p_origin: params.origin,
    p_idempotency_key: params.idempotencyKey,
    p_payload: params.payload,
    p_payload_fingerprint: params.payloadFingerprint,
    p_message_text: params.messageText,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? mapRow(row) : null;
}

async function defaultEnqueueSystemOutbound(params: Parameters<EnqueueSystemOutbound>[0]): Promise<ConversationOutboundJobSnapshot | null> {
  const { data, error } = await getServiceSupabase().rpc('enqueue_zelochat_system_outbound', {
    p_empresa_id: params.empresaId,
    p_remote_jid: params.remoteJid,
    p_origin: params.origin,
    p_idempotency_key: params.idempotencyKey,
    p_payload: params.payload,
    p_payload_fingerprint: params.payloadFingerprint,
    p_message_text: params.messageText,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? mapRow(row) : null;
}

async function defaultReadJob(jobId: string, empresaId: string): Promise<ConversationOutboundJobSnapshot | null> {
  const { data, error } = await getServiceSupabase()
    .from('zelochat_outbound_jobs')
    .select('id,empresa_id,conversation_jid,idempotency_key,outbound_origin,status,payload,payload_fingerprint,intent_payload_fingerprint,conversation_control_id,control_epoch,message_id,provider_message_id,suppression_reason')
    .eq('empresa_id', empresaId)
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data) : null;
}

async function defaultClaimMediaPreparation(
  jobId: string,
  empresaId: string,
  owner: string,
  intentPayloadFingerprint: string,
): Promise<ConversationOutboundJobSnapshot | null> {
  const { data, error } = await getServiceSupabase().rpc('claim_zelochat_outbound_media_preparation', {
    p_id: jobId,
    p_empresa_id: empresaId,
    p_owner: owner,
    p_intent_payload_fingerprint: intentPayloadFingerprint,
    p_lease_seconds: 120,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? mapRow(row) : null;
}

async function defaultMarkPrepared(
  jobId: string,
  payload: PersistedOutboundPayload,
  payloadFingerprint: string,
  empresaId: string,
  owner: string,
): Promise<ConversationOutboundJobSnapshot | null> {
  const { data, error } = await getServiceSupabase().rpc('complete_zelochat_outbound_media_preparation', {
    p_id: jobId,
    p_empresa_id: empresaId,
    p_owner: owner,
    p_payload: payload,
    p_payload_fingerprint: payloadFingerprint,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? mapRow(row) : null;
}

async function defaultMarkFailedBeforeDispatch(
  jobId: string,
  empresaId: string,
  reason: string,
  owner?: string,
): Promise<ConversationOutboundJobSnapshot | null> {
  const { data, error } = await getServiceSupabase().rpc('fail_zelochat_outbound_media_preparation', {
    p_id: jobId,
    p_empresa_id: empresaId,
    p_owner: owner ?? null,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? mapRow(row) : null;
}

async function defaultFingerprintPayload(
  payload: PersistedOutboundPayload,
  binding?: { empresaId: string; jobId: string },
): Promise<string> {
  if (MEDIA_KINDS.has(payload.kind)) {
    if (!('storagePath' in payload) || !binding) throw new Error('OUTBOUND_MEDIA_NOT_PREPARED');
    const preparedMedia = await createOutboundMediaStore().prepare(payload, binding);
    return fingerprintOutboundPayload(payload, preparedMedia);
  }
  return fingerprintOutboundPayload(payload);
}

export function createConversationOutboundDispatcher(dependencies: ConversationOutboundDependencies = {}) {
  const deps = {
    sendWaitMs: dependencies.sendWaitMs ?? CONVERSATION_SEND_WAIT_MS,
    beginHumanOutbound: dependencies.beginHumanOutbound ?? defaultBeginHumanOutbound,
    enqueueAiOutbound: dependencies.enqueueAiOutbound ?? defaultEnqueueAiOutbound,
    enqueueSystemOutbound: dependencies.enqueueSystemOutbound ?? defaultEnqueueSystemOutbound,
    claimMediaPreparation: dependencies.claimMediaPreparation ?? defaultClaimMediaPreparation,
    markPrepared: dependencies.markPrepared ?? defaultMarkPrepared,
    markFailedBeforeDispatch: dependencies.markFailedBeforeDispatch ?? defaultMarkFailedBeforeDispatch,
    readJob: dependencies.readJob ?? defaultReadJob,
    cancelPendingReply: dependencies.cancelPendingReply ?? cancelPendingReply,
    persistMediaPayload: dependencies.persistMediaPayload ?? ((params) => {
      const mediaStore: OutboundMediaStore = createOutboundMediaStore();
      return mediaStore.persistPayload(params);
    }),
    fingerprintPayload: dependencies.fingerprintPayload ?? defaultFingerprintPayload,
  };

  const prepareMediaIfNeeded = async (
    current: ConversationOutboundJobSnapshot,
    payload: OutboundPayload,
    intentPayloadFingerprint: string,
  ): Promise<ConversationOutboundJobSnapshot> => {
    if (!isMediaPayload(payload)) return current;

    const owner = `media-preparation:${process.pid}:${randomUUID()}`;
    let job = await deps.claimMediaPreparation(current.id, current.empresaId, owner, intentPayloadFingerprint);
    if (!job) return await deps.readJob(current.id, current.empresaId) ?? current;

    try {
      const persisted = await deps.persistMediaPayload({
        empresaId: current.empresaId,
        jobId: current.id,
        payload,
      });
      const persistedFingerprint = await deps.fingerprintPayload(persisted, {
        empresaId: current.empresaId,
        jobId: current.id,
      });
      const prepared = await deps.markPrepared(current.id, persisted, persistedFingerprint, current.empresaId, owner);
      job = prepared ?? await deps.readJob(current.id, current.empresaId) ?? job;
      return job;
    } catch {
      const failed = await deps.markFailedBeforeDispatch(current.id, current.empresaId, FRIENDLY_NOT_SENT, owner);
      return failed ?? await deps.readJob(current.id, current.empresaId) ?? job;
    }
  };

  return {
    async dispatchConversationOutbound(request: ConversationOutboundRequest): Promise<DispatchResult> {
      assertDispatchInput(request);
      const initialPayload = asPersistablePayload(request.payload);
      const initialFingerprint = isMediaPayload(request.payload)
        ? internalHash({ kind: 'outbound-media-intent-v1', payload: request.payload })
        : await deps.fingerprintPayload(initialPayload);
      const legacyMediaFingerprint = isMediaPayload(request.payload)
        ? legacyMediaIntentFingerprint(request.payload)
        : null;

      if (request.origin === 'ai_auto' || request.origin === 'ai_followup') {
        if (!request.aiPermit) {
          return { state: 'suppressed', jobId: null, messageId: null, reason: 'stale_epoch' };
        }
        if (request.aiPermit.empresaId !== request.empresaId || request.aiPermit.remoteJid !== request.remoteJid) {
          return { state: 'suppressed', jobId: null, messageId: null, reason: 'stale_epoch' };
        }
        let job = await deps.enqueueAiOutbound({
          empresaId: request.empresaId,
          remoteJid: request.remoteJid,
          idempotencyKey: request.idempotencyKey,
          payload: initialPayload,
          payloadFingerprint: initialFingerprint,
          aiPermit: request.aiPermit,
          messageText: messagePreview(request.payload),
          origin: request.origin,
        });
        if (!job) {
          return { state: 'suppressed', jobId: null, messageId: null, reason: 'stale_epoch' };
        }
        if (!isExpectedAiJob(job, request as ConversationOutboundRequest & { origin: 'ai_auto' | 'ai_followup'; aiPermit: AiTurnPermit }, initialPayload, initialFingerprint, legacyMediaFingerprint)) {
          return { state: 'suppressed', jobId: null, messageId: null, reason: 'stale_epoch' };
        }
        job = await prepareMediaIfNeeded(job, request.payload, initialFingerprint);
        return waitForTerminal(job, deps, deps.sendWaitMs);
      }

      if (request.origin === 'system_handoff' || request.origin === 'system_transactional' || request.origin === 'internal_system') {
        if (request.takeoverPolicy !== 'preserve_ai') throw new Error(FRIENDLY_PREPARE_FAILED);
        let job = await deps.enqueueSystemOutbound({
          empresaId: request.empresaId,
          remoteJid: request.remoteJid,
          idempotencyKey: request.idempotencyKey,
          payload: initialPayload,
          payloadFingerprint: initialFingerprint,
          messageText: messagePreview(request.payload),
          origin: request.origin,
        });
        if (!job || !isExpectedSystemJob(job, request as ConversationOutboundRequest & { origin: SystemOutboundOrigin }, initialPayload, initialFingerprint)) {
          throw new Error(FRIENDLY_PREPARE_FAILED);
        }
        job = await prepareMediaIfNeeded(job, request.payload, initialFingerprint);
        return waitForTerminal(job, deps, deps.sendWaitMs);
      }

      if (request.takeoverPolicy !== 'take_over') {
        throw new Error(FRIENDLY_PREPARE_FAILED);
      }

      let job: ConversationOutboundJobSnapshot;
      try {
        job = await deps.beginHumanOutbound({
          empresaId: request.empresaId,
          remoteJid: request.remoteJid,
          actorUserId: request.actorUserId,
          idempotencyKey: request.idempotencyKey,
          payload: initialPayload,
          payloadFingerprint: initialFingerprint,
          messageText: messagePreview(request.payload),
        });
      } catch {
        throw new Error(FRIENDLY_PREPARE_FAILED);
      }

      if (job.takeoverApplied) {
        await deps.cancelPendingReply(request.empresaId, request.remoteJid);
      }

      // FIX 2026-08-30: mídia humana pre-R2 não prova os bytes da intenção → o dispatcher novo exige fingerprint forte e pede uma nova tentativa.
      if (!isExpectedHumanJob(job, request, initialPayload, initialFingerprint)) {
        return retryRequiredResult(job);
      }

      job = await prepareMediaIfNeeded(job, request.payload, initialFingerprint);

      return waitForTerminal(job, deps, deps.sendWaitMs);
    },
  };
}

const defaultDispatcher = createConversationOutboundDispatcher();

export const dispatchConversationOutbound = defaultDispatcher.dispatchConversationOutbound;
