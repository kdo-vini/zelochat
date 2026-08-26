import { getServiceSupabase } from '../supabase.js';
import { getInstanceForEmpresa } from '../instanceManager.js';
import { fetchInstanceConnectionState, sendTextMessage } from '../whatsapp.js';
import { OutboundQueue, type OutboundJob, type OutboundJobInput, type OutboundJobStore } from './queue.js';

export function createSupabaseOutboundJobStore(): OutboundJobStore {
  const db = getServiceSupabase();
  return {
    async insert(input: OutboundJobInput) {
      const { data, error } = await db.from('zelochat_outbound_jobs').upsert({ empresa_id: input.empresaId, campaign_id: input.campaignId ?? null, recipient_id: input.recipientId ?? null, idempotency_key: input.idempotencyKey, phone_snapshot: input.phone ?? null, message: input.text, status: 'queued', next_attempt_at: new Date().toISOString() }, { onConflict: 'idempotency_key', ignoreDuplicates: true }).select('id,empresa_id,campaign_id,recipient_id,idempotency_key,phone_snapshot,message,status,attempts,lease_expires_at').maybeSingle();
      if (error || !data) throw error ?? new Error('JOB_INSERT_FAILED');
      return { id: data.id, empresaId: data.empresa_id, instanceKey: input.instanceKey, campaignId: data.campaign_id ?? undefined, recipientId: data.recipient_id ?? undefined, idempotencyKey: data.idempotency_key, phone: data.phone_snapshot, text: data.message, status: data.status, attempts: data.attempts, leaseExpiresAt: data.lease_expires_at };
    },
    async claim(workerId, leaseMs) { const { data, error } = await db.rpc('claim_zelochat_outbound_job', { p_worker: workerId, p_lease_seconds: Math.ceil(leaseMs / 1000) }); if (error || !data?.[0]) return null; const row = data[0]; return { id: row.id, empresaId: row.empresa_id, instanceKey: '', recipientId: row.recipient_id ?? undefined, campaignId: row.campaign_id ?? undefined, idempotencyKey: row.idempotency_key, phone: row.phone_snapshot, text: row.message, status: row.status, attempts: row.attempts, leaseExpiresAt: row.lease_expires_at }; },
    async markSent(id, messageId) { const { error } = await db.from('zelochat_outbound_jobs').update({ status: 'sent', provider_message_id: messageId, sent_at: new Date().toISOString(), lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq('id', id); if (error) throw error; if (messageId) await db.from('zelochat_campaign_recipients').update({ status: 'sent', provider_message_id: messageId, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id); },
    async markFailed(id, reason, retryAt) { const { error } = await db.from('zelochat_outbound_jobs').update({ status: retryAt ? 'queued' : 'failed', last_error: reason, next_attempt_at: retryAt?.toISOString() ?? new Date().toISOString(), lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq('id', id); if (error) throw error; },
    async releaseExpired() { await db.from('zelochat_outbound_jobs').update({ status: 'queued', lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq('status', 'sending').lt('lease_expires_at', new Date().toISOString()); },
  };
}

export interface OutboundWorkerDependencies { queue: OutboundQueue; resolveInstance?: (empresaId: string) => Promise<string>; getStatus?: (instance: string) => Promise<string>; send?: (phone: string, text: string, empresaId: string) => Promise<string | undefined>; }
export class OutboundWorker {
  private running = false;
  private readonly locks = new Set<string>();
  constructor(private readonly deps: OutboundWorkerDependencies) {}
  async runOnce(workerId = `campaign-worker-${process.pid}`): Promise<boolean> {
    await this.deps.queue.releaseExpired(); const job = await this.deps.queue.claim(workerId); if (!job || !job.phone) return false;
    const instance = await (this.deps.resolveInstance ?? getInstanceForEmpresa)(job.empresaId); if (this.locks.has(instance)) return false;
    this.locks.add(instance);
    try {
      const status = await (this.deps.getStatus ?? fetchInstanceConnectionState)(instance); if (status !== 'connected') { await this.deps.queue.fail(job, 'Conexão indisponível; a mensagem ficará na fila.'); return false; }
      const messageId = await (this.deps.send ?? sendTextMessage)(job.phone, job.text, job.empresaId); if (!messageId) throw new Error('SEND_ID_MISSING'); await this.deps.queue.complete(job, messageId); return true;
    } catch (cause) { await this.deps.queue.fail(job, cause instanceof Error ? cause.message : 'Falha ao enviar.'); return false; } finally { this.locks.delete(instance); }
  }
  start(intervalMs = 1_000): void { if (this.running) return; this.running = true; const tick = () => { if (!this.running) return; void this.runOnce().finally(() => setTimeout(tick, intervalMs)); }; void tick(); }
  stop(): void { this.running = false; }
}

let startedWorker: OutboundWorker | null = null;
export function startOutboundWorker(): OutboundWorker { if (!startedWorker) { startedWorker = new OutboundWorker({ queue: new OutboundQueue(createSupabaseOutboundJobStore()) }); startedWorker.start(); } return startedWorker; }
