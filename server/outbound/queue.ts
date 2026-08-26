import { nextRetryAt } from './policy.js';

export type OutboundStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';
export interface OutboundJobInput { id?: string; empresaId: string; instanceKey: string; recipientId?: string; campaignId?: string; idempotencyKey: string; phone?: string | null; text: string; }
export interface OutboundJob { id: string; empresaId: string; instanceKey: string; recipientId?: string; campaignId?: string; idempotencyKey: string; phone?: string | null; text: string; status: OutboundStatus; attempts: number; leaseExpiresAt?: string | null; }
export interface OutboundJobStore {
  insert(job: OutboundJobInput): Promise<OutboundJob>;
  claim(workerId: string, leaseMs: number): Promise<OutboundJob | null>;
  markSent(id: string, messageId: string): Promise<void>;
  markFailed(id: string, reason: string, retryAt: Date | null): Promise<void>;
  releaseExpired(): Promise<void>;
}

export class OutboundQueue {
  private readonly seen = new Map<string, OutboundJob>();
  constructor(private readonly store: OutboundJobStore, private readonly maxAttempts = 3) {}
  async enqueue(input: OutboundJobInput): Promise<OutboundJob> {
    const existing = this.seen.get(input.idempotencyKey);
    if (existing) return existing;
    const job = await this.store.insert({ ...input, text: input.text.trim() });
    this.seen.set(input.idempotencyKey, job);
    return job;
  }
  claim(workerId: string, leaseMs = 120_000): Promise<OutboundJob | null> { return this.store.claim(workerId, leaseMs); }
  async complete(job: OutboundJob, messageId: string): Promise<void> { if (!messageId.trim()) throw new Error('A mensagem precisa ter um identificador de envio.'); await this.store.markSent(job.id, messageId); }
  async fail(job: OutboundJob, reason: string): Promise<void> { await this.store.markFailed(job.id, reason, nextRetryAt(job.attempts, new Date())); }
  releaseExpired(): Promise<void> { return this.store.releaseExpired(); }
}
