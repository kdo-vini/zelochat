import { getServiceSupabase } from './supabase.js';
import { ensureSession } from './messageHandler.js';
import { cancelPendingReply } from './replyDebouncer.js';
import { broadcast, type ConversationModeChanged } from './ws.js';
import { wasSentByServer } from './whatsapp.js';
import { classifyFromMe, extractFromMeMessage, type FromMeEvidence } from './fromMe.js';
import type { WebhookAuthStatus } from './webhookLog.js';
import { recordConversationOutboundMetric } from './outbound/observability.js';

export interface NativeTakeoverRecord {
  inserted: boolean;
  takeoverApplied: boolean;
  messageId: string;
  jobId: string;
  conversationControlId: string;
  mode: 'ai' | 'human';
  epoch: string;
  remoteJids: string[];
}

export interface FromMeProcessorDependencies {
  lookupEvidence(input: { empresaId: string; remoteJid: string; waMessageId: string; fingerprint: string }): Promise<FromMeEvidence>;
  recordNativeTakeover(input: { empresaId: string; remoteJid: string; waMessageId: string; jobPayload: unknown; payloadFingerprint: string; messageContent: string; preview: string; sentAt: string }): Promise<NativeTakeoverRecord>;
  ensureConversationSession(input: { empresaId: string; remoteJid: string; preview: string; sentAt: string }): Promise<void>;
  repairServerEcho(input: { empresaId: string; remoteJid: string; waMessageId: string; jobId: string; payload: unknown; preview: string; sentAt: string }): Promise<void>;
  holdPendingCorrelation(input: { empresaId: string; remoteJid: string; waMessageId: string; jobId: string; fingerprint: string; rawEventId: string | null }): Promise<void>;
  cancelPendingReply(empresaId: string, remoteJid: string): void;
  broadcast(type: 'message_sent' | 'conversation_mode_changed', data: unknown, empresaId: string): void;
}

export type FromMeProcessingResult =
  | { kind: 'duplicate' | 'ignore_protocol_artifact' | 'unauthenticated' }
  | { kind: 'server_echo'; jobId: string }
  | { kind: 'native_human'; messageId: string; jobId: string; takeoverApplied: boolean };

function isMissingConversationSession(error: unknown): boolean {
  return error instanceof Error && error.message.includes('CONVERSATION_SESSION_NOT_FOUND');
}

function mapNativeRecord(value: any): NativeTakeoverRecord {
  const row = value?.result ?? value;
  if (!row?.message_id || !row?.job_id || !row?.conversation_control_id) throw new Error('FROM_ME_NATIVE_RECORD_INVALID');
  return {
    inserted: Boolean(row.inserted),
    takeoverApplied: Boolean(row.takeover_applied),
    messageId: row.message_id,
    jobId: row.job_id,
    conversationControlId: row.conversation_control_id,
    mode: row.mode === 'ai' ? 'ai' : 'human',
    epoch: String(row.epoch),
    remoteJids: Array.isArray(row.remote_jids) ? row.remote_jids : [],
  };
}

async function defaultLookupEvidence(input: { empresaId: string; remoteJid: string; waMessageId: string; fingerprint: string }): Promise<FromMeEvidence> {
  const db = getServiceSupabase();
  const [{ data: existingMessage, error: messageError }, { data: providerJob, error: providerError }] = await Promise.all([
    db.from('zelochat_messages').select('outbound_origin,outbound_job_id').eq('empresa_id', input.empresaId).eq('wa_message_id', input.waMessageId).maybeSingle(),
    db.from('zelochat_outbound_jobs').select('id,message_id').eq('empresa_id', input.empresaId).eq('provider_message_id', input.waMessageId).maybeSingle(),
  ]);
  if (messageError) throw new Error(messageError.message);
  if (providerError) throw new Error(providerError.message);

  let pendingJob: FromMeEvidence['pendingJob'] = null;
  if (!existingMessage && !providerJob) {
    const { data: session, error: sessionError } = await db.from('zelochat_sessions').select('conversation_control_id').eq('empresa_id', input.empresaId).eq('remote_jid', input.remoteJid).maybeSingle();
    if (sessionError) throw new Error(sessionError.message);
    if (session?.conversation_control_id) {
      const { data, error } = await db.from('zelochat_outbound_jobs')
        .select('id,payload_fingerprint,provider_message_id')
        .eq('empresa_id', input.empresaId)
        .eq('conversation_control_id', session.conversation_control_id)
        .eq('status', 'dispatch_started')
        .is('provider_message_id', null)
        .eq('payload_fingerprint', input.fingerprint)
        .order('transport_started_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data) pendingJob = { id: data.id, payloadFingerprint: data.payload_fingerprint, providerMessageId: data.provider_message_id };
    }
  }
  return {
    existingMessage: existingMessage ? { origin: existingMessage.outbound_origin, jobId: existingMessage.outbound_job_id } : null,
    providerJob: providerJob ? { id: providerJob.id, messageId: providerJob.message_id } : null,
    legacyTracked: wasSentByServer(input.waMessageId),
    pendingJob,
  };
}

async function defaultRecordNativeTakeover(input: { empresaId: string; remoteJid: string; waMessageId: string; jobPayload: unknown; payloadFingerprint: string; messageContent: string; preview: string; sentAt: string }): Promise<NativeTakeoverRecord> {
  const { data, error } = await getServiceSupabase().rpc('record_zelochat_native_outbound_takeover', {
    p_empresa_id: input.empresaId,
    p_remote_jid: input.remoteJid,
    p_wa_message_id: input.waMessageId,
    p_payload: input.jobPayload,
    p_payload_fingerprint: input.payloadFingerprint,
    p_message_content: input.messageContent,
    p_preview: input.preview,
    p_sent_at: input.sentAt,
  });
  if (error) throw new Error(error.message);
  return mapNativeRecord(Array.isArray(data) ? data[0] : data);
}

/**
 * FIX 2026-09-09: `record_zelochat_native_outbound_takeover` raises
 * CONVERSATION_SESSION_NOT_FOUND when no `zelochat_sessions` row is bound to
 * the conversation yet, which is exactly the case when the operator STARTS
 * the conversation from their own phone. The throw fell through to the
 * webhook replay worker, so the takeover was retried on a 5/10/20/40s
 * backoff and dead-lettered after 8 attempts — and for the whole of that
 * window the conversation stayed in `mode='ai'`, so the AI answered over the
 * operator (Bem Servido, 2026-09-09: takeover landed 100s late, 0.8s after
 * the AI had already replied; 31 events hit this in nine days, several never
 * applied at all). An operator-initiated conversation is a real conversation:
 * create the session the same way an inbound message would, then record the
 * takeover.
 */
async function defaultEnsureConversationSession(input: { empresaId: string; remoteJid: string; preview: string; sentAt: string }): Promise<void> {
  await ensureSession({
    empresaId: input.empresaId,
    jid: input.remoteJid,
    lastMessage: input.preview,
    lastMessageTime: input.sentAt,
    unreadCount: 0,
  });
}

async function defaultRepairServerEcho(input: { empresaId: string; remoteJid: string; waMessageId: string; jobId: string; payload: unknown; preview: string; sentAt: string }): Promise<void> {
  const legacy = input.jobId.startsWith('legacy:');
  const { error } = await getServiceSupabase().rpc('reconcile_zelochat_from_me_server_echo', {
    p_empresa_id: input.empresaId,
    p_remote_jid: input.remoteJid,
    p_wa_message_id: input.waMessageId,
    p_job_id: legacy ? null : input.jobId,
    p_payload: input.payload,
    p_preview: input.preview,
    p_sent_at: input.sentAt,
  });
  if (error) throw new Error(error.message);
}

async function defaultHoldPendingCorrelation(input: { empresaId: string; remoteJid: string; waMessageId: string; jobId: string; fingerprint: string; rawEventId: string | null }): Promise<void> {
  const { error } = await getServiceSupabase().rpc('hold_zelochat_from_me_correlation', {
    p_empresa_id: input.empresaId,
    p_job_id: input.jobId,
    p_wa_message_id: input.waMessageId,
    p_payload_fingerprint: input.fingerprint,
    p_raw_event_id: input.rawEventId,
  });
  if (error) throw new Error(error.message);
}

function defaults(): FromMeProcessorDependencies {
  return {
    lookupEvidence: defaultLookupEvidence,
    recordNativeTakeover: defaultRecordNativeTakeover,
    ensureConversationSession: defaultEnsureConversationSession,
    repairServerEcho: defaultRepairServerEcho,
    holdPendingCorrelation: defaultHoldPendingCorrelation,
    cancelPendingReply: (empresaId, remoteJid) => { cancelPendingReply(empresaId, remoteJid); },
    broadcast: (type, data, empresaId) => {
      if (type === 'conversation_mode_changed') {
        broadcast({ type, data: data as ConversationModeChanged['data'] }, empresaId);
        return;
      }
      broadcast({ type, data }, empresaId);
    },
  };
}

export function createFromMeProcessor(dependencies: FromMeProcessorDependencies = defaults()) {
  return async function processFromMeUpsert(input: { empresaId: string; data: any; authStatus: WebhookAuthStatus; rawEventId?: string | null }): Promise<FromMeProcessingResult> {
    const extracted = await extractFromMeMessage(input.data);
    if (extracted.protocolArtifact) return { kind: 'ignore_protocol_artifact' };
    // A native send is a human takeover only when the webhook authentication
    // proves it came from the configured WhatsApp instance. This is an
    // authorization boundary, not a rollout mode.
    if (input.authStatus !== 'token_match') return { kind: 'unauthenticated' };

    const evidence = await dependencies.lookupEvidence({ empresaId: input.empresaId, remoteJid: extracted.remoteJid, waMessageId: extracted.waMessageId, fingerprint: extracted.fingerprint });
    const decision = classifyFromMe(extracted, evidence);

    if (decision.kind === 'ignore_protocol_artifact' || decision.kind === 'duplicate') return { kind: decision.kind };
    if (decision.kind === 'pending_correlation') {
      recordConversationOutboundMetric('from_me_pending_correlation', {}, { empresaId: input.empresaId, remoteJid: extracted.remoteJid, jobId: decision.jobId });
      await dependencies.holdPendingCorrelation({ empresaId: input.empresaId, remoteJid: extracted.remoteJid, waMessageId: extracted.waMessageId, jobId: decision.jobId, fingerprint: extracted.fingerprint, rawEventId: input.rawEventId ?? null });
      throw new Error('FROM_ME_PENDING_CORRELATION');
    }
    if (decision.kind === 'server_echo') {
      recordConversationOutboundMetric('from_me_echo', {}, { empresaId: input.empresaId, remoteJid: extracted.remoteJid, jobId: decision.jobId });
      await dependencies.repairServerEcho({ empresaId: input.empresaId, remoteJid: extracted.remoteJid, waMessageId: extracted.waMessageId, jobId: decision.jobId, payload: extracted.payload, preview: extracted.preview, sentAt: extracted.sentAt });
      return { kind: 'server_echo', jobId: decision.jobId };
    }

    // FIX 2026-08-31: o job nativo perdia fingerprint/conteúdo e a RPC revertia a transação → persistir os dois campos explicitamente.
    const takeoverInput = {
      empresaId: input.empresaId,
      remoteJid: extracted.remoteJid,
      waMessageId: extracted.waMessageId,
      jobPayload: extracted.jobPayload,
      payloadFingerprint: extracted.fingerprint,
      messageContent: extracted.messageContent,
      preview: extracted.preview,
      sentAt: extracted.sentAt,
    };
    let recorded: NativeTakeoverRecord;
    try {
      recorded = await dependencies.recordNativeTakeover(takeoverInput);
    } catch (error) {
      // FIX 2026-09-09: see `defaultEnsureConversationSession`. Recovering
      // here rather than on the replay worker's backoff is what keeps the
      // takeover ahead of the next AI turn; any other failure still replays.
      if (!isMissingConversationSession(error)) throw error;
      await dependencies.ensureConversationSession({
        empresaId: input.empresaId,
        remoteJid: extracted.remoteJid,
        preview: extracted.preview,
        sentAt: extracted.sentAt,
      });
      recorded = await dependencies.recordNativeTakeover(takeoverInput);
    }
    recordConversationOutboundMetric('from_me_native', { takeover_applied: recorded.takeoverApplied }, { empresaId: input.empresaId, remoteJid: extracted.remoteJid, jobId: recorded.jobId, messageId: recorded.messageId });
    if (recorded.inserted) {
      dependencies.cancelPendingReply(input.empresaId, extracted.remoteJid);
      dependencies.broadcast('message_sent', {
        sessionId: extracted.remoteJid,
        message: { id: recorded.messageId, role: 'assistant', content: extracted.messageContent, timestamp: extracted.sentAt, status: 'sent', outboundOrigin: 'human_native_whatsapp', waMessageId: extracted.waMessageId },
        lastMessage: extracted.preview,
        lastMessageTime: extracted.sentAt,
      }, input.empresaId);
      dependencies.broadcast('conversation_mode_changed', {
        sessionIds: recorded.remoteJids.length ? recorded.remoteJids : [extracted.remoteJid],
        mode: recorded.mode,
        epoch: recorded.epoch,
        source: 'native_whatsapp',
        changedAt: extracted.sentAt,
      }, input.empresaId);
    }
    return { kind: 'native_human', messageId: recorded.messageId, jobId: recorded.jobId, takeoverApplied: recorded.takeoverApplied };
  };
}

export const processFromMeUpsert = createFromMeProcessor();
