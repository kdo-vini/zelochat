import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { StoredSession } from './messageHandler.js';
import { addToolMessage, getSession } from './messageHandler.js';
import { getOpenAIClient } from './openaiClient.js';
import { CustomerOrderingContext } from './customers/orderingContextAdapter.js';
import { escalateSession } from './escalation.js';
import { dispatchConversationOutbound } from './conversationOutbound.js';
import { isAiPermitCurrent, type AiTurnPermit } from './conversationControl.js';
import {
  applyFulfillmentTypeSelection,
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
  isOrderingSnapshotEditable,
  isDeliveryFeeQuestion,
  parseOrderingButton,
  renderCatalogReply,
  renderOrderingDraftPreview,
  renderOrderingSummary,
  requirementRevisionFingerprint,
  sanitizeCustomerForWire,
  serializeOrderingState,
  snapshotToDraft,
  type CatalogReplyResult,
  type OrderingDraft,
  type OrderingSnapshot,
  type OrderingStatePointer,
} from '../src/domain/aiWhatsAppOrdering.js';
import { presentOrderingRequirements, hasPendingOrderingRequirements, type OrderingReplyPayload } from '../src/domain/orderingRequirementPresenter.js';
import { applyConversationOrderPatch, buildOrderingPatchTool, validateConversationOrderPatch, type ConversationOrderPatch } from './orderingPatchPlanner.js';
import { composeOrderingTurn, type OrderingTurnComposition } from './orderingTurnComposer.js';
import type { OutboundPayload } from '../src/domain/outbound.js';
import {
  ZeloMenuInternalClient,
  ZeloMenuInternalError,
} from './zeloMenuInternalClient.js';

const MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const STATE_TOOL_CALL_ID = 'zelo_ai_ordering_state';
/**
 * Injectable so `tests/aiTakeoverRace.test.ts` can race the SAME primitives
 * this module actually calls (C5 / PR I-2, I-16, 1.22-1.24) without a real
 * Supabase connection — production always defaults to the real
 * `isAiPermitCurrent` (RPC-backed, fails closed). Threaded explicitly
 * through every function between `AiOrderingHandlerOptions`/the button
 * handler's `input` and the mutation call sites, mirroring how `client` and
 * `dryRun` are already threaded in this file.
 */
type PermitCheck = (permit: AiTurnPermit) => Promise<boolean>;
/** Depth cap for the auto-select recursion in `sendNextRequirement` (PR I-4). */
const MAX_AUTO_SELECT_DEPTH = 3;
/**
 * Consecutive "retry_later" outcomes (ZeloMenu unavailable/slow/rate
 * limited) tolerated before this conversation escalates to a human instead
 * of asking the customer to try again (PR I-5's "no circuit breaker").
 */
const MAX_RETRY_LATER_ATTEMPTS = 2;
class OrderingSuppressedError extends Error {}
const declinesOptionalExtras = (value: string) => /^(?:sem extras|so isso|só isso|nao quero extras|não quero extras)$/i.test(value.trim());

/**
 * FIX 2026-09-04 (B3 — "map every code in errors.json explicitly"): the
 * client used to collapse all ~20 ZeloMenu error codes into one generic
 * catch → human escalation. Recoverable states (a stale revision, a
 * transient 429, a summary token that expired) now each get their own
 * behavior instead of burning a human handoff:
 * - `suppress`: `AI_TURN_REVOKED` — a human already took over; say nothing,
 *   escalate nothing (CLAUDE.md "supressão limpa").
 * - `resync`: the error carries a fresh `current` snapshot
 *   (`REVISAO_DESATUALIZADA`/`PEDIDO_EM_ANDAMENTO`/`RESUMO_EXPIRADO`/
 *   `CONFIRMACAO_INVALIDA`) — adopt it, persist the pointer, and show the
 *   customer where the order actually stands (next requirement or summary)
 *   instead of retrying the same rejected mutation.
 * - `clear_and_tell`: the order is gone/closed
 *   (`PEDIDO_FECHADO`/`PEDIDO_NAO_ENCONTRADO`) — say so briefly; the next
 *   turn opens a fresh draft.
 * - `retry_later`: transient/availability faults
 *   (`MUITAS_REQUISICOES`/`PEDIDO_INDISPONIVEL`/`TIMEOUT`/`INDISPONIVEL`/
 *   `ORDERING_WIRE_UNSUPPORTED`) — ask the customer to try again, bounded by
 *   `MAX_RETRY_LATER_ATTEMPTS` before falling through to escalation.
 * - `escalate`: everything else (validation errors that should never happen
 *   given this codebase's own request-building, or errors with no
 *   recoverable `current`).
 */
type OrderingErrorRecovery =
  | { action: 'suppress' }
  | { action: 'resync'; current: OrderingSnapshot }
  | { action: 'clear_and_tell'; text: string }
  | {
    action: 'retry_later';
    text: string;
    /**
     * FIX 2026-09-04 (PR I-5): `false` for the circuit breaker's own error
     * code — while ZeloMenu is known-down for this empresa (the breaker is
     * open), every turn must keep getting the same friendly retry reply and
     * NEVER spend the per-conversation `MAX_RETRY_LATER_ATTEMPTS` budget,
     * or every open conversation would still independently escalate once
     * its own small counter ran out — exactly the flood I-5 exists to stop.
     * Omitted (defaults to counting) for every other transient code.
     */
    countsTowardLimit?: boolean;
  }
  | { action: 'escalate' };

export function classifyOrderingFailure(error: unknown): OrderingErrorRecovery {
  if (!(error instanceof ZeloMenuInternalError)) return { action: 'escalate' };
  switch (error.code) {
    case 'AI_TURN_REVOKED':
      return { action: 'suppress' };
    case 'PEDIDO_EM_ANDAMENTO':
    case 'REVISAO_DESATUALIZADA':
    case 'RESUMO_EXPIRADO':
    case 'CONFIRMACAO_INVALIDA':
      return error.current ? { action: 'resync', current: error.current } : { action: 'escalate' };
    case 'PEDIDO_FECHADO':
    case 'PEDIDO_NAO_ENCONTRADO':
      return { action: 'clear_and_tell', text: 'Esse pedido já foi encerrado por aqui. Se quiser, começamos um novo.' };
    case 'MUITAS_REQUISICOES':
    case 'PEDIDO_INDISPONIVEL':
    case 'TIMEOUT':
    case 'INDISPONIVEL':
    case 'ORDERING_WIRE_UNSUPPORTED':
      return { action: 'retry_later', text: 'Deu uma instabilidade rápida por aqui agora. Pode tentar de novo em instantes?' };
    // PR I-5: the circuit breaker's own code (server/orderingCircuitBreaker.ts
    // via zeloMenuInternalClient.ts) — never counts toward the escalation
    // budget, see the field doc on `countsTowardLimit`.
    case 'INDISPONIVEL_CIRCUITO_ABERTO':
      return { action: 'retry_later', text: 'Deu uma instabilidade rápida por aqui agora. Pode tentar de novo em instantes?', countsTowardLimit: false };
    default:
      return { action: 'escalate' };
  }
}

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
  /**
   * Injectable live-permit check (C5 / PR I-2, I-16, 1.22-1.24), used by
   * every canonical mutation/persist/outbound in this turn. Defaults to the
   * real, RPC-backed `isAiPermitCurrent` — override only in tests, to race a
   * takeover against the SAME primitives production actually calls, without
   * a real Supabase connection.
   */
  permitCheck?: PermitCheck;
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
  isPermitCurrent: PermitCheck = isAiPermitCurrent,
): Promise<void> {
  if (dryRun) return;
  // C5 / PR I-2, I-16, 1.22-1.24: re-check immediately before every
  // outbound too, not only before the mutation/persist that preceded it —
  // the durable enqueue RPC also fences on the epoch (`enqueue_zelochat_ai_outbound`
  // rejects a stale one as `suppressed`), so this is defense-in-depth that
  // skips the round trip entirely for an already-known-stale permit.
  await assertPermitCurrent(permit, isPermitCurrent);
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

async function sendText(
  permit: AiTurnPermit,
  text: string,
  purpose: string,
  dryRun = false,
  isPermitCurrent: PermitCheck = isAiPermitCurrent,
): Promise<void> {
  await dispatchAiPayload(permit, { kind: 'text', text }, purpose, dryRun, isPermitCurrent);
}

type PointerExtras = Pick<OrderingStatePointer, 'offeredOptionalRequirementIds' | 'declinedOptionalRequirementIds' | 'consumedMessageIds' | 'retryFailureCount'>;
type PointerOverrides = Pick<PointerExtras, 'offeredOptionalRequirementIds' | 'declinedOptionalRequirementIds' | 'retryFailureCount'>;

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
 *
 * `retryFailureCount` is the one exception to "default to prior": every
 * NORMAL (non-error-recovery) write resets it to 0 unless the caller
 * explicitly overrides it, because reaching this function outside the error
 * catch block means the retry streak broke — the turn succeeded.
 */
export function nextOrderingStatePatch(
  priorState: Pick<OrderingStatePointer, 'offeredOptionalRequirementIds' | 'declinedOptionalRequirementIds' | 'consumedMessageIds'> | null,
  consumedMessageIds?: string[],
  overrides: PointerOverrides = {},
): PointerExtras {
  return {
    offeredOptionalRequirementIds: overrides.offeredOptionalRequirementIds ?? priorState?.offeredOptionalRequirementIds,
    declinedOptionalRequirementIds: overrides.declinedOptionalRequirementIds ?? priorState?.declinedOptionalRequirementIds,
    consumedMessageIds: consumedMessageIds ?? priorState?.consumedMessageIds,
    retryFailureCount: overrides.retryFailureCount ?? 0,
  };
}

/**
 * FIX 2026-09-04 (C5 / PR I-2, I-16, 1.22-1.24): re-check the LIVE permit
 * immediately before every canonical mutation (`updateDraft`/`confirmDraft`/
 * `cancelDraft`), not only before the local persist/outbound. ZeloMenu's own
 * epoch fence (`conversationControlId`/`conversationEpoch` on every command)
 * still backstops this — a call that slips past this check because of a
 * race with the check itself is still rejected authority-side as
 * `AI_TURN_REVOKED`. This is the cheap, LOCAL half of the defense: it skips
 * the mutation (and the ZeloMenu round trip) entirely once a takeover has
 * already landed, instead of mutating first and discovering the fence only
 * after the cart was already changed (PR I-16's exact bug on the button
 * paths).
 */
async function assertPermitCurrent(permit: AiTurnPermit, isPermitCurrent: PermitCheck = isAiPermitCurrent): Promise<void> {
  if (!(await isPermitCurrent(permit))) throw new OrderingSuppressedError();
}

async function persistPointer(
  permit: AiTurnPermit,
  snapshot: Pick<OrderingSnapshot, 'orderingId' | 'revision'>,
  dryRun = false,
  state: PointerExtras | null = null,
  isPermitCurrent: PermitCheck = isAiPermitCurrent,
): Promise<void> {
  if (dryRun) return;
  await assertPermitCurrent(permit, isPermitCurrent);
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
      // `0` is falsy but a meaningful, load-bearing value here (it RESETS the
      // streak) — a truthy-only spread would silently drop it and leave the
      // previous count stuck.
      ...(typeof state?.retryFailureCount === 'number' ? { retryFailureCount: state.retryFailureCount } : {}),
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
  overrides: PointerOverrides = {},
  isPermitCurrent: PermitCheck = isAiPermitCurrent,
): Promise<void> {
  if (!current) return;
  await persistPointer(permit, current, dryRun, nextOrderingStatePatch(priorState, consumedMessageIds, overrides), isPermitCurrent);
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
  isPermitCurrent: PermitCheck = isAiPermitCurrent,
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
  await persistPointer(permit, snapshot, dryRun, nextOrderingStatePatch(previous, consumedMessageIds), isPermitCurrent);
  if (buttons.length) {
    await dispatchAiPayload(permit, {
      kind: 'buttons',
      text,
      buttons: buttons.map((button) => ({ id: button.id, label: button.displayText })),
    }, `summary:${snapshot.orderingId}:${snapshot.revision}`, dryRun, isPermitCurrent);
  } else {
    await sendText(permit, text, `summary:${snapshot.orderingId}:${snapshot.revision}`, dryRun, isPermitCurrent);
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
  autoSelectDepth = 0,
  isPermitCurrent: PermitCheck = isAiPermitCurrent,
): Promise<string> {
  const stored = await getSession(permit.remoteJid, permit.empresaId);
  const state = findLatestOrderingState(stored?.messages ?? []);
  const presentation = presentOrderingRequirements(snapshot, state);
  // FIX 2026-09-04 (PR I-4): this recursion had no depth guard — if ZeloMenu
  // ever kept returning an auto-selectable requirement (a rejected auto
  // -select, or a group whose single option keeps failing server-side
  // validation), one inbound message could drive an unbounded number of
  // `updateDraft` mutations against the authority. Capped at
  // `MAX_AUTO_SELECT_DEPTH`; past that, ask the customer instead of looping.
  if (presentation.autoSelect && client && messageId && !dryRun && autoSelectDepth < MAX_AUTO_SELECT_DEPTH) {
    const draft = snapshotToDraft(snapshot);
    const line = draft.items.find((item) => item.lineId === presentation.autoSelect?.lineId);
    if (line) {
      const groupId = presentation.autoSelect.groupId;
      line.selectedOptions = [
        ...(line.selectedOptions ?? []).filter((selection) => selection.groupId !== groupId),
        { groupId, optionSelections: [{ optionId: presentation.autoSelect.optionId, quantity: 1 }] },
      ];
      await assertPermitCurrent(permit, isPermitCurrent);
      const updated = await client.updateDraft({
        empresaId: permit.empresaId, remoteJid: permit.remoteJid, messageId: `${messageId}:auto:${groupId}`,
        orderingId: snapshot.orderingId, expectedRevision: snapshot.revision, draft,
        conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch,
      });
      return sendNextRequirement(permit, updated, dryRun, consumedMessageIds, client, messageId, autoSelectDepth + 1, isPermitCurrent);
    }
  }
  // The depth cap was hit while the presentation would otherwise have
  // auto-applied a choice and stayed silent about it ("Vou considerar X
  // para seguir.") — never send that text without actually having applied
  // it; ask a real, honest question instead.
  const payload = presentation.autoSelect && autoSelectDepth >= MAX_AUTO_SELECT_DEPTH
    ? { kind: 'text' as const, text: 'Pode confirmar rapidinho as próximas escolhas do seu pedido?' }
    : presentation.payload;
  // FIX 2026-09-03 (FN C3): `consumedMessageIds` used to be written as-is —
  // when a caller had none to offer (the button path, or the declines-extras
  // path calling through after its own explicit persist), the field was
  // OMITTED from the write entirely, erasing whatever cursor a sibling call
  // had just persisted moments earlier. Falling back to `state?.consumedMessageIds`
  // (the pointer this same call already re-fetched above) preserves it instead.
  await persistPointer(permit, snapshot, dryRun, nextOrderingStatePatch(state, consumedMessageIds, {
    offeredOptionalRequirementIds: presentation.offeredOptionalRequirementIds,
    declinedOptionalRequirementIds: presentation.declinedOptionalRequirementIds,
  }), isPermitCurrent);
  await dispatchAiPayload(permit, presentationPayload(payload), `requirement:${snapshot.orderingId}:${snapshot.revision}`, dryRun, isPermitCurrent);
  return payload.text;
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
    'Use somente alterar_carrinho; nunca confirme ou cancele.',
    'O CATÁLOGO CANÔNICO abaixo já foi buscado e o CARRINHO ATUAL já foi consultado — nunca peça para buscar de novo.',
    'Ao alterar, envie o carrinho completo e use somente IDs presentes no CATÁLOGO CANÔNICO ou no CARRINHO ATUAL.',
    'Não invente IDs, preços, taxas ou disponibilidade. Se faltar escolha essencial, não chame alterar_carrinho.',
    'Para remover um item inteiro, inclua o lineId em removedLineIds.',
    `CATÁLOGO CANÔNICO: ${JSON.stringify(result)}`,
    `CARRINHO ATUAL: ${JSON.stringify(current ? snapshotToDraft(current) : null)}`,
  ].join('\n');
  const completion = await getOpenAIClient().chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: text }],
    tools: [buildOrderingPatchTool()],
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
  const items = last.items.flatMap((item, index) => {
    const productId = Number(item.productId);
    if (!Number.isInteger(productId) || productId <= 0) return [];
    return [{
      // FIX 2026-09-04 (CT #6): ZeloMenu requires `lineId` on EVERY item,
      // open or update — this repeat-order draft never set one and every
      // "o de sempre" 400'd. The exact value only needs to be unique within
      // this brand-new draft (there is no `current` cart to reconcile
      // against on an open); the array index is enough.
      lineId: `line-${productId}-${index + 1}`,
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
  | { kind: 'confirmed'; snapshot: OrderingSnapshot }
  | { kind: 'timeout_pending'; snapshot: OrderingSnapshot };

export async function resolveConfirmation(
  snapshot: OrderingSnapshot,
  client: OrderingClient,
  empresaId: string,
  jid: string,
  messageId: string,
  permit: AiTurnPermit,
  token?: string,
  /**
   * FIX 2026-09-04 (C3 / PR C-5): the revision the customer actually SAW —
   * for a button tap it comes from the button id itself
   * (`buildRequirementButtonId`-style `|<revision>` suffix, PR 1.28's same
   * defense finally applied to the confirm button); for typed text it is the
   * persisted pointer's `revision` (updated on every `sendSummary` call).
   * `snapshot` here is always the FRESHLY reloaded draft — using its OWN
   * revision as "what the customer saw" is exactly the bug this fixes: it
   * would let a stale `Confirmar` silently confirm whatever is current now.
   */
  expectedRevision?: number,
  /**
   * C5 / PR I-2, I-16, 1.22-1.24: injectable so `tests/aiTakeoverRace.test.ts`
   * can race the SAME check this function performs, without a real Supabase
   * connection. Defaults to the real, RPC-backed `isAiPermitCurrent`.
   */
  isPermitCurrent: PermitCheck = isAiPermitCurrent,
): Promise<ConfirmationOutcome> {
  // Stale: the draft moved since the customer was shown this token/button
  // (another edit, a store-side fee recalculation, a race with a second
  // device). NEVER call confirmDraft against content the customer never
  // saw — refresh and re-send the CURRENT summary so they explicitly
  // re-confirm what is actually current.
  if (typeof expectedRevision === 'number' && expectedRevision !== snapshot.revision) {
    return { kind: 'summary', snapshot };
  }
  // C5 / PR I-2, I-16, 1.22-1.24: check the live permit before this
  // conversation's single money-moving mutation.
  await assertPermitCurrent(permit, isPermitCurrent);
  try {
    const confirmed = await client.confirmDraft({
      empresaId, remoteJid: jid, messageId, orderingId: snapshot.orderingId,
      expectedRevision: snapshot.revision, confirmationToken: token,
      conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch,
    });
    if (confirmed.requiresReview || confirmed.state === 'cart_open') return { kind: 'summary', snapshot: confirmed };
    return { kind: 'confirmed', snapshot: confirmed };
  } catch (error) {
    // FIX 2026-09-04 (CT #9): the client may have given up waiting on the
    // confirm round trip while ZeloMenu's multi-step transaction (order
    // materialization + insert + auto-accept) kept running server-side.
    // Reconcile with a fresh GET before telling the customer anything
    // failed — never claim a failure that already succeeded on the other
    // side of the seam.
    if (error instanceof ZeloMenuInternalError && (error.code === 'TIMEOUT' || error.code === 'INDISPONIVEL')) {
      try {
        const reconciled = await client.getOrdering(snapshot.orderingId, empresaId, jid);
        if (reconciled.order || reconciled.state.startsWith('confirmed') || reconciled.state === 'accepted') {
          return { kind: 'confirmed', snapshot: reconciled };
        }
      } catch {
        // Reconciliation GET itself failed too; fall through to the
        // "still confirming, try again next turn" outcome below.
      }
      return { kind: 'timeout_pending', snapshot };
    }
    // FIX 2026-09-04 (C5 / FN I3): `AI_TURN_REVOKED` means a human already
    // took over — CLAUDE.md/the design spec calls this "supressão limpa":
    // no mutation, no message. The generic `error.current` branch below used
    // to retry `updateDraft` with the SAME (now-revoked) epoch whenever
    // ZeloMenu attached a `current` snapshot to this 409 — which it does,
    // same as any other conflict — turning a clean suppression into a
    // second mutation attempt under a permit the conversation has already
    // moved on from. Re-throw immediately so `classifyOrderingFailure`
    // (the outer catch, in both callers) maps it to `{ action: 'suppress' }`
    // instead: no retry, no customer message, no escalation.
    if (error instanceof ZeloMenuInternalError && error.code === 'AI_TURN_REVOKED') throw error;
    if (error instanceof ZeloMenuInternalError && error.current) {
      await assertPermitCurrent(permit, isPermitCurrent);
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
  isPermitCurrent: PermitCheck = isAiPermitCurrent,
): Promise<string> {
  if (outcome.kind === 'summary') return sendSummary(permit, outcome.snapshot, dryRun, consumedMessageIds, isPermitCurrent);
  if (outcome.kind === 'timeout_pending') {
    const text = 'Ainda estou confirmando seu pedido, isso pode levar mais um instante. Se eu não confirmar em alguns minutos, me chame de novo por aqui que eu verifico.';
    await sendText(permit, text, `confirm-timeout:${outcome.snapshot.orderingId}:${outcome.snapshot.revision}`, dryRun, isPermitCurrent);
    // Do not advance/replace the pointer here: the mutation may still land
    // on ZeloMenu's side after this reply. The NEXT turn's
    // `loadCanonicalSnapshot` reads whatever actually happened.
    return text;
  }
  // FIX 2026-09-04 (C3 / PR C-4): the state transition is persisted BEFORE
  // the confirmation text is enqueued — the reverse order (as this used to
  // read) let a customer-visible dedupe/idempotency marker get set on the
  // caller's side once the ZeloMenu mutation and this reply had both fired,
  // with no durable local record in between. If persisting throws here, the
  // confirmation text is never sent THIS attempt and no dedupe key is
  // recorded upstream (see router.ts's canonical-button handling) — a retry
  // re-enters this conversation, `loadCanonicalSnapshot` sees the order is
  // already confirmed in ZeloMenu (source of truth), and the "already
  // confirmed" branch in the caller sends the notice exactly once.
  const text = 'Pedido confirmado e enviado para a loja. Aviso por aqui quando houver novidade.';
  await persistPointer(permit, outcome.snapshot, dryRun, consumedMessageIds ? { consumedMessageIds } : null, isPermitCurrent);
  await sendText(permit, text, `confirmed:${outcome.snapshot.orderingId}:${outcome.snapshot.revision}`, dryRun, isPermitCurrent);
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
  // C5 / PR I-2, I-16, 1.22-1.24: the live-permit check every canonical
  // mutation/persist/outbound in this turn re-checks. Defaults to the real
  // one; only tests override it.
  const isPermitCurrent = options.permitCheck ?? isAiPermitCurrent;
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
    await sendText(permit, response, `audio-failure:${composition.failedAudioMessageIds.join(':')}`, dryRun, isPermitCurrent);
    // No ZeloMenu round trip needed here — we are not mutating the draft,
    // only re-affirming the existing pointer's orderingId/revision with an
    // advanced cursor so this failed audio is never re-detected on the next
    // turn (the second half of PR C-6: "one failed audio permanently bricks
    // the conversation").
    await persistOrderingState(permit, priorState, dryRun, priorState, composition.consumedMessageIds, {}, isPermitCurrent);
    return { handled: true, response };
  }
  // FIX 2026-09-04 (C6 / PR I-8): this used to return `{ handled: false }`
  // below whenever `text` wasn't an EXACT greeting match (e.g. "tá
  // atendendo?", "estão atendendo?", "boa noite, tão aberto?") even though
  // the entry card had already been dispatched — `ai.ts` then let the
  // generic OpenAI model answer too, so the customer got the entry card
  // AND a redundant greeting. `entryDispatched` remembers that this turn
  // already sent something, so the "nothing else to do" exits below report
  // `handled: true` instead of inviting a second reply. A message that is
  // BOTH a greeting AND an order ("oi, quero uma coxinha") is unaffected:
  // `isOrderingGreeting` stays false for it, so control falls through to
  // the normal catalog/order flow exactly as before.
  let entryDispatched = false;
  if (entry.storeOpen === true && entry.menuUrl && isOrderingEntryTurn(text)) {
    const response = buildOrderingEntryPayload(entry.menuUrl);
    try {
      await dispatchAiPayload(permit, response, 'entry', dryRun, isPermitCurrent);
      entryDispatched = true;
      if (isOrderingGreeting(text)) return { handled: true, response: response.text };
    } catch (error) {
      if (error instanceof OrderingSuppressedError) return { handled: true };
      throw error;
    }
  }
  if (entry.menuUrl && isDeliveryFeeQuestion(text)) {
    const response = buildDeliveryFeeReply(entry.menuUrl);
    await sendText(permit, response, 'delivery-fee', dryRun, isPermitCurrent);
    return { handled: true, response };
  }
  const messageId = lastUserMessageId(session);
  const hasPointer = Boolean(priorState);
  const initialTurn = classifyOrderingTurn(text, hasPointer);
  const followUp = !hasPointer && isOrderingFollowUp(session.messages);
  if (initialTurn.kind === 'none' && !followUp) return { handled: entryDispatched };
  const client = options.client ?? ZeloMenuInternalClient.fromEnv();
  if (!client) {
    metric('ordering_turn', 'configuration_missing', startedAt);
    if (dryRun) return { handled: false };
    try {
      await persistOrderingState(permit, priorState, dryRun, priorState, composition.consumedMessageIds, {}, isPermitCurrent);
    } catch (persistError) {
      console.warn('[AiOrdering] best-effort cursor persist on configuration_missing threw:', persistError);
    }
    const response = await transferOnFailure(permit, dryRun);
    return { handled: true, response };
  }
  try {
    const canonical = await loadCanonicalSnapshot(session, empresaId, jid, client);
    current = canonical && isOrderingSnapshotEditable(canonical) ? canonical : null;
    const turn = classifyOrderingTurn(text, Boolean(current) || hasPointer);
    if (current && declinesOptionalExtras(text)) {
      const declinedOptionalRequirementIds = [...new Set([
        ...(priorState?.declinedOptionalRequirementIds ?? []),
        ...(current.requirements ?? []).filter((requirement) => !requirement.blocking).map((requirement) => requirement.id),
      ])];
      await persistOrderingState(permit, current, dryRun, priorState, composition.consumedMessageIds, {
        declinedOptionalRequirementIds,
      }, isPermitCurrent);
      // FIX 2026-09-04 (C4 / FN I1): use the JUST-declined list, not the
      // stale `priorState` — every non-blocking requirement was declined
      // above, so (absent a NEW blocking one) there is nothing left to
      // offer and this correctly falls through to the summary.
      const response = hasPendingOrderingRequirements(current, { declinedOptionalRequirementIds })
        ? await sendNextRequirement(permit, current, dryRun, composition.consumedMessageIds, undefined, undefined, 0, isPermitCurrent)
        : await sendSummary(permit, current, dryRun, composition.consumedMessageIds, isPermitCurrent);
      return { handled: true, response };
    }
    if (turn.kind === 'none' && !followUp) return { handled: entryDispatched };

    if (!current && canonical && (turn.kind === 'confirm' || turn.kind === 'ask_change' || turn.kind === 'cancel')) {
      const response = canonical.order || canonical.state.startsWith('confirmed') || canonical.state === 'accepted'
        ? 'Esse pedido já foi confirmado. Se precisar, posso chamar um atendente.'
        : 'Esse pedido já foi finalizado. Quer começar um novo?';
      await sendText(permit, response, 'already-closed', dryRun, isPermitCurrent);
      return { handled: true, response };
    }

    if (current && turn.kind === 'confirm') {
      if (dryRun) {
        const response = `${renderOrderingSummary(current)}\n\nSimulação: a confirmação não foi enviada.`;
        await sendText(permit, response, `confirm-preview:${current.orderingId}:${current.revision}`, true, isPermitCurrent);
        return { handled: true, response };
      }
      // FIX 2026-09-04 (B2 — "send only what the parser accepts"): a
      // `confirm_draft` with no `confirmationToken` is REJECTED by ZeloMenu
      // (mandatory since the authority's ZM1 step 3, `commands.rejected.json`).
      // A typed "sim" never carried the token that a `Confirmar` button tap
      // does — every text confirmation 400'd. The token is already visible
      // to the customer's OWN conversation via `confirmationAction`, so
      // reusing it here (rather than requiring a button tap) is safe.
      //
      // FIX 2026-09-04 (C3 / PR C-5): `priorState.revision` is the revision
      // of the LAST summary this conversation actually sent (persisted by
      // `sendSummary`/`sendNextRequirement` on every write) — pass it so
      // `resolveConfirmation` refuses to confirm a revision the customer was
      // never shown a summary for.
      const outcome = await resolveConfirmation(current, client, empresaId, jid, messageId, permit, current.confirmationAction?.token, priorState?.revision, isPermitCurrent);
      const response = await completeConfirmation(permit, outcome, dryRun, composition.consumedMessageIds, isPermitCurrent);
      metric('ordering_confirm', 'handled', startedAt);
      return { handled: true, response };
    }
    if (current && turn.kind === 'cancel') {
      if (!dryRun) {
        await assertPermitCurrent(permit, isPermitCurrent);
        await client.cancelDraft({ empresaId, remoteJid: jid, messageId, orderingId: current.orderingId, expectedRevision: current.revision,
          conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch });
      }
      await persistOrderingState(permit, current, dryRun, priorState, composition.consumedMessageIds, {}, isPermitCurrent);
      const response = 'Pedido cancelado. Se quiser começar outro, é só me dizer.';
      await sendText(permit, response, 'cancelled', dryRun, isPermitCurrent);
      metric('ordering_cancel', 'handled', startedAt);
      return { handled: true, response };
    }
    if (current && (turn.kind === 'ask_change' || (turn.kind === 'alter' && !turn.instruction.trim()))) {
      await persistOrderingState(permit, current, dryRun, priorState, composition.consumedMessageIds, {}, isPermitCurrent);
      const response = 'Tudo bem. O que você quer alterar no pedido?';
      await sendText(permit, response, 'ask-change', dryRun, isPermitCurrent);
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
      await persistOrderingState(permit, current, dryRun, priorState, composition.consumedMessageIds, {}, isPermitCurrent);
      const response = renderCatalogReply(catalog, query, entry.menuUrl);
      await sendText(permit, response, 'catalog', dryRun, isPermitCurrent);
      metric('catalog_search', 'answered', startedAt);
      return { handled: true, response };
    }
    if (dryRun) {
      const response = renderOrderingDraftPreview(draft, catalog);
      metric('ordering_update', 'dry_run_preview', startedAt);
      return { handled: true, response };
    }
    // FIX 2026-09-04 (CT #8): sending `customer: { name: undefined, ... }`
    // unconditionally used to reach ZeloMenu as `customer: {}`, which
    // resolves to `name: null` and re-raises the blocking `customer_name`
    // requirement forever for any contact with no WhatsApp pushName. Only
    // send a name when one is actually known.
    draft.customer = sanitizeCustomerForWire({ name: session.customerName, phone: session.customerPhone });
    draft.pessoaId = session.personId ?? null;
    await assertPermitCurrent(permit, isPermitCurrent);
    const updated = await client.updateDraft({
      empresaId, remoteJid: jid, messageId,
      orderingId: current?.orderingId, expectedRevision: current?.revision, draft,
      conversationControlId: permit.conversationControlId, conversationEpoch: permit.epoch,
    });
    current = updated;
    // FIX 2026-09-04 (C4 / FN I1): route through the presenter (which offers
    // any pending optional/"extras" group exactly once) whenever there is
    // still something to ask — never jump straight to the confirm summary
    // just because ZeloMenu's blocking requirements are all satisfied.
    const response = hasPendingOrderingRequirements(updated, priorState)
      ? await sendNextRequirement(permit, updated, dryRun, composition.consumedMessageIds, client, messageId, 0, isPermitCurrent)
      : await sendSummary(permit, updated, dryRun, composition.consumedMessageIds, isPermitCurrent);
    metric('ordering_update', 'summary_sent', startedAt);
    return { handled: true, response };
  } catch (error) {
    if (error instanceof OrderingSuppressedError) return { handled: true };
    // FIX 2026-09-04 (B3 — explicit error-code mapping): every ZeloMenu
    // error used to collapse into the same generic escalation. See
    // `classifyOrderingFailure`'s docstring for the behavior each action
    // implements.
    const recovery = classifyOrderingFailure(error);
    if (recovery.action === 'suppress') return { handled: true };
    try {
      if (recovery.action === 'resync') {
        await persistOrderingState(permit, recovery.current, dryRun, priorState, composition.consumedMessageIds, {}, isPermitCurrent);
        const response = hasPendingOrderingRequirements(recovery.current, priorState)
          ? await sendNextRequirement(permit, recovery.current, dryRun, composition.consumedMessageIds, client, messageId, 0, isPermitCurrent)
          : await sendSummary(permit, recovery.current, dryRun, composition.consumedMessageIds, isPermitCurrent);
        metric('ordering_turn', 'resynced', startedAt);
        return { handled: true, response };
      }
      if (recovery.action === 'clear_and_tell') {
        // The pointer already refers to a closed/missing order; nothing to
        // persist here — the NEXT turn opens a fresh draft instead of
        // retrying this one.
        await sendText(permit, recovery.text, 'ordering-closed-recovery', dryRun, isPermitCurrent);
        metric('ordering_turn', 'closed_recovered', startedAt);
        return { handled: true, response: recovery.text };
      }
      if (recovery.action === 'retry_later') {
        // PR I-5: a breaker-open failure never spends this conversation's
        // retry budget — reply and return without touching the counter.
        if (recovery.countsTowardLimit === false) {
          await sendText(permit, recovery.text, 'ordering-retry-later', dryRun, isPermitCurrent);
          metric('ordering_turn', 'retry_later', startedAt);
          return { handled: true, response: recovery.text };
        }
        const attempts = (priorState?.retryFailureCount ?? 0) + 1;
        if (attempts <= MAX_RETRY_LATER_ATTEMPTS) {
          await persistOrderingState(permit, current ?? priorState, dryRun, priorState, composition.consumedMessageIds, { retryFailureCount: attempts }, isPermitCurrent);
          await sendText(permit, recovery.text, 'ordering-retry-later', dryRun, isPermitCurrent);
          metric('ordering_turn', 'retry_later', startedAt);
          return { handled: true, response: recovery.text };
        }
        // Bounded policy (PR I-5): stop asking the customer to try again
        // forever — fall through to the normal escalation below, and reset
        // the streak so a fresh conversation (post-human-look) starts clean.
        await persistOrderingState(permit, current ?? priorState, dryRun, priorState, composition.consumedMessageIds, { retryFailureCount: 0 }, isPermitCurrent);
      }
    } catch (recoveryError) {
      console.warn('[AiOrdering] error-recovery path itself failed, falling back to escalation:', recoveryError);
    }
    metric('ordering_turn', 'failed_closed', startedAt);
    // Best-effort cursor advance (escalation/suppression are terminal paths
    // too): only possible when a live draft had already been loaded before
    // the failure. A failure here must never mask the original error path.
    try {
      // `current` may be null when the failure happened while reloading the
      // canonical snapshot itself; fall back to the pre-turn pointer so the
      // cursor still advances against the last known orderingId/revision.
      await persistOrderingState(permit, current ?? priorState, dryRun, priorState, composition.consumedMessageIds, {}, isPermitCurrent);
    } catch (persistError) {
      console.warn('[AiOrdering] best-effort cursor persist on failure threw:', persistError);
    }
    const response = await transferOnFailure(permit, dryRun);
    return { handled: true, response };
  }
}

/**
 * FIX 2026-09-04 (C5 / FN I3, PR I-2): `complete()` closures run AFTER
 * `tryHandleAiWhatsAppOrderingButton`'s own try/catch has already returned —
 * a takeover landing while a closure is in flight (or the permit check just
 * added ahead of each mutation above) surfaces as `OrderingSuppressedError`
 * to WHOEVER awaits `complete()` (router.ts). Without this wrapper that
 * throw would reach `processWebhookEvent`'s catch and get logged/retried as
 * a genuine failure — noisy and pointless for something that is, by design,
 * a clean no-op: the human already has the conversation.
 */
function withSuppression(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } catch (error) {
      if (!(error instanceof OrderingSuppressedError)) throw error;
    }
  };
}

export async function tryHandleAiWhatsAppOrderingButton(input: {
  jid: string;
  empresaId: string;
  buttonId: string;
  messageId: string;
  permit: AiTurnPermit;
  /**
   * C5 / PR I-2, I-16, 1.22-1.24: injectable live-permit check, same
   * contract as `AiOrderingHandlerOptions.permitCheck`. Defaults to the
   * real, RPC-backed `isAiPermitCurrent`.
   */
  permitCheck?: PermitCheck;
}): Promise<CanonicalButtonHandling> {
  const isPermitCurrent = input.permitCheck ?? isAiPermitCurrent;
  const action = parseOrderingButton(input.buttonId);
  if (!action) return { handled: false };
  if (action.kind === 'start') {
    return { handled: true, complete: withSuppression(async () => { await sendText(input.permit, 'Pode escrever ou mandar um áudio com o que você quer pedir.', 'button-start', false, isPermitCurrent); }) };
  }
  const client = ZeloMenuInternalClient.fromEnv();
  if (!client) {
    return { handled: true, complete: withSuppression(async () => { await transferOnFailure(input.permit); }) };
  }
  const session = await getSession(input.jid, input.empresaId);
  if (!session) return { handled: true };
  // Needed for C4/FN I1's "did we already offer/decline the optional
  // groups" check below, mirroring the text-turn handler.
  const priorState = findLatestOrderingState(session.messages);
  try {
    const current = await loadCanonicalSnapshot(session, input.empresaId, input.jid, client);
    if (!current) return { handled: true };
    if (!isOrderingSnapshotEditable(current)) {
      const text = current.order || current.state.startsWith('confirmed') || current.state === 'accepted'
          ? 'Esse pedido já foi confirmado. Se precisar, posso chamar um atendente.'
          : 'Esse pedido já foi finalizado. Quer começar um novo?';
      return { handled: true, complete: withSuppression(async () => { await sendText(input.permit, text, 'button-closed', false, isPermitCurrent); }) };
    }
    if (action.kind === 'alter') {
      return {
        handled: true,
        complete: withSuppression(async () => { await sendText(input.permit, 'Tudo bem. O que você quer alterar no pedido?', 'button-alter', false, isPermitCurrent); }),
      };
    }
    if (action.kind === 'cancel') {
      return { handled: true, complete: withSuppression(async () => {
        // C5 / PR I-16: check the permit BEFORE mutating — a takeover
        // landing between the button tap and this closure running must
        // never cancel the cart silently.
        await assertPermitCurrent(input.permit, isPermitCurrent);
        await client.cancelDraft({
          empresaId: input.empresaId, remoteJid: input.jid, messageId: input.messageId,
          orderingId: current.orderingId, expectedRevision: current.revision,
          conversationControlId: input.permit.conversationControlId, conversationEpoch: input.permit.epoch,
        });
        await sendText(input.permit, 'Pedido cancelado. Se quiser começar outro, é só me dizer.', 'button-cancel', false, isPermitCurrent);
      }) };
    }
    if (action.kind === 'requirement') {
      return { handled: true, complete: withSuppression(async () => {
        const requirement = (current.requirements ?? []).find((candidate) => candidate.id === action.requirementId);
        if (!requirement) {
          await sendText(input.permit, 'Pode me dizer sua escolha por texto ou áudio.', 'button-requirement', false, isPermitCurrent);
          return;
        }
        // FIX 2026-09-04 (PR 1.28): the button id carries a fingerprint of
        // the orderingId/revision it was built for. If the draft has moved
        // on since (another message updated it, or a stale re-render), do
        // NOT blindly apply this tap to whatever is current now — show the
        // customer where things actually stand and let them re-answer.
        if (action.fingerprint !== requirementRevisionFingerprint(current.orderingId, current.revision)) {
          if (hasPendingOrderingRequirements(current, priorState)) await sendNextRequirement(input.permit, current, false, undefined, client, input.messageId, 0, isPermitCurrent);
          else await sendSummary(input.permit, current, false, undefined, isPermitCurrent);
          return;
        }
        const draft = snapshotToDraft(current);
        if (requirement.type === 'fulfillment_type') {
          if (action.optionId !== 'pickup' && action.optionId !== 'delivery') return;
          // C6 / PR I-3: preserves an already-agreed schedule instead of
          // silently forcing `asap: true`.
          draft.fulfillment = applyFulfillmentTypeSelection(draft.fulfillment, action.optionId);
        } else if (requirement.type === 'modifier_group' && requirement.lineId) {
          const line = draft.items.find((item) => item.lineId === requirement.lineId);
          const groupId = requirement.groupId ?? requirement.id;
          if (!line || !(requirement.options ?? []).some((option) => option.id === action.optionId && option.available)) return;
          line.selectedOptions = [
            ...(line.selectedOptions ?? []).filter((selection) => selection.groupId !== groupId),
            { groupId, optionSelections: [{ optionId: action.optionId, quantity: 1 }] },
          ];
        } else if (requirement.type === 'payment_method') {
          if (!(requirement.options ?? []).some((option) => option.id === action.optionId && option.available)) return;
          draft.paymentMethod = action.optionId;
        } else {
          await sendText(input.permit, 'Pode me dizer sua escolha por texto ou áudio.', 'button-requirement', false, isPermitCurrent);
          return;
        }
        await assertPermitCurrent(input.permit, isPermitCurrent);
        const updated = await client.updateDraft({
          empresaId: input.empresaId, remoteJid: input.jid, messageId: input.messageId,
          orderingId: current.orderingId, expectedRevision: current.revision, draft,
          conversationControlId: input.permit.conversationControlId, conversationEpoch: input.permit.epoch,
        });
        if (hasPendingOrderingRequirements(updated, priorState)) await sendNextRequirement(input.permit, updated, false, undefined, client, input.messageId, 0, isPermitCurrent);
        else await sendSummary(input.permit, updated, false, undefined, isPermitCurrent);
      }) };
    }
    if (action.kind !== 'confirm') return { handled: true };
    // FIX 2026-09-04 (C3 / PR C-5): `action.expectedRevision` comes from the
    // button id itself (`ZOC:<token>|<revision>`) — the exact revision this
    // specific button was rendered for. Absent only for a button already
    // delivered before this deploy shipped the suffix.
    const outcome = await resolveConfirmation(current, client, input.empresaId, input.jid, input.messageId, input.permit, action.token, action.expectedRevision, isPermitCurrent);
    return {
      handled: true,
      complete: withSuppression(async () => { await completeConfirmation(input.permit, outcome, false, undefined, isPermitCurrent); }),
    };
  } catch (error) {
    if (error instanceof OrderingSuppressedError) return { handled: true };
    const recovery = classifyOrderingFailure(error);
    if (recovery.action === 'suppress') return { handled: true };
    if (recovery.action === 'resync') {
      return { handled: true, complete: withSuppression(async () => {
        if (hasPendingOrderingRequirements(recovery.current, priorState)) await sendNextRequirement(input.permit, recovery.current, false, undefined, client, input.messageId, 0, isPermitCurrent);
        else await sendSummary(input.permit, recovery.current, false, undefined, isPermitCurrent);
      }) };
    }
    if (recovery.action === 'clear_and_tell' || recovery.action === 'retry_later') {
      return { handled: true, complete: withSuppression(async () => { await sendText(input.permit, recovery.text, 'button-error-recovery', false, isPermitCurrent); }) };
    }
    return { handled: true, complete: withSuppression(async () => { await transferOnFailure(input.permit); }) };
  }
}
