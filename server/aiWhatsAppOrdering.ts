import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { StoredSession } from './messageHandler.js';
import { addAssistantMessage, addToolMessage, getSession } from './messageHandler.js';
import { sendButtonMessage, sendTextMessage } from './whatsapp.js';
import { getOpenAIClient } from './openaiClient.js';
import { CustomerOrderingContext } from './customers/orderingContextAdapter.js';
import { escalateSession } from './escalation.js';
import {
  applyOrderingDefaults,
  buildConfirmationButtons,
  type CanonicalButtonHandling,
  classifyOrderingTurn,
  findPriorOrderingQuery,
  findLatestOrderingState,
  getAiWhatsAppOrderingMode,
  isOrderingFollowUp,
  parseOrderingButton,
  renderCatalogReply,
  renderOrderingSummary,
  serializeOrderingState,
  snapshotToDraft,
  type CatalogReplyResult,
  type OrderingDraft,
  type OrderingSnapshot,
} from '../src/domain/aiWhatsAppOrdering.js';
import {
  ORDERING_MODEL_TOOLS,
  ZeloMenuInternalClient,
  ZeloMenuInternalError,
} from './zeloMenuInternalClient.js';

const MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const STATE_TOOL_CALL_ID = 'zelo_ai_ordering_state';

export interface AiOrderingHandleResult {
  handled: boolean;
  response?: string;
}

function metric(event: string, mode: string, outcome: string, startedAt = Date.now()): void {
  // Strict allowlist: never include JID, message text, names, addresses, token or cart.
  console.info('[AiOrderingMetric]', JSON.stringify({ event, mode, outcome, durationMs: Date.now() - startedAt }));
}

async function sendText(jid: string, empresaId: string, text: string): Promise<void> {
  const waMessageId = await sendTextMessage(jid, text, empresaId);
  await addAssistantMessage(jid, text, undefined, empresaId, undefined, { responseSource: 'ai_auto', waMessageId });
}

async function persistPointer(jid: string, empresaId: string, snapshot: OrderingSnapshot): Promise<void> {
  await addToolMessage(
    jid,
    serializeOrderingState({ orderingId: snapshot.orderingId, revision: snapshot.revision }),
    STATE_TOOL_CALL_ID,
    empresaId,
  );
}

async function sendSummary(jid: string, empresaId: string, snapshot: OrderingSnapshot): Promise<string> {
  await persistPointer(jid, empresaId, snapshot);
  const text = renderOrderingSummary(snapshot);
  const buttons = buildConfirmationButtons(snapshot);
  if (buttons.length) {
    await sendButtonMessage(jid, 'Resumo do pedido', text, '', buttons, empresaId);
    await addAssistantMessage(jid, text, undefined, empresaId, undefined, { responseSource: 'ai_auto' });
  } else {
    await sendText(jid, empresaId, text);
  }
  return text;
}

async function loadCanonicalSnapshot(
  session: StoredSession,
  empresaId: string,
  jid: string,
  client: ZeloMenuInternalClient,
): Promise<OrderingSnapshot | null> {
  const pointer = findLatestOrderingState(session.messages);
  if (!pointer) return null;
  try {
    const snapshot = await client.getOrdering(pointer.orderingId, empresaId);
    if (snapshot.empresaId !== empresaId || snapshot.remoteJid !== jid) {
      throw new ZeloMenuInternalError('PEDIDO_INDISPONIVEL', 403, 'tenant-boundary');
    }
    return snapshot;
  } catch (error) {
    if (error instanceof ZeloMenuInternalError && error.status === 404) return null;
    throw error;
  }
}

function lastUserText(session: StoredSession): string {
  const message = [...session.messages].reverse().find((candidate) => candidate.role === 'user');
  return (message?.audio_transcript || message?.preview || message?.content || '').trim();
}

function lastUserMessageId(session: StoredSession): string {
  const message = [...session.messages].reverse().find((candidate) => candidate.role === 'user');
  return message?.waMessageId || message?.id || `zelo-${Date.now()}`;
}

async function customerContext(session: StoredSession, empresaId: string) {
  if (!session.personId) return null;
  try {
    return await CustomerOrderingContext.get({ empresaId, pessoaId: session.personId });
  } catch {
    return null;
  }
}

function draftMissingQuestion(draft: OrderingDraft): string | null {
  if (!draft.fulfillment?.type) return 'É para entrega ou retirada?';
  if (draft.fulfillment.type === 'delivery' && !draft.fulfillment.deliveryAddress) return 'Qual é o endereço para entrega?';
  if (!draft.paymentMethod) return 'Como você vai pagar?';
  return null;
}

function allowedCatalogIds(result: CatalogReplyResult, current: OrderingSnapshot | null) {
  const products = new Set<number>();
  const groups = new Set<number>();
  const options = new Set<number>();
  for (const candidate of result.results) {
    products.add(candidate.productId);
    for (const group of candidate.modifierGroups ?? []) {
      groups.add(group.id);
      for (const option of group.options) options.add(option.id);
    }
  }
  for (const item of current?.cart.items ?? []) {
    products.add(item.productId);
    for (const group of item.selectedModifiers) {
      groups.add(group.groupId);
      for (const option of group.selectedOptions) options.add(option.optionId);
    }
  }
  return { products, groups, options };
}

function validDraftIds(draft: OrderingDraft, allowed: ReturnType<typeof allowedCatalogIds>): boolean {
  return draft.items.every((item) => allowed.products.has(item.productId)
    && (item.selectedOptions ?? []).every((group) => allowed.groups.has(group.groupId)
      && group.optionSelections.every((option) => allowed.options.has(option.optionId))));
}

async function planDraft(
  session: StoredSession,
  text: string,
  result: CatalogReplyResult,
  current: OrderingSnapshot | null,
): Promise<OrderingDraft | null> {
  const history: ChatCompletionMessageParam[] = session.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-10)
    .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content || message.preview || '' }));
  const system = [
    'Você planeja um carrinho de lanchonete em português brasileiro.',
    'Use somente buscar_cardapio, alterar_carrinho e consultar_carrinho; nunca confirme ou cancele.',
    'Ao alterar, envie o carrinho completo e use somente IDs presentes no CATÁLOGO CANÔNICO ou no CARRINHO ATUAL.',
    'Não invente IDs, preços, taxas ou disponibilidade. Se faltar escolha essencial, não chame alterar_carrinho.',
    `CATÁLOGO CANÔNICO: ${JSON.stringify(result)}`,
    `CARRINHO ATUAL: ${JSON.stringify(current ? snapshotToDraft(current) : null)}`,
  ].join('\n');
  const completion = await getOpenAIClient().chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: text }],
    tools: ORDERING_MODEL_TOOLS,
    tool_choice: 'auto',
  });
  const toolCall = completion.choices[0]?.message.tool_calls?.find((call) => call.type === 'function' && call.function.name === 'alterar_carrinho');
  if (!toolCall || toolCall.type !== 'function') return null;
  try {
    const draft = JSON.parse(toolCall.function.arguments) as OrderingDraft;
    if (!Array.isArray(draft.items) || !draft.items.length) return null;
    return validDraftIds(draft, allowedCatalogIds(result, current)) ? draft : null;
  } catch {
    return null;
  }
}

function lastOrderDraft(context: Awaited<ReturnType<typeof customerContext>>): OrderingDraft | null {
  const last = context?.lastOrder.value;
  if (!last?.items.length) return null;
  const items = last.items.flatMap((item) => {
    const productId = Number(item.productId);
    if (!Number.isInteger(productId) || productId <= 0) return [];
    return [{
      productId,
      quantity: Math.max(1, item.quantity),
      selectedOptions: item.modifiers.map((group) => ({
        groupId: Number(group.id),
        optionSelections: group.options.map((option) => ({ optionId: Number(option.id), quantity: option.quantity })),
      })),
    }];
  });
  if (!items.length) return null;
  return applyOrderingDefaults({ items }, context);
}

async function transferOnFailure(jid: string, empresaId: string): Promise<string> {
  const text = 'Não consegui conferir o pedido com segurança agora; vou chamar um atendente para ajudar.';
  await escalateSession(empresaId, jid, {
    triggerId: null,
    triggerKind: 'escalate_human',
    triggerName: 'Falha no pedido pelo WhatsApp',
    reasonCategory: 'repeated_ai_failure',
    reasonText: 'Falha segura na integração interna de pedidos.',
    customerMessageExcerpt: null,
    skipCustomerMessage: true,
  });
  await sendText(jid, empresaId, text);
  return text;
}

type ConfirmationOutcome =
  | { kind: 'summary'; snapshot: OrderingSnapshot }
  | { kind: 'confirmed'; snapshot: OrderingSnapshot };

async function resolveConfirmation(
  snapshot: OrderingSnapshot,
  client: ZeloMenuInternalClient,
  empresaId: string,
  jid: string,
  messageId: string,
  token?: string,
): Promise<ConfirmationOutcome> {
  try {
    const confirmed = await client.confirmDraft({
      empresaId, remoteJid: jid, messageId, orderingId: snapshot.orderingId,
      expectedRevision: snapshot.revision, confirmationToken: token,
    });
    if (confirmed.requiresReview || confirmed.state === 'cart_open') return { kind: 'summary', snapshot: confirmed };
    return { kind: 'confirmed', snapshot: confirmed };
  } catch (error) {
    if (error instanceof ZeloMenuInternalError && error.current) {
      const refreshed = await client.updateDraft({
        empresaId, remoteJid: jid, messageId: `${messageId}:refresh`,
        orderingId: error.current.orderingId, expectedRevision: error.current.revision,
        draft: snapshotToDraft(error.current),
      });
      return { kind: 'summary', snapshot: refreshed };
    }
    throw error;
  }
}

async function completeConfirmation(
  jid: string,
  empresaId: string,
  outcome: ConfirmationOutcome,
): Promise<string> {
  if (outcome.kind === 'summary') return sendSummary(jid, empresaId, outcome.snapshot);
  const text = 'Pedido confirmado e enviado para a loja. Aviso por aqui quando houver novidade.';
  await persistPointer(jid, empresaId, outcome.snapshot);
  await sendText(jid, empresaId, text);
  return text;
}

export async function tryHandleAiWhatsAppOrdering(
  jid: string,
  empresaId: string,
  session: StoredSession,
): Promise<AiOrderingHandleResult> {
  const startedAt = Date.now();
  const mode = getAiWhatsAppOrderingMode();
  if (mode === 'off') return { handled: false };
  const text = lastUserText(session);
  const messageId = lastUserMessageId(session);
  const hasPointer = Boolean(findLatestOrderingState(session.messages));
  const initialTurn = classifyOrderingTurn(text, hasPointer);
  const followUp = !hasPointer && isOrderingFollowUp(session.messages);
  if (initialTurn.kind === 'none' && !followUp) return { handled: false };
  const client = ZeloMenuInternalClient.fromEnv();
  if (!client) {
    metric('ordering_turn', mode, 'configuration_missing', startedAt);
    if (mode === 'shadow') return { handled: false };
    const response = await transferOnFailure(jid, empresaId);
    return { handled: true, response };
  }
  try {
    const canonical = await loadCanonicalSnapshot(session, empresaId, jid, client);
    const current = canonical && (canonical.state === 'cart_open' || canonical.requiresReview) ? canonical : null;
    const turn = classifyOrderingTurn(text, Boolean(current) || hasPointer);
    if (turn.kind === 'none' && !followUp) return { handled: false };

    if (mode === 'shadow') {
      if (turn.kind === 'catalog_or_order' || followUp) {
        await client.searchCatalog({ empresaId, query: findPriorOrderingQuery(session.messages, text), limit: 12 });
      }
      metric('ordering_turn', mode, 'shadow_observed', startedAt);
      return { handled: false };
    }

    if (!current && canonical && (turn.kind === 'confirm' || turn.kind === 'ask_change' || turn.kind === 'cancel')) {
      const response = canonical.order || canonical.state.startsWith('confirmed') || canonical.state === 'accepted'
        ? 'Esse pedido já foi confirmado. Se precisar, posso chamar um atendente.'
        : 'Esse pedido já foi finalizado. Quer começar um novo?';
      await sendText(jid, empresaId, response);
      return { handled: true, response };
    }

    if (current && turn.kind === 'confirm') {
      const outcome = await resolveConfirmation(current, client, empresaId, jid, messageId);
      const response = await completeConfirmation(jid, empresaId, outcome);
      metric('ordering_confirm', mode, 'handled', startedAt);
      return { handled: true, response };
    }
    if (current && turn.kind === 'cancel') {
      await client.cancelDraft({ empresaId, remoteJid: jid, messageId, orderingId: current.orderingId, expectedRevision: current.revision });
      const response = 'Pedido cancelado. Se quiser começar outro, é só me dizer.';
      await sendText(jid, empresaId, response);
      metric('ordering_cancel', mode, 'handled', startedAt);
      return { handled: true, response };
    }
    if (current && (turn.kind === 'ask_change' || (turn.kind === 'alter' && !turn.instruction.trim()))) {
      const response = 'Tudo bem. O que você quer alterar no pedido?';
      await sendText(jid, empresaId, response);
      return { handled: true, response };
    }

    const context = await customerContext(session, empresaId);
    let draft: OrderingDraft | null = null;
    const query = findPriorOrderingQuery(session.messages, text);
    if (/\bo de sempre\b/i.test(text)) draft = lastOrderDraft(context);
    const catalog = await client.searchCatalog({ empresaId, query, limit: 12 });
    const wantsOrder = Boolean(current) || /\b(quero|vou querer|manda|coloca|adiciona|pedir|pedido|o de sempre)\b/i.test(text) || followUp;
    if (!draft && wantsOrder) draft = await planDraft(session, text, catalog, current);
    if (!draft) {
      const response = renderCatalogReply(catalog, query);
      await sendText(jid, empresaId, response);
      metric('catalog_search', mode, 'answered', startedAt);
      return { handled: true, response };
    }
    draft = applyOrderingDefaults(draft, context);
    const missing = draftMissingQuestion(draft);
    if (missing) {
      await sendText(jid, empresaId, missing);
      return { handled: true, response: missing };
    }
    draft.customer = { name: session.customerName, phone: session.customerPhone };
    draft.pessoaId = session.personId ?? null;
    const updated = await client.updateDraft({
      empresaId, remoteJid: jid, messageId,
      orderingId: current?.orderingId, expectedRevision: current?.revision, draft,
    });
    const response = await sendSummary(jid, empresaId, updated);
    metric('ordering_update', mode, 'summary_sent', startedAt);
    return { handled: true, response };
  } catch {
    metric('ordering_turn', mode, 'failed_closed', startedAt);
    if (mode === 'shadow') return { handled: false };
    const response = await transferOnFailure(jid, empresaId);
    return { handled: true, response };
  }
}

export async function tryHandleAiWhatsAppOrderingButton(input: {
  jid: string;
  empresaId: string;
  buttonId: string;
  messageId: string;
}): Promise<CanonicalButtonHandling> {
  const action = parseOrderingButton(input.buttonId);
  if (!action) return { handled: false };
  const mode = getAiWhatsAppOrderingMode();
  if (mode !== 'active') return { handled: true }; // fail closed and never leak a stale Task 6 button to legacy AI
  const client = ZeloMenuInternalClient.fromEnv();
  if (!client) {
    return { handled: true, complete: async () => { await transferOnFailure(input.jid, input.empresaId); } };
  }
  const session = await getSession(input.jid, input.empresaId);
  if (!session) return { handled: true };
  try {
    const current = await loadCanonicalSnapshot(session, input.empresaId, input.jid, client);
    if (!current) return { handled: true };
    if (current.state !== 'cart_open' && !current.requiresReview) {
      const text = current.order || current.state.startsWith('confirmed') || current.state === 'accepted'
          ? 'Esse pedido já foi confirmado. Se precisar, posso chamar um atendente.'
          : 'Esse pedido já foi finalizado. Quer começar um novo?';
      return { handled: true, complete: async () => { await sendText(input.jid, input.empresaId, text); } };
    }
    if (action.kind === 'alter') {
      return {
        handled: true,
        complete: async () => { await sendText(input.jid, input.empresaId, 'Tudo bem. O que você quer alterar no pedido?'); },
      };
    }
    const outcome = await resolveConfirmation(current, client, input.empresaId, input.jid, input.messageId, action.token);
    return {
      handled: true,
      complete: async () => { await completeConfirmation(input.jid, input.empresaId, outcome); },
    };
  } catch {
    return { handled: true, complete: async () => { await transferOnFailure(input.jid, input.empresaId); } };
  }
}
