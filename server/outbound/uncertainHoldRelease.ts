import { getServiceSupabase } from '../supabase.js';
import { recordConversationOutboundMetric } from './observability.js';
import { wakeOutboundWorker } from './wake.js';

/**
 * FIX 2026-09-14: a send that failed ambiguously (provider timeout, 500, 401)
 * becomes `delivery_uncertain` and puts its conversation on hold, so nothing
 * else goes out ahead of an answer about it. Nothing ever called
 * `release_zelochat_outbound_hold`, so the hold was permanent: the Bem Servido
 * delivery driver stopped receiving "Nova entrega" for four days and customers
 * lost "saiu pra entrega", with nobody told. Holds are now released after a
 * short grace period. The uncertain message itself is never resent — it keeps
 * its "Não foi possível confirmar a entrega" mark for the operator.
 */
export const DELIVERY_UNCERTAIN_HOLD_GRACE_MS = (() => {
  const value = Number.parseInt(process.env.DELIVERY_UNCERTAIN_HOLD_GRACE_MS || '', 10);
  return Number.isFinite(value) && value >= 0 ? value : 3 * 60_000;
})();

export interface ConversationHold {
  controlId: string;
  empresaId: string;
  holdJobId: string;
  holdReason: string | null;
}

export interface HoldJobState {
  id: string;
  status: string;
  updatedAt: string;
}

export interface UncertainHoldStore {
  listHolds(): Promise<ConversationHold[]>;
  getJobs(ids: string[]): Promise<HoldJobState[]>;
  release(hold: ConversationHold): Promise<string | null>;
}

/**
 * Only `delivery_uncertain` holds are ours to release. `from_me_pending_correlation`
 * waits for the WhatsApp echo and is released by the native from-me path.
 * A hold whose job is no longer uncertain (or no longer exists) protects nothing.
 */
export function selectReleasableHolds(
  holds: ConversationHold[],
  jobs: HoldJobState[],
  now: Date,
  graceMs: number = DELIVERY_UNCERTAIN_HOLD_GRACE_MS,
): ConversationHold[] {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  return holds.filter((hold) => {
    if (hold.holdReason !== 'delivery_uncertain') return false;
    const job = jobsById.get(hold.holdJobId);
    if (!job || job.status !== 'delivery_uncertain') return true;
    const settledAt = Date.parse(job.updatedAt);
    return Number.isFinite(settledAt) && now.getTime() - settledAt >= graceMs;
  });
}

export function createSupabaseUncertainHoldStore(): UncertainHoldStore {
  const db = getServiceSupabase();
  return {
    async listHolds() {
      const { data, error } = await db
        .from('zelochat_conversation_ai_control')
        .select('id,empresa_id,hold_job_id,hold_reason')
        .not('hold_job_id', 'is', null)
        .limit(500);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        controlId: row.id, empresaId: row.empresa_id, holdJobId: row.hold_job_id, holdReason: row.hold_reason,
      }));
    },
    async getJobs(ids) {
      if (!ids.length) return [];
      const { data, error } = await db.from('zelochat_outbound_jobs').select('id,status,updated_at').in('id', ids);
      if (error) throw error;
      return (data ?? []).map((row) => ({ id: row.id, status: row.status, updatedAt: row.updated_at }));
    },
    async release(hold) {
      const { data, error } = await db.rpc('release_zelochat_outbound_hold', {
        p_empresa_id: hold.empresaId, p_conversation_control_id: hold.controlId, p_resolved_job_id: hold.holdJobId,
      });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
  };
}

export async function releaseStaleUncertainHolds(
  store: UncertainHoldStore = createSupabaseUncertainHoldStore(),
  now: Date = new Date(),
  graceMs: number = DELIVERY_UNCERTAIN_HOLD_GRACE_MS,
): Promise<number> {
  const holds = await store.listHolds();
  if (!holds.length) return 0;
  const jobs = await store.getJobs([...new Set(holds.map((hold) => hold.holdJobId))]);
  let released = 0;
  for (const hold of selectReleasableHolds(holds, jobs, now, graceMs)) {
    try {
      await store.release(hold);
      released += 1;
      recordConversationOutboundMetric('delivery_uncertain_hold_released', {}, { empresaId: hold.empresaId, jobId: hold.holdJobId });
    } catch (error) {
      console.error('[outbound] uncertain hold release failed', error instanceof Error ? error.message : 'unknown');
    }
  }
  if (released) wakeOutboundWorker();
  return released;
}
