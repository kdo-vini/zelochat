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
  const { data: profile } = await db.from('empresa_perfil').select('whatsmiau_instance').eq('id', rule.empresaId).maybeSingle();
  const { data: job, error: jobError } = await db.from('zelochat_outbound_jobs').upsert({ empresa_id: rule.empresaId, recipient_id: data.id, pessoa_id: dispatch.pessoaId, job_type: 'automation', idempotency_key: dispatch.eventKey, instance_key: profile?.whatsmiau_instance ?? '', phone_snapshot: dispatch.phone, message: dispatch.message, status: 'queued', next_attempt_at: new Date().toISOString() }, { onConflict: 'idempotency_key', ignoreDuplicates: true }).select('id').maybeSingle();
  if (jobError) throw jobError;
  if (job?.id) await db.from('zelochat_automation_dispatches').update({ status: 'queued', outbound_job_id: job.id, queued_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', data.id);
}

export async function listAutomationCandidatesForRule(rule: AutomationRule): Promise<AutomationCandidate[]> {
  const db = getServiceSupabase(); const { data: profile, error: profileError } = await db.from('empresa_perfil').select('user_id').eq('id', rule.empresaId).maybeSingle(); if (profileError) throw profileError; if (!profile?.user_id) return [];
  const [{ data: people, error: peopleError }, { data: orders }, { data: sessions }, { data: blocked }, { data: optouts }, { data: conflicts }] = await Promise.all([
    db.from('pessoas').select('id,nome,contato,tipo,aniversario_dia,aniversario_mes').eq('id_usuario', profile.user_id),
    db.from('zelo_orders').select('id,pessoa_id,total,status,closed_at,created_at').eq('empresa_id', rule.empresaId).order('created_at', { ascending: false }).limit(10000),
    db.from('zelochat_sessions').select('pessoa_id,last_message_time').eq('empresa_id', rule.empresaId).order('last_message_time', { ascending: false }).limit(10000),
    db.from('zelochat_customer_relationships').select('pessoa_id').eq('empresa_id', rule.empresaId).not('whatsapp_blocked_at', 'is', null),
    db.from('zelochat_customer_optouts').select('pessoa_id').eq('empresa_id', rule.empresaId),
    db.from('zelochat_person_match_conflicts').select('candidate_person_ids').eq('empresa_id', rule.empresaId).eq('state', 'open'),
  ]); if (peopleError) throw peopleError;
  const blockedIds = new Set((blocked ?? []).map((row) => row.pessoa_id)); const optedOutIds = new Set((optouts ?? []).map((row) => row.pessoa_id)); const conflictIds = new Set<string>(); for (const row of conflicts ?? []) for (const id of row.candidate_person_ids ?? []) if (typeof id === 'string') conflictIds.add(id);
  const delivered = (orders ?? []).filter((row) => row.status === 'delivered' && row.pessoa_id); const byPerson = new Map<string, any[]>(); for (const order of delivered) { const list = byPerson.get(order.pessoa_id) ?? []; list.push(order); byPerson.set(order.pessoa_id, list); }
  const lastConversation = new Map<string, string>(); for (const row of sessions ?? []) if (row.pessoa_id && !lastConversation.has(row.pessoa_id)) lastConversation.set(row.pessoa_id, row.last_message_time);
  return (people ?? []).map((person) => { const personOrders = byPerson.get(person.id) ?? []; const latest = personOrders[0] ?? null; const candidate: AutomationCandidate = { pessoaId: person.id, phone: person.contato, employee: person.tipo !== 'cliente', blocked: blockedIds.has(person.id), optedOut: optedOutIds.has(person.id), conflict: conflictIds.has(person.id), birthday: person.aniversario_dia && person.aniversario_mes ? { day: person.aniversario_dia, month: person.aniversario_mes } : null, lastDeliveredAt: latest ? (latest.closed_at ?? latest.created_at) : null, lastConversationAt: lastConversation.get(person.id) ?? null, deliveredOrders: personOrders.length, totalSpentCents: personOrders.reduce((sum, order) => sum + Math.round(Number(order.total ?? 0) * 100), 0), order: latest ? { id: latest.id, status: latest.status, deliveredAt: latest.closed_at ?? latest.created_at, totalCents: Math.round(Number(latest.total ?? 0) * 100) } : null }; return candidate; });
}

let sweepHandle: NodeJS.Timeout | null = null;
export function startAutomationSweeper(): void {
  if (sweepHandle) return;
  const tick = () => {
    void runAutomationSweep({
      listRules: async () => { const { data } = await getServiceSupabase().from('zelochat_automation_rules').select('*').eq('enabled', true).limit(500); return (data ?? []).map((row: any) => ({ ...getDefaultAutomationRule(row.kind), ...row, empresaId: row.empresa_id, sendStart: row.send_start, sendEnd: row.send_end })); },
      listCandidates: listAutomationCandidatesForRule,
      persist: persistAutomationDispatch,
    }).catch((error) => console.error('[automations] tick failed', error));
  };
  setTimeout(tick, 180_000).unref?.();
  sweepHandle = setInterval(tick, 900_000); sweepHandle.unref?.();
}

export function stopAutomationSweeper(): void { if (sweepHandle) clearInterval(sweepHandle); sweepHandle = null; }

export function defaultRuleForKind(kind: AutomationKind): AutomationRule { return getDefaultAutomationRule(kind); }
