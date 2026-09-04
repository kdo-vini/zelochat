import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { StoredSession } from './messageHandler.js';
import { addToolMessage, getSession } from './messageHandler.js';
import { getOpenAIClient } from './openaiClient.js';
import { CustomerOrderingContext } from './customers/orderingContextAdapter.js';
import { escalateSession } from './escalation.js';
import { dispatchConversationOutbound } from './conversationOutbound.js';
import { isAiPermitCurrent, type AiTurnPermit } from './conversationControl.js';
import {
  buildOrderingEntryPayload,
  buildCanonicalConfirmationButtons,
  buildDeliveryFeeReply,
  type CanonicalButtonHandling,
  classifyOrderingTurn,
  findPriorOrderingQuery,
  findLatestOrderingState,
  isOrderingFollowUp,
  isOrderingEntryTurn,
  isOrderingGreeting,
  isDeliveryFeeQuestion,
  parseOrderingButton,
  renderCatalogReply,
  renderOrderingDraftPreview,
  renderOrderingSummary,
  serializeOrderingState,
  snapshotToDraft,
  type CatalogReplyResult,
  type OrderingDraft,
  type OrderingSnapshot,
  type OrderingStatePointer,
} from '../src/domain/aiWhatsAppOrdering.js';
import { presentOrderingRequirements, type OrderingReplyPayload } from '../src/domain/orderingRequirementPresenter.js';
import { applyConversationOrderPatch, validateConversationOrderPatch, type ConversationOrderPatch } from './orderingPatchPlanner.js';
import { buildOrderingPatchTool } from './orderingPatchPlanner.js';
import { composeOrderingTurn, type OrderingTurnComposition } from './orderingTurnComposer.js';
import type { OutboundPayload } from '../src/domain/outbound.js';
import {
  ORDERING_MODEL_TOOLS,
  ZeloMenuInternalClient,
  ZeloMenuInternalError,
} from './zeloMenuInternalClient.js';

const MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const STATE_TOOL_CALL_ID = 'zelo_ai_ordering_state';
class OrderingSuppressedError extends Error {}
const declinesOptionalExtras = (value: string) => /^(?:sem extras|so isso|só isso|nao quero extras|não quero extras)$/i.test(value.trim());

export interface AiOrderingHandleResult {
  handled: boolean;
  response?: string;
}

/**
 * The ZeloMenu boundary used by live and dry-run ordering turns. Keeping this
 * seam structural lets the simulator use the authenticated catalog reader
 * without gaining access to any mutating operation.
 */
export type OrderingClient = Pick<
  ZeloMenuInternalClient,
  'searchCatalog' | 'updateDraft' | 'getOrdering' | 'confirmDraft' | 'cancelDraft'
>;

export type OrderingDraftPlanner = (
  session: StoredSession,
  text: string,
  result: CatalogReplyResult,
  current: OrderingSnapshot | null,
) => Promise<OrderingDraft | null>;

export interface AiOrderingHandlerOptions {
  /** Do not dispatch, persist ordering state, mutate a cart or escalate. */
  dryRun?: boolean;
  /** Injectable boundary for the simulator and focused tests. */
  client?: OrderingClient;
  /** Injectable planner for deterministic simulator tests. */
  draftPlanner?: OrderingDraftPlanner;
}

function metric(event: string, outcome: string, startedAt = Date.now()): void {
  // Strict allowlist: never include JID, message text, names, addresses, token or cart.
  console.info('[AiOrderingMetric]', JSON.stringify({ event, outcome, durationMs: Date.now() - startedAt }));
}

async function dispatchAiPayload(
  permit: AiTurnPermit,
  payload: OutboundPayload,
  purpose: string,
  dryRun = false,
): Promise<void> {
  if (dryRun) return;
  const result = await dispatchConversationOutbound({
    empresaId: permit.empresaId,
    remoteJid: permit.remoteJid,
    actorUserId: null,
    origin: 'ai_auto',
    takeoverPolicy: 'preserve_ai',
    idempotencyKey: `ai-ordering:${permit.triggerMessageId}:${purpose}`,
    payload,
    aiPermit: permit,
  });
  if (result.state === 'suppressed') throw new OrderingSuppressedError();
  if (result.state === 'failed_before_dispatch') throw new Error('AI_ORDERING_SEND_FAILED');
}

async function sendText(permit: AiTurnPermit, text: string, purpose: string, dryRun = false): Promise<void> {
  await dispatchAiPayload(permit, { kind: 'text', text }, purpose, dryRun);
}

type PointerExtras = Pick<OrderingStatePointer, 'offeredOptionalRequirementIds' | 'declinedOptionalRequirementIds' | 'consumedMessageIds'>;

/**
 * FIX 2026-09-03 (FN C3 / PR C-6): the single source of truth for what a
 * pointer write carries forward. Every field here MUST default to the prior
 * on-disk value when the caller does not have a newer one to offer — NEVER to
 * `undefined`, because `persistPointer` only serializes a field when it is
 * present, and `findLatestOrderingState` reads only the LATEST tool row (it
 * does not merge across writes). Omitting a field here does not "leave it
 * unchanged" — it erases it from the next read. This is what let
 * `sendNextRequirement`'s auto-select/button calls silently wipe
 * `consumedMessageIds` that a sibling call had just written moments earlier.
 */
export function nextOrderingStatePatch(
  priorState: Pick<OrderingStatePointer, 'offeredOptionalRequirementIds' | 'declinedOptionalRequirementIds' | 'consumedMessageIds'> | null,
  consumedMessageIds?: string[],
  overrides: Pick<PointerExtras, 'offeredOptionalRequirementIds' | 'declinedOptionalRequirementIds'> = {},
): PointerExtras {
  return {
    offeredOptionalRequirementIds: overrides.offeredOptionalRequirementIds ?? priorState?.offeredOptionalRequirementIds,
    declinedOptionalRequirementIds: overrides.declinedOptionalRequirementIds ?? priorState?.declinedOptionalRequirementIds,
    consumedMessageIds: consumedMessageIds ?? priorState?.consumedMessageIds,
  };
}

async function persistPointer(
  permit: AiTurnPermit,
  snapshot: Pick<OrderingSnapshot, 'orderingId' | 'revision'>,
  dryRun = false,
  state: PointerExtras | null = null,
): Promise<void> {
  if (dryRun) return;
  if (!(await isAiPermitCurrent(permit))) throw new OrderingSuppressedError();
  await addToolMessage(
    permit.remoteJid,
    serializeOrderingState({
      orderingId: snapshot.orderingId,
      revision: snapshot.revision,
      conversationControlId: permit.conversationControlId,
      conversationEpoch: permit.epoch,
      ...(state?.offeredOptionalRequirementIds ? { offeredOptionalRequirementIds: state.offeredOptionalRequirementIds } : {}),
      ...(state?.declinedOptionalRequirementIds ? { declinedOptionalRequirementIds: state.declinedOptionalRequirementIds } : {}),
      ...(state?.consumedMessageIds ? { consumedMessageIds: state.consumedMessageIds } : {}),
    }),
    STATE_TOOL_CALL_ID,
    permit.empresaId,
  );
}

/**
 * Single helper every terminal path in this file calls to advance the
 * consumed-message cursor. No-ops when there is no live draft to attach the
 * pointer to (pre-pointer turns are already bounded by
 * `composeOrderingTurn`'s "since last assistant" window, so there is nothing
 * to persist yet).
 */
async function persistOrderingState(
  permit: AiTurnPermit,
  current: Pick<OrderingSnapshot, 'orderingId' | 'revision'> | null,
  dryRun: boolean,
  priorState: PointerExtras | null,
  consumedMessageIds: string[],
  overrides: Pick<PointerExtras, 'offeredOptionalRequirementIds' | 'declinedOptionalRequirementIds'> = {},
): Promise<void> {
  if (!current) return;
  await persistPointer(permit, current, dryRun, nextOrderingStatePatch(priorState, consumedMessageIds, overrides));
}

function presentationPayload(payload: OrderingReplyPayload): OutboundPayload {
  if (payload.kind !== 'list') return payload;
  return { kind: 'list', body: payload.text, buttonText: payload.buttonText, sections: payload.sections };
}

async function sendSummary(
  permit: AiTurnPermit,
  snapshot: OrderingSnapshot,
  dryRun = false,
  consumedMessageIds?: string[],
): Promise<string> {
  const text = renderOrderingSummary(snapshot);
  const buttons = buildCanonicalConfirmationButtons(snapshot);
  // The state pointer is durable before a customer can tap any control.
  const previous = findLatestOrderingState((await getSession(permit.remoteJid, permit.empresaId))?.messages ?? []);
  // FIX 2026-09-03 (FN C3): this used to re-persist `previous` verbatim,
  // silently dropping whatever this turn's own composeOrderingTurn() had just
  // consumed — the root cause of "sim" replaying as "talharim\nsim" one turn
  // later. `consumedMessageIds`, when the caller has it, always wins; falling
  // back to `previous` only covers callers with nothing new to consume
  // (button taps, the final "confirmed" leg).
  await persistPointer(permit, snapshot, dryRun, nextOrderingStatePatch(previous, consumedMessageIds));
  if (buttons.length) {
    await dispatchAiPayload(permit, {
      kind: 'buttons',
      text,
      buttons: buttons.map((button) => ({ id: button.id, label: button.displayText })),
    }, `summary:${snapshot.orderingId}:${snapshot.revision}`, dryRun);
  } else {
    await sendText(permit, text, `summary:${snapshot.orderingId}:${snapshot.revision}`, dryRun);
  }
  return text;
}

async function sendNextRequirement(
  permit: AiTurnPermit,
  snapshot: OrderingSnapshot,
  dryRun = false,
  consumedMessageIds?: string[],
  client?: OrderingClient,
  messageId?: string,
): Promise<string> {
  const stored = await getSession(permit.remoteJid, permit.empresaId);
  const state = findLatestOrderingState(stored?.messages ?? []);
  const presentation = presentOrderingRequirements(snapshot, state);
  if (presentation.autoSelect && client && messageId && !dryRun) {
    const draft = snapshotToDraft(snapshot);
    const line = draft.items.find((item) => item.lineId === presentation.autoSelect?.lineId);
    if (line) {
      const groupId = presentation.autoSelect.groupId;
      line.selectedOptions = [
        ...(line.selectedOptions ?? []).filter((selection) => selection.groupId !== groupId),
        { groupId, optionSelections: [{ optionId: presentation.autoSelect.optionId, quantity: 1 }] },
      ];
      const updated = await client.updateDraft({
        empresaId: permit.empresaId, remoteJid: permit.remoteJid, messageId: `${messageId}:auto:${groupId}`,
        orderingId: snapshot.orderingId, expectedRevision: snapshot.revision, draft,
        conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch,
      });
      return sendNextRequirement(permit, updated, dryRun, consumedMessageIds, client, messageId);
    }
  }
  // FIX 2026-09-03 (FN C3): `consumedMessageIds` used to be written as-is —
  // when a caller had none to offer (the button path, or the declines-extras
  // path calling through after its own explicit persist), the field was
  // OMITTED from the write entirely, erasing whatever cursor a sibling call
  // had just persisted moments earlier. Falling back to `state?.consumedMessageIds`
  // (the pointer this same call already re-fetched above) preserves it instead.
  await persistPointer(permit, snapshot, dryRun, nextOrderingStatePatch(state, consumedMessageIds, {
    offeredOptionalRequirementIds: presentation.offeredOptionalRequirementIds,
    declinedOptionalRequirementIds: presentation.declinedOptionalRequirementIds,
  }));
  await dispatchAiPayload(permit, presentationPayload(presentation.payload), `requirement:${snapshot.orderingId}:${snapshot.revision}`, dryRun);
  return presentation.payload.text;
}

async function loadCanonicalSnapshot(
  session: StoredSession,
  empresaId: string,
  jid: string,
  client: OrderingClient,
): Promise<OrderingSnapshot | null> {
  const pointer = findLatestOrderingState(session.messages);
  if (!pointer) return null;
  try {
    const snapshot = await client.getOrdering(pointer.orderingId, empresaId, jid);
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
  const groups = new Set<string>();
  const options = new Set<string>();
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
    tools: ORDERING_MODEL_TOOLS.map((tool) => tool.function.name === 'alterar_carrinho' ? buildOrderingPatchTool() : tool),
    tool_choice: 'auto',
  });
  const toolCall = completion.choices[0]?.message.tool_calls?.find((call) => call.type === 'function' && call.function.name === 'alterar_carrinho');
  if (!toolCall || toolCall.type !== 'function') return null;
  try {
    const patch = JSON.parse(toolCall.function.arguments) as ConversationOrderPatch;
    if (!Array.isArray(patch.items) || !patch.items.length) return null;
    if (!validateConversationOrderPatch(patch, result, current)) return null;
    return applyConversationOrderPatch(current, patch);
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
        groupId: String(group.id),
        optionSelections: group.options.map((option) => ({ optionId: String(option.id), quantity: option.quantity })),
      })),
    }];
  });
  if (!items.length) return null;
  // Previous habits are hints for the planner, never facts silently applied to
  // a new order. The canonical requirements will ask for what is still needed.
  return { items };
}

async function transferOnFailure(permit: AiTurnPermit, dryRun = false): Promise<string> {
  const text = 'Não consegui conferir o pedido com segurança agora; vou chamar um atendente para ajudar.';
  if (dryRun) return text;
  await escalateSession(permit.empresaId, permit.remoteJid, {
    aiPermit: permit,
    triggerId: null,
    triggerKind: 'escalate_human',
    triggerName: 'Falha no pedido pelo WhatsApp',
    reasonCategory: 'repeated_ai_failure',
    reasonText: 'Falha segura na integração interna de pedidos.',
    customerMessageExcerpt: null,
    customerHandoffMessage: text,
  });
  return text;
}

type ConfirmationOutcome =
  | { kind: 'summary'; snapshot: OrderingSnapshot }
  | { kind: 'confirmed'; snapshot: OrderingSnapshot };

async function resolveConfirmation(
  snapshot: OrderingSnapshot,
  client: OrderingClient,
  empresaId: string,
  jid: string,
  messageId: string,
  permit: AiTurnPermit,
  token?: string,
): Promise<ConfirmationOutcome> {
  try {
    const confirmed = await client.confirmDraft({
      empresaId, remoteJid: jid, messageId, orderingId: snapshot.orderingId,
      expectedRevision: snapshot.revision, confirmationToken: token,
      conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch,
    });
    if (confirmed.requiresReview || confirmed.state === 'cart_open') return { kind: 'summary', snapshot: confirmed };
    return { kind: 'confirmed', snapshot: confirmed };
  } catch (error) {
    if (error instanceof ZeloMenuInternalError && error.current) {
      const refreshed = await client.updateDraft({
        empresaId, remoteJid: jid, messageId: `${messageId}:refresh`,
        orderingId: error.current.orderingId, expectedRevision: error.current.revision,
        draft: snapshotToDraft(error.current),
        conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch,
      });
      return { kind: 'summary', snapshot: refreshed };
    }
    throw error;
  }
}

async function completeConfirmation(
  permit: AiTurnPermit,
  outcome: ConfirmationOutcome,
  dryRun = false,
  consumedMessageIds?: string[],
): Promise<string> {
  if (outcome.kind === 'summary') return sendSummary(permit, outcome.snapshot, dryRun, consumedMessageIds);
  const text = 'Pedido confirmado e enviado para a loja. Aviso por aqui quando houver novidade.';
  await sendText(permit, text, `confirmed:${outcome.snapshot.orderingId}:${outcome.snapshot.revision}`, dryRun);
  await persistPointer(permit, outcome.snapshot, dryRun, consumedMessageIds ? { consumedMessageIds } : null);
  return text;
}

// FIX 2026-08-31: o simulador precisava percorrer o mesmo roteador do WhatsApp
// sem tocar dispatcher, carrinho ou sessão; opções dryRun/client isolam os efeitos.
export async function tryHandleAiWhatsAppOrdering(
  jid: string,
  empresaId: string,
  session: StoredSession,
  permit: AiTurnPermit,
  entry: { menuUrl: string | null; storeOpen: boolean | null },
  options: AiOrderingHandlerOptions = {},
): Promise<AiOrderingHandleResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun === true;
  // Computed once per turn (FN C3 / PR C-6): every terminal exit below must
  // route its cursor write through `persistOrderingState`/`nextOrderingStatePatch`
  // using THIS composition's `consumedMessageIds`, never a stale re-read.
  const priorState = findLatestOrderingState(session.messages);
  const composition = composeOrderingTurn(session.messages, priorState);
  const text = composition.text || lastUserText(session);
  // Hoisted so the catch-all failure handler below can still attempt a
  // best-effort cursor advance (escalation/suppression are terminal paths
  // too — see the brief's exit list) when a live draft was already loaded.
  let current: OrderingSnapshot | null = null;
  if (composition.failedAudioMessageIds.length > 0) {
    const response = 'Não consegui ouvir esse áudio. Pode escrever o pedido aqui para eu continuar?';
    await sendText(permit, response, `audio-failure:${composition.failedAudioMessageIds.join(':')}`, dryRun);
    // No ZeloMenu round trip needed here — we are not mutating the draft,
    // only re-affirming the existing pointer's orderingId/revision with an
    // advanced cursor so this failed audio is never re-detected on the next
    // turn (the second half of PR C-6: "one failed audio permanently bricks
    // the conversation").
    await persistOrderingState(permit, priorState, dryRun, priorState, composition.consumedMessageIds);
    return { handled: true, response };
  }
  if (entry.storeOpen === true && entry.menuUrl && isOrderingEntryTurn(text)) {
    const response = buildOrderingEntryPayload(entry.menuUrl);
    try {
      await dispatchAiPayload(permit, response, 'entry', dryRun);
      if (isOrderingGreeting(text)) return { handled: true, response: response.text };
    } catch (error) {
      if (error instanceof OrderingSuppressedError) return { handled: true };
      throw error;
    }
  }
  if (entry.menuUrl && isDeliveryFeeQuestion(text)) {
    const response = buildDeliveryFeeReply(entry.menuUrl);
    await sendText(permit, response, 'delivery-fee', dryRun);
    return { handled: true, response };
  }
  const messageId = lastUserMessageId(session);
  const hasPointer = Boolean(priorState);
  const initialTurn = classifyOrderingTurn(text, hasPointer);
  const followUp = !hasPointer && isOrderingFollowUp(session.messages);
  if (initialTurn.kind === 'none' && !followUp) return { handled: false };
  const client = options.client ?? ZeloMenuInternalClient.fromEnv();
  if (!client) {
    metric('ordering_turn', 'configuration_missing', startedAt);
    if (dryRun) return { handled: false };
    try {
      await persistOrderingState(permit, priorState, dryRun, priorState, composition.consumedMessageIds);
    } catch (persistError) {
      console.warn('[AiOrdering] best-effort cursor persist on configuration_missing threw:', persistError);
    }
    const response = await transferOnFailure(permit, dryRun);
    return { handled: true, response };
  }
  try {
    const canonical = await loadCanonicalSnapshot(session, empresaId, jid, client);
    current = canonical && (canonical.state === 'cart_open' || canonical.requiresReview) ? canonical : null;
    const turn = classifyOrderingTurn(text, Boolean(current) || hasPointer);
    if (current && declinesOptionalExtras(text)) {
      const declinedOptionalRequirementIds = [...new Set([
        ...(priorState?.declinedOptionalRequirementIds ?? []),
        ...(current.requirements ?? []).filter((requirement) => !requirement.blocking).map((requirement) => requirement.id),
      ])];
      await persistOrderingState(permit, current, dryRun, priorState, composition.consumedMessageIds, {
        declinedOptionalRequirementIds,
      });
      const response = current.readyForConfirmation && current.confirmationAction
        ? await sendSummary(permit, current, dryRun, composition.consumedMessageIds)
        : await sendNextRequirement(permit, current, dryRun, composition.consumedMessageIds);
      return { handled: true, response };
    }
    if (turn.kind === 'none' && !followUp) return { handled: false };

    if (!current && canonical && (turn.kind === 'confirm' || turn.kind === 'ask_change' || turn.kind === 'cancel')) {
      const response = canonical.order || canonical.state.startsWith('confirmed') || canonical.state === 'accepted'
        ? 'Esse pedido já foi confirmado. Se precisar, posso chamar um atendente.'
        : 'Esse pedido já foi finalizado. Quer começar um novo?';
      await sendText(permit, response, 'already-closed', dryRun);
      return { handled: true, response };
    }

    if (current && turn.kind === 'confirm') {
      if (dryRun) {
        const response = `${renderOrderingSummary(current)}\n\nSimulação: a confirmação não foi enviada.`;
        await sendText(permit, response, `confirm-preview:${current.orderingId}:${current.revision}`, true);
        return { handled: true, response };
      }
      const outcome = await resolveConfirmation(current, client, empresaId, jid, messageId, permit);
      const response = await completeConfirmation(permit, outcome, dryRun, composition.consumedMessageIds);
      metric('ordering_confirm', 'handled', startedAt);
      return { handled: true, response };
    }
    if (current && turn.kind === 'cancel') {
      if (!dryRun) {
        await client.cancelDraft({ empresaId, remoteJid: jid, messageId, orderingId: current.orderingId, expectedRevision: current.revision,
          conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch });
      }
      await persistOrderingState(permit, current, dryRun, priorState, composition.consumedMessageIds);
      const response = 'Pedido cancelado. Se quiser começar outro, é só me dizer.';
      await sendText(permit, response, 'cancelled', dryRun);
      metric('ordering_cancel', 'handled', startedAt);
      return { handled: true, response };
    }
    if (current && (turn.kind === 'ask_change' || (turn.kind === 'alter' && !turn.instruction.trim()))) {
      await persistOrderingState(permit, current, dryRun, priorState, composition.consumedMessageIds);
      const response = 'Tudo bem. O que você quer alterar no pedido?';
      await sendText(permit, response, 'ask-change', dryRun);
      return { handled: true, response };
    }

    const context = await customerContext(session, empresaId);
    let draft: OrderingDraft | null = null;
    const query = findPriorOrderingQuery(session.messages, text);
    if (/\bo de sempre\b/i.test(text)) draft = lastOrderDraft(context);
    const catalog = await client.searchCatalog({ empresaId, query, limit: 12 });
    const wantsOrder = Boolean(current) || /\b(quero|vou querer|manda|coloca|adiciona|pedir|pedido|o de sempre)\b/i.test(text) || followUp;
    // Candidate ambiguity is resolved in the conversation, never delegated to
    // the model: a valid ID is not enough to prove which sellable item the
    // customer meant.
    if (!draft && wantsOrder && !catalog.ambiguous) {
      draft = await (options.draftPlanner ?? planDraft)(session, text, catalog, current);
    }
    if (!draft) {
      // Mid-order ambiguous catalog question (`current` may be set): advance
      // the cursor so this text is not replayed into the next turn's
      // composition once the customer answers the real pending requirement.
      await persistOrderingState(permit, current, dryRun, priorState, composition.consumedMessageIds);
      const response = renderCatalogReply(catalog, query, entry.menuUrl);
      await sendText(permit, response, 'catalog', dryRun);
      metric('catalog_search', 'answered', startedAt);
      return { handled: true, response };
    }
    if (dryRun) {
      const response = renderOrderingDraftPreview(draft, catalog);
      metric('ordering_update', 'dry_run_preview', startedAt);
      return { handled: true, response };
    }
    draft.customer = { name: session.customerName, phone: session.customerPhone };
    draft.pessoaId = session.personId ?? null;
    const updated = await client.updateDraft({
      empresaId, remoteJid: jid, messageId,
      orderingId: current?.orderingId, expectedRevision: current?.revision, draft,
      conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch,
    });
    current = updated;
    const response = updated.readyForConfirmation && updated.confirmationAction
      ? await sendSummary(permit, updated, dryRun, composition.consumedMessageIds)
      : await sendNextRequirement(permit, updated, dryRun, composition.consumedMessageIds, client, messageId);
    metric('ordering_update', 'summary_sent', startedAt);
    return { handled: true, response };
  } catch (error) {
    if (error instanceof OrderingSuppressedError) return { handled: true };
    metric('ordering_turn', 'failed_closed', startedAt);
    // Best-effort cursor advance (escalation/suppression are terminal paths
    // too): only possible when a live draft had already been loaded before
    // the failure. A failure here must never mask the original error path.
    try {
      // `current` may be null when the failure happened while reloading the
      // canonical snapshot itself; fall back to the pre-turn pointer so the
      // cursor still advances against the last known orderingId/revision.
      await persistOrderingState(permit, current ?? priorState, dryRun, priorState, composition.consumedMessageIds);
    } catch (persistError) {
      console.warn('[AiOrdering] best-effort cursor persist on failure threw:', persistError);
    }
    const response = await transferOnFailure(permit, dryRun);
    return { handled: true, response };
  }
}

export async function tryHandleAiWhatsAppOrderingButton(input: {
  jid: string;
  empresaId: string;
  buttonId: string;
  messageId: string;
  permit: AiTurnPermit;
}): Promise<CanonicalButtonHandling> {
  const action = parseOrderingButton(input.buttonId);
  if (!action) return { handled: false };
  if (action.kind === 'start') {
    return { handled: true, complete: async () => { await sendText(input.permit, 'Pode escrever ou mandar um áudio com o que você quer pedir.', 'button-start'); } };
  }
  const client = ZeloMenuInternalClient.fromEnv();
  if (!client) {
    return { handled: true, complete: async () => { await transferOnFailure(input.permit); } };
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
      return { handled: true, complete: async () => { await sendText(input.permit, text, 'button-closed'); } };
    }
    if (action.kind === 'alter') {
      return {
        handled: true,
        complete: async () => { await sendText(input.permit, 'Tudo bem. O que você quer alterar no pedido?', 'button-alter'); },
      };
    }
    if (action.kind === 'cancel') {
      return { handled: true, complete: async () => {
        await client.cancelDraft({
          empresaId: input.empresaId, remoteJid: input.jid, messageId: input.messageId,
          orderingId: current.orderingId, expectedRevision: current.revision,
          conversationControlId: input.permit.conversationControlId, conversationEpoch: input.permit.epoch,
        });
        await sendText(input.permit, 'Pedido cancelado. Se quiser começar outro, é só me dizer.', 'button-cancel');
      } };
    }
    if (action.kind === 'requirement') {
      return { handled: true, complete: async () => {
        const draft = snapshotToDraft(current);
        const requirement = (current.requirements ?? []).find((candidate) => candidate.id === action.requirementId);
        if (action.requirementId === 'fulfillment') {
          if (action.optionId !== 'pickup' && action.optionId !== 'delivery') return;
          draft.fulfillment = { ...draft.fulfillment, type: action.optionId, asap: true };
        } else if (requirement?.kind === 'modifier_group' && requirement.lineId) {
          const line = draft.items.find((item) => item.lineId === requirement.lineId);
          const groupId = requirement.groupId ?? requirement.id;
          if (!line || !(requirement.options ?? []).some((option) => option.id === action.optionId && option.available)) return;
          line.selectedOptions = [
            ...(line.selectedOptions ?? []).filter((selection) => selection.groupId !== groupId),
            { groupId, optionSelections: [{ optionId: action.optionId, quantity: 1 }] },
          ];
        } else if (requirement?.kind === 'payment_method') {
          if (!(requirement.options ?? []).some((option) => option.id === action.optionId && option.available)) return;
          draft.paymentMethod = action.optionId;
        } else {
          await sendText(input.permit, 'Pode me dizer sua escolha por texto ou áudio.', 'button-requirement');
          return;
        }
        const updated = await client.updateDraft({
          empresaId: input.empresaId, remoteJid: input.jid, messageId: input.messageId,
          orderingId: current.orderingId, expectedRevision: current.revision, draft,
          conversationControlId: input.permit.conversationControlId, conversationEpoch: input.permit.epoch,
        });
        if (updated.readyForConfirmation && updated.confirmationAction) await sendSummary(input.permit, updated);
        else await sendNextRequirement(input.permit, updated, false, undefined, client, input.messageId);
      } };
    }
    if (action.kind !== 'confirm') return { handled: true };
    const outcome = await resolveConfirmation(current, client, input.empresaId, input.jid, input.messageId, input.permit, action.token);
    return {
      handled: true,
      complete: async () => { await completeConfirmation(input.permit, outcome); },
    };
  } catch (error) {
    if (error instanceof OrderingSuppressedError) return { handled: true };
    return { handled: true, complete: async () => { await transferOnFailure(input.permit); } };
  }
}
