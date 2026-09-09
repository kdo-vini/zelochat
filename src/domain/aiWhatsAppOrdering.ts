/**
 * Pure domain vocabulary for the conversational ordering flow.
 *
 * This module deliberately contains no provider, database, React or AI
 * dependencies.  The server adapter is responsible for carrying these values
 * across the ZeloMenu boundary and for dispatching the resulting payloads.
 */

export const AI_ORDER_CONFIRM_PREFIX = 'ZOC:';
export const AI_ORDER_ALTER_BUTTON = 'ZOA';
export const AI_ORDER_CANCEL_BUTTON = 'ZOC_CANCEL';
export const AI_ORDER_START_BUTTON = 'AI_ORDER_START';
export const AI_ORDER_REQUIREMENT_PREFIX = 'REQ:';
export const AI_ORDER_STATE_PREFIX = 'ZELO_AI_ORDERING_STATE:';

export type OrderingTurn =
  | { kind: 'confirm' }
  | { kind: 'alter'; instruction: string }
  | { kind: 'ask_change' }
  | { kind: 'cancel' }
  | { kind: 'catalog_or_order'; query: string }
  | { kind: 'none' };

export interface OrderingConversationMessage {
  role: string;
  content: string | null;
  preview?: string | null;
  audio_transcript?: string | null;
  audio_transcript_status?: 'pending' | 'done' | 'failed' | null;
  id?: string;
  timestamp?: string | null;
  /** Provider timestamp, when the transport exposes one separately. */
  providerTimestamp?: string | number | null;
  /** Database insertion timestamp, used as a deterministic tie breaker. */
  dbTimestamp?: string | number | null;
}

export const normalizeOrderingText = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR')
  .replace(/[.!?]+$/g, '')
  .trim();

const normalize = normalizeOrderingText;

/** True when the customer greeted or asked whether the store is operating. */
export function isOrderingEntryTurn(text: string): boolean {
  const normalized = normalize(text);
  return /^(?:oi|ola|bom dia|boa tarde|boa noite)(?:\b|$)/.test(normalized)
    || /\b(?:estao|tao|esta|ta)\s+(?:atendendo|aberto|funcionando)\b/.test(normalized);
}

export function isOrderingGreeting(text: string): boolean {
  const normalized = normalize(text).replace(/[,;:]\s*/g, ' ').trim();
  return /^(?:oi|ola|bom dia|boa tarde|boa noite)(?:\s+(?:tudo\s+bem|estao\s+atendendo|esta[o]?\s+aberto|tem\s+algu(?:e|é)m))?$/.test(normalized);
}

/**
 * Entry copy retained for old callers.  The live handler uses the structured
 * payload below so the entry message has exactly one action button.
 */
export function buildOrderingEntryReply(menuUrl: string): string {
  return `Olá! Estamos atendendo. Você pode ver o cardápio e fazer o pedido por aqui: ${menuUrl}\n\nSe preferir, também pode fazer o pedido por escrito nesta conversa que eu monto com você.`;
}

export function buildOrderingEntryPayload(menuUrl: string): {
  kind: 'buttons';
  text: string;
  buttons: Array<{ id: string; label: string }>;
} {
  return {
    kind: 'buttons',
    text: `Olá! Estamos atendendo. Veja o cardápio e faça seu pedido por aqui: ${menuUrl}\n\nSe preferir, pode fazer o pedido por escrito ou mandar um áudio nesta conversa que eu monto com você.`,
    buttons: [{ id: AI_ORDER_START_BUTTON, label: 'Pedir por aqui' }],
  };
}

export function isExplicitHumanRequest(text: string): boolean {
  const normalized = normalize(text);
  const humanTerm = /\b(?:atendente|humano|gerente|pessoa real|gente de verdade|alguem)\b/.test(normalized);
  return humanTerm && /\b(?:quero|preciso|falar|chama|chame|transfere|transferir|por favor)\b/.test(normalized);
}

export function isDeliveryFeeQuestion(text: string): boolean {
  const normalized = normalize(text);
  const mentionsDelivery = /\b(?:entrega|delivery|frete)\b/.test(normalized);
  const asksValue = /\b(?:taxa|quanto|custa|valor)\b/.test(normalized);
  return mentionsDelivery && asksValue;
}

export function buildDeliveryFeeReply(menuUrl: string): string {
  return `A taxa de entrega é calculada no cardápio quando você informa o endereço: ${menuUrl}. Se preferir, pode fazer o pedido por escrito aqui comigo.`;
}

/**
 * FIX 2026-09-04 (PR I-11): this regex used to accept bare "pode" and "show"
 * (not documented anywhere as a confirmation) and DROP `ok`, `com certeza`,
 * `✅`, `👌`, `🙏` — all of which CLAUDE.md §"Comportamento geral da IA"
 * fixes as accepted confirmations. That made this canonical classifier
 * simultaneously more trigger-happy and less forgiving than the documented
 * (legacy) set for the exact same customer message — giving a decisive,
 * irreversible meaning to a short informal token is the root-cause class of
 * incident XVI. `confirmar` is added on top of the documented list because
 * it is also the exact label of the canonical `Confirmar` button (FN C4):
 * a typed "confirmar" must confirm the same draft a tap would.
 */
const BARE_CONFIRM = /^(?:sim|s|ok|confirmo|pode confirmar|confirmar|fechado|certinho|com certeza|✅|👌|🙏|👍)$/;
/**
 * A confirmation-ish word followed by MORE content ("sim, sem cebola",
 * "fechou, só coloca troco pra 50", "confirmar mais tarde?") is an edit or a
 * qualified question, never a bare confirm — mirrors the legacy
 * `classifyPendingOrderTurn`'s qualified-reply handling in
 * `src/domain/conversationState.ts` so both classifiers agree on the same
 * customer message instead of contradicting each other (PR I-11).
 */
const CONFIRM_LEAD_WITH_MORE = /^(?:sim|nao|ok|certo|certinho|fechado|fechou|confirmar|pode confirmar|com certeza)\b.+/;

export function classifyOrderingTurn(text: string, hasOpenOrdering: boolean): OrderingTurn {
  const normalized = normalize(text);
  if (isExplicitHumanRequest(text)) return { kind: 'none' };
  if (hasOpenOrdering) {
    if (/^(?:quero\s+)?(?:cancela|cancelar)(?:\s+(?:o|meu|esse|este))?\s+pedido(?:\s+(?:agora|por favor))?$/.test(normalized)) return { kind: 'cancel' };
    if (BARE_CONFIRM.test(normalized)) return { kind: 'confirm' };
    if (/^(?:nao|n)$/.test(normalized)) return { kind: 'ask_change' };
    if (CONFIRM_LEAD_WITH_MORE.test(normalized) || /\b(troca|trocar|muda|mudar|tira|tirar|adiciona|adicionar|cancela|cancelar|prefiro|quero)\b/.test(normalized)) {
      return { kind: 'alter', instruction: text.trim() };
    }
  }
  if (/\b(cardapio|menu|mistura|marmita|lanche|pedido|pedir|quero|tem hoje|o de sempre|arroz|feijao|acompanhament\w*|farofa|batata palha|tamanho|base)\b/.test(normalized)
    || /^(?:voces?\s+)?(?:tem|temos|vende|vendem)\s+\S+/.test(normalized)) {
    return { kind: 'catalog_or_order', query: text.trim() };
  }
  return { kind: 'none' };
}

const messageText = (message: OrderingConversationMessage) =>
  (message.audio_transcript || message.preview || message.content || '').trim();

export function isOrderingFollowUp(messages: OrderingConversationMessage[]): boolean {
  const previousAssistant = [...messages].reverse().find((candidate) => candidate.role === 'assistant');
  return /entrega ou retirada|qual é o endereço|como vai pagar|o que você quer alterar|qual (?:(?:deles|delas)(?: você)?|você|voce) quer|qual (?:tamanho|opção|opcao)/i
    .test(previousAssistant?.content || previousAssistant?.preview || '');
}

export function findPriorOrderingQuery(messages: OrderingConversationMessage[], fallback: string): string {
  return [...messages].reverse()
    .filter((candidate) => candidate.role === 'user')
    .map(messageText)
    .find((text) => classifyOrderingTurn(text, false).kind === 'catalog_or_order') || fallback;
}

/**
 * A short answer to an option question ("frango", "o médio", "a de 600") is
 * not a searchable query on its own — the question it answers is. Anything
 * longer is the customer describing what they want.
 */
const FOLLOW_UP_ANSWER_MAX_WORDS = 3;

/**
 * FIX 2026-09-09: the catalog query for THIS turn used to be
 * `findPriorOrderingQuery` alone, which threw the customer's own words away
 * whenever they carried none of `classifyOrderingTurn`'s keywords. "Penne,
 * molho branco, bacon, calabresa, mussarela, parmesão" — a complete order —
 * has none of them, so the search ran on the stale "Vc pode me mandar o
 * cardápio" from two turns earlier and answered with the same product list.
 * That list ends in "Qual você quer?", which keeps `isOrderingFollowUp` true,
 * so the next message re-entered the same branch, re-ran the same stale
 * query and sent the same sentence again: a fixed point the conversation
 * could not leave (Bem Servido, 2026-09-09 — three identical replies to
 * three different messages; 13 occurrences across 10 conversations in the
 * nine days before the fix).
 *
 * The prior question is still the query when the current message is a bare
 * follow-up answer, because that is the case it was written for. It is never
 * a substitute for a message that says something.
 */
export function buildCatalogSearchQuery(messages: OrderingConversationMessage[], text: string): string {
  const current = text.trim();
  if (!current) return findPriorOrderingQuery(messages, current);
  if (classifyOrderingTurn(current, false).kind === 'catalog_or_order') return current;
  const words = current.split(/\s+/).filter(Boolean);
  if (words.length > FOLLOW_UP_ANSWER_MAX_WORDS) return current;
  return findPriorOrderingQuery(messages, current);
}

/**
 * FIX 2026-09-09: the loop breaker. Even with the right query, a canonical
 * catalog reply that repeats the previous one verbatim tells the customer
 * nothing new and keeps `isOrderingFollowUp` true for the next turn. When
 * that happens the canonical path has nothing left to add and must hand the
 * turn to the generic assistant instead of restating itself.
 */
export function repeatsLastAssistantReply(
  messages: OrderingConversationMessage[],
  response: string,
): boolean {
  const candidate = response.trim();
  if (!candidate) return false;
  const previousAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  return (previousAssistant?.content || previousAssistant?.preview || '').trim() === candidate;
}

export interface CanonicalButtonHandling {
  handled: boolean;
  complete?: () => Promise<void>;
}

export function canonicalButtonMessageKey(input: {
  empresaId: string;
  jid: string;
  messageId?: string | null;
}): string | null {
  const messageId = input.messageId?.trim();
  return messageId ? `${input.empresaId}:${input.jid}:${messageId}` : null;
}

/** Must run inside the shared per-JID queue. */
export async function handleCanonicalButtonOnce<T extends CanonicalButtonHandling>(
  handledMessageIds: Map<string, number>,
  exactKey: string | null,
  handler: () => Promise<T>,
): Promise<T> {
  if (exactKey && handledMessageIds.has(exactKey)) return { handled: true } as T;
  const result = await handler();
  if (result.handled && exactKey) handledMessageIds.set(exactKey, Date.now());
  return result;
}

export type OrderingButtonAction =
  | { kind: 'confirm'; token: string; expectedRevision?: number }
  | { kind: 'alter' }
  | { kind: 'cancel' }
  | { kind: 'start' }
  | { kind: 'requirement'; requirementId: string; optionId: string; fingerprint: string };

/**
 * FIX 2026-09-04 (CT #3): ZeloMenu's real requirement ids are
 * `${lineId}:${groupId}` (e.g. `linha-massa-1:g002`) — they contain a colon.
 * The old encoding (`REQ:${requirementId}:${optionId}`) split on `:` and
 * silently rejected every modifier requirement button as soon as it was fed a
 * real id (4 segments instead of 3). `|` never appears in a ZeloMenu-issued
 * id (lineId/groupId/optionId are all `[A-Za-z0-9_-]+`, and the small set of
 * non-modifier requirement ids — `fulfillment_type`, `payment_method`, etc. —
 * are plain slugs too), so it is safe as the field separator here.
 *
 * The trailing fingerprint (PR 1.28) is a short, non-cryptographic digest of
 * `orderingId:revision` at the moment the button was sent. It lets the button
 * handler detect — cheaply, without a lookup — that a tap landed after the
 * draft moved to a different revision, so a stale tap can be re-presented
 * instead of blindly applied to whatever draft happens to be current.
 */
function shortFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function requirementRevisionFingerprint(orderingId: string, revision: number): string {
  return shortFingerprint(`${orderingId}:${revision}`);
}

export function buildRequirementButtonId(input: {
  requirementId: string;
  optionId: string;
  orderingId: string;
  revision: number;
}): string {
  const fingerprint = requirementRevisionFingerprint(input.orderingId, input.revision);
  return `${AI_ORDER_REQUIREMENT_PREFIX}${input.requirementId}|${input.optionId}|${fingerprint}`;
}

export function parseOrderingButton(buttonId: string): OrderingButtonAction | null {
  const normalized = buttonId.trim();
  if (normalized === AI_ORDER_ALTER_BUTTON) return { kind: 'alter' };
  if (normalized === AI_ORDER_CANCEL_BUTTON) return { kind: 'cancel' };
  if (normalized === AI_ORDER_START_BUTTON) return { kind: 'start' };
  if (normalized.startsWith(AI_ORDER_REQUIREMENT_PREFIX)) {
    if (normalized.length > 128) return null;
    const parts = normalized.slice(AI_ORDER_REQUIREMENT_PREFIX.length).split('|');
    if (parts.length !== 3) return null;
    const [requirementId, optionId, fingerprint] = parts;
    if (!requirementId || !optionId || !fingerprint) return null;
    return { kind: 'requirement', requirementId, optionId, fingerprint };
  }
  if (!normalized.startsWith(AI_ORDER_CONFIRM_PREFIX)) return null;
  const rest = normalized.slice(AI_ORDER_CONFIRM_PREFIX.length).trim();
  // FIX 2026-09-04 (C3 / PR C-5): a trailing `|<revision>` binds this button
  // to the exact draft revision it was rendered for — the same defense the
  // `REQ:` requirement buttons already have (PR 1.28), previously missing
  // here. Tolerate the OLD format (no suffix) so a button already delivered
  // to a customer before this deploy still parses; `expectedRevision` is
  // simply absent then and the staleness check in `resolveConfirmation`
  // falls back to the persisted pointer's revision.
  const sepIndex = rest.lastIndexOf('|');
  let token = rest;
  let expectedRevision: number | undefined;
  if (sepIndex >= 0) {
    const maybeRevision = rest.slice(sepIndex + 1);
    if (/^\d+$/.test(maybeRevision)) {
      token = rest.slice(0, sepIndex);
      expectedRevision = Number(maybeRevision);
    }
  }
  return token && token.length <= 256 ? { kind: 'confirm', token, ...(expectedRevision !== undefined ? { expectedRevision } : {}) } : null;
}

export interface OrderingModifierSelection {
  groupId: string;
  groupName: string;
  kind: string;
  selectedOptions: Array<{ optionId: string; optionName: string; priceDelta: number; quantity: number }>;
}

/**
 * Exhaustive list of the requirement `type` values ZeloMenu (the authority)
 * can emit — see `tests/fixtures/zelomenu-wire/v1/requirement-types.json`.
 * Renamed to match the wire exactly (`schedule`, not the old `pickup_schedule`
 * guess) so the presenter's lookup table can be checked against this union at
 * compile time.
 */
export type OrderingRequirementKind =
  | 'modifier_group'
  | 'fulfillment_type'
  | 'delivery_address'
  | 'schedule'
  | 'payment_method'
  | 'customer_name';

export interface OrderingRequirementOption {
  id: string;
  name: string;
  currentPrice?: number;
  priceDelta: number;
  available: boolean;
  displayPrice?: string;
}

/**
 * Domain requirement shape, produced ONLY by `parseOrderingSnapshotWire`
 * (`server/zeloMenuOrderingWire.ts`). Field names were previously a guess at
 * what ZeloMenu might send (`kind`/`label`) and collided with the wire's own
 * `kind` (modifier subtype `adicional`/`variacao`) — every requirement prompt
 * rendered `undefined` in production. `type`/`label` now match the wire's
 * `type`/`name` 1:1; `kind` is reserved exclusively for the modifier subtype
 * and is only ever present on `type: 'modifier_group'` requirements.
 */
export interface OrderingRequirement {
  /** `${lineId}:${groupId}` for modifier requirements; a plain slug otherwise. */
  id: string;
  /** Stable line reference for modifier requirements. */
  lineId?: string;
  productId?: number;
  /** Stable modifier group reference; for non-modifier requirements it may be omitted. */
  groupId?: string;
  type: OrderingRequirementKind;
  /** Customer-facing question/label text — ZeloMenu's `name`. */
  label: string;
  blocking: boolean;
  /** Modifier subtype (`adicional`|`variacao`); only present on `modifier_group`. */
  kind?: 'adicional' | 'variacao';
  minSelections?: number;
  maxSelections?: number | null;
  minTotalQuantity?: number;
  maxTotalQuantity?: number | null;
  allowsQuantity?: boolean;
  maxPerOption?: number | null;
  pricingMode?: 'somar' | 'substituir' | string;
  selectedDistinctCount?: number;
  selectedTotalQuantity?: number;
  autoSelectableOptionId?: string;
  missingFields?: string[];
  options?: OrderingRequirementOption[];
}

export interface OrderingSnapshot {
  orderingId: string;
  empresaId: string;
  remoteJid: string;
  state: string;
  revision: number;
  cart: {
    items: Array<{
      /** Optional for backward-compatible legacy snapshots; derived by adapters. */
      lineId?: string;
      productId: number;
      productName: string;
      baseUnitPrice: number;
      selectedModifiers: OrderingModifierSelection[];
      modifierDeltaTotal: number;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      notes?: string;
    }>;
    observations?: string;
  };
  customer: { name?: string | null; phone?: string | null };
  fulfillment: {
    /** ZeloMenu nulls this until the customer picks one — never assume a default. */
    type: 'pickup' | 'delivery' | null;
    asap: boolean;
    pickupDate?: string | null;
    pickupTime?: string | null;
    deliveryAddress?: string | null;
    deliveryNumber?: string | null;
    deliveryNeighborhood?: string | null;
    deliveryPostalCode?: string | null;
    deliveryComplement?: string | null;
    /** Store-computed; the wire REJECTS these on the way back in — read-only. */
    deliveryFee?: number;
    deliveryFeeToConfirm?: boolean;
  };
  payment: { declaredMethod?: string | null; pixReceiptRequired: boolean; pixReceiptApproved: boolean };
  pricing: { subtotal: number; deliveryFee: number; discount: number; total: number };
  revalidation: { checkedAt: string; ok: boolean; issues: Array<{ code: string; message: string }> };
  requirements?: OrderingRequirement[];
  readyForConfirmation?: boolean;
  summaryText?: string;
  confirmationAction: { type: 'confirm_order'; token: string; revision: number; expiresAt: string } | null;
  requiresReview: boolean;
  order: { id: string; status: string; alreadyConfirmed: boolean; revision: number } | null;
}

export interface OrderingDraft {
  items: Array<{
    lineId?: string;
    productId: number;
    quantity: number;
    notes?: string;
    selectedOptions?: Array<{ groupId: string; optionSelections: Array<{ optionId: string; quantity: number }> }>;
  }>;
  /** Lines to remove from the current cart (CT Important 5 — "cancela só a coca"). */
  removedLineIds?: string[];
  observations?: string;
  customer?: { name?: string; phone?: string };
  pessoaId?: string | null;
  fulfillment?: {
    type: 'pickup' | 'delivery';
    asap?: boolean;
    pickupDate?: string;
    pickupTime?: string;
    deliveryAddress?: string;
    deliveryNeighborhood?: string;
    deliveryPostalCode?: string;
    deliveryNumber?: string;
    deliveryComplement?: string;
  };
  paymentMethod?: string;
}

interface OrderingContextLike {
  fulfillmentType?: { value: 'pickup' | 'delivery' | null; source?: string };
  deliveryAddress?: { value: { address: string; neighborhood?: string | null; postalCode?: string | null; complement?: string | null } | null; source?: string };
  paymentMethod?: { value: string | null; source?: string };
  habitualTime?: { value: { label: string } | null; source?: string };
  resolved?: {
    fulfillmentType?: { value: 'pickup' | 'delivery' | null; source?: string };
    deliveryAddress?: { value: string | null; source?: string };
    deliveryNeighborhood?: { value: string | null; source?: string };
    deliveryPostalCode?: { value: string | null; source?: string };
    paymentMethod?: { value: string | null; source?: string };
    pickupTimePreference?: { value: string | null; source?: string };
  };
  frequentItems?: unknown[] | { value: unknown[]; source?: string };
}

export function applyOrderingDefaults(draft: OrderingDraft, context: OrderingContextLike | null): OrderingDraft {
  const resolved = context?.resolved;
  const contextAddress = context?.deliveryAddress?.value;
  const type = draft.fulfillment?.type ?? resolved?.fulfillmentType?.value ?? context?.fulfillmentType?.value ?? undefined;
  const fulfillment = type ? {
    ...draft.fulfillment,
    type,
    asap: draft.fulfillment?.asap ?? !draft.fulfillment?.pickupDate,
    deliveryAddress: draft.fulfillment?.deliveryAddress ?? resolved?.deliveryAddress?.value ?? contextAddress?.address ?? undefined,
    deliveryNeighborhood: draft.fulfillment?.deliveryNeighborhood ?? resolved?.deliveryNeighborhood?.value ?? contextAddress?.neighborhood ?? undefined,
    deliveryPostalCode: draft.fulfillment?.deliveryPostalCode ?? resolved?.deliveryPostalCode?.value ?? contextAddress?.postalCode ?? undefined,
    deliveryComplement: draft.fulfillment?.deliveryComplement ?? contextAddress?.complement ?? undefined,
    // A habitual time is context, never an implicit promise for this order.
    pickupTime: draft.fulfillment?.pickupTime,
  } : undefined;
  return {
    ...draft,
    fulfillment,
    paymentMethod: draft.paymentMethod ?? resolved?.paymentMethod?.value ?? context?.paymentMethod?.value ?? undefined,
  };
}

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
  .format(value)
  .replace(/\u00a0/g, ' ');
const customerText = (value: string | undefined | null) => (value ?? '')
  .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
  .replace(/[\u0000-\u001f\u007f.!?;]+/gu, ' ')
  .replace(/\s+/gu, ' ')
  .trim();
const paymentLabel = (value?: string) => {
  if (!value) return 'pagamento a combinar';
  return value.toLocaleLowerCase('pt-BR') === 'pix' ? 'Pix' : value;
};

/**
 * FIX 2026-09-04 (PR Important "needs_customer_adjustment"): the store can
 * bounce a ready order back for adjustment (a fee changed between summary
 * and confirm, etc.) — ZeloMenu keeps the draft alive as
 * `state: 'needs_customer_adjustment'`. The three call sites that used to
 * check only `state === 'cart_open' || requiresReview` treated this as
 * closed and told the customer "já foi finalizado. Quer começar um novo?",
 * while the ZeloMenu draft was still open underneath — a fresh
 * `open_or_update_draft` on top of it then wedges into `PEDIDO_EM_ANDAMENTO`
 * (Critical 7). A single predicate keeps the three checks in lockstep.
 */
export function isOrderingSnapshotEditable(snapshot: Pick<OrderingSnapshot, 'state' | 'requiresReview'>): boolean {
  return snapshot.state === 'cart_open' || snapshot.state === 'needs_customer_adjustment' || snapshot.requiresReview === true;
}

export function isOrderingSummaryBlocked(snapshot: OrderingSnapshot): boolean {
  return snapshot.requiresReview
    || snapshot.fulfillment.deliveryFeeToConfirm === true
    || snapshot.revalidation.ok === false
    || snapshot.revalidation.issues.length > 0
    || snapshot.readyForConfirmation === false;
}

export function renderOrderingSummary(snapshot: OrderingSnapshot): string {
  const items = snapshot.cart.items.map((item) => {
    const modifiers = item.selectedModifiers.flatMap((group) => {
      const options = group.selectedOptions.map((option) => {
        const selected = option.quantity > 1 ? `${option.quantity}x ${customerText(option.optionName)}` : customerText(option.optionName);
        return option.priceDelta > 0 ? `${selected} (+${money(option.priceDelta)})` : selected;
      }).join(', ');
      return options ? `${customerText(group.groupName)}: ${options}` : '';
    }).filter(Boolean).join('; ');
    return `${item.quantity}x ${customerText(item.productName)}${modifiers ? ` (${modifiers})` : ''}`;
  }).join(', ');
  const fulfillment = snapshot.fulfillment.type === 'delivery'
    ? `entrega em ${[customerText(snapshot.fulfillment.deliveryAddress), customerText(snapshot.fulfillment.deliveryNumber)].filter(Boolean).join(', ')}${snapshot.fulfillment.deliveryNeighborhood ? ` - ${customerText(snapshot.fulfillment.deliveryNeighborhood)}` : ''}${snapshot.fulfillment.deliveryComplement ? ` (${customerText(snapshot.fulfillment.deliveryComplement)})` : ''}`
    : 'retirada no local';
  const time = snapshot.fulfillment.asap
    ? 'o quanto antes'
    : [snapshot.fulfillment.pickupDate, snapshot.fulfillment.pickupTime].filter(Boolean).join(' às ');
  const payment = customerText(paymentLabel(snapshot.payment.declaredMethod));
  const fee = snapshot.pricing.deliveryFee > 0 ? ` (taxa ${money(snapshot.pricing.deliveryFee)})` : '';
  const observations = customerText(snapshot.cart.observations);
  // FIX 2026-09-04 (PR I-7): `revalidation.issues[].message` is authored by
  // ZeloMenu for operator/log consumption, not customer copy — it can contain
  // internal codes or phrasing that violates CLAUDE.md's "Customer-facing
  // copy" rule. Never interpolate it; always speak in generic, friendly terms.
  const blocked = snapshot.fulfillment.deliveryFeeToConfirm
    ? 'a taxa de entrega ainda precisa ser confirmada'
    : snapshot.revalidation.issues.length > 0
      ? 'alguns detalhes do pedido antes de confirmar'
      : 'a conferência do pedido ainda não terminou';
  const ending = isOrderingSummaryBlocked(snapshot)
    ? `Preciso ajustar ${customerText(blocked)} antes de confirmar.`
    : 'Posso confirmar?';
  return `Resumo: ${items}; ${fulfillment}; ${payment}; ${customerText(time)}; total ${money(snapshot.pricing.total)}${fee}${observations ? `; observação: ${observations}` : ''}. ${ending}`;
}

/** Legacy two-button helper retained for simulator/old callers. */
/** `|<revision>` binds the button to the exact revision it was rendered for — see `parseOrderingButton` (C3 / PR C-5). */
function confirmButtonId(token: string, revision: number): string {
  return `${AI_ORDER_CONFIRM_PREFIX}${token}|${revision}`;
}

export function buildConfirmationButtons(snapshot: OrderingSnapshot): Array<{ id: string; displayText: string }> {
  const token = snapshot.confirmationAction?.token;
  if (!token || isOrderingSummaryBlocked(snapshot)) return [];
  return [
    { id: confirmButtonId(token, snapshot.revision), displayText: 'Confirmar' },
    { id: AI_ORDER_ALTER_BUTTON, displayText: 'Alterar' },
  ];
}

export function buildCanonicalConfirmationButtons(snapshot: OrderingSnapshot): Array<{ id: string; displayText: string }> {
  const token = snapshot.confirmationAction?.token;
  if (!token || isOrderingSummaryBlocked(snapshot)) return [];
  return [
    { id: confirmButtonId(token, snapshot.revision), displayText: 'Confirmar' },
    { id: AI_ORDER_ALTER_BUTTON, displayText: 'Alterar' },
    { id: AI_ORDER_CANCEL_BUTTON, displayText: 'Cancelar' },
  ];
}

export interface CatalogReplyResult {
  total: number;
  ambiguous: boolean;
  results: Array<{
    productId: number;
    publicName: string;
    currentPrice: number;
    /**
     * `kind: 'from'` means the price varies with a required modifier group —
     * `currentPrice` is only the cheapest path through it. Quoting
     * `currentPrice` alone as a firm price for these products misstates what
     * the customer will actually pay (CT Important 6).
     */
    displayPrice?: { kind: 'from' | 'fixed'; amount: number };
    matchReason: string;
    ambiguous: boolean;
    modifierGroups?: Array<{
      id: string;
      name: string;
      minSelections?: number;
      maxSelections?: number | null;
      minTotalQuantity?: number;
      maxTotalQuantity?: number | null;
      allowsQuantity?: boolean;
      maxPerOption?: number | null;
      pricingMode?: string;
      options: Array<{ id: string; name: string; priceDelta: number; currentPrice?: number; available?: boolean; displayPrice?: string }>;
    }>;
  }>;
}

function requestedModifierGroup(query: string): RegExp | null {
  if (/acompanhamento/i.test(query)) return /acompanhamento/i;
  if (/\b(base|arroz|feij[aã]o)\b/i.test(query)) return /\bbase\b/i;
  if (/\b(opciona(?:l|is)|farofa|batata palha)\b/i.test(query)) return /opciona/i;
  if (/\b(mistura|prote[ií]na)\b/i.test(query)) return /mistura|prote[ií]na/i;
  if (/\btamanho\b/i.test(query)) return /tamanho/i;
  return null;
}

function selectionRule(group: { minSelections?: number; maxSelections?: number | null }): string {
  const min = Number.isFinite(group.minSelections) ? Math.max(0, Number(group.minSelections)) : null;
  const max = group.maxSelections == null || !Number.isFinite(group.maxSelections) ? null : Math.max(0, Number(group.maxSelections));
  if (min === 0 && max != null) return `opcional; escolha até ${max}`;
  if (min === 0) return 'opcional';
  if (min != null && max === min) return min === 1 ? 'escolha 1' : `escolha ${min}`;
  if (min != null && max != null) return `escolha de ${min} a ${max}`;
  if (min != null) return `escolha pelo menos ${min}`;
  return '';
}

export function renderCatalogReply(result: CatalogReplyResult, query: string, menuUrl?: string | null): string {
  const finish = (text: string): string => menuUrl
    ? `${text}\n\nCardápio digital: ${menuUrl}\nSe preferir, pode fazer o pedido por escrito aqui comigo.`
    : text;
  const requestedGroup = requestedModifierGroup(query);
  if (result.ambiguous && !requestedGroup) return finish('Encontrei mais de uma opção parecida. Qual delas você quer?');
  if ((!requestedGroup && result.total > 12) || (!result.results.length && result.total > 0)) return finish('Tem bastante opção no cardápio. Quer filtrar por tipo ou faixa de preço?');
  if (!result.results.length) return finish('Não encontrei uma opção disponível com esse nome. Quer tentar de outro jeito?');
  const productsById = new Map<number, CatalogReplyResult['results'][number]>();
  for (const item of result.results) {
    const current = productsById.get(item.productId);
    if (!current || (item.modifierGroups?.length ?? 0) > (current.modifierGroups?.length ?? 0)) productsById.set(item.productId, item);
  }
  const uniqueProducts = [...productsById.values()].slice(0, 12);
  const choices = uniqueProducts.map((item) => {
    const groups = requestedGroup ? (item.modifierGroups ?? []).filter((candidate) => requestedGroup.test(candidate.name)) : [];
    const groupChoices = groups.flatMap((group) => {
      const options = group.options.filter((option) => option.available !== false).map((option) => {
        if (option.displayPrice) return `${customerText(option.name)} (${option.displayPrice})`;
        return option.priceDelta > 0 ? `${customerText(option.name)} (+${money(option.priceDelta)})` : customerText(option.name);
      }).join(', ');
      const rule = selectionRule(group);
      return options ? [`*${customerText(group.name)}*${rule ? ` (${rule})` : ''}: ${options}`] : [];
    });
    if (groupChoices.length) return `${customerText(item.publicName)}:\n${groupChoices.join('\n')}`;
    // FIX 2026-09-04 (CT Important 6): `currentPrice` alone is only the
    // cheapest path through a required modifier group when `displayPrice`
    // says so — quoting it as a firm price misstates what the customer will
    // actually pay.
    const price = item.displayPrice?.kind === 'from'
      ? `a partir de ${money(item.displayPrice.amount)}`
      : money(item.currentPrice);
    return `${customerText(item.publicName)} por ${price}`;
  }).join('\n');
  return finish(`${requestedGroup ? 'As opções disponíveis são' : 'Encontrei'}:\n${choices}\nQual você quer?`);
}

export function renderOrderingDraftPreview(draft: OrderingDraft, result: CatalogReplyResult): string {
  // A dry-run preview can never call the mutating canonical endpoint, so it
  // has no server-computed `requirements` list to consult. Mirror the single
  // most common missing requirement (fulfillment type) locally so the
  // simulator doesn't default silently to pickup and jump straight to a
  // "posso confirmar?" summary before the customer has actually chosen.
  if (!draft.fulfillment?.type) {
    return 'Seu pedido é para entrega ou retirada?';
  }
  const productsById = new Map(result.results.map((item) => [item.productId, item]));
  const items = draft.items.map((item) => {
    const product = productsById.get(item.productId);
    const productName = customerText(product?.publicName || `produto #${item.productId}`);
    const modifiers = (item.selectedOptions ?? []).flatMap((selection) => {
      const group = product?.modifierGroups?.find((candidate) => candidate.id === selection.groupId);
      if (!group) return [];
      const options = selection.optionSelections.flatMap((selected) => {
        const option = group.options.find((candidate) => candidate.id === selected.optionId);
        if (!option) return [];
        return [selected.quantity > 1 ? `${selected.quantity}x ${customerText(option.name)}` : customerText(option.name)];
      }).join(', ');
      return options ? `${customerText(group.name)}: ${options}` : [];
    }).join('; ');
    return `${Math.max(1, item.quantity)}x ${productName}${modifiers ? ` (${modifiers})` : ''}`;
  }).join(', ');
  const fulfillment = draft.fulfillment.type === 'delivery' ? `entrega${draft.fulfillment.deliveryAddress ? ` em ${customerText(draft.fulfillment.deliveryAddress)}` : ''}` : 'retirada no local';
  return `Resumo: ${items}; ${fulfillment}; ${customerText(paymentLabel(draft.paymentMethod))}. Posso confirmar?`;
}

export interface OrderingStatePointer {
  orderingId: string;
  revision: number;
  conversationControlId?: string;
  conversationEpoch?: string;
  offeredOptionalRequirementIds?: string[];
  declinedOptionalRequirementIds?: string[];
  consumedMessageIds?: string[];
  /**
   * Consecutive "retry_later" turns (ZeloMenu unavailable/slow/rate-limited)
   * for THIS conversation. Resets to 0 on any normal write; only the error
   * recovery path in `server/aiWhatsAppOrdering.ts` increments it. Used to
   * bound how long a customer is told "tente de novo" before the turn
   * escalates to a human (see B3 / PR I-5).
   */
  retryFailureCount?: number;
}

export function serializeOrderingState(pointer: OrderingStatePointer): string {
  return `${AI_ORDER_STATE_PREFIX}${JSON.stringify(pointer)}`;
}

export function findLatestOrderingState(messages: Array<{ role: string; content: string | null }>): OrderingStatePointer | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'tool' || !message.content?.startsWith(AI_ORDER_STATE_PREFIX)) continue;
    try {
      const value = JSON.parse(message.content.slice(AI_ORDER_STATE_PREFIX.length)) as Partial<OrderingStatePointer>;
      if (typeof value.orderingId === 'string' && Number.isInteger(value.revision)) {
        return {
          orderingId: value.orderingId,
          revision: value.revision as number,
          ...(typeof value.conversationControlId === 'string' ? { conversationControlId: value.conversationControlId } : {}),
          ...(typeof value.conversationEpoch === 'string' ? { conversationEpoch: value.conversationEpoch } : {}),
          ...(Array.isArray(value.offeredOptionalRequirementIds) ? { offeredOptionalRequirementIds: value.offeredOptionalRequirementIds.filter((id): id is string => typeof id === 'string').slice(0, 100) } : {}),
          ...(Array.isArray(value.declinedOptionalRequirementIds) ? { declinedOptionalRequirementIds: value.declinedOptionalRequirementIds.filter((id): id is string => typeof id === 'string').slice(0, 100) } : {}),
          ...(Array.isArray(value.consumedMessageIds) ? { consumedMessageIds: value.consumedMessageIds.filter((id): id is string => typeof id === 'string').slice(-100) } : {}),
          ...(Number.isInteger(value.retryFailureCount) ? { retryFailureCount: value.retryFailureCount as number } : {}),
        };
      }
    } catch {
      // Ignore malformed internal audit rows and keep searching older state.
    }
  }
  return null;
}

/**
 * FIX 2026-09-04 (CT #4 / CT #5): ZeloMenu's snapshot ALWAYS carries
 * `deliveryFee`/`deliveryFeeToConfirm` (store-computed) and nulls `type`
 * until the customer has chosen — and its command parser HARD-REJECTS both
 * on the way back in (`COMANDO_INVALIDO`: "A taxa de entrega é calculada
 * pela loja." / "Escolha entrega ou retirada."). Every caller that turns a
 * snapshot's fulfillment back into an outbound draft (`snapshotToDraft`,
 * `applyConversationOrderPatch`'s fallback-to-current, the REQ button
 * handler) MUST route through this sanitizer instead of echoing the snapshot
 * shape verbatim: omit `fulfillment` entirely when no type is chosen yet,
 * and only ever emit the 9 keys the wire allowlists.
 */
export function sanitizeFulfillmentForWire(
  fulfillment: OrderingSnapshot['fulfillment'] | OrderingDraft['fulfillment'] | null | undefined,
): OrderingDraft['fulfillment'] | undefined {
  if (!fulfillment || !fulfillment.type) return undefined;
  const sanitized: NonNullable<OrderingDraft['fulfillment']> = { type: fulfillment.type };
  if (typeof fulfillment.asap === 'boolean') sanitized.asap = fulfillment.asap;
  if (fulfillment.pickupDate) sanitized.pickupDate = fulfillment.pickupDate;
  if (fulfillment.pickupTime) sanitized.pickupTime = fulfillment.pickupTime;
  if (fulfillment.deliveryAddress) sanitized.deliveryAddress = fulfillment.deliveryAddress;
  if (fulfillment.deliveryNeighborhood) sanitized.deliveryNeighborhood = fulfillment.deliveryNeighborhood;
  if (fulfillment.deliveryPostalCode) sanitized.deliveryPostalCode = fulfillment.deliveryPostalCode;
  if (fulfillment.deliveryNumber) sanitized.deliveryNumber = fulfillment.deliveryNumber;
  if (fulfillment.deliveryComplement) sanitized.deliveryComplement = fulfillment.deliveryComplement;
  return sanitized;
}

/**
 * FIX 2026-09-04 (C6 / PR I-3): applies a `fulfillment_type` requirement tap
 * (the "Entrega"/"Retirada" button) to a draft. ZeloMenu's `fulfillment_type`
 * requirement carries no `options[]` at all (see
 * `tests/fixtures/zelomenu-wire/v1/requirement-types.json`), so — unlike
 * `modifier_group`/`payment_method` — there is no per-option availability to
 * validate against the wire; the caller's own enum check
 * (`optionId === 'pickup' | 'delivery'`) plus the requirement-id lookup and
 * revision-fingerprint check (PR 1.28) are the full extent of what CAN be
 * validated here. What this function guards is the other half of I-3: a
 * customer who already said "entrega às 19h" (`asap:false` +
 * `pickupDate`/`pickupTime` already collected) must not have that silently
 * discarded just because they then clarified entrega vs. retirada — `asap`
 * only ever defaults to `true` when nothing was collected yet; an existing
 * `false` (or any other already-set field, carried via the spread) survives.
 */
export function applyFulfillmentTypeSelection(
  fulfillment: OrderingDraft['fulfillment'] | undefined,
  optionId: 'pickup' | 'delivery',
): NonNullable<OrderingDraft['fulfillment']> {
  return { ...fulfillment, type: optionId, asap: fulfillment?.asap ?? true };
}

/**
 * FIX 2026-09-04 (CT #8): the customer's WhatsApp session name was sent
 * unconditionally on every update, including when it was `undefined` — the
 * key still reached ZeloMenu as `customer: {}` and resolved to
 * `name: null`, which re-raised the blocking `customer_name` requirement
 * FOREVER for any contact without a WhatsApp pushName. Send a name only when
 * one is actually known; never send an empty/null name to "clear" it.
 */
export function sanitizeCustomerForWire(
  customer: { name?: string | null; phone?: string | null } | null | undefined,
): OrderingDraft['customer'] | undefined {
  const name = customer?.name?.trim();
  return name ? { name } : undefined;
}

export function snapshotToDraft(snapshot: OrderingSnapshot): OrderingDraft {
  return {
    items: snapshot.cart.items.map((item, index) => ({
      lineId: item.lineId ?? `line-${item.productId}-${index + 1}`,
      productId: item.productId,
      quantity: item.quantity,
      notes: item.notes,
      selectedOptions: item.selectedModifiers.map((group) => ({
        groupId: group.groupId,
        optionSelections: group.selectedOptions.map((option) => ({ optionId: option.optionId, quantity: option.quantity })),
      })),
    })),
    observations: snapshot.cart.observations,
    customer: sanitizeCustomerForWire(snapshot.customer),
    fulfillment: sanitizeFulfillmentForWire(snapshot.fulfillment),
    paymentMethod: snapshot.payment.declaredMethod ?? undefined,
  };
}
