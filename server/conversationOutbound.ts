import { createHash } from 'node:crypto';
import type { AiTurnPermit } from './conversationControl.js';
import { isAiPermitCurrent } from './conversationControl.js';
import { getServiceSupabase } from './supabase.js';
import { cancelPendingReply } from './replyDebouncer.js';
import {
  createOutboundMediaStore,
  type OutboundMediaStore,
} from './outbound/mediaStore.js';
import {
  createSupabaseOutboundJobStore,
} from './outbound/worker.js';
import { OutboundQueue } from './outbound/queue.js';
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
}) => Promise<ConversationOutboundJobSnapshot>;

export interface ConversationOutboundDependencies {
  sendWaitMs?: number;
  beginHumanOutbound?: BeginHumanOutbound;
  enqueueAiOutbound?: EnqueueAiOutbound;
  markPrepared?: (
    jobId: string,
    payload: PersistedOutboundPayload,
    payloadFingerprint: string,
    empresaId: string,
  ) => Promise<ConversationOutboundJobSnapshot>;
  markFailedBeforeDispatch?: (
    jobId: string,
    empresaId: string,
    reason: string,
  ) => Promise<ConversationOutboundJobSnapshot>;
  readJob?: (jobId: string, empresaId: string) => Promise<ConversationOutboundJobSnapshot | null>;
  isAiPermitCurrent?: (permit: AiTurnPermit) => Promise<boolean>;
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

function isMediaPayload(payload: OutboundPayload): payload is Extract<OutboundPayload, { kind: 'media' | 'audio' | 'sticker' }> {
  return payload.kind === 'media' || payload.kind === 'audio' || payload.kind === 'sticker';
}

function internalHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
  return {
    id: row.id,
    messageId: row.message_id ?? row.messageId ?? null,
    empresaId: row.empresa_id ?? row.empresaId,
    remoteJid: row.conversation_jid ?? row.remoteJid,
    idempotencyKey: row.idempotency_key ?? row.idempotencyKey,
    origin: row.outbound_origin ?? row.origin,
    status: row.status,
    payload: row.payload,
    payloadFingerprint: row.payload_fingerprint ?? row.payloadFingerprint ?? '',
    providerMessageId: row.provider_message_id ?? row.providerMessageId ?? null,
    suppressionReason: row.suppression_reason ?? row.suppressionReason ?? null,
    takeoverApplied: row.takeover_applied ?? row.takeoverApplied ?? true,
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

async function defaultEnqueueAiOutbound(params: Parameters<EnqueueAiOutbound>[0]): Promise<ConversationOutboundJobSnapshot> {
  const queue = new OutboundQueue(createSupabaseOutboundJobStore());
  const job = await queue.enqueue({
    empresaId: params.empresaId,
    instanceKey: '',
    idempotencyKey: params.idempotencyKey,
    text: params.messageText,
    jobType: 'conversation',
    conversationControlId: params.aiPermit.conversationControlId,
    conversationJid: params.remoteJid,
    messageId: null,
    origin: params.origin,
    payload: params.payload,
    payloadFingerprint: params.payloadFingerprint,
    controlEpoch: params.aiPermit.epoch,
  });
  return {
    id: job.id,
    messageId: job.messageId ?? null,
    empresaId: job.empresaId,
    remoteJid: job.conversationJid,
    idempotencyKey: job.idempotencyKey,
    origin: job.origin,
    status: job.status as JobState,
    payload: job.payload as PersistedOutboundPayload,
    payloadFingerprint: job.payloadFingerprint,
    providerMessageId: null,
    suppressionReason: job.suppressionReason ?? null,
  };
}

async function defaultReadJob(jobId: string, empresaId: string): Promise<ConversationOutboundJobSnapshot | null> {
  const { data, error } = await getServiceSupabase()
    .from('zelochat_outbound_jobs')
    .select('id,empresa_id,conversation_jid,idempotency_key,outbound_origin,status,payload,payload_fingerprint,message_id,provider_message_id,suppression_reason')
    .eq('empresa_id', empresaId)
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data) : null;
}

async function defaultMarkPrepared(
  jobId: string,
  payload: PersistedOutboundPayload,
  payloadFingerprint: string,
  empresaId: string,
): Promise<ConversationOutboundJobSnapshot> {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from('zelochat_outbound_jobs')
    .update({
      payload,
      payload_fingerprint: payloadFingerprint,
      status: 'queued',
      next_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('empresa_id', empresaId)
    .eq('id', jobId)
    .eq('status', 'preparing')
    .select('id,empresa_id,conversation_jid,idempotency_key,outbound_origin,status,payload,payload_fingerprint,message_id,provider_message_id,suppression_reason')
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? 'OUTBOUND_JOB_NOT_PREPARING');
  if (data.message_id) {
    await db
      .from('zelochat_messages')
      .update({ outbound_status: 'queued', outbound_error: null })
      .eq('empresa_id', empresaId)
      .eq('id', data.message_id);
  }
  return mapRow(data);
}

async function defaultMarkFailedBeforeDispatch(
  jobId: string,
  empresaId: string,
  reason: string,
): Promise<ConversationOutboundJobSnapshot> {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from('zelochat_outbound_jobs')
    .update({
      status: 'failed_before_dispatch',
      last_error: reason.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq('empresa_id', empresaId)
    .eq('id', jobId)
    .in('status', ['preparing', 'queued'])
    .select('id,empresa_id,conversation_jid,idempotency_key,outbound_origin,status,payload,payload_fingerprint,message_id,provider_message_id,suppression_reason')
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? 'OUTBOUND_JOB_NOT_MARKED_FAILED');
  if (data.message_id) {
    await db
      .from('zelochat_messages')
      .update({ outbound_status: 'failed_before_dispatch', outbound_error: FRIENDLY_NOT_SENT })
      .eq('empresa_id', empresaId)
      .eq('id', data.message_id);
  }
  return mapRow(data);
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
    markPrepared: dependencies.markPrepared ?? defaultMarkPrepared,
    markFailedBeforeDispatch: dependencies.markFailedBeforeDispatch ?? defaultMarkFailedBeforeDispatch,
    readJob: dependencies.readJob ?? defaultReadJob,
    isAiPermitCurrent: dependencies.isAiPermitCurrent ?? isAiPermitCurrent,
    cancelPendingReply: dependencies.cancelPendingReply ?? cancelPendingReply,
    persistMediaPayload: dependencies.persistMediaPayload ?? ((params) => {
      const mediaStore: OutboundMediaStore = createOutboundMediaStore();
      return mediaStore.persistPayload(params);
    }),
    fingerprintPayload: dependencies.fingerprintPayload ?? defaultFingerprintPayload,
  };

  return {
    async dispatchConversationOutbound(request: ConversationOutboundRequest): Promise<DispatchResult> {
      assertDispatchInput(request);
      const initialPayload = asPersistablePayload(request.payload);
      const initialFingerprint = isMediaPayload(request.payload)
        ? internalHash({ kind: request.payload.kind, fileName: request.payload.attachment.fileName, mimeType: request.payload.attachment.mimeType })
        : await deps.fingerprintPayload(initialPayload);

      if (request.origin === 'ai_auto' || request.origin === 'ai_followup') {
        if (!request.aiPermit) {
          return { state: 'suppressed', jobId: null, messageId: null, reason: 'stale_epoch' };
        }
        const allowed = await deps.isAiPermitCurrent(request.aiPermit);
        if (!allowed) {
          return { state: 'suppressed', jobId: null, messageId: null, reason: 'stale_epoch' };
        }
        const job = await deps.enqueueAiOutbound({
          empresaId: request.empresaId,
          remoteJid: request.remoteJid,
          idempotencyKey: request.idempotencyKey,
          payload: initialPayload,
          payloadFingerprint: initialFingerprint,
          aiPermit: request.aiPermit,
          messageText: messagePreview(request.payload),
          origin: request.origin,
        });
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

      if (isMediaPayload(request.payload)) {
        try {
          const persisted = await deps.persistMediaPayload({
            empresaId: request.empresaId,
            jobId: job.id,
            payload: request.payload,
          });
          const persistedFingerprint = await deps.fingerprintPayload(persisted, {
            empresaId: request.empresaId,
            jobId: job.id,
          });
          job = await deps.markPrepared(job.id, persisted, persistedFingerprint, request.empresaId);
        } catch {
          job = await deps.markFailedBeforeDispatch(job.id, request.empresaId, FRIENDLY_NOT_SENT);
          return resultFromJob(job);
        }
      }

      return waitForTerminal(job, deps, deps.sendWaitMs);
    },
  };
}

const defaultDispatcher = createConversationOutboundDispatcher();

export const dispatchConversationOutbound = defaultDispatcher.dispatchConversationOutbound;
