import { getServiceSupabase } from '../supabase.js';
import { evaluateAutomationCandidate, type AutomationCandidate, type EvaluatedDispatch } from './evaluator.js';
import { getDefaultAutomationRule, type AutomationKind, type AutomationRule } from './rules.js';

export type AutomationSweepDependencies = {
  listRules: () => Promise<AutomationRule[]>;
  listCandidates: (rule: AutomationRule) => Promise<AutomationCandidate[]>;
  now?: () => Date;
  persist: (rule: AutomationRule, dispatch: EvaluatedDispatch) => Promise<void>;
};

export async function runAutomationSweep(deps: AutomationSweepDependencies): Promise<{ eligible: number; suppressed: number }> {
  let eligible = 0; let suppressed = 0;
  for (const rule of await deps.listRules()) {
    try {
      for (const candidate of await deps.listCandidates(rule)) {
        const dispatch = evaluateAutomationCandidate(rule.kind, candidate, rule, deps.now?.() ?? new Date());
        await deps.persist(rule, dispatch);
        if (dispatch.status === 'eligible') eligible++; else suppressed++;
      }
    } catch (error) { console.error(`[automations] jornada ${rule.kind} falhou; próxima rodada tentará novamente`, error); }
  }
  return { eligible, suppressed };
}

export async function persistAutomationDispatch(rule: AutomationRule, dispatch: EvaluatedDispatch): Promise<void> {
  const db = getServiceSupabase();
  const { data, error } = await db.from('zelochat_automation_dispatches').upsert({ empresa_id: rule.empresaId, rule_id: rule.id, pessoa_id: dispatch.pessoaId, event_key: dispatch.eventKey, status: dispatch.status, message: dispatch.message, phone_snapshot: dispatch.phone, suppression_reason: dispatch.suppressionReason ?? null }, { onConflict: 'rule_id,event_key', ignoreDuplicates: true }).select('id,status').maybeSingle();
  if (error) throw error;
  if (!data || dispatch.status !== 'eligible' || !dispatch.phone) return;
  const { data: job, error: jobError } = await db.from('zelochat_outbound_jobs').upsert({ empresa_id: rule.empresaId, recipient_id: data.id, pessoa_id: dispatch.pessoaId, job_type: 'automation', idempotency_key: dispatch.eventKey, phone_snapshot: dispatch.phone, message: dispatch.message, status: 'queued', next_attempt_at: new Date().toISOString() }, { onConflict: 'idempotency_key', ignoreDuplicates: true }).select('id').maybeSingle();
  if (jobError) throw jobError;
  if (job?.id) await db.from('zelochat_automation_dispatches').update({ status: 'queued', outbound_job_id: job.id, queued_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', data.id);
}

let sweepHandle: NodeJS.Timeout | null = null;
export function startAutomationSweeper(): void {
  if (sweepHandle) return;
  const tick = () => {
    void runAutomationSweep({
      listRules: async () => { const { data } = await getServiceSupabase().from('zelochat_automation_rules').select('*').eq('enabled', true).limit(500); return (data ?? []).map((row: any) => ({ ...getDefaultAutomationRule(row.kind), ...row, empresaId: row.empresa_id, sendStart: row.send_start, sendEnd: row.send_end })); },
      listCandidates: async () => [],
      persist: persistAutomationDispatch,
    }).catch((error) => console.error('[automations] tick failed', error));
  };
  setTimeout(tick, 180_000).unref?.();
  sweepHandle = setInterval(tick, 900_000); sweepHandle.unref?.();
}

export function stopAutomationSweeper(): void { if (sweepHandle) clearInterval(sweepHandle); sweepHandle = null; }

export function defaultRuleForKind(kind: AutomationKind): AutomationRule { return getDefaultAutomationRule(kind); }
