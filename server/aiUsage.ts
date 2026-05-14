import { getServiceSupabase } from './supabase.js';

export type AiUsageFeature =
  | 'ai_auto_reply'
  | 'ai_auto_followup'
  | 'ai_manual_reply'
  | 'ai_generate_instructions'
  | 'ai_manager'
  | 'ai_simulator'
  | 'ai_trigger_parse'
  | 'ai_transcription'
  | 'pix_receipt_validation'
  | 'customer_profile';

export type AiUsageStatus = 'success' | 'error' | 'rate_limited';

type TokenUsage = {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
} | null | undefined;

function usageDateBrazil(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  const d = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${y}-${m}-${d}`;
}

function safeTokenCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function recordAiUsage(args: {
  empresaId: string;
  feature: AiUsageFeature;
  model: string;
  status: AiUsageStatus;
  usage?: TokenUsage;
}): void {
  if (!args.empresaId) return;

  const usage = args.usage ?? null;
  void (async () => {
    try {
      const { error } = await getServiceSupabase().rpc('zelochat_increment_ai_usage_daily', {
        p_empresa_id: args.empresaId,
        p_usage_date: usageDateBrazil(),
        p_feature: args.feature,
        p_model: args.model || 'unknown',
        p_status: args.status,
        p_prompt_tokens: safeTokenCount(usage?.prompt_tokens),
        p_completion_tokens: safeTokenCount(usage?.completion_tokens),
        p_total_tokens: safeTokenCount(usage?.total_tokens),
      });
      if (error) {
        console.warn('[AI Usage] Failed to record usage:', error.message);
      }
    } catch (err) {
      console.warn('[AI Usage] Failed to record usage:', err);
    }
  })();
}
