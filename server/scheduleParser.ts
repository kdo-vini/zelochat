import { getAI } from './ai.js';
import { recordAiUsage } from './aiUsage.js';
// Reusing the trigger-parse feature counter: same shape (NL → small JSON),
// low volume, no need for a separate column.
const USAGE_FEATURE = 'ai_trigger_parse' as const;
import {
  AI_SCHEDULE_DAY_KEYS,
  normalizeAiScheduleDays,
  type AiGlobalMode,
  type AiScheduleDays,
} from '../src/domain/aiSchedule.js';

export interface BlockedDateEntry {
  date: string; // YYYY-MM-DD
  reason: string;
}

export interface ScheduleParseInput {
  /** Free-form PT-BR description from the operator. */
  description: string;
  /** Current saved schedule (when present, treat the description as an incremental edit). */
  currentSchedule?: AiScheduleDays | null;
  /** Current saved blocked_dates. Parser can add/remove entries via the description. */
  currentBlockedDates?: BlockedDateEntry[];
  /** ISO date string (YYYY-MM-DD) for "hoje" in empresa timezone — lets the LLM resolve "amanhã", "próxima sexta", etc. */
  today?: string;
}

export interface ScheduleParseResult {
  mode: AiGlobalMode;
  scheduleDays: AiScheduleDays | null;
  /**
   * Full proposed blocked_dates list. `null` means "no change". When
   * present, the frontend replaces the current list with this — additions
   * and removals are both expressed as the resulting list.
   */
  blockedDates: BlockedDateEntry[] | null;
  /** One-line PT-BR summary the UI can show before the operator confirms. */
  summary: string;
}

const MODEL = 'gpt-4o-mini';

const SYSTEM_PROMPT = `Você converte descrições em português de quando a IA de atendimento de uma lanchonete deve responder o WhatsApp em uma agenda estruturada em JSON.

A agenda tem três modos globais:
- "always_on" — IA responde 24 horas, todos os dias. Use quando o dono diz "sempre", "24h", "o tempo todo".
- "always_off" — IA nunca responde. Use quando o dono diz "desliga a IA", "manual sempre".
- "scheduled" — IA segue uma agenda por dia da semana.

Quando "scheduled", forneça \`scheduleDays\` — um objeto com 7 chaves obrigatórias: sun, mon, tue, wed, thu, fri, sat. Cada uma tem:
  enabled (boolean)
  start ("HH:MM", 00:00 a 23:59)
  end   ("HH:MM", 00:00 a 23:59)
  inverted (boolean)

Regras por dia:
- enabled=false → IA desligada nesse dia.
- enabled=true && start===end → IA ativa 24 horas nesse dia.
- enabled=true && start<end && inverted=false → IA ativa DENTRO de [start, end].
- enabled=true && start<end && inverted=true → IA ativa FORA de [start, end] (o intervalo descreve o turno HUMANO, e a IA cobre o resto do dia). Use isso para padrões "humanos das X às Y, IA cobre o resto".
- start>end nunca é válido. Para "noite + madrugada", use inverted=true com o intervalo humano.

Exemplos:
- "humanos atendem das 6 às 18 de segunda a sábado, domingo IA 24h" → todos os dias enabled=true; mon-sat com start=06:00 end=18:00 inverted=true; sun com start=00:00 end=00:00 inverted=false.
- "IA só no comercial 8-18 seg a sex" → mon-fri start=08:00 end=18:00 inverted=false; sat/sun enabled=false.
- "IA cobre só finais de semana" → sat/sun start=00:00 end=00:00 inverted=false (24h); mon-fri enabled=false.

Edição incremental: se houver agenda atual, modifique APENAS o que o operador pediu e mantenha o resto. Ex: agenda atual com seg-sex 08-18, operador diz "muda quarta pra 24h" → mantém os outros dias iguais e ajusta wed para start=00:00 end=00:00.

DATAS BLOQUEADAS — \`blockedDates\` é a lista de dias em que o dono não vai trabalhar (feriados, folgas, viagens). Nesses dias a IA cobre o WhatsApp 24h mas RECUSA pedidos (a loja não está operando). Cada entrada tem:
  date  ("YYYY-MM-DD")
  reason (texto curto em PT-BR, ex: "Natal", "Folga do dono", "Aniversário")

Regras de \`blockedDates\`:
- Se o operador pediu para adicionar/remover datas, retorne a LISTA COMPLETA resultante (não diff) — incluindo as datas atuais que não mudaram.
- Se o operador NÃO mencionou datas bloqueadas, retorne \`blockedDates: null\` (significa "sem mudança").
- Use o campo "today" para resolver datas relativas: "hoje", "amanhã", "próxima sexta", "dia 25" (do mês atual se passou, do próximo se já passou), etc.
- Datas que o operador remove desaparecem da lista. Ex: lista atual ["2026-12-25", "2026-06-15"], operador diz "tira a folga do dia 15" → retorna lista só com Natal.

Exemplos com blockedDates:
- "bloqueia 25 de dezembro, Natal" + lista atual vazia → blockedDates: [{ "date": "2026-12-25", "reason": "Natal" }]
- "bloqueia amanhã, vou no médico" + today="2026-06-08" → blockedDates: [{ "date": "2026-06-09", "reason": "Vou no médico" }]
- "remove o 15 de junho" + lista atual com 15/06 → blockedDates: lista atual sem o 15/06

Responda APENAS em JSON válido com a forma:
{
  "mode": "always_on" | "always_off" | "scheduled",
  "scheduleDays": { ... } | null,
  "blockedDates": [ { "date": "YYYY-MM-DD", "reason": "..." }, ... ] | null,
  "summary": "frase curta em PT-BR descrevendo o que mudou (cite datas adicionadas/removidas quando relevante)"
}

scheduleDays deve ser null quando mode é always_on ou always_off.
blockedDates deve ser null quando a descrição não fala sobre datas bloqueadas.`;

export async function parseScheduleFromDescription(
  empresaId: string,
  input: ScheduleParseInput,
): Promise<ScheduleParseResult> {
  const description = input.description.trim();
  if (!description) throw new Error('INVALID_SCHEDULE_DESCRIPTION');

  const userPayload = {
    description,
    currentSchedule: input.currentSchedule ?? null,
    currentBlockedDates: input.currentBlockedDates ?? [],
    today: input.today ?? null,
  };

  const openai = getAI();
  let response;
  try {
    response = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    });
  } catch (error) {
    recordAiUsage({ empresaId, feature: USAGE_FEATURE, model: MODEL, status: 'error' });
    throw error;
  }

  recordAiUsage({
    empresaId,
    feature: USAGE_FEATURE,
    model: MODEL,
    status: 'success',
    usage: response.usage,
  });

  const raw = response.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error('EMPTY_SCHEDULE_RESPONSE');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('INVALID_SCHEDULE_JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('INVALID_SCHEDULE_JSON');

  const obj = parsed as { mode?: unknown; scheduleDays?: unknown; blockedDates?: unknown; summary?: unknown };
  const mode = obj.mode;
  const summary = typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary.trim() : 'Agenda atualizada.';
  const blockedDates = normalizeBlockedDatesPayload(obj.blockedDates);

  if (mode === 'always_on' || mode === 'always_off') {
    return { mode, scheduleDays: null, blockedDates, summary };
  }

  if (mode !== 'scheduled') {
    throw new Error('INVALID_SCHEDULE_MODE');
  }

  const scheduleDays = normalizeAiScheduleDays(obj.scheduleDays);
  if (!scheduleDays) throw new Error('INVALID_SCHEDULE_DAYS');

  // Defensive: at least one enabled day for scheduled mode (otherwise the
  // global kill-switch would silence everyone — operator probably meant
  // always_off or made a mistake).
  const hasEnabled = AI_SCHEDULE_DAY_KEYS.some((k) => scheduleDays[k].enabled);
  if (!hasEnabled) throw new Error('SCHEDULE_HAS_NO_ENABLED_DAYS');

  return { mode: 'scheduled', scheduleDays, blockedDates, summary };
}

/**
 * Validates the LLM's proposed blockedDates list. Returns null when the
 * field is absent/null (= "no change requested") and an array of valid
 * entries otherwise. Invalid entries are dropped silently — the operator
 * sees the diff before saving anyway, so a swallowed bad date just won't
 * appear in the preview.
 */
function normalizeBlockedDatesPayload(value: unknown): BlockedDateEntry[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const out: BlockedDateEntry[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as { date?: unknown; reason?: unknown };
    const date = typeof entry.date === 'string' ? entry.date.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (seen.has(date)) continue;
    seen.add(date);
    const reason = typeof entry.reason === 'string' ? entry.reason.trim().slice(0, 120) : '';
    out.push({ date, reason });
  }
  return out;
}
