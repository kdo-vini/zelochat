import type { OutboundOrigin, OutboundPayload, PersistedOutboundPayload } from '../../src/domain/outbound.js';
import type { ChatMessage } from '../../src/types.js';
import { getServiceSupabase } from '../supabase.js';
import { getInstanceForEmpresa } from '../instanceManager.js';
import { fetchInstanceConnectionState } from '../whatsapp.js';
import { OutboundQueue, assertQueueablePayload, type OutboundJob, type OutboundJobInput, type OutboundJobStore } from './queue.js';
import { getCrmRolloutFlags, isOutboundJobAllowed } from '../customers/rollout.js';
import { createProviderAdapter, type ProviderAdapter, type ProviderDispatchResult } from './providerAdapter.js';
import { cleanupTerminalOutboundMedia } from './mediaStore.js';

const originFor = (jobType: OutboundJob['jobType'], value?: string | null): OutboundOrigin => {
  if (value) return value as OutboundOrigin;
  if (jobType === 'automation') return 'automation';
  if (jobType === 'campaign') return 'campaign';
  throw new Error('OUTBOUND_ORIGIN_MISSING');
};

function mapRow(row: Record<string, any>): OutboundJob {
  const jobType = (row.job_type ?? 'campaign') as OutboundJob['jobType'];
  const text = String(row.message ?? '');
  return {
    id: row.id,
    empresaId: row.empresa_id,
    instanceKey: row.instance_key ?? '',
    campaignId: row.campaign_id ?? undefined,
    jobType,
    recipientId: row.recipient_id ?? undefined,
    automationDispatchId: row.automation_dispatch_id ?? undefined,
    idempotencyKey: row.idempotency_key,
    phone: row.phone_snapshot,
    text,
    conversationControlId: row.conversation_control_id ?? undefined,
    conversationJid: row.conversation_jid ?? undefined,
    messageId: row.message_id ?? undefined,
    origin: originFor(jobType, row.outbound_origin),
    payload: row.payload as OutboundPayload | PersistedOutboundPayload,
    payloadFingerprint: row.payload_fingerprint ?? '',
    controlEpoch: row.control_epoch == null ? undefined : String(row.control_epoch),
    status: row.status,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    attempts: row.attempts,
    suppressionReason: row.suppression_reason,
  } as OutboundJob;
}

const rpcBoolean = (data: unknown): boolean => data === true || (Array.isArray(data) && data[0] === true);

export function createSupabaseOutboundJobStore(): OutboundJobStore {
  const db = getServiceSupabase();
  return {
    async insert(input: OutboundJobInput) {
      const isAutomation = input.jobType === 'automation';
      const payload = input.payload ?? { kind: 'text', text: input.text };
      assertQueueablePayload(payload);
      if (/"data:[^"\\]*,/i.test(JSON.stringify(payload))) throw new Error('OUTBOUND_PAYLOAD_DATA_URL_FORBIDDEN');
      const { data, error } = await db.from('zelochat_outbound_jobs').upsert({
        ...(input.id ? { id: input.id } : {}),
        empresa_id: input.empresaId,
        campaign_id: input.campaignId ?? null,
        recipient_id: isAutomation ? null : input.recipientId ?? null,
        automation_dispatch_id: isAutomation ? input.automationDispatchId ?? input.recipientId ?? null : null,
        pessoa_id: input.recipientId ?? null,
        job_type: input.jobType ?? 'campaign',
        instance_key: input.instanceKey,
        idempotency_key: input.idempotencyKey,
        phone_snapshot: input.phone ?? null,
        message: input.text,
        conversation_control_id: input.conversationControlId ?? null,
        conversation_jid: input.conversationJid ?? null,
        message_id: input.messageId ?? null,
        outbound_origin: input.origin ?? (isAutomation ? 'automation' : 'campaign'),
        takeover_policy: 'preserve_ai',
        payload,
        payload_fingerprint: input.payloadFingerprint ?? '',
        control_epoch: input.controlEpoch ?? null,
        status: 'queued',
        next_attempt_at: new Date().toISOString(),
      }, { onConflict: 'idempotency_key', ignoreDuplicates: true }).select('*').maybeSingle();
      if (error || !data) throw error ?? new Error('JOB_INSERT_FAILED');
      return mapRow(data);
    },

    async claim(workerId, leaseMs) {
      const { data, error } = await db.rpc('claim_zelochat_outbound_job', { p_worker: workerId, p_lease_seconds: Math.ceil(leaseMs / 1000) });
      if (error) throw error;
      return data?.[0] ? mapRow(data[0]) : null;
    },

    async startTransport(id, empresaId, leaseOwner) {
      const { data, error } = await db.rpc('start_zelochat_outbound_transport', { p_id: id, p_empresa_id: empresaId, p_lease_owner: leaseOwner });
      if (error) throw error;
      return rpcBoolean(data);
    },

    async markSent(id, messageId, empresaId, leaseOwner) {
      if (!empresaId || !leaseOwner) return false;
      const { data, error } = await db.rpc('complete_zelochat_outbound_job', { p_id: id, p_empresa_id: empresaId, p_lease_owner: leaseOwner, p_provider_message_id: messageId });
      if (error) throw error;
      return rpcBoolean(data);
    },

    async markDeliveryUncertain(id, reason, empresaId, leaseOwner) {
      const { data, error } = await db.rpc('fail_zelochat_outbound_job', { p_id: id, p_empresa_id: empresaId, p_lease_owner: leaseOwner, p_reason: reason, p_retry_at: null, p_delivery_uncertain: true });
      if (error) throw error;
      return rpcBoolean(data);
    },

    async markFailed(id, reason, retryAt, empresaId, leaseOwner) {
      if (!empresaId || !leaseOwner) return false;
      const { data, error } = await db.rpc('fail_zelochat_outbound_job', { p_id: id, p_empresa_id: empresaId, p_lease_owner: leaseOwner, p_reason: reason, p_retry_at: retryAt?.toISOString() ?? null, p_delivery_uncertain: false });
      if (error) throw error;
      return rpcBoolean(data);
    },

    async defer(id, reason, retryAt = new Date(Date.now() + 60_000), empresaId, leaseOwner) {
      if (!empresaId || !leaseOwner) return false;
      const { data, error } = await db.rpc('fail_zelochat_outbound_job', { p_id: id, p_empresa_id: empresaId, p_lease_owner: leaseOwner, p_reason: reason, p_retry_at: retryAt.toISOString(), p_delivery_uncertain: false });
      if (error) throw error;
      return rpcBoolean(data);
    },

    async markSuppressed(id, reason, empresaId, leaseOwner) {
      if (!empresaId || !leaseOwner) return false;
      const { data, error } = await db.rpc('suppress_zelochat_outbound_job', { p_id: id, p_empresa_id: empresaId, p_lease_owner: leaseOwner, p_reason: reason });
      if (error) throw error;
      return rpcBoolean(data);
    },

    async releaseExpired() {
      const { error } = await db.rpc('release_zelochat_expired_leases');
      if (error) throw error;
    },
  };
}

export interface OutboundWorkerDependencies {
  queue: OutboundQueue;
  transport?: Pick<ProviderAdapter, 'prepare' | 'send'>;
  resolveInstance?: (empresaId: string) => Promise<string>;
  getStatus?: (instance: string) => Promise<string>;
  /** Rolling compatibility for focused legacy tests; production uses transport. */
  send?: (phone: string, text: string, empresaId: string) => Promise<string | undefined>;
  validate?: (job: OutboundJob) => Promise<{ action: 'send' | 'defer' | 'suppress'; reason?: string }>;
  getRolloutFlags?: (empresaId: string) => Promise<Awaited<ReturnType<typeof getCrmRolloutFlags>>>;
  broadcastStatus?: (empresaId: string, messageId: string | null | undefined, status: ChatMessage['status']) => void | Promise<void>;
}

export class OutboundWorker {
  private running = false;
  private readonly locks = new Set<string>();
  private readonly transport: Pick<ProviderAdapter, 'prepare' | 'send'>;

  constructor(private readonly deps: OutboundWorkerDependencies) {
    this.transport = deps.transport ?? (deps.send
      ? { prepare: async (job) => ({ job, request: { url: 'test://legacy-send', body: '{}', headers: {} } }), send: async (prepared): Promise<ProviderDispatchResult> => {
          const job = prepared.job;
          const id = await deps.send!(job.conversationJid ?? job.phone ?? '', job.text, job.empresaId);
          return id ? { state: 'sent', providerMessageId: id } : { state: 'delivery_uncertain', reason: 'PROVIDER_MESSAGE_ID_MISSING' };
        } }
      : createProviderAdapter());
  }

  private executionKey(job: OutboundJob, instance: string): string {
    return job.conversationControlId ? `conversation:${job.conversationControlId}` : `instance:${instance}`;
  }

  private async broadcastStatus(job: OutboundJob, status: ChatMessage['status']): Promise<void> {
    if (!job.messageId) return;
    try {
      if (this.deps.broadcastStatus) {
        await this.deps.broadcastStatus(job.empresaId, job.messageId, status);
        return;
      }
      const { broadcastAssistantMessageStatus } = await import('../messageHandler.js');
      broadcastAssistantMessageStatus(job.empresaId, job.messageId, status);
    } catch (error) {
      console.warn('[outbound] status broadcast skipped', error instanceof Error ? error.message : 'unknown');
    }
  }

  async runOnce(workerId = `outbound-worker-${process.pid}`): Promise<boolean> {
    await this.deps.queue.releaseExpired();
    const job = await this.deps.queue.claim(workerId);
    if (!job) return false;
    if (!job.phone && !job.conversationJid) {
      await this.deps.queue.failBeforeDispatch(job, 'Destinatário ausente para envio.');
      return false;
    }

    // `internal_system` is an operational notification (for example, the
    // manager side of an escalation), not a CRM campaign/automation. It must
    // still use the durable worker but is deliberately outside CRM rollout.
    if (job.jobType !== 'conversation' && job.origin !== 'internal_system') {
      try {
        const rollout = await (this.deps.getRolloutFlags ?? getCrmRolloutFlags)(job.empresaId);
        if (!isOutboundJobAllowed(rollout, { jobType: job.jobType })) {
          await this.deps.queue.defer(job, 'Este recurso está pausado temporariamente; a fila será retomada depois.');
          return false;
        }
      } catch (error) {
        console.warn('[outbound] rollout indisponível; job mantido na fila', error instanceof Error ? error.message : 'unknown');
        await this.deps.queue.defer(job, 'O envio está temporariamente pausado; a fila será retomada depois.');
        return false;
      }
    }

    const instance = job.instanceKey || await (this.deps.resolveInstance ?? getInstanceForEmpresa)(job.empresaId);
    const executionKey = this.executionKey(job, instance);
    if (this.locks.has(executionKey)) {
      await this.deps.queue.defer(job, 'Outra mensagem desta conexão está sendo enviada.');
      return false;
    }
    this.locks.add(executionKey);
    let transportStarted = false;
    try {
      const status = await (this.deps.getStatus ?? fetchInstanceConnectionState)(instance);
      if (status !== 'connected') {
        await this.deps.queue.defer(job, 'Conexão indisponível; a mensagem ficará na fila.');
        return false;
      }
      const check = await (this.deps.validate?.(job) ?? validateOutboundJob(job));
      if (check.action === 'defer') { await this.deps.queue.defer(job, check.reason ?? 'Envio aguardando condições seguras.'); return false; }
      if (check.action === 'suppress') { await this.deps.queue.suppress(job, check.reason ?? 'Destinatário não elegível.'); return false; }

      let prepared;
      try {
        prepared = await this.transport.prepare({ ...job, instanceKey: instance });
      } catch (cause) {
        await this.deps.queue.failBeforeDispatch(job, cause instanceof Error ? cause.message : 'Payload inválido para envio.');
        await this.broadcastStatus(job, 'failed_before_dispatch');
        return false;
      }
      transportStarted = await this.deps.queue.startTransport(job);
      if (!transportStarted) return false;
      await this.broadcastStatus(job, 'dispatch_started');
      const dispatchJob: OutboundJob = { ...job, instanceKey: instance, status: 'dispatch_started' };
      const result = await this.transport.send({ ...prepared, job: dispatchJob } as typeof prepared);
      if (result.state === 'delivery_uncertain') {
        await this.deps.queue.deliveryUncertain(dispatchJob, result.reason);
        await this.broadcastStatus(job, 'delivery_uncertain');
        return true;
      }
      const completed = await this.deps.queue.complete(dispatchJob, result.providerMessageId);
      if (completed) await this.broadcastStatus(job, 'sent');
      return completed;
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'Falha ao enviar.';
      if (transportStarted) {
        await this.deps.queue.deliveryUncertain({ ...job, status: 'dispatch_started' }, reason);
        await this.broadcastStatus(job, 'delivery_uncertain');
      } else {
        await this.deps.queue.fail(job, reason);
        await this.broadcastStatus(job, 'failed_before_dispatch');
      }
      return false;
    } finally {
      this.locks.delete(executionKey);
    }
  }

  async runBatch(workerId = `outbound-worker-${process.pid}`, limit = 1): Promise<number> {
    const concurrency = Math.max(1, Math.floor(limit));
    const results = await Promise.all(
      Array.from({ length: concurrency }, (_, index) => this.runOnce(`${workerId}-${index + 1}`)),
    );
    return results.filter(Boolean).length;
  }

  start(intervalMs = 1_000, concurrency = Number.parseInt(process.env.OUTBOUND_WORKER_CONCURRENCY || '1', 10)): void {
    if (this.running) return;
    this.running = true;
    const tick = () => { if (!this.running) return; void this.runBatch(`outbound-worker-${process.pid}`, concurrency).catch((error) => console.error('[outbound] worker tick failed', error instanceof Error ? error.message : 'unknown')).finally(() => setTimeout(tick, intervalMs)); };
    void tick();
  }
  stop(): void { this.running = false; }
}

export const canUseAutomationPhoneSnapshot = (job: OutboundJob, pessoaId: string | null): boolean =>
  job.jobType === 'automation' && !pessoaId && Boolean(job.phone);

async function validateOutboundJob(job: OutboundJob): Promise<{ action: 'send' | 'defer' | 'suppress'; reason?: string }> {
  if (job.jobType === 'conversation') return { action: 'send' };
  const db = getServiceSupabase();
  if (job.campaignId) {
    const { data, error } = await db.from('zelochat_campaigns').select('status,scheduled_at').eq('id', job.campaignId).eq('empresa_id', job.empresaId).maybeSingle();
    if (error) throw error;
    if (!data || data.status === 'paused' || data.status === 'cancelled') return { action: 'defer', reason: 'Campanha pausada; a fila será retomada depois.' };
    if (data.status === 'scheduled' && (!data.scheduled_at || Date.parse(data.scheduled_at) > Date.now())) return { action: 'defer', reason: 'Campanha agendada; a fila aguardará o horário.' };
  }
  const targetId = job.jobType === 'automation' ? job.automationDispatchId : job.recipientId;
  if (!targetId) return { action: 'send' };
  let recipient: { status: string; pessoa_id: string | null } | null = null;
  if (job.jobType === 'automation') {
    const { data, error } = await db.from('zelochat_automation_dispatches').select('status,pessoa_id').eq('id', targetId).eq('empresa_id', job.empresaId).maybeSingle();
    if (error) throw error; if (!data) return { action: 'suppress', reason: 'Jornada não encontrada.' }; recipient = { status: data.status, pessoa_id: data.pessoa_id };
  } else {
    const { data, error } = await db.from('zelochat_campaign_recipients').select('status,pessoa_id').eq('id', targetId).eq('empresa_id', job.empresaId).maybeSingle();
    if (error) throw error; if (!data) return { action: 'suppress', reason: 'Destinatário não encontrado.' }; recipient = data;
  }
  if (!recipient || !['queued', 'sending'].includes(recipient.status)) return { action: 'suppress', reason: 'Destinatário já não está na fila.' };
  if (canUseAutomationPhoneSnapshot(job, recipient.pessoa_id)) return { action: 'send' };
  if (!recipient.pessoa_id) return { action: 'suppress', reason: 'missing_phone' };
  const pessoaId = recipient.pessoa_id;
  const [{ data: person, error: personError }, { data: relationship, error: relationshipError }, { data: optout, error: optoutError }, { data: conflicts, error: conflictError }] = await Promise.all([
    db.from('pessoas').select('id,tipo,contato').eq('id', pessoaId).maybeSingle(),
    db.from('zelochat_customer_relationships').select('whatsapp_blocked_at').eq('empresa_id', job.empresaId).eq('pessoa_id', pessoaId).maybeSingle(),
    db.from('zelochat_customer_optouts').select('id').eq('empresa_id', job.empresaId).eq('pessoa_id', pessoaId).maybeSingle(),
    db.from('zelochat_person_match_conflicts').select('candidate_person_ids').eq('empresa_id', job.empresaId).eq('state', 'open'),
  ]);
  if (personError || relationshipError || optoutError || conflictError) throw personError ?? relationshipError ?? optoutError ?? conflictError;
  const conflict = (conflicts ?? []).some((row) => Array.isArray(row.candidate_person_ids) && row.candidate_person_ids.includes(pessoaId));
  if (optout) return { action: 'suppress', reason: 'opt_out' };
  if (relationship?.whatsapp_blocked_at) return { action: 'suppress', reason: 'blocked' };
  if (conflict) return { action: 'suppress', reason: 'identity_conflict' };
  if (!person || person.tipo !== 'cliente' || !person.contato) return { action: 'suppress', reason: 'missing_phone' };
  return { action: 'send' };
}

let startedWorker: OutboundWorker | null = null;
let cleanupTimer: NodeJS.Timeout | null = null;
export function startOutboundWorker(): OutboundWorker {
  if (!startedWorker) {
    startedWorker = new OutboundWorker({ queue: new OutboundQueue(createSupabaseOutboundJobStore()) });
    startedWorker.start();
    void cleanupTerminalOutboundMedia().catch((error) => console.warn('[outbound] limpeza de mídia adiada', error instanceof Error ? error.message : 'unknown'));
    cleanupTimer = setInterval(() => { void cleanupTerminalOutboundMedia().catch((error) => console.warn('[outbound] limpeza de mídia adiada', error instanceof Error ? error.message : 'unknown')); }, 60 * 60 * 1000);
    cleanupTimer.unref();
  }
  return startedWorker;
}
