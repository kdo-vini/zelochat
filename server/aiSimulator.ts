import {
  getAI,
  OPENAI_MODEL,
  OPENAI_CHAT_TEMPERATURE,
  buildSystemInstruction,
  CREATE_ORDER_TOOL,
  CONSULT_ORDER_TOOL,
  DISPATCH_TRIGGER_TOOL,
  safeForPrompt,
} from './ai.js';
import { getConfig, ensureAiSettingsHydrated } from './configStore.js';
import { fetchActiveTriggers } from './triggers.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { recordAiUsage } from './aiUsage.js';

export interface SimulatePayload {
  customerMessage: string;
  customerName?: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  configOverride?: {
    aiInstructions?: string;
    storeName?: string;
  };
}

export interface SimulateResult {
  reply: string;
  toolCallsMade: string[];
  wouldCreateOrder: boolean;
  simulationNote: string;
}

const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_MSGS = 20;

/**
 * Dry-run the full AI pipeline for a given empresa and customer message.
 * No DB writes, no WhatsApp sends — only one real OpenAI call.
 */
export async function simulateAtendimento(
  empresaId: string,
  payload: SimulatePayload,
): Promise<SimulateResult> {
  // Hydrate config from DB (same TTL-gated path as the real pipeline).
  await ensureAiSettingsHydrated(empresaId);

  const cfg = getConfig(empresaId);

  // Apply any config overrides from the caller (e.g. test a new aiInstructions draft).
  if (payload.configOverride?.aiInstructions !== undefined) {
    cfg.aiInstructions = safeForPrompt(payload.configOverride.aiInstructions, 1200);
  }
  if (payload.configOverride?.storeName !== undefined) {
    cfg.name = safeForPrompt(payload.configOverride.storeName, 100);
  }

  const customerName = safeForPrompt(payload.customerName || 'Cliente', 80);
  const customerMessage = payload.customerMessage.slice(0, MAX_MESSAGE_CHARS);

  // Fetch triggers (read-only — no side effects).
  let triggers: Awaited<ReturnType<typeof fetchActiveTriggers>> = [];
  try {
    triggers = await fetchActiveTriggers(empresaId);
  } catch (err) {
    console.error('[aiSimulator] fetchActiveTriggers failed (continuing without triggers):', err);
  }

  // Build system prompt via the canonical helper.
  // We pass empty strings for customerHistory and activeOrdersBlock since we have
  // no real session context in a simulation.
  const systemPrompt = buildSystemInstruction(
    empresaId,
    '', // customerPhone — not relevant for simulation
    `Simulação para: ${customerName}`, // customerHistory placeholder
    triggers,
    '(simulação — sem pedidos ativos)', // activeOrdersBlock
  );

  // Build the messages array.
  const rawHistory = (payload.conversationHistory ?? []).slice(0, MAX_HISTORY_MSGS);
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...rawHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })) as ChatCompletionMessageParam[],
    { role: 'user', content: customerMessage },
  ];

  // Call OpenAI — same model, same tools, no side effects.
  const openai = getAI();
  let response;
  try {
    response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: OPENAI_CHAT_TEMPERATURE,
      messages,
      tools: [CREATE_ORDER_TOOL, CONSULT_ORDER_TOOL, DISPATCH_TRIGGER_TOOL],
      tool_choice: 'auto',
    });
  } catch (error) {
    recordAiUsage({
      empresaId,
      feature: 'ai_simulator',
      model: OPENAI_MODEL,
      status: 'error',
    });
    throw error;
  }
  recordAiUsage({
    empresaId,
    feature: 'ai_simulator',
    model: OPENAI_MODEL,
    status: 'success',
    usage: response.usage,
  });

  const choice = response.choices[0];
  const assistantMessage = choice.message;

  // Extract tool call names.
  const toolCallsMade: string[] = (assistantMessage.tool_calls ?? [])
    .filter((tc) => tc.type === 'function')
    .map((tc) => tc.function.name);

  // Derive reply text — if the model only emitted tool calls (no content), describe what
  // it would have done so the simulator returns something readable.
  let reply = assistantMessage.content ?? '';
  if (!reply && toolCallsMade.length > 0) {
    reply = `[IA chamaria as ferramentas: ${toolCallsMade.join(', ')}]`;
  }
  if (!reply) {
    reply = '[IA não retornou resposta de texto]';
  }

  const wouldCreateOrder = toolCallsMade.includes('criar_pedido');

  return {
    reply,
    toolCallsMade,
    wouldCreateOrder,
    simulationNote: 'Simulação — nenhuma mensagem foi enviada e nenhum dado foi gravado',
  };
}
