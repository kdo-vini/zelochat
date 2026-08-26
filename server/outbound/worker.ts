import { getServiceSupabase } from '../supabase.js';
import { getInstanceForEmpresa } from '../instanceManager.js';
import { fetchInstanceConnectionState, sendTextMessage } from '../whatsapp.js';
import { OutboundQueue, type OutboundJob, type OutboundJobInput, type OutboundJobStore } from './queue.js';

export function createSupabaseOutboundJobStore(): OutboundJobStore {
  const db = getServiceSupabase();
  return {
    async insert(input: OutboundJobInput) {
      const { data, error } = await db.from('zelochat_outbound_jobs').upsert({ empresa_id: input.empresaId, campaign_id: input.campaignId ?? null, recipient_id: input.recipientId ?? null, pessoa_id: input.recipientId ?? null, job_type: input.jobType ?? 'campaign', instance_key: input.instanceKey, idempotency_key: input.idempotencyKey, phone_snapshot: input.phone ?? null, message: input.text, status: 'queued', next_attempt_at: new Date().toISOString() }, { onConflict: 'idempotency_key', ignoreDuplicates: true }).select('id,empresa_id,campaign_id,recipient_id,job_type,idempotency_key,phone_snapshot,message,status,attempts,lease_expires_at,instance_key').maybeSingle();
      if (error || !data) throw error ?? new Error('JOB_INSERT_FAILED');
      return { id: data.id, empresaId: data.empresa_id, instanceKey: data.instance_key ?? input.instanceKey, campaignId: data.campaign_id ?? undefined, jobType: data.job_type ?? input.jobType ?? 'campaign', recipientId: data.recipient_id ?? undefined, idempotencyKey: data.idempotency_key, phone: data.phone_snapshot, text: data.message, status: data.status, attempts: data.attempts, leaseExpiresAt: data.lease_expires_at };
    },
    async claim(workerId, leaseMs) { const { data, error } = await db.rpc('claim_zelochat_outbound_job', { p_worker: workerId, p_lease_seconds: Math.ceil(leaseMs / 1000) }); if (error || !data?.[0]) return null; const row = data[0]; if (row.recipient_id && row.job_type === 'campaign') await db.from('zelochat_campaign_recipients').update({ status: 'sending', updated_at: new Date().toISOString() }).eq('id', row.recipient_id).in('status', ['queued', 'sending']); if (row.recipient_id && row.job_type === 'automation') await db.from('zelochat_automation_dispatches').update({ status: 'sending', updated_at: new Date().toISOString() }).eq('id', row.recipient_id).eq('status', 'queued'); return { id: row.id, empresaId: row.empresa_id, instanceKey: row.instance_key ?? '', jobType: row.job_type ?? 'campaign', recipientId: row.recipient_id ?? undefined, campaignId: row.campaign_id ?? undefined, idempotencyKey: row.idempotency_key, phone: row.phone_snapshot, text: row.message, status: row.status, attempts: row.attempts, leaseExpiresAt: row.lease_expires_at }; },
    async markSent(id, messageId) { const { data: job, error: lookupError } = await db.from('zelochat_outbound_jobs').select('recipient_id,job_type').eq('id', id).maybeSingle(); if (lookupError) throw lookupError; const now = new Date().toISOString(); const { error } = await db.from('zelochat_outbound_jobs').update({ status: 'sent', provider_message_id: messageId, sent_at: now, lease_owner: null, lease_expires_at: null, updated_at: now }).eq('id', id); if (error) throw error; if (job?.recipient_id && job.job_type === 'campaign') await db.from('zelochat_campaign_recipients').update({ status: 'sent', provider_message_id: messageId, sent_at: now, updated_at: now }).eq('id', job.recipient_id); if (job?.recipient_id && job.job_type === 'automation') await db.from('zelochat_automation_dispatches').update({ status: 'sent', sent_at: now, updated_at: now }).eq('id', job.recipient_id); },
    async markFailed(id, reason, retryAt) { const { data: job, error: lookupError } = await db.from('zelochat_outbound_jobs').select('recipient_id,job_type').eq('id', id).maybeSingle(); if (lookupError) throw lookupError; const nextStatus = retryAt ? 'queued' : 'failed'; const now = new Date().toISOString(); const { error } = await db.from('zelochat_outbound_jobs').update({ status: nextStatus, last_error: reason, next_attempt_at: retryAt?.toISOString() ?? now, lease_owner: null, lease_expires_at: null, updated_at: now }).eq('id', id); if (error) throw error; if (job?.recipient_id && job.job_type === 'campaign') await db.from('zelochat_campaign_recipients').update({ status: nextStatus === 'queued' ? 'queued' : 'failed', last_error: reason, updated_at: now }).eq('id', job.recipient_id); if (job?.recipient_id && job.job_type === 'automation') await db.from('zelochat_automation_dispatches').update({ status: nextStatus, last_error: reason, updated_at: now }).eq('id', job.recipient_id); },
    async defer(id, reason, retryAt = new Date(Date.now() + 60_000)) { const { data: job, error: lookupError } = await db.from('zelochat_outbound_jobs').select('recipient_id').eq('id', id).maybeSingle(); if (lookupError) throw lookupError; const now = new Date().toISOString(); const { error } = await db.from('zelochat_outbound_jobs').update({ status: 'queued', attempts: 0, last_error: reason, next_attempt_at: retryAt.toISOString(), lease_owner: null, lease_expires_at: null, updated_at: now }).eq('id', id); if (error) throw error; if (job?.recipient_id) { await db.from('zelochat_campaign_recipients').update({ status: 'queued', last_error: reason, updated_at: now }).eq('id', job.recipient_id); await db.from('zelochat_automation_dispatches').update({ status: 'queued', last_error: reason, updated_at: now }).eq('id', job.recipient_id); } },
    async markSuppressed(id, reason) { const { data: job, error: lookupError } = await db.from('zelochat_outbound_jobs').select('recipient_id').eq('id', id).maybeSingle(); if (lookupError) throw lookupError; const now = new Date().toISOString(); const { error } = await db.from('zelochat_outbound_jobs').update({ status: 'cancelled', last_error: reason, lease_owner: null, lease_expires_at: null, updated_at: now }).eq('id', id); if (error) throw error; if (job?.recipient_id) { await db.from('zelochat_campaign_recipients').update({ status: 'suppressed', suppression_reason: reason, updated_at: now }).eq('id', job.recipient_id); await db.from('zelochat_automation_dispatches').update({ status: 'suppressed', suppression_reason: reason, updated_at: now }).eq('id', job.recipient_id); } },
    async releaseExpired() { await db.from('zelochat_outbound_jobs').update({ status: 'queued', lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq('status', 'sending').lt('lease_expires_at', new Date().toISOString()); },
  };
}

export interface OutboundWorkerDependencies { queue: OutboundQueue; resolveInstance?: (empresaId: string) => Promise<string>; getStatus?: (instance: string) => Promise<string>; send?: (phone: string, text: string, empresaId: string) => Promise<string | undefined>; validate?: (job: OutboundJob) => Promise<{ action: 'send' | 'defer' | 'suppress'; reason?: string }>; }
export class OutboundWorker {
  private running = false;
  private readonly locks = new Set<string>();
  constructor(private readonly deps: OutboundWorkerDependencies) {}
  async runOnce(workerId = `campaign-worker-${process.pid}`): Promise<boolean> {
    await this.deps.queue.releaseExpired(); const job = await this.deps.queue.claim(workerId); if (!job || !job.phone) return false;
    const instance = job.instanceKey || await (this.deps.resolveInstance ?? getInstanceForEmpresa)(job.empresaId); if (this.locks.has(instance)) { await this.deps.queue.defer(job, 'Outra mensagem desta conexão está sendo enviada.'); return false; }
    this.locks.add(instance);
    try {
      const status = await (this.deps.getStatus ?? fetchInstanceConnectionState)(instance); if (status !== 'connected') { await this.deps.queue.defer(job, 'Conexão indisponível; a mensagem ficará na fila.'); return false; }
      const check = await (this.deps.validate?.(job) ?? validateOutboundJob(job)); if (check.action === 'defer') { await this.deps.queue.defer(job, check.reason ?? 'Envio aguardando condições seguras.'); return false; } if (check.action === 'suppress') { await this.deps.queue.suppress(job, check.reason ?? 'Destinatário não elegível.'); return false; }
      const messageId = await (this.deps.send ?? sendTextMessage)(job.phone, job.text, job.empresaId); if (!messageId) throw new Error('SEND_ID_MISSING'); await this.deps.queue.complete(job, messageId); return true;
    } catch (cause) { await this.deps.queue.fail(job, cause instanceof Error ? cause.message : 'Falha ao enviar.'); return false; } finally { this.locks.delete(instance); }
  }
  start(intervalMs = 1_000): void { if (this.running) return; this.running = true; const tick = () => { if (!this.running) return; void this.runOnce().finally(() => setTimeout(tick, intervalMs)); }; void tick(); }
  stop(): void { this.running = false; }
}

async function validateOutboundJob(job: OutboundJob): Promise<{ action: 'send' | 'defer' | 'suppress'; reason?: string }> {
  const db = getServiceSupabase();
  if (job.campaignId) { const { data, error } = await db.from('zelochat_campaigns').select('status,scheduled_at').eq('id', job.campaignId).eq('empresa_id', job.empresaId).maybeSingle(); if (error) throw error; if (!data || data.status === 'paused' || data.status === 'cancelled') return { action: 'defer', reason: 'Campanha pausada; a fila será retomada depois.' }; if (data.status === 'scheduled' && (!data.scheduled_at || Date.parse(data.scheduled_at) > Date.now())) return { action: 'defer', reason: 'Campanha agendada; a fila aguardará o horário.' }; }
  if (!job.recipientId) return { action: 'send' };
  let recipient: { status: string; pessoa_id: string } | null = null;
  if (job.jobType === 'automation') { const { data, error } = await db.from('zelochat_automation_dispatches').select('status,pessoa_id').eq('id', job.recipientId).maybeSingle(); if (error) throw error; if (!data) return { action: 'suppress', reason: 'Jornada não encontrada.' }; recipient = { status: data.status, pessoa_id: data.pessoa_id }; }
  else { const { data, error } = await db.from('zelochat_campaign_recipients').select('status,pessoa_id').eq('id', job.recipientId).maybeSingle(); if (error) throw error; if (!data) return { action: 'suppress', reason: 'Destinatário não encontrado.' }; recipient = data; }
  const pessoaId = recipient.pessoa_id;
  const [{ data: person, error: personError }, { data: relationship, error: relationshipError }, { data: optout, error: optoutError }, { data: conflicts, error: conflictError }] = await Promise.all([
    db.from('pessoas').select('id,tipo,contato').eq('id', pessoaId).maybeSingle(),
    db.from('zelochat_customer_relationships').select('whatsapp_blocked_at').eq('empresa_id', job.empresaId).eq('pessoa_id', pessoaId).maybeSingle(),
    db.from('zelochat_customer_optouts').select('id').eq('empresa_id', job.empresaId).eq('pessoa_id', pessoaId).maybeSingle(),
    db.from('zelochat_person_match_conflicts').select('candidate_person_ids').eq('empresa_id', job.empresaId).eq('state', 'open'),
  ]); if (personError || relationshipError || optoutError || conflictError) throw personError ?? relationshipError ?? optoutError ?? conflictError;
  const conflict = (conflicts ?? []).some((row) => Array.isArray(row.candidate_person_ids) && row.candidate_person_ids.includes(pessoaId));
  if (!pessoaId) return { action: 'send' };
  if (!recipient || !['queued', 'sending'].includes(recipient.status)) return { action: 'suppress', reason: 'Destinatário já não está na fila.' }; if (optout) return { action: 'suppress', reason: 'opt_out' }; if (relationship?.whatsapp_blocked_at) return { action: 'suppress', reason: 'blocked' }; if (conflict) return { action: 'suppress', reason: 'identity_conflict' }; if (!person || person.tipo !== 'cliente' || !person.contato) return { action: 'suppress', reason: 'missing_phone' }; return { action: 'send' };
}

let startedWorker: OutboundWorker | null = null;
export function startOutboundWorker(): OutboundWorker { if (!startedWorker) { startedWorker = new OutboundWorker({ queue: new OutboundQueue(createSupabaseOutboundJobStore()) }); startedWorker.start(); } return startedWorker; }
