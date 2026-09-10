import { getServiceSupabase } from './supabase.js';

/**
 * Rastro de cada turno da IA, para troubleshooting.
 *
 * Em 09-10/09/2026 quatro defeitos seguidos exigiram reconstruir conversas no
 * banco na mão para descobrir o que a IA tinha lido. Um deles só foi explicado
 * depois de achar uma mensagem de 47 dias antes que tinha vazado para o
 * contexto do turno. Os logs da aplicação ficam no Dokploy e, na prática, não
 * são consultáveis por quem precisa deles.
 *
 * O conteúdo é sensível — o prompt carrega histórico, nome, telefone e
 * endereço do cliente. A tabela é service-role apenas (migration 069) e a
 * retenção é curta. Diferente das linhas de métrica, que continuam sem PII
 * nenhuma: log é público para quem tem acesso ao servidor, esta tabela não.
 */

const DEFAULT_KEEP_DAYS = 14;
/** Trecho grande o bastante para diagnosticar, pequeno o bastante para não inchar. */
const MAX_FIELD_CHARS = 24_000;

export type AiTurnTrace = {
  empresaId: string;
  remoteJid: string;
  sessionId?: string | null;
  /** 'model' ou o caminho determinístico que respondeu antes dele. */
  path: string;
  inboundText?: string | null;
  systemPrompt?: string | null;
  runtimeMessages?: unknown;
  replyText?: string | null;
  model?: string | null;
  guardDetail?: Record<string, unknown> | null;
  durationMs?: number | null;
};

function isEnabled(): boolean {
  // Ligado por padrão; `ZELOCHAT_AI_TRACE=0` desliga sem precisar de deploy de
  // código, só de variável.
  const raw = (process.env.ZELOCHAT_AI_TRACE ?? '').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no';
}

function keepDays(): number {
  const parsed = Number.parseInt(process.env.ZELOCHAT_AI_TRACE_KEEP_DAYS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_KEEP_DAYS;
}

const clip = (value: string | null | undefined): string | null => {
  if (!value) return null;
  return value.length > MAX_FIELD_CHARS ? `${value.slice(0, MAX_FIELD_CHARS)}…[truncado]` : value;
};

/**
 * Grava o rastro sem bloquear nem derrubar o turno. Uma falha aqui nunca pode
 * custar a resposta ao cliente: troubleshooting não vale uma conversa perdida.
 */
export function recordAiTurnTrace(trace: AiTurnTrace): void {
  if (!isEnabled() || !trace.empresaId) return;
  void (async () => {
    try {
      const { error } = await getServiceSupabase()
        .from('zelochat_ai_turn_traces')
        .insert({
          empresa_id: trace.empresaId,
          session_id: trace.sessionId ?? null,
          remote_jid: trace.remoteJid,
          path: trace.path,
          inbound_text: clip(trace.inboundText),
          system_prompt: clip(trace.systemPrompt),
          runtime_messages: trace.runtimeMessages ?? null,
          reply_text: clip(trace.replyText),
          model: trace.model ?? null,
          guard_detail: trace.guardDetail ?? null,
          duration_ms: trace.durationMs ?? null,
        });
      if (error) throw error;
      await pruneOccasionally();
    } catch (error) {
      console.warn('[AiTurnTrace] falha ao gravar rastro (ignorada):', error);
    }
  })();
}

/**
 * Retenção sem agendador novo: a cada ~1 em 50 gravações roda a limpeza. Com
 * o volume atual isso é várias vezes por dia, e o custo fica diluído.
 */
async function pruneOccasionally(): Promise<void> {
  if (Math.random() >= 0.02) return;
  try {
    await getServiceSupabase().rpc('zelochat_prune_ai_turn_traces', { p_keep_days: keepDays() });
  } catch (error) {
    console.warn('[AiTurnTrace] limpeza de retenção falhou (ignorada):', error);
  }
}
