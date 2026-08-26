import { getEmpresaUserId, getServiceSupabase } from '../supabase.js';
import { resolveCustomerForOrder } from './identity.js';

export type BackfillOutcome = 'linked' | 'created' | 'incomplete' | 'conflict' | 'failed';
export type BackfillCounts = Record<BackfillOutcome, number>;
export interface BackfillRow { id: string; remote_jid: string; customer_phone: string | null; customer_name: string | null; updated_at: string; }
export interface BackfillCheckpoint { cursor: string | null; counts: BackfillCounts; }
export interface BackfillDependencies {
  fetchSessions(empresaId: string, cursor: string | null, limit: number): Promise<BackfillRow[]>;
  resolve(row: BackfillRow): Promise<{ status: BackfillOutcome; pessoaId: string | null }>;
  updateSession(id: string, pessoaId: string | null): Promise<void>;
  loadCheckpoint(empresaId: string): Promise<BackfillCheckpoint>;
  saveCheckpoint(empresaId: string, checkpoint: BackfillCheckpoint): Promise<void>;
}

function emptyCounts(): BackfillCounts { return { linked: 0, created: 0, incomplete: 0, conflict: 0, failed: 0 }; }
function mergeCounts(a: BackfillCounts, b: BackfillCounts): BackfillCounts {
  return { linked: a.linked + b.linked, created: a.created + b.created, incomplete: a.incomplete + b.incomplete, conflict: a.conflict + b.conflict, failed: a.failed + b.failed };
}

/** Resumable, bounded and side-effect free apart from CRM rows/checkpoint. */
export async function runCustomerBackfill(input: {
  empresaId: string;
  batchSize?: number;
  dryRun?: boolean;
  dependencies: BackfillDependencies;
}): Promise<BackfillCheckpoint & { processed: number }> {
  const limit = Math.max(1, Math.min(input.batchSize ?? 100, 500));
  const checkpoint = await input.dependencies.loadCheckpoint(input.empresaId);
  const rows = await input.dependencies.fetchSessions(input.empresaId, checkpoint.cursor, limit);
  let counts = checkpoint.counts;
  for (const row of rows) {
    try {
      const result = await input.dependencies.resolve(row);
      counts = mergeCounts(counts, { ...emptyCounts(), [result.status]: 1 });
      if (!input.dryRun && (result.status === 'linked' || result.status === 'created')) {
        await input.dependencies.updateSession(row.id, result.pessoaId);
      }
    } catch (error) {
      console.error(`[customers] backfill row ${row.id} failed:`, error);
      counts = mergeCounts(counts, { ...emptyCounts(), failed: 1 });
    }
  }
  const last = rows[rows.length - 1];
  const nextCursor = rows.length === limit && last ? `${last.updated_at}|${last.id}` : null;
  const next = { cursor: nextCursor, counts };
  if (!input.dryRun) await input.dependencies.saveCheckpoint(input.empresaId, next);
  return { ...next, processed: rows.length };
}

export function createSupabaseBackfillDependencies(empresaId: string): BackfillDependencies {
  return {
    async fetchSessions(empresaId, cursor, limit) {
      let query = getServiceSupabase().from('zelochat_sessions')
        .select('id, remote_jid, customer_phone, customer_name, updated_at')
        .eq('empresa_id', empresaId).order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(limit);
      if (cursor) {
        const [timestamp, id] = cursor.split('|');
        query = query.or(`updated_at.gt.${timestamp},and(updated_at.eq.${timestamp},id.gt.${id ?? ''})`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data as BackfillRow[]) ?? [];
    },
    async resolve(row) {
      const owner = await getEmpresaUserId(empresaId);
      if (!owner) return { status: 'incomplete', pessoaId: null };
      const result = await resolveCustomerForOrder({ empresaId, ownerUserId: owner, phone: row.customer_phone, observedName: row.customer_name });
      return { status: result.status, pessoaId: result.pessoaId };
    },
    async updateSession(id, pessoaId) {
      const { error } = await getServiceSupabase().from('zelochat_sessions').update({ pessoa_id: pessoaId }).eq('id', id);
      if (error) throw error;
    },
    async loadCheckpoint(empresaId) {
      const { data, error } = await getServiceSupabase().from('zelochat_customer_backfill_state').select('cursor, counts').eq('empresa_id', empresaId).maybeSingle();
      if (error) throw error;
      return { cursor: (data?.cursor as string | null) ?? null, counts: { ...emptyCounts(), ...((data?.counts as Partial<BackfillCounts>) ?? {}) } };
    },
    async saveCheckpoint(empresaId, checkpoint) {
      const { error } = await getServiceSupabase().from('zelochat_customer_backfill_state').upsert({ empresa_id: empresaId, cursor: checkpoint.cursor, counts: checkpoint.counts, updated_at: new Date().toISOString() }, { onConflict: 'empresa_id' });
      if (error) throw error;
    },
  };
}
