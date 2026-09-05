import { startPeriodicTask } from '../runtime/periodicTask.js';
import { getServiceSupabase } from '../supabase.js';
import { redactJid } from '../redact.js';

export type ConversationOutboundMetric =
  | 'human_takeover'
  | 'ai_stale_suppressed'
  | 'from_me_echo'
  | 'from_me_native'
  | 'from_me_pending_correlation'
  | 'delivery_uncertain'
  | 'queue_depth'
  | 'queue_oldest_seconds'
  | 'leases_stuck';

type Labels = Readonly<Record<string, string | number | boolean | null | undefined>>;
type LogContext = { empresaId?: string; remoteJid?: string; jobId?: string | null; messageId?: string | null };

const counters = new Map<string, number>();
const allowedLabel = /^[a-z0-9_:-]{1,80}$/i;

function safeLabels(labels: Labels): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (!allowedLabel.test(key) || value == null) continue;
    if (typeof value === 'number' || typeof value === 'boolean') result[key] = value;
    else if (allowedLabel.test(value)) result[key] = value;
  }
  return result;
}

export function recordConversationOutboundMetric(
  metric: ConversationOutboundMetric,
  labels: Labels = {},
  context: LogContext = {},
  value = 1,
): void {
  const sanitized = safeLabels(labels);
  const suffix = Object.entries(sanitized).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${key}=${item}`).join(',');
  const key = suffix ? `${metric}|${suffix}` : metric;
  counters.set(key, (counters.get(key) ?? 0) + value);
  console.info('[conversation_outbound_metric]', JSON.stringify({
    metric,
    value,
    ...sanitized,
    ...(context.empresaId ? { empresaId: context.empresaId } : {}),
    ...(context.remoteJid ? { jid: redactJid(context.remoteJid) } : {}),
    ...(context.jobId ? { jobId: context.jobId } : {}),
    ...(context.messageId ? { messageId: context.messageId } : {}),
  }));
}

function setConversationOutboundGauge(metric: ConversationOutboundMetric, value: number): void {
  counters.set(metric, value);
  console.info('[conversation_outbound_metric]', JSON.stringify({ metric, value }));
}

export function getConversationOutboundMetricsSnapshot(): Readonly<Record<string, number>> {
  return Object.freeze(Object.fromEntries(counters));
}

export function resetConversationOutboundMetricsForTests(): void {
  counters.clear();
}

export async function observeConversationOutboundQueue(): Promise<void> {
  const now = Date.now();
  const { data, error } = await getServiceSupabase()
    .from('zelochat_outbound_jobs')
    .select('status,created_at,lease_expires_at')
    .in('status', ['preparing', 'queued', 'sending', 'dispatch_started'])
    .limit(10_000);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const oldestSeconds = rows.reduce((oldest, row) => {
    const createdAt = Date.parse(row.created_at ?? '');
    return Number.isFinite(createdAt) ? Math.max(oldest, Math.floor(Math.max(0, now - createdAt) / 1000)) : oldest;
  }, 0);
  const stuck = rows.filter((row) => {
    const expiresAt = Date.parse(row.lease_expires_at ?? '');
    return (row.status === 'sending' || row.status === 'dispatch_started') && Number.isFinite(expiresAt) && expiresAt < now;
  }).length;
  setConversationOutboundGauge('queue_depth', rows.length);
  setConversationOutboundGauge('queue_oldest_seconds', oldestSeconds);
  setConversationOutboundGauge('leases_stuck', stuck);
}

export function startConversationOutboundQueueObserver(intervalMs = 60_000): void {
  startPeriodicTask('outboundObserver', observeConversationOutboundQueue, 0, intervalMs);
}
