import { randomUUID } from 'node:crypto';
import { getServiceSupabase } from './supabase.js';
import { processFromMeUpsert } from './fromMeProcessor.js';
import type { WebhookAuthStatus } from './webhookLog.js';

export interface WebhookReplayEvent {
  id: string;
  empresaId: string;
  payload: any;
  authStatus: WebhookAuthStatus;
  attemptCount: number;
  leaseOwner: string;
}

export interface ReplayFailure {
  error: string;
  retryAt: Date | null;
  deadLetter: boolean;
}

export interface WebhookReplayWorkerDependencies {
  claim(workerId: string, leaseSeconds: number): Promise<WebhookReplayEvent | null>;
  process(event: WebhookReplayEvent): Promise<unknown>;
  complete(event: WebhookReplayEvent): Promise<boolean>;
  fail(event: WebhookReplayEvent, failure: ReplayFailure): Promise<boolean>;
  now?: () => Date;
}

const MAX_ATTEMPTS = 8;
export function webhookReplayBackoffMs(attemptCount: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attemptCount - 1), 15 * 60_000);
}

function mapEvent(row: any): WebhookReplayEvent {
  return {
    id: row.id,
    empresaId: row.empresa_id,
    payload: row.payload,
    authStatus: row.auth_status,
    attemptCount: Number(row.attempt_count ?? 0),
    leaseOwner: row.lease_owner,
  };
}

function defaultDependencies(): WebhookReplayWorkerDependencies {
  const db = getServiceSupabase();
  return {
    async claim(workerId, leaseSeconds) {
      const { data, error } = await db.rpc('claim_zelochat_webhook_replay', { p_worker: workerId, p_lease_seconds: leaseSeconds });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      return row ? mapEvent(row) : null;
    },
    process: (event) => processFromMeUpsert({ empresaId: event.empresaId, data: event.payload?.data, authStatus: event.authStatus, rawEventId: event.id }),
    async complete(event) {
      const { data, error } = await db.rpc('complete_zelochat_webhook_replay', { p_id: event.id, p_worker: event.leaseOwner });
      if (error) throw new Error(error.message);
      return data === true;
    },
    async fail(event, failure) {
      const { data, error } = await db.rpc('fail_zelochat_webhook_replay', {
        p_id: event.id,
        p_worker: event.leaseOwner,
        p_error: failure.error,
        p_retry_at: failure.retryAt?.toISOString() ?? null,
        p_dead_letter: failure.deadLetter,
      });
      if (error) throw new Error(error.message);
      return data === true;
    },
  };
}

export class WebhookReplayWorker {
  private readonly deps: WebhookReplayWorkerDependencies;
  constructor(dependencies: WebhookReplayWorkerDependencies = defaultDependencies()) { this.deps = dependencies; }

  async runOnce(workerId: string): Promise<boolean> {
    const event = await this.deps.claim(workerId, 120);
    if (!event) return false;
    try {
      await this.deps.process(event);
      return await this.deps.complete(event);
    } catch (error) {
      const deadLetter = event.attemptCount >= MAX_ATTEMPTS;
      const now = (this.deps.now ?? (() => new Date()))();
      const retryAt = deadLetter ? null : new Date(now.getTime() + webhookReplayBackoffMs(event.attemptCount));
      const errorText = error instanceof Error ? error.message : String(error);
      await this.deps.fail(event, { error: errorText.slice(0, 1000), retryAt, deadLetter });
      return false;
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startWebhookReplayWorker(intervalMs = 5_000): void {
  if (timer) return;
  const worker = new WebhookReplayWorker();
  const workerId = `webhook-replay:${process.pid}:${randomUUID()}`;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (let count = 0; count < 20 && await worker.runOnce(workerId); count += 1) { /* drain bounded batch */ }
    } catch (error) {
      console.error('[WebhookReplay] worker cycle failed:', error instanceof Error ? error.message : String(error));
    } finally { running = false; }
  };
  timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();
  void tick();
}
