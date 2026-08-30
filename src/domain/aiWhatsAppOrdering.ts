export type AiWhatsAppOrderingMode = 'off' | 'shadow' | 'active';

export const AI_ORDER_CONFIRM_PREFIX = 'ZOC:';
export const AI_ORDER_ALTER_BUTTON = 'ZOA';
export const AI_ORDER_STATE_PREFIX = 'ZELO_AI_ORDERING_STATE:';

type Env = Record<string, string | undefined>;

export function getAiWhatsAppOrderingMode(env: Env = process.env): AiWhatsAppOrderingMode {
  if (env.ZELOCHAT_AI_ORDERING_KILL_SWITCH !== '0') return 'off';
  if (env.ZELOCHAT_AI_ORDERING_ACTIVE === '1') return 'active';
  if (env.ZELOCHAT_AI_ORDERING_SHADOW === '1') return 'shadow';
  return 'off';
}

export type OrderingTurn =
  | { kind: 'confirm' }
  | { kind: 'alter'; instruction: string }
  | { kind: 'ask_change' }
  | { kind: 'cancel' }
  | { kind: 'catalog_or_order'; query: string }
  | { kind: 'none' };

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR')
  .replace(/[.!?]+$/g, '')
  .trim();

export function classifyOrderingTurn(text: string, hasOpenOrdering: boolean): OrderingTurn {
  const normalized = normalize(text);
  if (hasOpenOrdering) {
    if (/^(?:quero\s+)?(?:cancela|cancelar)(?:\s+(?:o|meu|esse|este))?\s*pedido(?:\s+(?:agora|por favor))?$/.test(normalized)) return { kind: 'cancel' };
    if (/^(sim|s|confirmo|pode confirmar|confirmar)$/.test(normalized)) return { kind: 'confirm' };
    if (/^(nao|n)$/.test(normalized)) return { kind: 'ask_change' };
    if (/^(sim|nao|não)\b.+/.test(normalized) || /\b(troca|trocar|muda|mudar|tira|tirar|adiciona|adicionar|cancela|cancelar|prefiro|quero)\b/.test(normalized)) {
      return { kind: 'alter', instruction: text.trim() };
    }
  }
  if (/\b(cardapio|menu|mistura|marmita|lanche|pedido|pedir|quero|tem hoje|o de sempre)\b/.test(normalized)) {
    return { kind: 'catalog_or_order', query: text.trim() };
  }
  return { kind: 'none' };
}

export function parseOrderingButton(buttonId: string): { kind: 'confirm'; token: string } | { kind: 'alter' } | null {
  if (buttonId === AI_ORDER_ALTER_BUTTON) return { kind: 'alter' };
  if (!buttonId.startsWith(AI_ORDER_CONFIRM_PREFIX)) return null;
  const token = buttonId.slice(AI_ORDER_CONFIRM_PREFIX.length).trim();
  return token ? { kind: 'confirm', token } : null;
}

export interface OrderingModifierSelection {
  groupId: number;
  groupName: string;
  kind: string;
  selectedOptions: Array<{ optionId: number; optionName: string; priceDelta: number; quantity: number }>;
}

export interface OrderingSnapshot {
  orderingId: string;
  empresaId: string;
  remoteJid: string;
  state: string;
  revision: number;
  cart: {
    items: Array<{
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
  confirmationAction: { type: 'confirm_order'; token: string; revision: number; expiresAt: string } | null;
  requiresReview: boolean;
  order: { id: string; status: string; alreadyConfirmed: boolean; revision: number } | null;
}

export interface OrderingDraft {
  items: Array<{
    productId: number;
    quantity: number;
    notes?: string;
    selectedOptions?: Array<{ groupId: number; optionSelections: Array<{ optionId: number; quantity: number }> }>;
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
    // A habitual time is context for the model, never an implicit promise for
    // this order. Without an explicit time, the canonical default is ASAP.
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
const customerText = (value: string | undefined) => (value ?? '')
  .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
  .replace(/[\u0000-\u001f\u007f.!?;]+/gu, ' ')
  .replace(/\s+/gu, ' ')
  .trim();
const paymentLabel = (value?: string) => {
  if (!value) return 'pagamento a combinar';
  return value.toLocaleLowerCase('pt-BR') === 'pix' ? 'Pix' : value;
};

export function renderOrderingSummary(snapshot: OrderingSnapshot): string {
  const items = snapshot.cart.items.map((item) => {
    const modifiers = item.selectedModifiers.flatMap((group) => {
      const options = group.selectedOptions.map((option) => option.quantity > 1 ? `${option.quantity}x ${customerText(option.optionName)}` : customerText(option.optionName)).join(', ');
      return options ? `${customerText(group.groupName)}: ${options}` : '';
    }).filter(Boolean).join('; ');
    return `${item.quantity}x ${customerText(item.productName)}${modifiers ? ` (${modifiers})` : ''}`;
  }).join(', ');
  const fulfillment = snapshot.fulfillment.type === 'delivery'
    ? `entrega em ${[customerText(snapshot.fulfillment.deliveryAddress), customerText(snapshot.fulfillment.deliveryNumber)].filter(Boolean).join(', ')}${snapshot.fulfillment.deliveryNeighborhood ? ` - ${customerText(snapshot.fulfillment.deliveryNeighborhood)}` : ''}`
    : 'retirada no local';
  const time = snapshot.fulfillment.asap
    ? 'o quanto antes'
    : [snapshot.fulfillment.pickupDate, snapshot.fulfillment.pickupTime].filter(Boolean).join(' às ');
  return `Resumo: ${items}; ${fulfillment}; ${customerText(paymentLabel(snapshot.payment.declaredMethod))}; ${customerText(time)}; total ${money(snapshot.pricing.total)}. Posso confirmar?`;
}

export function buildConfirmationButtons(snapshot: OrderingSnapshot): Array<{ id: string; displayText: string }> {
  const token = snapshot.confirmationAction?.token;
  if (!token) return [];
  return [
    { id: `${AI_ORDER_CONFIRM_PREFIX}${token}`, displayText: 'Confirmar' },
    { id: AI_ORDER_ALTER_BUTTON, displayText: 'Alterar' },
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
      id: number;
      name: string;
      options: Array<{ id: number; name: string; priceDelta: number }>;
    }>;
  }>;
}

export function renderCatalogReply(result: CatalogReplyResult, query: string): string {
  if (result.ambiguous) return 'Encontrei mais de uma opção parecida. Qual delas você quer?';
  if (result.total > 12 || (!result.results.length && result.total > 0)) return 'Tem bastante opção no cardápio. Quer filtrar por tipo ou faixa de preço?';
  if (!result.results.length) return 'Não encontrei uma opção disponível com esse nome. Quer tentar de outro jeito?';
  const wantsModifier = /mistura/i.test(query);
  const choices = result.results.slice(0, 12).map((item) => {
    const group = wantsModifier
      ? item.modifierGroups?.find((candidate) => /mistura/i.test(candidate.name))
      : undefined;
    if (group?.options.length) return `${customerText(item.publicName)}: ${group.options.map((option) => customerText(option.name)).join(', ')}`;
    return `${customerText(item.publicName)} por ${money(item.currentPrice)}`;
  }).join('; ');
  return `Hoje tem ${choices}. Qual você quer?`;
}

export interface OrderingStatePointer { orderingId: string; revision: number }

export function serializeOrderingState(pointer: OrderingStatePointer): string {
  return `${AI_ORDER_STATE_PREFIX}${JSON.stringify(pointer)}`;
}

export function findLatestOrderingState(messages: Array<{ role: string; content: string | null }>): OrderingStatePointer | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'tool' || !message.content?.startsWith(AI_ORDER_STATE_PREFIX)) continue;
    try {
      const value = JSON.parse(message.content.slice(AI_ORDER_STATE_PREFIX.length)) as Partial<OrderingStatePointer>;
      if (typeof value.orderingId === 'string' && Number.isInteger(value.revision)) {
        return { orderingId: value.orderingId, revision: value.revision as number };
      }
    } catch {
      // Ignore malformed internal audit rows and keep searching older state.
    }
  }
  return null;
}

export function snapshotToDraft(snapshot: OrderingSnapshot): OrderingDraft {
  return {
    items: snapshot.cart.items.map((item) => ({
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
