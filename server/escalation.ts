import { getServiceSupabase, getBoundEmpresaId } from './supabase.js';
import { broadcast } from './ws.js';
import { sendTextMessage } from './whatsapp.js';
import { getConfig } from './configStore.js';
import { addAssistantMessage } from './messageHandler.js';
import { normalizePhoneNumber } from '../src/domain/chat.js';

export type ReasonCategory =
  | 'frustration'
  | 'complaint'
  | 'explicit_human_request'
  | 'repeated_ai_failure'
  | 'offensive_language'
  | 'manual'
  | 'custom';

export interface EscalationEventRow {
  id: string;
  empresa_id: string;
  session_id: string;
  trigger_id: string | null;
  trigger_kind: string;
  trigger_name: string;
  reason_category: ReasonCategory;
  reason_text: string;
  customer_message_excerpt: string | null;
  triggered_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export interface EscalationEvent {
  id: string;
  empresaId: string;
  sessionId: string;
  triggerId: string | null;
  triggerKind: string;
  triggerName: string;
  reasonCategory: ReasonCategory;
  reasonText: string;
  customerMessageExcerpt: string | null;
  triggeredAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

const SELECT_COLS =
  'id, empresa_id, session_id, trigger_id, trigger_kind, trigger_name, reason_category, reason_text, customer_message_excerpt, triggered_at, acknowledged_at, resolved_at, resolved_by, created_at';

function mapRow(row: EscalationEventRow): EscalationEvent {
  return {
    id: row.id,
    empresaId: row.empresa_id,
    sessionId: row.session_id,
    triggerId: row.trigger_id,
    triggerKind: row.trigger_kind,
    triggerName: row.trigger_name,
    reasonCategory: row.reason_category,
    reasonText: row.reason_text,
    customerMessageExcerpt: row.customer_message_excerpt,
    triggeredAt: row.triggered_at,
    acknowledgedAt: row.acknowledged_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

function safeForLog(value: unknown, max = 300): string {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[`<>]/g, '')
    .slice(0, max);
}

export function categorizeReason(triggerNameOrCondition: string): ReasonCategory {
  const t = triggerNameOrCondition.toLowerCase();
  if (/(ofens|xingam|agress|palavr.o|insult)/.test(t)) return 'offensive_language';
  if (/(humano|atendente|gerente|pessoa real)/.test(t)) return 'explicit_human_request';
  if (/(reclam|insatisf|errado|p.ssimo|veio sem|veio errado|estraga)/.test(t)) return 'complaint';
  if (/(frustra|raiva|irritad|nervos)/.test(t)) return 'frustration';
  return 'custom';
}

export function handoffMessageFor(reason: ReasonCategory): string {
  switch (reason) {
    case 'complaint':
    case 'frustration':
      return 'Entendi. Vou encaminhar sua mensagem para a gerência agora. Um atendente humano vai continuar com você em instantes. 🙏';
    case 'explicit_human_request':
      return 'Tudo certo. Já estou chamando um atendente humano para continuar com você.';
    case 'offensive_language':
      return 'Vou transferir essa conversa para um atendente humano agora.';
    case 'repeated_ai_failure':
      return 'Tive uma dificuldade aqui. Vou transferir você para um atendente humano que vai te ajudar melhor.';
    case 'manual':
    case 'custom':
    default:
      return 'Vou chamar um atendente humano para continuar com você. Só um instante. 🙏';
  }
}

const REASON_LABELS_PT: Record<ReasonCategory, string> = {
  frustration: 'Frustração',
  complaint: 'Reclamação',
  explicit_human_request: 'Solicitação de humano',
  repeated_ai_failure: 'Falha repetida da IA',
  offensive_language: 'Linguagem ofensiva',
  manual: 'Escalação manual',
  custom: 'Gatilho personalizado',
};

export function reasonLabelPt(r: ReasonCategory): string {
  return REASON_LABELS_PT[r] ?? r;
}

function phoneToJid(phone: string): string | null {
  let digits = normalizePhoneNumber(phone);
  if (!digits) return null;
  if (digits.length >= 10 && digits.length <= 11) digits = `55${digits}`;
  if (digits.length < 12) return null;
  return `${digits}@s.whatsapp.net`;
}

async function findSessionByJid(empresaId: string, jid: string) {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('zelochat_sessions')
    .select('id, remote_jid, customer_name, customer_phone, status, escalated_at')
    .eq('empresa_id', empresaId)
    .eq('remote_jid', jid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

interface EscalateParams {
  triggerId: string | null;
  triggerKind: 'escalate_human' | 'notify_manager';
  triggerName: string;
  reasonCategory: ReasonCategory;
  reasonText: string;
  customerMessageExcerpt?: string | null;
  /** Skip sending the handoff text to the customer (e.g. if the AI already sent it). */
  skipCustomerMessage?: boolean;
}

export interface EscalateResult {
  event: EscalationEvent;
  reEscalated: boolean;
}

/**
 * Atomic escalation flow: insert event row, flip session status, broadcast WS,
 * notify manager, send handoff text. Idempotent — if the session is already
 * escalated, only inserts a new event row and skips the duplicate handoff.
 */
export async function escalateSession(
  empresaId: string,
  jid: string,
  params: EscalateParams,
): Promise<EscalateResult | null> {
  const supabase = getServiceSupabase();
  const session = await findSessionByJid(empresaId, jid);
  if (!session) {
    console.warn('[Escalation] No session found for jid:', jid);
    return null;
  }

  const wasAlreadyEscalated = session.status === 'escalated';
  const now = new Date().toISOString();

  const { data: inserted, error: insertErr } = await supabase
    .from('zelochat_escalation_events')
    .insert({
      empresa_id: empresaId,
      session_id: session.id,
      trigger_id: params.triggerId,
      trigger_kind: params.triggerKind,
      trigger_name: safeForLog(params.triggerName, 80),
      reason_category: params.reasonCategory,
      reason_text: safeForLog(params.reasonText, 500),
      customer_message_excerpt: params.customerMessageExcerpt
        ? safeForLog(params.customerMessageExcerpt, 300)
        : null,
      triggered_at: now,
    })
    .select(SELECT_COLS)
    .single();

  if (insertErr) {
    console.error('[Escalation] Failed to insert event:', insertErr);
    throw new Error(insertErr.message);
  }

  if (!wasAlreadyEscalated) {
    const { error: updateErr } = await supabase
      .from('zelochat_sessions')
      .update({
        status: 'escalated',
        auto_reply: false,
        escalated_at: now,
        acknowledged_at: null,
        updated_at: now,
      })
      .eq('id', session.id);
    if (updateErr) {
      console.error('[Escalation] Failed to update session status:', updateErr);
      throw new Error(updateErr.message);
    }
  }

  const event = mapRow(inserted as EscalationEventRow);

  broadcast(
    {
      type: 'escalation_triggered',
      data: {
        sessionId: jid,
        empresaId,
        event,
        sessionStatus: 'escalated',
        escalatedAt: wasAlreadyEscalated ? session.escalated_at : now,
      },
    },
    empresaId,
  );

  if (!wasAlreadyEscalated) {
    broadcast(
      {
        type: 'session_status_changed',
        data: { sessionId: jid, empresaId, status: 'escalated', escalatedAt: now },
      },
      empresaId,
    );
  }

  if (!wasAlreadyEscalated && !params.skipCustomerMessage) {
    const handoff = handoffMessageFor(params.reasonCategory);
    try {
      await sendTextMessage(jid, handoff, empresaId);
      await addAssistantMessage(jid, handoff, undefined, empresaId);
    } catch (err) {
      console.error('[Escalation] Failed to send handoff to customer:', err);
    }
  }

  const cfg = getConfig(empresaId);
  const managerJid = cfg.managerPhone ? phoneToJid(cfg.managerPhone) : null;
  if (managerJid) {
    const customerName = safeForLog((session as any).customer_name, 80) || 'Cliente';
    const customerPhone = safeForLog((session as any).customer_phone, 30) || '';
    const reasonLabel = reasonLabelPt(params.reasonCategory);
    const body =
      `🆘 *Escalação* — ${reasonLabel}\n` +
      `Cliente: ${customerName} (${customerPhone})\n` +
      `Gatilho: ${safeForLog(params.triggerName, 80)}\n` +
      `Motivo: ${safeForLog(params.reasonText, 300)}` +
      (params.customerMessageExcerpt
        ? `\nMensagem: "${safeForLog(params.customerMessageExcerpt, 200)}"`
        : '') +
      `\n\nAuto-resposta da IA desativada.`;
    try {
      await sendTextMessage(managerJid, body, empresaId);
    } catch (err) {
      console.warn('[Escalation] Failed to notify manager:', err);
    }
  } else {
    console.warn('[Escalation] managerPhone not configured — manager notification skipped.');
  }

  console.log(
    `[Escalation] ${wasAlreadyEscalated ? 're-fire' : 'new'} (${params.reasonCategory}) for ${jid}`,
  );

  return { event, reEscalated: wasAlreadyEscalated };
}

export async function resolveSession(
  empresaId: string,
  jid: string,
  userId: string | null,
): Promise<{ resolvedCount: number }> {
  const supabase = getServiceSupabase();
  const session = await findSessionByJid(empresaId, jid);
  if (!session) return { resolvedCount: 0 };

  const now = new Date().toISOString();

  const { error: updateErr } = await supabase
    .from('zelochat_sessions')
    .update({ status: 'resolved', escalated_at: null, updated_at: now })
    .eq('id', session.id);
  if (updateErr) throw new Error(updateErr.message);

  const { data: resolved, error: resolveErr } = await supabase
    .from('zelochat_escalation_events')
    .update({ resolved_at: now, resolved_by: userId })
    .eq('session_id', session.id)
    .is('resolved_at', null)
    .select('id');
  if (resolveErr) throw new Error(resolveErr.message);

  broadcast(
    {
      type: 'escalation_resolved',
      data: { sessionId: jid, empresaId, resolvedAt: now, resolvedCount: resolved?.length ?? 0 },
    },
    empresaId,
  );
  broadcast(
    {
      type: 'session_status_changed',
      data: { sessionId: jid, empresaId, status: 'resolved' },
    },
    empresaId,
  );

  return { resolvedCount: resolved?.length ?? 0 };
}

export async function acknowledgeSession(empresaId: string, jid: string): Promise<void> {
  const supabase = getServiceSupabase();
  const session = await findSessionByJid(empresaId, jid);
  if (!session || session.status !== 'escalated') return;

  const now = new Date().toISOString();
  await supabase
    .from('zelochat_sessions')
    .update({ acknowledged_at: now })
    .eq('id', session.id)
    .is('acknowledged_at', null);

  await supabase
    .from('zelochat_escalation_events')
    .update({ acknowledged_at: now })
    .eq('session_id', session.id)
    .is('acknowledged_at', null)
    .is('resolved_at', null);
}

export async function listEscalationEvents(
  empresaId: string,
  jid: string,
): Promise<EscalationEvent[]> {
  const supabase = getServiceSupabase();
  const session = await findSessionByJid(empresaId, jid);
  if (!session) return [];
  const { data, error } = await supabase
    .from('zelochat_escalation_events')
    .select(SELECT_COLS)
    .eq('empresa_id', empresaId)
    .eq('session_id', session.id)
    .order('triggered_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapRow(row as EscalationEventRow));
}

export async function countOpenEscalations(empresaId: string): Promise<number> {
  const supabase = getServiceSupabase();
  const { count, error } = await supabase
    .from('zelochat_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId)
    .eq('status', 'escalated');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// In-memory consecutive AI-failure counter — auto-escalates after N failures.
const FAILURE_THRESHOLD = 2;
const consecutiveFailures = new Map<string, number>();

function failureKey(empresaId: string, jid: string): string {
  return `${empresaId}:${jid}`;
}

export function resetAiFailureCounter(empresaId: string, jid: string): void {
  consecutiveFailures.delete(failureKey(empresaId, jid));
}

/**
 * Records an AI catch-all failure for this conversation. After the 2nd consecutive
 * failure, escalates with reason 'repeated_ai_failure' and returns `{escalated: true}`
 * so the caller can suppress the generic apology message.
 */
export async function recordAiFailure(
  empresaId: string,
  jid: string,
  errorMessage: string,
  customerMessageExcerpt?: string | null,
): Promise<{ escalated: boolean }> {
  const key = failureKey(empresaId, jid);
  const next = (consecutiveFailures.get(key) ?? 0) + 1;
  consecutiveFailures.set(key, next);

  if (next < FAILURE_THRESHOLD) return { escalated: false };

  consecutiveFailures.delete(key);
  try {
    await escalateSession(empresaId, jid, {
      triggerId: null,
      triggerKind: 'escalate_human',
      triggerName: 'Falha repetida da IA',
      reasonCategory: 'repeated_ai_failure',
      reasonText: `IA falhou ${next} vezes consecutivas. Último erro: ${errorMessage}`,
      customerMessageExcerpt: customerMessageExcerpt ?? null,
    });
    return { escalated: true };
  } catch (err) {
    console.error('[Escalation] Auto-escalation after AI failure threw:', err);
    return { escalated: false };
  }
}

/** Returns the open escalation event for a session, if any. */
export async function getOpenEscalationEvent(
  empresaId: string,
  jid: string,
): Promise<EscalationEvent | null> {
  const supabase = getServiceSupabase();
  const session = await findSessionByJid(empresaId, jid);
  if (!session) return null;
  const { data, error } = await supabase
    .from('zelochat_escalation_events')
    .select(SELECT_COLS)
    .eq('session_id', session.id)
    .is('resolved_at', null)
    .order('triggered_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as EscalationEventRow) : null;
}

export const _internal_for_testing = {
  consecutiveFailures,
  getBoundEmpresaIdRef: getBoundEmpresaId,
};
