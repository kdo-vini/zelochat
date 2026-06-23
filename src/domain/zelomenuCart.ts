import { createHash, randomBytes } from 'node:crypto';

export const ZELOMENU_CART_CONTEXTS = ['whatsapp_order', 'public_order', 'table_order'] as const;
export type ZeloMenuCartContext = (typeof ZELOMENU_CART_CONTEXTS)[number];

export const ZELOMENU_CART_STATES = [
  'cart_open',
  'confirmed_waiting_review',
  'confirmed_waiting_payment',
  'needs_customer_adjustment',
  'accepted',
  'rejected',
  'cancelled',
  'archived',
] as const;
export type ZeloMenuCartState = (typeof ZELOMENU_CART_STATES)[number];

export type ZeloMenuCartItemInput = {
  productName: string;
  quantity: number;
  notes?: string | null;
};

export type ZeloMenuCartItemSnapshot = {
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  notes?: string | null;
};

export type ZeloMenuCartSnapshot = {
  items: ZeloMenuCartItemSnapshot[];
  observations: string | null;
};

export type ZeloMenuCustomerSnapshot = {
  name: string | null;
  phone: string | null;
};

export type ZeloMenuFulfillmentSnapshot = {
  type: 'pickup' | 'delivery';
  pickupDate: string | null;
  pickupTime: string | null;
  deliveryAddress: string | null;
  deliveryNeighborhood: string | null;
  deliveryFee: number;
};

export type ZeloMenuPricingSnapshot = {
  subtotal: number;
  deliveryFee: number;
  total: number;
};

export type ZeloMenuPaymentSnapshot = {
  declaredMethod: string | null;
  pixReceiptRequired: boolean;
  pixReceiptApproved: boolean;
};

export type ZeloMenuCartRevalidationIssueCode =
  | 'product_missing'
  | 'product_unavailable'
  | 'stock_insufficient'
  | 'price_changed'
  | 'schedule_unavailable';

export type ZeloMenuCartRevalidationIssue = {
  code: ZeloMenuCartRevalidationIssueCode;
  message: string;
  productName?: string;
  requestedQuantity?: number;
  availableQuantity?: number | null;
  previousUnitPrice?: number;
  currentUnitPrice?: number;
};

export type ZeloMenuCartRevalidation = {
  checkedAt: string;
  ok: boolean;
  issues: ZeloMenuCartRevalidationIssue[];
  previewCart: ZeloMenuCartSnapshot | null;
  previewPricing: ZeloMenuPricingSnapshot | null;
  previewPayment: ZeloMenuPaymentSnapshot | null;
};

export function normalizePublicCartToken(value: string): string | null {
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{20,120}$/.test(trimmed) ? trimmed : null;
}

export function hashPublicCartToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createPublicCartToken(): { token: string; tokenHash: string; tokenLast4: string } {
  const token = randomBytes(24).toString('base64url');
  return {
    token,
    tokenHash: hashPublicCartToken(token),
    tokenLast4: token.slice(-4),
  };
}

export function buildPublicCartPath(token: string): string {
  return `/menu/carrinho/${encodeURIComponent(token)}`;
}

export function buildPublicCartUrl(appBaseUrl: string, token: string): string {
  const base = appBaseUrl.replace(/\/$/, '');
  return `${base}${buildPublicCartPath(token)}`;
}

export function computeCartPricing(
  items: Array<Pick<ZeloMenuCartItemSnapshot, 'lineTotal'>>,
  deliveryFee = 0,
): ZeloMenuPricingSnapshot {
  const normalizedDeliveryFee = Number.isFinite(deliveryFee) ? Number(deliveryFee) : 0;
  const subtotal = items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
  const total = subtotal + normalizedDeliveryFee;
  return {
    subtotal: roundCurrency(subtotal),
    deliveryFee: roundCurrency(normalizedDeliveryFee),
    total: roundCurrency(total),
  };
}

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolveConfirmedCartState(payment: Pick<ZeloMenuPaymentSnapshot, 'pixReceiptRequired' | 'pixReceiptApproved'>): Extract<ZeloMenuCartState, 'confirmed_waiting_review' | 'confirmed_waiting_payment'> {
  return payment.pixReceiptRequired && !payment.pixReceiptApproved
    ? 'confirmed_waiting_payment'
    : 'confirmed_waiting_review';
}

function formatBRL(value: number): string {
  return `R$ ${roundCurrency(value).toFixed(2).replace('.', ',')}`;
}

function formatDateBR(value: string | null): string {
  if (!value) return 'data a combinar';
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function buildCartSummaryLines(input: {
  cart: ZeloMenuCartSnapshot;
  fulfillment: ZeloMenuFulfillmentSnapshot;
  pricing: ZeloMenuPricingSnapshot;
  payment: ZeloMenuPaymentSnapshot;
}): {
  itemsLine: string;
  deliveryLine: string;
  observationsLine: string;
  scheduleLine: string;
  paymentLine: string;
  totalLine: string;
} {
  const itemsLine = input.cart.items.length > 0
    ? input.cart.items.map((item) => `${item.quantity}x ${item.productName}`).join(', ')
    : 'Itens a revisar';
  const scheduleLabel = input.fulfillment.type === 'delivery' ? '🛵 Entrega' : '📅 Retirada';
  const scheduleLine = `${scheduleLabel}: ${formatDateBR(input.fulfillment.pickupDate)}${input.fulfillment.pickupTime ? ` às ${input.fulfillment.pickupTime}` : ''}`;
  const deliveryLine = input.fulfillment.type === 'delivery' && input.fulfillment.deliveryAddress
    ? `\n📍 ${input.fulfillment.deliveryAddress}${input.fulfillment.deliveryNeighborhood ? `\n🏘️ Bairro: ${input.fulfillment.deliveryNeighborhood}` : ''}`
    : '';
  const observationsLine = input.cart.observations ? `\n📝 Obs: ${input.cart.observations}` : '';
  return {
    itemsLine,
    deliveryLine,
    observationsLine,
    scheduleLine,
    paymentLine: `💳 Pagamento: ${input.payment.declaredMethod || 'Não informado'}`,
    totalLine: `💰 Total: ${formatBRL(input.pricing.total)}`,
  };
}

export function buildConfirmedCartCustomerMessage(input: {
  orderingId: string;
  state: Extract<ZeloMenuCartState, 'confirmed_waiting_review' | 'confirmed_waiting_payment'>;
  cart: ZeloMenuCartSnapshot;
  fulfillment: ZeloMenuFulfillmentSnapshot;
  pricing: ZeloMenuPricingSnapshot;
  payment: ZeloMenuPaymentSnapshot;
}): string {
  const shortId = input.orderingId.slice(0, 8).toUpperCase();
  const summary = buildCartSummaryLines(input);
  const nextStep = input.state === 'confirmed_waiting_payment'
    ? 'Agora envie o comprovante do Pix aqui no WhatsApp para a loja conferir.'
    : 'A loja vai conferir o pedido e te chamar por aqui com o próximo passo.';

  return `✅ Pedido recebido pelo cardápio! Número: *#${shortId}*\n\n📦 ${summary.itemsLine}${summary.deliveryLine}${summary.observationsLine}\n${summary.scheduleLine}\n${summary.paymentLine}\n${summary.totalLine}\n\n${nextStep}`;
}

export function buildAcceptedCartCustomerMessage(input: {
  orderId: string;
  cart: ZeloMenuCartSnapshot;
  fulfillment: ZeloMenuFulfillmentSnapshot;
  pricing: ZeloMenuPricingSnapshot;
  payment: ZeloMenuPaymentSnapshot;
}): string {
  const shortId = input.orderId.slice(0, 8).toUpperCase();
  const summary = buildCartSummaryLines(input);
  return `✅ Pedido confirmado! Número: *#${shortId}*\n\n📦 ${summary.itemsLine}${summary.deliveryLine}${summary.observationsLine}\n${summary.scheduleLine}\n${summary.paymentLine}\n${summary.totalLine}\n\nSeu pedido já entrou na produção da loja. Qualquer dúvida, fale com a gente por aqui!`;
}

export function buildWhatsAppCartLinkMessage(input: {
  publicUrl: string;
  customerName: string;
  summary: string;
  pixReceiptRequired: boolean;
}): string {
  const greeting = input.customerName
    ? `Perfeito, ${input.customerName}!`
    : 'Perfeito!';
  const pixLine = input.pixReceiptRequired
    ? '\n\nSe o pagamento for no Pix, o comprovante será pedido no WhatsApp depois que você confirmar pelo link.'
    : '';
  return `${greeting} Montei seu pedido no link abaixo para você revisar com calma, ajustar se precisar e confirmar:\n\n${input.publicUrl}\n\n${input.summary}${pixLine}`;
}

// ZLM-105 — recuperação de carrinho abandonado.
// Só carrinho ainda aberto (`cart_open`), não arquivado e que nunca recebeu
// nudge pode ser recuperado. A janela [min, max] evita lembrar cedo demais
// (cliente ainda decidindo) e tarde demais (lembrete velho vira spam).
export const ABANDONED_CART_RECOVERY_MIN_AGE_MS = 2 * 60 * 60 * 1000; // 2h
export const ABANDONED_CART_RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

export function isCartEligibleForAbandonedRecovery(params: {
  state: ZeloMenuCartState;
  archivedAt: string | null;
  recoveryNudgeSentAt: string | null;
  updatedAt: string;
  now?: number;
  minAgeMs?: number;
  maxAgeMs?: number;
}): boolean {
  // Apenas carrinho aberto pode ser abandonado. Confirmado / aguardando pagamento /
  // aceito / recusado / cancelado / arquivado NUNCA recebem recuperação.
  if (params.state !== 'cart_open') return false;
  if (params.archivedAt) return false;
  // "No máximo uma recuperação": uma vez nudado, nunca mais para este carrinho.
  if (params.recoveryNudgeSentAt) return false;

  const now = params.now ?? Date.now();
  const updatedAtMs = Date.parse(params.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return false;
  const age = now - updatedAtMs;
  const minAge = params.minAgeMs ?? ABANDONED_CART_RECOVERY_MIN_AGE_MS;
  const maxAge = params.maxAgeMs ?? ABANDONED_CART_RECOVERY_MAX_AGE_MS;
  return age >= minAge && age <= maxAge;
}

export function buildAbandonedCartRecoveryMessage(input: {
  customerName: string | null;
  itemsLine: string | null;
  publicUrl: string;
}): string {
  const greeting = input.customerName ? `Oi, ${input.customerName}!` : 'Oi!';
  const itemsBlock = input.itemsLine ? `\n\n📦 ${input.itemsLine}` : '';
  return `${greeting} 👋 Vi que seu pedido ficou pela metade por aqui.${itemsBlock}\n\nQuando quiser, é só tocar no link para revisar e finalizar:\n${input.publicUrl}\n\nSe precisar de ajuda ou quiser mudar algo, é só me chamar por aqui! 😊`;
}
