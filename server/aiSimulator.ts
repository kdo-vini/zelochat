import {
  getAI,
  OPENAI_MODEL,
  OPENAI_CHAT_TEMPERATURE,
  buildSystemInstruction,
  CONSULT_ORDER_TOOL,
  DISPATCH_TRIGGER_TOOL,
  safeForPrompt,
  evaluateScheduleGuardForDryRun,
  getZeloMenuPublicBaseUrl,
  resolveWeeklyStatus,
} from './ai.js';
import { getConfig, ensureAiSettingsHydrated, getEmpresaTimezone } from './configStore.js';
import { fetchActiveTriggers } from './triggers.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { recordAiUsage } from './aiUsage.js';
import { buildPublicStoreUrl } from '../src/domain/zelomenuSlug.js';
import {
  tryHandleAiWhatsAppOrdering,
  type OrderingClient,
  type OrderingDraftPlanner,
} from './aiWhatsAppOrdering.js';
import { handoffMessageFor } from './escalation.js';
import { detectEscalationIntentFromText } from '../src/domain/escalationIntent.js';
import type { StoredSession } from './messageHandler.js';
import type { AiTurnPermit } from './conversationControl.js';
import type { ChatMessage } from '../src/types.js';

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

export interface SimulateDependencies {
  /** Optional authenticated ZeloMenu boundary used by focused tests. */
  orderingClient?: OrderingClient;
  /** Optional deterministic planner used by focused tests. */
  orderingDraftPlanner?: OrderingDraftPlanner;
}

const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_MSGS = 20;
const OWNER_AI_INSTRUCTIONS_MAX_CHARS = 50000;

/**
 * Dry-run the full AI pipeline for a given empresa and customer message.
 * No WhatsApp sends or conversation/order mutations — restaurant cases use
 * the canonical catalog/planning path in dry-run; other cases use the generic
 * model (which may record aggregate AI-usage metrics as before).
 */
export async function simulateAtendimento(
  empresaId: string,
  payload: SimulatePayload,
  dependencies: SimulateDependencies = {},
): Promise<SimulateResult> {
  // Hydrate config from DB (same TTL-gated path as the real pipeline).
  await ensureAiSettingsHydrated(empresaId);

  const cfg = getConfig(empresaId);

  // Apply any config overrides from the caller (e.g. test a new aiInstructions draft).
  if (payload.configOverride?.aiInstructions !== undefined) {
    cfg.aiInstructions = safeForPrompt(payload.configOverride.aiInstructions, OWNER_AI_INSTRUCTIONS_MAX_CHARS);
  }
  if (payload.configOverride?.storeName !== undefined) {
    cfg.name = safeForPrompt(payload.configOverride.storeName, 100);
  }

  const customerName = safeForPrompt(payload.customerName || 'Cliente', 80);
  const customerMessage = payload.customerMessage.slice(0, MAX_MESSAGE_CHARS);
  const rawHistory = (payload.conversationHistory ?? []).slice(0, MAX_HISTORY_MSGS);
  const simulatedConversation = [
    ...rawHistory.map((msg) => ({
      role: msg.role,
      content: String(msg.content ?? '').slice(0, MAX_MESSAGE_CHARS),
    })),
    { role: 'user' as const, content: customerMessage },
  ];

  const simulatedMessages: ChatMessage[] = simulatedConversation.map((message, index) => ({
    id: `simulation-message-${index}`,
    waMessageId: `simulation-message-${index}`,
    role: message.role,
    content: message.content,
    preview: message.content,
    timestamp: new Date().toISOString(),
    kind: 'text',
  }));
  const simulatedJid = `simulator-${empresaId}@s.whatsapp.net`;
  const simulatedSession: StoredSession = {
    id: `simulation-session-${empresaId}`,
    customerName,
    customerPhone: '',
    lastMessage: customerMessage,
    lastMessageTime: new Date().toISOString(),
    unreadCount: 0,
    messages: simulatedMessages,
    status: 'active',
    autoReply: true,
  };

  const scheduleGuard = evaluateScheduleGuardForDryRun(empresaId, simulatedConversation);
  if (scheduleGuard) {
    return {
      reply: scheduleGuard.reply,
      toolCallsMade: [],
      wouldCreateOrder: false,
      simulationNote: `Simulação — resposta bloqueada pela mesma validação de agenda da produção (${scheduleGuard.type})`,
    };
  }

  // Built-in human requests are deterministic in production. Preview the same
  // customer-facing acknowledgement and tool intent without touching the real
  // escalation/session state.
  const escalationIntent = detectEscalationIntentFromText(customerMessage);
  if (escalationIntent) {
    return {
      reply: handoffMessageFor(escalationIntent.category),
      toolCallsMade: ['dispatch_trigger'],
      wouldCreateOrder: false,
      simulationNote: 'Simulação — handoff humano em dry-run; nenhuma mensagem foi enviada e nenhum dado foi gravado',
    };
  }

  // Restaurant simulations must enter through the same canonical ordering
  // router as production. The handler receives a dry-run flag so it can read
  // the authenticated catalog while skipping every outbound/ordering mutation.
  // FIX 2026-09-04 (PR 1.1/1.3): the simulator honors `ai_hybrid_ordering_enabled`
  // too — for a tenant the flag has not been turned on for, the operator must
  // see exactly what customers see (the generic AI, no canonical requirement
  // flow), never a preview of a feature production isn't giving that tenant.
  if (cfg.zelochatMode !== 'general' && cfg.aiHybridOrderingEnabled === true) {
    const menuUrl = cfg.zelomenuSlug
      ? buildPublicStoreUrl(getZeloMenuPublicBaseUrl(), cfg.zelomenuSlug)
      : null;
    const permit: AiTurnPermit = {
      empresaId,
      conversationControlId: `simulation-control-${empresaId}`,
      remoteJid: simulatedJid,
      epoch: '0',
      triggerMessageId: simulatedMessages.at(-1)?.waMessageId || 'simulation-message',
    };
    const ordering = await tryHandleAiWhatsAppOrdering(
      simulatedJid,
      empresaId,
      simulatedSession,
      permit,
      {
        menuUrl,
        storeOpen: resolveWeeklyStatus(
          empresaId,
          new Date(),
          getEmpresaTimezone(empresaId),
        ).open,
      },
      {
        dryRun: true,
        client: dependencies.orderingClient,
        draftPlanner: dependencies.orderingDraftPlanner,
      },
    );
    if (ordering.handled) {
      return {
        reply: ordering.response || '[IA não retornou resposta de texto]',
        toolCallsMade: [],
        wouldCreateOrder: false,
        simulationNote: 'Simulação — resposta do fluxo canônico; nenhuma mensagem foi enviada e nenhum dado foi gravado',
      };
    }
  }

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
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...simulatedConversation.slice(0, -1).map((msg) => ({
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
      // ZLM-310: criar_pedido foi removido da stack. A IA não monta pedidos —
      // o simulador reflete a produção: só consulta de pedido + gatilhos.
      tools: [CONSULT_ORDER_TOOL, DISPATCH_TRIGGER_TOOL],
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

  // ZLM-310: a IA não cria mais pedidos (criar_pedido removido). Mantido no
  // contrato de resposta por compatibilidade com o frontend (AIConfigsView),
  // sempre false — pedidos têm fonte única no ZeloMenu.
  const wouldCreateOrder = false;

  return {
    reply,
    toolCallsMade,
    wouldCreateOrder,
    simulationNote: 'Simulação — nenhuma mensagem foi enviada e nenhum dado foi gravado',
  };
}
