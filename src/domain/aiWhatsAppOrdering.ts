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
    text: `Olá! Estamos atendendo. Veja o cardápio e faça seu pedido por aqui: ${menuUrl}\n\nSe preferir, escreva ou mande um áudio nesta conversa que eu monto com você.`,
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

export function classifyOrderingTurn(text: string, hasOpenOrdering: boolean): OrderingTurn {
  const normalized = normalize(text);
  if (isExplicitHumanRequest(text)) return { kind: 'none' };
  if (hasOpenOrdering) {
    if (/^(?:quero\s+)?(?:cancela|cancelar)(?:\s+(?:o|meu|esse|este))?\s+pedido(?:\s+(?:agora|por favor))?$/.test(normalized)) return { kind: 'cancel' };
    if (/^(?:sim|s|confirmo|pode confirmar|confirmar|pode|fechado|certinho|show|👍)$/.test(normalized)) return { kind: 'confirm' };
    if (/^(?:nao|n)$/.test(normalized)) return { kind: 'ask_change' };
    if (/^(?:sim|nao)\b.+/.test(normalized) || /\b(troca|trocar|muda|mudar|tira|tirar|adiciona|adicionar|cancela|cancelar|prefiro|quero)\b/.test(normalized)) {
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
  | { kind: 'confirm'; token: string }
  | { kind: 'alter' }
  | { kind: 'cancel' }
  | { kind: 'start' }
  | { kind: 'requirement'; requirementId: string; optionId: string };

export function parseOrderingButton(buttonId: string): OrderingButtonAction | null {
  const normalized = buttonId.trim();
  if (normalized === AI_ORDER_ALTER_BUTTON) return { kind: 'alter' };
  if (normalized === AI_ORDER_CANCEL_BUTTON) return { kind: 'cancel' };
  if (normalized === AI_ORDER_START_BUTTON) return { kind: 'start' };
  if (normalized.startsWith(AI_ORDER_REQUIREMENT_PREFIX)) {
    const [, requirementId, optionId, ...extra] = normalized.split(':');
    if (requirementId && optionId && !extra.length && requirementId.length <= 128 && optionId.length <= 128) {
      return { kind: 'requirement', requirementId, optionId };
    }
    return null;
  }
  if (!normalized.startsWith(AI_ORDER_CONFIRM_PREFIX)) return null;
  const token = normalized.slice(AI_ORDER_CONFIRM_PREFIX.length).trim();
  return token && token.length <= 256 ? { kind: 'confirm', token } : null;
}

export interface OrderingModifierSelection {
  groupId: string;
  groupName: string;
  kind: string;
  selectedOptions: Array<{ optionId: string; optionName: string; priceDelta: number; quantity: number }>;
}

export type OrderingRequirementKind =
  | 'modifier_group'
  | 'fulfillment_type'
  | 'delivery_address'
  | 'pickup_schedule'
  | 'payment_method'
  | 'customer_name'
  | 'review';

export interface OrderingRequirementOption {
  id: string;
  name: string;
  currentPrice?: number;
  priceDelta: number;
  available: boolean;
  displayPrice?: string;
}

export interface OrderingRequirement {
  id: string;
  /** Stable line reference for modifier requirements. */
  lineId?: string;
  /** Stable modifier group reference; for non-modifier requirements it may be omitted. */
  groupId?: string;
  kind: OrderingRequirementKind;
  /** Wire adapters may supply `type`/`name`; domain code uses kind/label. */
  type?: OrderingRequirementKind;
  label: string;
  name?: string;
  blocking: boolean;
  minSelections?: number;
  maxSelections?: number | null;
  minTotalQuantity?: number;
  maxTotalQuantity?: number | null;
  allowsQuantity?: boolean;
  maxPerOption?: number | null;
  pricingMode?: 'base' | 'delta' | 'substitution' | 'fixed' | string;
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
  customer: { name?: string; phone?: string };
  fulfillment: {
    type: 'pickup' | 'delivery';
    asap: boolean;
    pickupDate?: string;
    pickupTime?: string;
    deliveryAddress?: string;
    deliveryNumber?: string;
    deliveryNeighborhood?: string;
    deliveryPostalCode?: string;
    deliveryComplement?: string;
    deliveryFee?: number;
    deliveryFeeToConfirm?: boolean;
  };
  payment: { declaredMethod?: string; pixReceiptRequired: boolean; pixReceiptApproved: boolean };
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
  const blocked = snapshot.revalidation.issues[0]?.message || (snapshot.fulfillment.deliveryFeeToConfirm ? 'a taxa de entrega ainda precisa ser confirmada' : 'a conferência do pedido ainda não terminou');
  const ending = isOrderingSummaryBlocked(snapshot)
    ? `Preciso ajustar ${customerText(blocked)} antes de confirmar.`
    : 'Posso confirmar?';
  return `Resumo: ${items}; ${fulfillment}; ${payment}; ${customerText(time)}; total ${money(snapshot.pricing.total)}${fee}${observations ? `; observação: ${observations}` : ''}. ${ending}`;
}

/** Legacy two-button helper retained for simulator/old callers. */
export function buildConfirmationButtons(snapshot: OrderingSnapshot): Array<{ id: string; displayText: string }> {
  const token = snapshot.confirmationAction?.token;
  if (!token || isOrderingSummaryBlocked(snapshot)) return [];
  return [
    { id: `${AI_ORDER_CONFIRM_PREFIX}${token}`, displayText: 'Confirmar' },
    { id: AI_ORDER_ALTER_BUTTON, displayText: 'Alterar' },
  ];
}

export function buildCanonicalConfirmationButtons(snapshot: OrderingSnapshot): Array<{ id: string; displayText: string }> {
  const token = snapshot.confirmationAction?.token;
  if (!token || isOrderingSummaryBlocked(snapshot)) return [];
  return [
    { id: `${AI_ORDER_CONFIRM_PREFIX}${token}`, displayText: 'Confirmar' },
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
    return `${customerText(item.publicName)} por ${money(item.currentPrice)}`;
  }).join('\n');
  return finish(`${requestedGroup ? 'As opções disponíveis são' : 'Encontrei'}:\n${choices}\nQual você quer?`);
}

export function renderOrderingDraftPreview(draft: OrderingDraft, result: CatalogReplyResult): string {
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
  const fulfillment = draft.fulfillment?.type === 'delivery' ? `entrega${draft.fulfillment.deliveryAddress ? ` em ${customerText(draft.fulfillment.deliveryAddress)}` : ''}` : 'retirada no local';
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
        };
      }
    } catch {
      // Ignore malformed internal audit rows and keep searching older state.
    }
  }
  return null;
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
    customer: snapshot.customer,
    fulfillment: snapshot.fulfillment,
    paymentMethod: snapshot.payment.declaredMethod,
  };
}
