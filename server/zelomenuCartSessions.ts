import { randomUUID } from 'node:crypto';
import { getConfig, isAiGloballyEnabledNow, loadAiSettingsFromDb, type CatalogCategoriaGroup, type CatalogProduct } from './configStore.js';
import { evaluateCreateOrderScheduleGuard, getPublicAppBaseUrl } from './ai.js';
import { isReservedZeloMenuSlug, normalizeZeloMenuSlug } from '../src/domain/zelomenuSlug.js';
import { addAssistantMessage } from './messageHandler.js';
import { selectOrderCreatedNotifyTriggers } from '../src/domain/orderEventTriggers.js';
import { getEmpresaUserId, getServiceSupabase } from './supabase.js';
import { sendTextMessage } from './whatsapp.js';
import { isPixPaymentMethod, isPixReceiptConfigActive, normalizeComparableText } from '../src/domain/pixReceipt.js';
import { firstZeloMenuCheckoutError, validateZeloMenuCheckoutDetails } from '../src/domain/zelomenuCheckout.js';
import {
  buildModifierSelectionKey,
  formatModifierAwareCartItem,
  resolveModifierSelections,
  type ZeloMenuModifierSelectionInput,
} from '../src/domain/zelomenuModifiers.js';
import {
  ABANDONED_CART_ARCHIVED_REASON,
  ABANDONED_CART_EXPIRY_AGE_MS,
  ABANDONED_CART_PURGE_AGE_MS,
  ABANDONED_CART_RECOVERY_MAX_AGE_MS,
  ABANDONED_CART_RECOVERY_MIN_AGE_MS,
  buildAbandonedCartRecoveryMessage,
  buildAcceptedCartCustomerMessage,
  buildConfirmedCartCustomerMessage,
  buildPublicCartPath,
  buildPublicCartUrl,
  computeCartPricing,
  createPublicCartToken,
  hashPublicCartToken,
  isCartEligibleForAbandonedRecovery,
  normalizePublicCartToken,
  resolveConfirmedCartState,
  resolveDeliveryFeeForNeighborhood,
  type ZeloMenuCartContext,
  type ZeloMenuCartItemInput,
  type ZeloMenuCartItemSnapshot,
  type ZeloMenuCartRevalidation,
  type ZeloMenuCartRevalidationIssue,
  type ZeloMenuCartSnapshot,
  type ZeloMenuCustomerSnapshot,
  type ZeloMenuFulfillmentSnapshot,
  type ZeloMenuPaymentSnapshot,
  type ZeloMenuPricingSnapshot,
  type ZeloMenuCartState,
} from '../src/domain/zelomenuCart.js';
import { resolveCustomerForOrder } from './customers/identity.js';

type SessionRow = {
  id: string;
  empresa_id: string;
  ordering_id: string;
  context: ZeloMenuCartContext;
  state: ZeloMenuCartState;
  source_ref: string;
  customer_snapshot: unknown;
  cart_snapshot: unknown;
  fulfillment_snapshot: unknown;
  pricing_snapshot: unknown;
  payment_snapshot: unknown;
  metadata: unknown;
  revision: number;
  current_token_hash: string | null;
  current_token_last4: string | null;
  last_revalidated_at: string | null;
  last_revalidation: unknown;
  confirmed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type TokenRow = {
  id: string;
  session_id: string;
  token_hash: string;
  token_last4: string;
  issued_for_revision: number;
  revoked_at: string | null;
  created_at: string;
  last_seen_at: string | null;
};

type OpenWhatsAppCartInput = {
  empresaId: string;
  remoteJid: string;
  customerName?: string | null;
  customerPhone?: string | null;
  items?: ZeloMenuCartItemInput[];
  fulfillment?: Partial<ZeloMenuFulfillmentSnapshot> | null;
  paymentMethod?: string | null;
  observations?: string | null;
  source?: 'ai_prebuilt' | 'operator';
};

type PublicCartPatch = {
  customerName?: string | null;
  customerPhone?: string | null;
  items?: ZeloMenuCartItemInput[];
  fulfillment?: Partial<ZeloMenuFulfillmentSnapshot> | null;
  paymentMethod?: string | null;
  observations?: string | null;
};

type ResolvedCart = {
  cart: ZeloMenuCartSnapshot;
  fulfillment: ZeloMenuFulfillmentSnapshot;
  pricing: ZeloMenuPricingSnapshot;
  payment: ZeloMenuPaymentSnapshot;
};

type PublicCartSession = {
  id: string;
  orderingId: string;
  context: ZeloMenuCartContext;
  state: ZeloMenuCartState;
  revision: number;
  customer: ZeloMenuCustomerSnapshot;
  cart: ZeloMenuCartSnapshot;
  fulfillment: ZeloMenuFulfillmentSnapshot;
  pricing: ZeloMenuPricingSnapshot;
  payment: ZeloMenuPaymentSnapshot;
  metadata: Record<string, unknown>;
  lastRevalidatedAt: string | null;
  lastRevalidation: ZeloMenuCartRevalidation | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  archivedAt: string | null;
};

type ProductionOrderStatus = {
  id: string;
  status: string;
  revision: number;
};

type PublicCartResponse = {
  session: PublicCartSession;
  business: {
    name: string;
    address: string;
    pixEnabled: boolean;
    deliveryEnabled: boolean;
    deliveryNeighborhoods: Array<{ name: string; fee: number }>;
    logoUrl?: string | null;
    welcomeText?: string | null;
    featuredEnabled?: boolean;
    featuredProductIds?: number[];
    businessHours?: PublicBusinessHoursStatus;
  };
  catalog: CatalogCategoriaGroup[];
  link: {
    path: string;
    tokenStatus: 'current' | 'stale';
  };
  revalidation: ZeloMenuCartRevalidation;
  productionOrder: ProductionOrderStatus | null;
};

type PublicBusinessHoursStatus = {
  configured: boolean;
  openNow: boolean;
  label: string | null;
};

const PUBLIC_DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function parsePublicTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function publicMinutesLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function publicNowParts(timezone: string): { day: string; minutes: number } {
  const now = new Date();
  const weekday = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'short',
  }).format(now).toLowerCase().replace(/\./g, '');
  const dayMap: Record<string, string> = {
    dom: 'Dom',
    seg: 'Seg',
    ter: 'Ter',
    qua: 'Qua',
    qui: 'Qui',
    sex: 'Sex',
    sab: 'Sáb',
    'sáb': 'Sáb',
  };
  const timeParts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const rawHour = Number(timeParts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(timeParts.find((part) => part.type === 'minute')?.value ?? '0');
  const hour = rawHour === 24 ? 0 : rawHour;
  return {
    day: dayMap[weekday] ?? PUBLIC_DAY_LABELS[now.getDay()] ?? 'Dom',
    minutes: hour * 60 + minute,
  };
}

function isPublicWindowOpen(nowMinutes: number, openMinutes: number, closeMinutes: number): boolean {
  if (openMinutes <= closeMinutes) return nowMinutes >= openMinutes && nowMinutes <= closeMinutes;
  return nowMinutes >= openMinutes || nowMinutes <= closeMinutes;
}

function buildPublicBusinessHoursStatus(config: ReturnType<typeof getConfig>): PublicBusinessHoursStatus {
  const openMinutes = parsePublicTime(config.openTime);
  const closeMinutes = parsePublicTime(config.closeTime);
  if (openMinutes === null || closeMinutes === null) {
    return { configured: false, openNow: true, label: null };
  }
  const timezone = config.timezone || 'America/Sao_Paulo';
  const { day, minutes } = publicNowParts(timezone);
  const closedToday = config.closedDays.includes(day);
  return {
    configured: true,
    openNow: !closedToday && isPublicWindowOpen(minutes, openMinutes, closeMinutes),
    label: `${publicMinutesLabel(openMinutes)}–${publicMinutesLabel(closeMinutes)}`,
  };
}

type PublicCartConfirmResponse = PublicCartResponse & {
  confirmation: {
    confirmed: boolean;
    alreadyConfirmed: boolean;
    state: ZeloMenuCartState;
    customerMessage: string | null;
  };
};

type ReviewCartSession = PublicCartSession & {
  acceptance: {
    acceptedAt: string | null;
    acceptedByUserId: string | null;
    acceptedByName: string | null;
  };
  productionOrder: {
    id: string | null;
    shortId: string | null;
  };
};

type ReviewCartResponse = {
  session: ReviewCartSession;
  revalidation: ZeloMenuCartRevalidation | null;
  review: {
    canAccept: boolean;
    blockingReason: string | null;
  };
};

type ReviewCartAcceptResponse = ReviewCartResponse & {
  accepted: boolean;
  alreadyAccepted: boolean;
  customerMessage: string | null;
};

const CART_SESSION_COLUMNS = `
  id,
  empresa_id,
  ordering_id,
  context,
  state,
  source_ref,
  customer_snapshot,
  cart_snapshot,
  fulfillment_snapshot,
  pricing_snapshot,
  payment_snapshot,
  metadata,
  revision,
  current_token_hash,
  current_token_last4,
  last_revalidated_at,
  last_revalidation,
  confirmed_at,
  archived_at,
  created_at,
  updated_at
`;

function sanitizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function sanitizeObservations(value: unknown): string | null {
  return sanitizeText(value, 500);
}

function normalizePositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : null;
}

function normalizeDate(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
}

function normalizeTime(value: unknown): string | null {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value.trim()) ? value.trim() : null;
}

function parseCustomerSnapshot(value: unknown): ZeloMenuCustomerSnapshot {
  if (!value || typeof value !== 'object') return { name: null, phone: null };
  const row = value as { name?: unknown; phone?: unknown };
  return {
    name: sanitizeText(row.name, 120),
    phone: sanitizeText(row.phone, 40),
  };
}

function parseCartSnapshot(value: unknown): ZeloMenuCartSnapshot {
  if (!value || typeof value !== 'object') return { items: [], observations: null };
  const row = value as { items?: unknown; observations?: unknown };
  const items = Array.isArray(row.items)
    ? row.items.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const typed = item as {
        productId?: unknown;
        productName?: unknown;
        baseUnitPrice?: unknown;
        selectedModifiers?: unknown;
        modifierDeltaTotal?: unknown;
        quantity?: unknown;
        unitPrice?: unknown;
        lineTotal?: unknown;
        notes?: unknown;
      };
      const productId = typed.productId == null ? null : Number(typed.productId);
      const productName = sanitizeText(typed.productName, 120);
      const baseUnitPrice = Number(typed.baseUnitPrice ?? typed.unitPrice);
      const quantity = normalizePositiveInt(typed.quantity);
      const unitPrice = Number(typed.unitPrice);
      const lineTotal = Number(typed.lineTotal);
      const modifierDeltaTotal = Number(typed.modifierDeltaTotal ?? 0);
      if (!productName || quantity === null || !Number.isFinite(unitPrice) || !Number.isFinite(lineTotal)) return [];
      return [{
        productId: Number.isFinite(productId) ? productId : null,
        productName,
        baseUnitPrice: Number.isFinite(baseUnitPrice) ? baseUnitPrice : unitPrice,
        selectedModifiers: parseSelectedModifiers(typed.selectedModifiers),
        modifierDeltaTotal: Number.isFinite(modifierDeltaTotal) ? modifierDeltaTotal : 0,
        quantity,
        unitPrice,
        lineTotal,
        notes: sanitizeText(typed.notes, 200),
      }];
    })
    : [];
  return {
    items,
    observations: sanitizeObservations(row.observations),
  };
}

function parseFulfillmentSnapshot(value: unknown): ZeloMenuFulfillmentSnapshot {
  if (!value || typeof value !== 'object') {
    return {
      type: 'pickup',
      asap: false,
      pickupDate: null,
      pickupTime: null,
      deliveryAddress: null,
      deliveryNeighborhood: null,
      deliveryFee: 0,
      deliveryFeeToConfirm: false,
    };
  }
  const row = value as {
    type?: unknown;
    asap?: unknown;
    pickupDate?: unknown;
    pickupTime?: unknown;
    deliveryAddress?: unknown;
    deliveryNeighborhood?: unknown;
    deliveryFee?: unknown;
    deliveryFeeToConfirm?: unknown;
  };
  return {
    type: row.type === 'delivery' ? 'delivery' : 'pickup',
    asap: row.asap === true,
    pickupDate: normalizeDate(row.pickupDate),
    pickupTime: normalizeTime(row.pickupTime),
    deliveryAddress: sanitizeText(row.deliveryAddress, 250),
    deliveryNeighborhood: sanitizeText(row.deliveryNeighborhood, 120),
    deliveryFee: Number.isFinite(Number(row.deliveryFee)) ? Number(row.deliveryFee) : 0,
    deliveryFeeToConfirm: row.deliveryFeeToConfirm === true,
  };
}

function parsePricingSnapshot(value: unknown): ZeloMenuPricingSnapshot {
  if (!value || typeof value !== 'object') {
    return { subtotal: 0, deliveryFee: 0, total: 0 };
  }
  const row = value as { subtotal?: unknown; deliveryFee?: unknown; total?: unknown };
  return {
    subtotal: Number.isFinite(Number(row.subtotal)) ? Number(row.subtotal) : 0,
    deliveryFee: Number.isFinite(Number(row.deliveryFee)) ? Number(row.deliveryFee) : 0,
    total: Number.isFinite(Number(row.total)) ? Number(row.total) : 0,
  };
}

function parsePaymentSnapshot(value: unknown): ZeloMenuPaymentSnapshot {
  if (!value || typeof value !== 'object') {
    return { declaredMethod: null, pixReceiptRequired: false, pixReceiptApproved: false };
  }
  const row = value as {
    declaredMethod?: unknown;
    pixReceiptRequired?: unknown;
    pixReceiptApproved?: unknown;
  };
  return {
    declaredMethod: sanitizeText(row.declaredMethod, 40),
    pixReceiptRequired: row.pixReceiptRequired === true,
    pixReceiptApproved: row.pixReceiptApproved === true,
  };
}

function parseRevalidation(value: unknown): ZeloMenuCartRevalidation | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<ZeloMenuCartRevalidation>;
  if (typeof row.checkedAt !== 'string' || typeof row.ok !== 'boolean' || !Array.isArray(row.issues)) return null;
  return {
    checkedAt: row.checkedAt,
    ok: row.ok,
    issues: row.issues,
    previewCart: row.previewCart ?? null,
    previewPricing: row.previewPricing ?? null,
    previewPayment: row.previewPayment ?? null,
  };
}

function parseSelectedModifiers(value: unknown): ZeloMenuCartItemSnapshot['selectedModifiers'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((group) => {
    if (!group || typeof group !== 'object') return [];
    const typed = group as {
      groupId?: unknown;
      groupName?: unknown;
      kind?: unknown;
      selectedOptions?: unknown;
    };
    const groupId = sanitizeText(typed.groupId, 64);
    const groupName = sanitizeText(typed.groupName, 120);
    if (!groupId || !groupName) return [];
    const selectedOptions = Array.isArray(typed.selectedOptions)
      ? typed.selectedOptions.flatMap((option) => {
        if (!option || typeof option !== 'object') return [];
        const candidate = option as {
          optionId?: unknown;
          optionName?: unknown;
          priceDelta?: unknown;
        };
        const optionId = sanitizeText(candidate.optionId, 64);
        const optionName = sanitizeText(candidate.optionName, 120);
        const priceDelta = Number(candidate.priceDelta ?? 0);
        if (!optionId || !optionName || !Number.isFinite(priceDelta)) return [];
        return [{ optionId, optionName, priceDelta }];
      })
      : [];
    return [{
      groupId,
      groupName,
      kind: typed.kind === 'variacao' ? 'variacao' : 'adicional',
      selectedOptions,
    }];
  });
}

function parseMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseAcceptedByUserId(metadata: Record<string, unknown>): string | null {
  return sanitizeText(metadata.acceptedByUserId, 64);
}

function parseAcceptedByName(metadata: Record<string, unknown>): string | null {
  return sanitizeText(metadata.acceptedByName, 120);
}

function parseAcceptedAt(metadata: Record<string, unknown>): string | null {
  return typeof metadata.acceptedAt === 'string' ? metadata.acceptedAt : null;
}

function parseProductionOrderId(metadata: Record<string, unknown>): string | null {
  return sanitizeText(metadata.productionOrderId, 64);
}

function mapSessionRow(row: SessionRow): PublicCartSession {
  return {
    id: row.id,
    orderingId: row.ordering_id,
    context: row.context,
    state: row.state,
    revision: Number(row.revision || 1),
    customer: parseCustomerSnapshot(row.customer_snapshot),
    cart: parseCartSnapshot(row.cart_snapshot),
    fulfillment: parseFulfillmentSnapshot(row.fulfillment_snapshot),
    pricing: parsePricingSnapshot(row.pricing_snapshot),
    payment: parsePaymentSnapshot(row.payment_snapshot),
    metadata: parseMetadata(row.metadata),
    lastRevalidatedAt: row.last_revalidated_at,
    lastRevalidation: parseRevalidation(row.last_revalidation),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
    archivedAt: row.archived_at,
  };
}

function mapReviewSessionRow(row: SessionRow): ReviewCartSession {
  const session = mapSessionRow(row);
  const metadata = parseMetadata(row.metadata);
  const productionOrderId = parseProductionOrderId(metadata);
  return {
    ...session,
    acceptance: {
      acceptedAt: parseAcceptedAt(metadata),
      acceptedByUserId: parseAcceptedByUserId(metadata),
      acceptedByName: parseAcceptedByName(metadata),
    },
    productionOrder: {
      id: productionOrderId,
      shortId: productionOrderId ? productionOrderId.slice(0, 8).toUpperCase() : null,
    },
  };
}

function toCartItemInputs(cart: ZeloMenuCartSnapshot): ZeloMenuCartItemInput[] {
  return cart.items.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    notes: item.notes ?? null,
    selectedOptions: item.selectedModifiers.map((group) => ({
      groupId: group.groupId,
      optionIds: group.selectedOptions.map((option) => option.optionId),
    })),
  }));
}

function filterVisibleCatalog(groups: CatalogCategoriaGroup[]): CatalogCategoriaGroup[] {
  return groups
    .map((group) => {
      const subcategorias = group.subcategorias
        .map((subcategory) => ({
          nome: subcategory.nome,
          produtos: subcategory.produtos.filter((product) => product.available),
        }))
        .filter((subcategory) => subcategory.produtos.length > 0);
      const produtosDireto = group.produtosDireto.filter((product) => product.available);
      return {
        nome: group.nome,
        subcategorias,
        produtosDireto,
      };
    })
    .filter((group) => group.subcategorias.length > 0 || group.produtosDireto.length > 0);
}

function findCatalogProduct(
  products: CatalogProduct[],
  productRef: { productId?: number | null; productName: string },
): CatalogProduct | null {
  if (productRef.productId != null) {
    const byId = products.find((product) => product.id === productRef.productId);
    if (byId) return byId;
  }
  const normalizedTarget = normalizeComparableText(productRef.productName);
  if (!normalizedTarget) return null;
  return products.find((product) => normalizeComparableText(product.name) === normalizedTarget) ?? null;
}

function normalizeIncomingItems(items: unknown): ZeloMenuCartItemInput[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const typed = item as {
      productId?: unknown;
      productName?: unknown;
      quantity?: unknown;
      notes?: unknown;
      selectedOptions?: unknown;
    };
    const productName = sanitizeText(typed.productName, 120);
    const productId = typed.productId == null ? null : Number(typed.productId);
    const quantity = normalizePositiveInt(typed.quantity);
    if (!productName || quantity === null) return [];
    return [{
      productId: Number.isFinite(productId) ? productId : null,
      productName,
      quantity,
      notes: sanitizeText(typed.notes, 200),
      selectedOptions: normalizeIncomingModifierSelections(typed.selectedOptions),
    }];
  }).slice(0, 50);
}

function normalizeIncomingModifierSelections(value: unknown): ZeloMenuModifierSelectionInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((selection) => {
    if (!selection || typeof selection !== 'object') return [];
    const typed = selection as { groupId?: unknown; optionIds?: unknown };
    const groupId = sanitizeText(typed.groupId, 64);
    if (!groupId || !Array.isArray(typed.optionIds)) return [];
    const optionIds = typed.optionIds
      .map((optionId) => sanitizeText(optionId, 64))
      .filter((optionId): optionId is string => Boolean(optionId));
    return [{ groupId, optionIds }];
  });
}

function resolveDeliveryFee(
  deliveryType: 'pickup' | 'delivery',
  deliveryNeighborhood: string | null,
  deliveryConfig: ReturnType<typeof getConfig>['deliveryConfig'],
): { fee: number; toConfirm: boolean } {
  if (deliveryType !== 'delivery') return { fee: 0, toConfirm: false };
  // Loja que não habilitou entrega não consegue precificar uma entrega — guard
  // explícito, separado do caso de bairro livre tratado pela função pura.
  if (!deliveryConfig?.enabled) {
    throw new Error('DELIVERY_DISABLED');
  }
  // ZLM-204 (D-081/D-082/D-083): bairro fora da tabela não estoura mais erro —
  // a função pura devolve fee 0 + toConfirm, deixando o pedido confirmar com a
  // taxa "a confirmar" e força conferência humana antes do aceite.
  return resolveDeliveryFeeForNeighborhood({
    type: 'delivery',
    neighborhood: deliveryNeighborhood,
    neighborhoods: deliveryConfig.neighborhoods,
  });
}

async function resolveSnapshots(
  empresaId: string,
  params: {
    items: ZeloMenuCartItemInput[];
    fulfillment?: Partial<ZeloMenuFulfillmentSnapshot> | null;
    paymentMethod?: string | null;
    observations?: string | null;
  },
): Promise<ResolvedCart> {
  await loadAiSettingsFromDb(empresaId);
  const config = getConfig(empresaId);
  const resolvedItems: ZeloMenuCartItemSnapshot[] = [];

  for (const item of params.items) {
    const product = findCatalogProduct(config.products, {
      productId: item.productId ?? null,
      productName: item.productName,
    });
    if (!product) throw new Error('PRODUCT_NOT_FOUND');
    if (!product.available) throw new Error('PRODUCT_UNAVAILABLE');
    if (product.stockControlled) {
      const stockQuantity = Number(product.stockQuantity ?? 0);
      if (item.quantity > stockQuantity) throw new Error('PRODUCT_STOCK_EXCEEDED');
    }
    const modifierResolution = resolveModifierSelections(product.modifierGroups, item.selectedOptions ?? []);
    if (modifierResolution.ok === false) {
      throw new Error(`MODIFIER_INVALID:${modifierResolution.message}`);
    }
    const baseUnitPrice = Number(product.basePrice ?? product.price);
    const unitPrice = Number((baseUnitPrice + modifierResolution.deltaTotal).toFixed(2));
    resolvedItems.push({
      productId: product.id ?? null,
      productName: product.name,
      baseUnitPrice,
      selectedModifiers: modifierResolution.selectedGroups,
      modifierDeltaTotal: modifierResolution.deltaTotal,
      quantity: item.quantity,
      unitPrice,
      lineTotal: Number((unitPrice * item.quantity).toFixed(2)),
      notes: sanitizeText(item.notes, 200),
    });
  }

  const fulfillmentType = params.fulfillment?.type === 'delivery' ? 'delivery' : 'pickup';
  const deliveryNeighborhood = sanitizeText(params.fulfillment?.deliveryNeighborhood, 120);
  const delivery = resolveDeliveryFee(fulfillmentType, deliveryNeighborhood, config.deliveryConfig);
  const fulfillment: ZeloMenuFulfillmentSnapshot = {
    type: fulfillmentType,
    asap: params.fulfillment?.asap === true,
    pickupDate: normalizeDate(params.fulfillment?.pickupDate),
    pickupTime: normalizeTime(params.fulfillment?.pickupTime),
    deliveryAddress: sanitizeText(params.fulfillment?.deliveryAddress, 250),
    deliveryNeighborhood,
    deliveryFee: delivery.fee,
    deliveryFeeToConfirm: delivery.toConfirm,
  };
  const pricing = computeCartPricing(resolvedItems, delivery.fee);
  const declaredMethod = sanitizeText(params.paymentMethod, 40);
  const payment: ZeloMenuPaymentSnapshot = {
    declaredMethod,
    pixReceiptRequired: isPixReceiptConfigActive(config.pixReceiptConfig) && isPixPaymentMethod(declaredMethod),
    pixReceiptApproved: false,
  };
  return {
    cart: {
      items: resolvedItems,
      observations: sanitizeObservations(params.observations),
    },
    fulfillment,
    pricing,
    payment,
  };
}

async function findActiveWhatsAppSession(empresaId: string, remoteJid: string): Promise<SessionRow | null> {
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .select(CART_SESSION_COLUMNS)
    .eq('empresa_id', empresaId)
    .eq('context', 'whatsapp_order')
    .eq('source_ref', remoteJid)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as SessionRow | null) ?? null;
}

async function findTokenRowByHash(token: string): Promise<TokenRow | null> {
  const normalized = normalizePublicCartToken(token);
  if (!normalized) return null;
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_cart_tokens')
    .select('id, session_id, token_hash, token_last4, issued_for_revision, revoked_at, created_at, last_seen_at')
    .eq('token_hash', hashPublicCartToken(normalized))
    .maybeSingle();
  if (error) throw error;
  return (data as TokenRow | null) ?? null;
}

async function findSessionById(sessionId: string): Promise<SessionRow | null> {
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .select(CART_SESSION_COLUMNS)
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return (data as SessionRow | null) ?? null;
}

async function touchToken(tokenId: string): Promise<void> {
  const { error } = await getServiceSupabase()
    .from('zelomenu_cart_tokens')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', tokenId);
  if (error) throw error;
}

/**
 * Rotate the public token for a session: revoke any active token, mint a fresh
 * one and promote it to the session's `current_token_hash`. The plaintext token
 * is never persisted — only its hash — so the only place to obtain a usable link
 * is the return value here, at issue time. Used both when opening a cart and when
 * sending the abandoned-cart recovery nudge (ZLM-105), since the original token
 * cannot be reconstructed from the DB.
 */
async function issueFreshCartToken(
  sessionId: string,
  revision: number,
  now: string,
): Promise<{ token: string; tokenHash: string; tokenLast4: string }> {
  const tokenData = createPublicCartToken();
  const { error: revokeTokenError } = await getServiceSupabase()
    .from('zelomenu_cart_tokens')
    .update({ revoked_at: now })
    .eq('session_id', sessionId)
    .is('revoked_at', null);
  if (revokeTokenError) throw revokeTokenError;

  const { error: tokenError } = await getServiceSupabase()
    .from('zelomenu_cart_tokens')
    .insert({
      session_id: sessionId,
      token_hash: tokenData.tokenHash,
      token_last4: tokenData.tokenLast4,
      issued_for_revision: revision,
      created_at: now,
    });
  if (tokenError) throw tokenError;

  const { error: sessionTokenError } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .update({
      current_token_hash: tokenData.tokenHash,
      current_token_last4: tokenData.tokenLast4,
      updated_at: now,
    })
    .eq('id', sessionId);
  if (sessionTokenError) throw sessionTokenError;

  return tokenData;
}

async function runRevalidation(session: PublicCartSession): Promise<ZeloMenuCartRevalidation> {
  const currentInput = toCartItemInputs(session.cart);
  const issues: ZeloMenuCartRevalidationIssue[] = [];
  let previewCart: ZeloMenuCartSnapshot | null = null;
  let previewPricing: ZeloMenuPricingSnapshot | null = null;
  let previewPayment: ZeloMenuPaymentSnapshot | null = null;

  try {
    const resolved = await resolveSnapshots(session.metadata.empresaId as string, {
      items: currentInput,
      fulfillment: session.fulfillment,
      paymentMethod: session.payment.declaredMethod,
      observations: session.cart.observations,
    });
    previewCart = resolved.cart;
    previewPricing = resolved.pricing;
    previewPayment = resolved.payment;

    for (const storedItem of session.cart.items) {
      const resolvedItem = resolved.cart.items.find(
        (item) =>
          (
            item.productId === storedItem.productId
            || normalizeComparableText(item.productName) === normalizeComparableText(storedItem.productName)
          )
          && buildModifierSelectionKey(
            item.selectedModifiers.map((group) => ({
              groupId: group.groupId,
              optionIds: group.selectedOptions.map((option) => option.optionId),
            })),
          ) === buildModifierSelectionKey(
            storedItem.selectedModifiers.map((group) => ({
              groupId: group.groupId,
              optionIds: group.selectedOptions.map((option) => option.optionId),
            })),
          ),
      );
      if (!resolvedItem) {
        issues.push({
          code: 'product_missing',
          message: `O item ${formatModifierAwareCartItem(storedItem)} não está mais disponível nesse carrinho.`,
          productName: storedItem.productName,
        });
        continue;
      }
      if (storedItem.unitPrice !== resolvedItem.unitPrice) {
        issues.push({
          code: 'price_changed',
          message: `O preço de ${resolvedItem.productName} foi atualizado.`,
          productName: resolvedItem.productName,
          previousUnitPrice: storedItem.unitPrice,
          currentUnitPrice: resolvedItem.unitPrice,
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN';
    if (message === 'PRODUCT_NOT_FOUND') {
      issues.push({ code: 'product_missing', message: 'Um item desse carrinho não existe mais no cardápio.' });
    } else if (message === 'PRODUCT_UNAVAILABLE') {
      issues.push({ code: 'product_unavailable', message: 'Um item desse carrinho não está disponível no momento.' });
    } else if (message === 'PRODUCT_STOCK_EXCEEDED') {
      issues.push({ code: 'stock_insufficient', message: 'A quantidade de um item ultrapassa o estoque atual.' });
    } else if (message === 'DELIVERY_DISABLED') {
      // Loja não habilitou entrega. Bairro livre fora da lista NÃO cai aqui —
      // vira taxa "a confirmar" (ZLM-204) e não bloqueia a confirmação.
      issues.push({ code: 'schedule_unavailable', message: 'A entrega precisa ser revista antes da confirmação.' });
    } else if (message.startsWith('MODIFIER_INVALID:')) {
      issues.push({ code: 'modifier_invalid', message: message.slice('MODIFIER_INVALID:'.length) });
    } else {
      throw error;
    }
  }

  const scheduleGuard = !session.fulfillment.asap && session.fulfillment.pickupDate && session.fulfillment.pickupTime
    ? evaluateCreateOrderScheduleGuard(
      session.metadata.empresaId as string,
      session.fulfillment.pickupDate,
      session.fulfillment.pickupTime,
    )
    : null;

  if (scheduleGuard) {
    issues.push({
      code: 'schedule_unavailable',
      message: scheduleGuard.reply,
    });
  }

  return {
    checkedAt: new Date().toISOString(),
    ok: issues.length === 0,
    issues,
    previewCart,
    previewPricing,
    previewPayment,
  };
}

async function persistRevalidation(sessionId: string, revalidation: ZeloMenuCartRevalidation): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .update({
      last_revalidated_at: now,
      last_revalidation: revalidation,
      updated_at: now,
    })
    .eq('id', sessionId);
  if (error) throw error;
}

async function buildPublicResponse(
  token: string,
  sessionRow: SessionRow,
  tokenRow: TokenRow,
): Promise<PublicCartResponse> {
  const session = mapSessionRow(sessionRow);
  const sessionForRevalidation = {
    ...session,
    metadata: { ...session.metadata, empresaId: sessionRow.empresa_id },
  };
  const revalidation = await runRevalidation(sessionForRevalidation);
  await persistRevalidation(session.id, revalidation);
  await touchToken(tokenRow.id);
  await loadAiSettingsFromDb(sessionRow.empresa_id);
  const config = getConfig(sessionRow.empresa_id);
  session.lastRevalidatedAt = revalidation.checkedAt;
  session.lastRevalidation = revalidation;
  session.updatedAt = revalidation.checkedAt;
  const publicMetadata: Record<string, unknown> = {};
  if (session.metadata.source) publicMetadata.source = session.metadata.source;
  if (session.context === 'public_order' && typeof session.metadata.slug === 'string') {
    publicMetadata.slug = session.metadata.slug;
  }
  session.metadata = publicMetadata;

  // Fetch live production order status if the order has been materialized.
  const productionOrderId = parseProductionOrderId(parseMetadata(sessionRow.metadata));
  let productionOrder: ProductionOrderStatus | null = null;
  if (productionOrderId) {
    try {
      const { data: orderData } = await getServiceSupabase()
        .from('zelo_orders')
        .select('id, status, revision')
        .eq('id', productionOrderId)
        .maybeSingle();
      if (orderData) {
        const o = orderData as { id: string; status: string; revision: number };
        productionOrder = { id: o.id, status: o.status, revision: Number(o.revision ?? 1) };
      }
    } catch (err) {
      console.error('[ZeloMenu] failed to fetch production order for public response:', err);
      // fail-soft: productionOrder stays null, response still works
    }
  }

  return {
    session,
    business: {
      name: config.name,
      address: config.address,
      pixEnabled: isPixReceiptConfigActive(config.pixReceiptConfig),
      deliveryEnabled: config.deliveryConfig?.enabled === true,
      deliveryNeighborhoods: config.deliveryConfig?.neighborhoods ?? [],
      businessHours: buildPublicBusinessHoursStatus(config),
    },
    catalog: filterVisibleCatalog(config.catalogHierarchy),
    link: {
      path: buildPublicCartPath(token),
      tokenStatus: sessionRow.current_token_hash === tokenRow.token_hash && !tokenRow.revoked_at ? 'current' : 'stale',
    },
    revalidation,
    productionOrder,
  };
}

async function createAcceptedOrderRecord(input: {
  sessionId: string;
  expectedRevision: number;
  empresaId: string;
  context: ZeloMenuCartContext;
  customer: ZeloMenuCustomerSnapshot;
  cart: ZeloMenuCartSnapshot;
  fulfillment: ZeloMenuFulfillmentSnapshot;
  pricing: ZeloMenuPricingSnapshot;
  payment: ZeloMenuPaymentSnapshot;
}): Promise<{ orderId: string; orderStatus: string; revision: number }> {
  let pessoaId: string | null = null;
  const ownerUserId = await getEmpresaUserId(input.empresaId);
  if (ownerUserId) {
    try {
      const identity = await resolveCustomerForOrder({
        empresaId: input.empresaId,
        ownerUserId,
        phone: input.customer.phone,
        observedName: input.customer.name,
      });
      pessoaId = identity.status === 'linked' || identity.status === 'created' ? identity.pessoaId : null;
    } catch (error) {
      // Identity is enrichment; confirmation remains valid with its snapshot.
      console.error('[ZeloMenu] customer identity unavailable; preserving order snapshot:', error);
    }
  }
  const { data, error } = await getServiceSupabase().rpc('create_zelo_order', {
    p_session_id: input.sessionId,
    p_expected_revision: input.expectedRevision,
    p_idempotency_key: `zelomenu-${input.sessionId}`,
    p_snapshots: {
      empresaId: input.empresaId,
      source: 'zelomenu',
      customer: input.customer,
      fulfillment: input.fulfillment,
      payment: input.payment,
      pricing: input.pricing,
      cart: input.cart,
      context: input.context,
    },
    p_pessoa_id: pessoaId,
  });
  if (error) throw error;
  const result = (Array.isArray(data) ? data[0] : data) as { orderId?: string; order_id?: string; orderStatus?: string; revision?: number } | null;
  const orderId = result?.orderId ?? result?.order_id;
  if (!orderId) throw new Error('ORDER_MATERIALIZATION_FAILED');
  return { orderId, orderStatus: result?.orderStatus ?? 'pending_review', revision: Number(result?.revision ?? 1) };
}

async function decrementAcceptedOrderStockBestEffort(
  empresaId: string,
  items: ZeloMenuCartSnapshot['items'],
): Promise<void> {
  const userId = await getEmpresaUserId(empresaId);
  if (!userId) return;
  await getServiceSupabase().rpc('zelochat_decrement_stock', {
    p_id_usuario: userId,
    p_items: items.map((item) => ({ name: item.productName, qty: item.quantity })),
  });
}

// ─── ZLM-301 / T5 — materialização do pedido na tela comum de Pedidos do PDV ────
//
// Só vale para quem TEM PDV (pdv/bundle): cliente chat-only (ex.: Casa dos
// Salgados, Agreste) nunca dispara isto — eles seguem operando em
// `zelochat_orders` sem nenhuma mudança. Para bundle, cria um TICKET DE COZINHA
// em `pedidos`/`pedido_itens` espelhando exatamente o fluxo "balcão" do PDV:
//   - numero_pedido pela RPC race-safe `proximo_numero_pedido`;
//   - status 'aberto', itens enviado_cozinha=true/status_cozinha 'aguardando';
//   - NÃO cria `venda` (o financeiro nasce só no fechamento/pagamento no PDV,
//     idêntico ao balcão) — zero risco de mexer em dado financeiro;
//   - vincula via `pedidos.zelochat_order_id` (hook já existente no schema).
//
// É uma materialização ONE-WAY (visibilidade na cozinha do PDV). A sincronização
// bidirecional de status / fonte única (cutover completo, dropar zelochat_orders)
// é a próxima fase de ZLM-301. Best-effort: falha aqui nunca derruba o pedido.

async function notifyManagerForAcceptedOrder(input: {
  empresaId: string;
  customer: ZeloMenuCustomerSnapshot;
  cart: ZeloMenuCartSnapshot;
  fulfillment: ZeloMenuFulfillmentSnapshot;
  pricing: ZeloMenuPricingSnapshot;
  payment: ZeloMenuPaymentSnapshot;
}): Promise<void> {
  const { data, error } = await getServiceSupabase()
    .from('zelochat_triggers')
    .select('id, kind, name, condition_description, natural_input, active')
    .eq('empresa_id', input.empresaId)
    .eq('active', true);
  if (error) throw error;

  const matches = selectOrderCreatedNotifyTriggers(
    ((data ?? []) as Array<{
      id: string;
      kind: string;
      name: string;
      condition_description?: string | null;
      natural_input?: string | null;
      active?: boolean;
    }>).map((trigger) => ({
      id: trigger.id,
      kind: trigger.kind,
      name: trigger.name,
      conditionDescription: trigger.condition_description ?? null,
      naturalInput: trigger.natural_input ?? null,
      active: trigger.active !== false,
    })),
    input.cart.items.map((item) => ({ product: formatModifierAwareCartItem(item), quantity: item.quantity })),
  );
  if (matches.length === 0) return;

  const managerPhone = getConfig(input.empresaId).managerPhone?.replace(/\D/g, '') ?? '';
  if (!managerPhone) return;
  const managerJid = `${managerPhone.startsWith('55') ? managerPhone : `55${managerPhone}`}@s.whatsapp.net`;
  const schedule = `${input.fulfillment.pickupDate || 'data a combinar'}${input.fulfillment.pickupTime ? ` às ${input.fulfillment.pickupTime}` : ''}`;
  const itemsList = input.cart.items.map((item) => `${item.quantity}x ${formatModifierAwareCartItem(item)}`).join(', ');
  // ZLM-204: taxa "a confirmar" precisa chegar ao operador para ele definir o
  // valor real no aceite (força conferência humana).
  const deliveryFeeLine = input.fulfillment.type === 'delivery' && input.fulfillment.deliveryFeeToConfirm
    ? '\n⚠️ Taxa de entrega: a confirmar (bairro fora da tabela)'
    : '';

  for (const match of matches) {
    await sendTextMessage(
      managerJid,
      `🔔 *${match.trigger.name}*\n` +
        `Cliente: ${input.customer.name || 'Cliente'}${input.customer.phone ? ` (${input.customer.phone})` : ''}\n` +
        `Pedido: ${itemsList || 'Itens a revisar'}\n` +
        `Retirada/entrega: ${schedule}${deliveryFeeLine}\n` +
        `Pagamento: ${input.payment.declaredMethod || 'Não informado'}\n` +
        `Total: R$ ${input.pricing.total.toFixed(2)}\n` +
        `Motivo: ${match.reason}`,
      input.empresaId,
    );
  }
}

function buildReviewResponse(
  sessionRow: SessionRow,
  revalidation: ZeloMenuCartRevalidation | null,
): ReviewCartResponse {
  const session = mapReviewSessionRow(sessionRow);
  let blockingReason: string | null = null;
  let canAccept = false;

  if (session.state === 'accepted') {
    blockingReason = 'Este pedido já entrou na produção.';
  } else if (session.state === 'confirmed_waiting_payment' && !session.payment.pixReceiptApproved) {
    blockingReason = 'Aguardando comprovante Pix antes do aceite.';
  } else if (session.state !== 'confirmed_waiting_review' && session.state !== 'confirmed_waiting_payment') {
    blockingReason = 'Este pedido não está pronto para aceite.';
  } else if (revalidation && !revalidation.ok) {
    blockingReason = 'Este pedido precisa de ajuste antes de entrar na produção.';
  } else if (session.state === 'confirmed_waiting_review') {
    canAccept = true;
  }

  return {
    session,
    revalidation,
    review: {
      canAccept,
      blockingReason,
    },
  };
}

// ─── ZLM-203 — Loja pública por slug (public_order) ────────────────────────────
//
// O slug é PDV-owned (`empresa_perfil.zelomenu_slug`, D-102). O backend ZeloChat
// SERVE a rota pública e LÊ o slug; resolve a empresa, carrega o catálogo (mesmo
// overlay de publicação do fluxo WhatsApp) e abre uma sessão `public_order`.
// Confirmação reusa `confirmPublicCartSession` (que materializa o pedido no
// branch public_order — ver lá).

export async function getEmpresaZeloMenuSlug(empresaId: string): Promise<string | null> {
  const { data, error } = await getServiceSupabase()
    .from('empresa_perfil')
    .select('zelomenu_slug')
    .eq('id', empresaId)
    .maybeSingle();
  if (error) throw error;
  return (data as { zelomenu_slug?: string | null } | null)?.zelomenu_slug ?? null;
}

/**
 * Define o slug público da loja (operador self-service, D-046). Valida formato e
 * palavras reservadas; o índice único do banco garante unicidade cross-loja —
 * traduzimos a violação 23505 em SLUG_TAKEN para a UI.
 */
export async function setEmpresaZeloMenuSlug(empresaId: string, rawSlug: string): Promise<string> {
  const normalized = normalizeZeloMenuSlug(rawSlug);
  if (!normalized) throw new Error('INVALID_SLUG');
  if (isReservedZeloMenuSlug(normalized)) throw new Error('RESERVED_SLUG');
  const { error } = await getServiceSupabase()
    .from('empresa_perfil')
    .update({ zelomenu_slug: normalized })
    .eq('id', empresaId);
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('SLUG_TAKEN');
    throw error;
  }
  return normalized;
}

async function resolveEmpresaIdBySlug(slug: string): Promise<string | null> {
  const normalized = normalizeZeloMenuSlug(slug);
  if (!normalized) return null;
  const { data, error } = await getServiceSupabase()
    .from('empresa_perfil')
    .select('id')
    .eq('zelomenu_slug', normalized)
    .maybeSingle();
  if (error) throw error;
  return (data as { id?: string } | null)?.id ?? null;
}

type EmpresaPerfilZeloMenuRow = {
  logo_url?: string | null;
  zelomenu_welcome_text?: string | null;
  zelomenu_featured_enabled?: boolean;
  zelomenu_featured_product_ids?: unknown;
  zelomenu_category_order?: unknown;
};

function applyCategoryOrder(catalog: CatalogCategoriaGroup[], order: string[]): CatalogCategoriaGroup[] {
  if (order.length === 0) return catalog;
  const idx = new Map(order.map((n, i) => [n, i]));
  return [...catalog].sort((a, b) => (idx.get(a.nome) ?? 9999) - (idx.get(b.nome) ?? 9999));
}

export async function getPublicStoreBySlug(slug: string): Promise<{
  empresaId: string;
  business: PublicCartResponse['business'];
  catalog: CatalogCategoriaGroup[];
} | null> {
  const empresaId = await resolveEmpresaIdBySlug(slug);
  if (!empresaId) return null;
  const [, perfilResult] = await Promise.all([
    loadAiSettingsFromDb(empresaId),
    getServiceSupabase()
      .from('empresa_perfil')
      .select('logo_url, zelomenu_welcome_text, zelomenu_featured_enabled, zelomenu_featured_product_ids, zelomenu_category_order')
      .eq('id', empresaId)
      .maybeSingle(),
  ]);
  const perfil = perfilResult.data as EmpresaPerfilZeloMenuRow | null;
  const config = getConfig(empresaId);
  const rawCatalog = filterVisibleCatalog(config.catalogHierarchy);
  const categoryOrder = Array.isArray(perfil?.zelomenu_category_order) ? (perfil.zelomenu_category_order as string[]) : [];
  return {
    empresaId,
    business: {
      name: config.name,
      address: config.address,
      pixEnabled: isPixReceiptConfigActive(config.pixReceiptConfig),
      deliveryEnabled: config.deliveryConfig?.enabled === true,
      deliveryNeighborhoods: config.deliveryConfig?.neighborhoods ?? [],
      logoUrl: perfil?.logo_url ?? null,
      welcomeText: perfil?.zelomenu_welcome_text ?? null,
      featuredEnabled: perfil?.zelomenu_featured_enabled ?? false,
      featuredProductIds: Array.isArray(perfil?.zelomenu_featured_product_ids)
        ? (perfil.zelomenu_featured_product_ids as number[])
        : [],
      businessHours: buildPublicBusinessHoursStatus(config),
    },
    catalog: applyCategoryOrder(rawCatalog, categoryOrder),
  };
}

export type ZeloMenuStoreSettings = {
  logoUrl: string | null;
  companyName: string;
  companySpecialty: string;
  welcomeText: string | null;
  featuredEnabled: boolean;
  featuredProductIds: number[];
  categoryOrder: string[];
  availableProducts: Array<{ id: number; name: string; categoryName: string }>;
  availableCategories: string[];
};

export async function getZeloMenuStoreSettings(empresaId: string): Promise<ZeloMenuStoreSettings> {
  const [, perfilResult] = await Promise.all([
    loadAiSettingsFromDb(empresaId),
    getServiceSupabase()
      .from('empresa_perfil')
      .select('logo_url, zelomenu_welcome_text, zelomenu_featured_enabled, zelomenu_featured_product_ids, zelomenu_category_order')
      .eq('id', empresaId)
      .maybeSingle(),
  ]);
  const perfil = perfilResult.data as EmpresaPerfilZeloMenuRow | null;
  const config = getConfig(empresaId);
  const catalog = filterVisibleCatalog(config.catalogHierarchy);

  const availableProducts: Array<{ id: number; name: string; categoryName: string }> = [];
  for (const cat of catalog) {
    for (const p of cat.produtosDireto) {
      if (p.id != null) availableProducts.push({ id: p.id, name: p.name, categoryName: cat.nome });
    }
    for (const sub of cat.subcategorias) {
      for (const p of sub.produtos) {
        if (p.id != null) availableProducts.push({ id: p.id, name: p.name, categoryName: cat.nome });
      }
    }
  }

  return {
    logoUrl: perfil?.logo_url ?? null,
    companyName: config.name,
    companySpecialty: config.specialty,
    welcomeText: perfil?.zelomenu_welcome_text ?? null,
    featuredEnabled: perfil?.zelomenu_featured_enabled ?? false,
    featuredProductIds: Array.isArray(perfil?.zelomenu_featured_product_ids)
      ? (perfil.zelomenu_featured_product_ids as number[])
      : [],
    categoryOrder: Array.isArray(perfil?.zelomenu_category_order)
      ? (perfil.zelomenu_category_order as string[])
      : [],
    availableProducts,
    availableCategories: catalog.map((c) => c.nome),
  };
}

export async function updateZeloMenuStoreSettings(
  empresaId: string,
  patch: Partial<Pick<ZeloMenuStoreSettings, 'welcomeText' | 'featuredEnabled' | 'featuredProductIds' | 'categoryOrder'>>,
): Promise<void> {
  const update: Record<string, unknown> = {};
  if ('welcomeText' in patch) update.zelomenu_welcome_text = patch.welcomeText ?? null;
  if ('featuredEnabled' in patch) update.zelomenu_featured_enabled = patch.featuredEnabled;
  if ('featuredProductIds' in patch) update.zelomenu_featured_product_ids = patch.featuredProductIds;
  if ('categoryOrder' in patch) update.zelomenu_category_order = patch.categoryOrder;
  if (Object.keys(update).length === 0) return;
  const { error } = await getServiceSupabase().from('empresa_perfil').update(update).eq('id', empresaId);
  if (error) throw error;
}

export async function openPublicOrderCartSession(input: {
  slug: string;
  customerName?: string | null;
  customerPhone?: string | null;
  items?: ZeloMenuCartItemInput[];
  fulfillment?: Partial<ZeloMenuFulfillmentSnapshot> | null;
  paymentMethod?: string | null;
  observations?: string | null;
}): Promise<{
  sessionId: string;
  orderingId: string;
  revision: number;
  publicToken: string;
  publicPath: string;
} | null> {
  const empresaId = await resolveEmpresaIdBySlug(input.slug);
  if (!empresaId) return null;

  const items = normalizeIncomingItems(input.items ?? []);
  if (items.length === 0) throw new Error('EMPTY_CART');

  const customer: ZeloMenuCustomerSnapshot = {
    name: sanitizeText(input.customerName, 120),
    phone: sanitizeText(input.customerPhone, 40),
  };
  const resolved = await resolveSnapshots(empresaId, {
    items,
    fulfillment: input.fulfillment,
    paymentMethod: input.paymentMethod,
    observations: input.observations,
  });

  // Público não tem JID. source_ref é um id único por carrinho público.
  const sourceRef = `public:${randomUUID()}`;
  const now = new Date().toISOString();
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .insert({
      empresa_id: empresaId,
      context: 'public_order',
      state: 'cart_open',
      source_ref: sourceRef,
      customer_snapshot: customer,
      cart_snapshot: resolved.cart,
      fulfillment_snapshot: resolved.fulfillment,
      pricing_snapshot: resolved.pricing,
      payment_snapshot: resolved.payment,
      metadata: { source: 'public_link', slug: normalizeZeloMenuSlug(input.slug) },
      revision: 1,
      created_at: now,
      updated_at: now,
    })
    .select(CART_SESSION_COLUMNS)
    .single();
  if (error) throw error;
  const sessionRow = data as SessionRow;

  const tokenData = await issueFreshCartToken(sessionRow.id, sessionRow.revision, now);
  return {
    sessionId: sessionRow.id,
    orderingId: sessionRow.ordering_id,
    revision: sessionRow.revision,
    publicToken: tokenData.token,
    publicPath: buildPublicCartPath(tokenData.token),
  };
}

export async function openWhatsAppCartSession(input: OpenWhatsAppCartInput): Promise<{
  sessionId: string;
  orderingId: string;
  revision: number;
  publicToken: string;
  publicPath: string;
}> {
  const remoteJid = sanitizeText(input.remoteJid, 160);
  if (!remoteJid) throw new Error('INVALID_REMOTE_JID');

  const customer: ZeloMenuCustomerSnapshot = {
    name: sanitizeText(input.customerName, 120),
    phone: sanitizeText(input.customerPhone, 40),
  };
  const resolved = await resolveSnapshots(input.empresaId, {
    items: normalizeIncomingItems(input.items ?? []),
    fulfillment: input.fulfillment,
    paymentMethod: input.paymentMethod,
    observations: input.observations,
  });

  const existing = await findActiveWhatsAppSession(input.empresaId, remoteJid);
  const now = new Date().toISOString();
  let sessionRow: SessionRow;

  if (existing) {
    const nextRevision = Number(existing.revision || 1) + 1;
    const { data, error } = await getServiceSupabase()
      .from('zelomenu_cart_sessions')
      .update({
        state: 'cart_open',
        customer_snapshot: customer,
        cart_snapshot: resolved.cart,
        fulfillment_snapshot: resolved.fulfillment,
        pricing_snapshot: resolved.pricing,
        payment_snapshot: resolved.payment,
        metadata: {
          source: input.source ?? 'ai_prebuilt',
          remoteJid,
        },
        revision: nextRevision,
        last_revalidated_at: null,
        last_revalidation: null,
        updated_at: now,
      })
      .eq('id', existing.id)
      .select(CART_SESSION_COLUMNS)
      .single();
    if (error) throw error;
    sessionRow = data as SessionRow;
  } else {
    const { data, error } = await getServiceSupabase()
      .from('zelomenu_cart_sessions')
      .insert({
        empresa_id: input.empresaId,
        context: 'whatsapp_order',
        state: 'cart_open',
        source_ref: remoteJid,
        customer_snapshot: customer,
        cart_snapshot: resolved.cart,
        fulfillment_snapshot: resolved.fulfillment,
        pricing_snapshot: resolved.pricing,
        payment_snapshot: resolved.payment,
        metadata: {
          source: input.source ?? 'ai_prebuilt',
          remoteJid,
        },
        revision: 1,
        created_at: now,
        updated_at: now,
      })
      .select(CART_SESSION_COLUMNS)
      .single();
    if (error) throw error;
    sessionRow = data as SessionRow;
  }

  const tokenData = await issueFreshCartToken(sessionRow.id, sessionRow.revision, now);

  return {
    sessionId: sessionRow.id,
    orderingId: sessionRow.ordering_id,
    revision: sessionRow.revision,
    publicToken: tokenData.token,
    publicPath: buildPublicCartPath(tokenData.token),
  };
}

export async function getWhatsAppCartReviewSession(input: {
  empresaId: string;
  remoteJid: string;
  shortId?: string | null;
}): Promise<ReviewCartResponse | null> {
  const remoteJid = sanitizeText(input.remoteJid, 160);
  const shortId = sanitizeText(input.shortId, 8)?.replace(/^#/, '').toUpperCase() ?? null;
  if (!remoteJid) throw new Error('INVALID_REMOTE_JID');

  const { data, error } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .select(CART_SESSION_COLUMNS)
    .eq('empresa_id', input.empresaId)
    .eq('context', 'whatsapp_order')
    .eq('source_ref', remoteJid)
    .order('updated_at', { ascending: false })
    .limit(20);
  if (error) throw error;

  const rows = (data ?? []) as SessionRow[];
  if (rows.length === 0) return null;
  const matchedRow = shortId
    ? rows.find((row) => row.ordering_id.slice(0, 8).toUpperCase() === shortId) ?? null
    : rows[0] ?? null;
  if (!matchedRow) return null;

  let revalidation = parseRevalidation(matchedRow.last_revalidation);
  if (matchedRow.state === 'confirmed_waiting_review' || matchedRow.state === 'confirmed_waiting_payment') {
    const session = mapSessionRow(matchedRow);
    revalidation = await runRevalidation({
      ...session,
      metadata: { ...session.metadata, empresaId: matchedRow.empresa_id },
    });
    await persistRevalidation(matchedRow.id, revalidation);
    matchedRow.last_revalidated_at = revalidation.checkedAt;
    matchedRow.last_revalidation = revalidation;
    matchedRow.updated_at = revalidation.checkedAt;
  }

  return buildReviewResponse(matchedRow, revalidation);
}

export async function acceptWhatsAppCartReviewSession(input: {
  empresaId: string;
  sessionId: string;
  acceptedByUserId: string;
  acceptedByName?: string | null;
}): Promise<ReviewCartAcceptResponse | null> {
  const sessionRow = await findSessionById(input.sessionId);
  if (!sessionRow || sessionRow.empresa_id !== input.empresaId || sessionRow.context !== 'whatsapp_order') {
    return null;
  }

  if (sessionRow.state === 'accepted') {
    return {
      ...buildReviewResponse(sessionRow, parseRevalidation(sessionRow.last_revalidation)),
      accepted: true,
      alreadyAccepted: true,
      customerMessage: null,
    };
  }

  if (sessionRow.state !== 'confirmed_waiting_review' && sessionRow.state !== 'confirmed_waiting_payment') {
    throw new Error('REVIEW_NOT_READY');
  }

  const current = mapSessionRow(sessionRow);
  const revalidation = await runRevalidation({
    ...current,
    metadata: { ...current.metadata, empresaId: sessionRow.empresa_id },
  });
  await persistRevalidation(sessionRow.id, revalidation);

  if (!revalidation.ok || !revalidation.previewCart || !revalidation.previewPricing || !revalidation.previewPayment) {
    const now = new Date().toISOString();
    const { data, error } = await getServiceSupabase()
      .from('zelomenu_cart_sessions')
      .update({
        state: 'needs_customer_adjustment',
        last_revalidated_at: revalidation.checkedAt,
        last_revalidation: revalidation,
        updated_at: now,
      })
      .eq('id', sessionRow.id)
      .select(CART_SESSION_COLUMNS)
      .single();
    if (error) throw error;
    throw new Error('REVIEW_NEEDS_ADJUSTMENT');
  }

  if (revalidation.previewPayment.pixReceiptRequired && !revalidation.previewPayment.pixReceiptApproved) {
    const { data, error } = await getServiceSupabase()
      .from('zelomenu_cart_sessions')
      .update({
        last_revalidated_at: revalidation.checkedAt,
        last_revalidation: revalidation,
        payment_snapshot: revalidation.previewPayment,
        updated_at: revalidation.checkedAt,
      })
      .eq('id', sessionRow.id)
      .select(CART_SESSION_COLUMNS)
      .single();
    if (error) throw error;
    throw new Error('PIX_RECEIPT_PENDING');
  }

  const nextCustomer: ZeloMenuCustomerSnapshot = current.customer;
  const nextFulfillment = current.fulfillment;
  const canonicalOrder = await createAcceptedOrderRecord({
    sessionId: sessionRow.id,
    expectedRevision: sessionRow.revision,
    empresaId: sessionRow.empresa_id,
    context: 'whatsapp_order',
    customer: nextCustomer,
    cart: revalidation.previewCart,
    fulfillment: nextFulfillment,
    pricing: revalidation.previewPricing,
    payment: revalidation.previewPayment,
  });
  if (canonicalOrder.orderStatus === 'pending_review') {
    const { error: acceptError } = await getServiceSupabase().rpc('accept_zelo_order', {
      p_order_id: canonicalOrder.orderId,
      p_expected_revision: canonicalOrder.revision,
      p_actor_id: input.acceptedByUserId,
    });
    if (acceptError) throw acceptError;
  }
  const orderId = canonicalOrder.orderId;

  void Promise.resolve()
    .catch((err) => console.error('[ZeloMenu] stock decrement failed after accept:', err));

  // T5/ZLM-301: bundle (pdv_core) também recebe o ticket de cozinha no PDV. Chat-only não.
  void Promise.resolve({
    empresaId: sessionRow.empresa_id,
    zelochatOrderId: orderId,
    context: 'whatsapp_order',
    customer: nextCustomer,
    cart: revalidation.previewCart,
  }).catch((err) => console.error('[ZeloMenu] pedidos materialization failed after accept:', err));

  void notifyManagerForAcceptedOrder({
    empresaId: sessionRow.empresa_id,
    customer: nextCustomer,
    cart: revalidation.previewCart,
    fulfillment: nextFulfillment,
    pricing: revalidation.previewPricing,
    payment: revalidation.previewPayment,
  }).catch((err) => console.error('[ZeloMenu] manager notification failed after accept:', err));

  const now = new Date().toISOString();
  const mergedMetadata = {
    ...parseMetadata(sessionRow.metadata),
    acceptedAt: now,
    acceptedByUserId: input.acceptedByUserId,
    acceptedByName: sanitizeText(input.acceptedByName, 120),
    productionOrderId: orderId,
  };
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .update({
      state: 'accepted',
      cart_snapshot: revalidation.previewCart,
      pricing_snapshot: revalidation.previewPricing,
      payment_snapshot: revalidation.previewPayment,
      metadata: mergedMetadata,
      last_revalidated_at: revalidation.checkedAt,
      last_revalidation: revalidation,
      archived_at: now,
      updated_at: now,
    })
    .eq('id', sessionRow.id)
    .select(CART_SESSION_COLUMNS)
    .single();
  if (error) throw error;

  const acceptedRow = data as SessionRow;
  const customerMessage = buildAcceptedCartCustomerMessage({
    orderId,
    cart: revalidation.previewCart,
    fulfillment: nextFulfillment,
    pricing: revalidation.previewPricing,
    payment: revalidation.previewPayment,
  });

  let waMessageId: string | undefined;
  let sendOk = true;
  try {
    waMessageId = await sendTextMessage(acceptedRow.source_ref, customerMessage, acceptedRow.empresa_id);
  } catch (sendErr) {
    sendOk = false;
    console.error('[ZeloMenu] acceptWhatsAppCartReviewSession: customer message failed after accept:', sendErr);
  }
  await addAssistantMessage(
    acceptedRow.source_ref,
    sendOk ? customerMessage : `[FALHA NO ENVIO — reenviar manualmente]\n${customerMessage}`,
    undefined,
    acceptedRow.empresa_id,
    undefined,
    { waMessageId },
  );

  return {
    ...buildReviewResponse(acceptedRow, revalidation),
    accepted: true,
    alreadyAccepted: false,
    customerMessage,
  };
}

export async function getPublicCartSession(token: string): Promise<PublicCartResponse | null> {
  const normalized = normalizePublicCartToken(token);
  if (!normalized) return null;
  const tokenRow = await findTokenRowByHash(normalized);
  if (!tokenRow) return null;
  const sessionRow = await findSessionById(tokenRow.session_id);
  if (!sessionRow || sessionRow.archived_at) return null;
  return buildPublicResponse(normalized, sessionRow, tokenRow);
}

export async function updatePublicCartSession(token: string, patch: PublicCartPatch): Promise<PublicCartResponse | null> {
  const normalized = normalizePublicCartToken(token);
  if (!normalized) return null;
  const tokenRow = await findTokenRowByHash(normalized);
  if (!tokenRow) return null;
  const sessionRow = await findSessionById(tokenRow.session_id);
  if (!sessionRow || sessionRow.archived_at) return null;
  if (sessionRow.current_token_hash !== tokenRow.token_hash || tokenRow.revoked_at) {
    throw new Error('STALE_CART_TOKEN');
  }
  if (sessionRow.state !== 'cart_open') {
    throw new Error('CART_ALREADY_CONFIRMED');
  }

  const current = mapSessionRow(sessionRow);
  const customer: ZeloMenuCustomerSnapshot = {
    name: patch.customerName === undefined ? current.customer.name : sanitizeText(patch.customerName, 120),
    phone: patch.customerPhone === undefined ? current.customer.phone : sanitizeText(patch.customerPhone, 40),
  };
  const resolved = await resolveSnapshots(sessionRow.empresa_id, {
    items: patch.items === undefined ? toCartItemInputs(current.cart) : normalizeIncomingItems(patch.items),
    fulfillment: patch.fulfillment === undefined ? current.fulfillment : patch.fulfillment,
    paymentMethod: patch.paymentMethod === undefined ? current.payment.declaredMethod : patch.paymentMethod,
    observations: patch.observations === undefined ? current.cart.observations : patch.observations,
  });
  const nextRevision = current.revision + 1;
  const now = new Date().toISOString();
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .update({
      customer_snapshot: customer,
      cart_snapshot: resolved.cart,
      fulfillment_snapshot: resolved.fulfillment,
      pricing_snapshot: resolved.pricing,
      payment_snapshot: resolved.payment,
      revision: nextRevision,
      last_revalidated_at: null,
      last_revalidation: null,
      updated_at: now,
    })
    .eq('id', sessionRow.id)
    .select(CART_SESSION_COLUMNS)
    .single();
  if (error) throw error;
  return buildPublicResponse(normalized, data as SessionRow, tokenRow);
}

export async function confirmPublicCartSession(token: string): Promise<PublicCartConfirmResponse | null> {
  const normalized = normalizePublicCartToken(token);
  if (!normalized) return null;
  const tokenRow = await findTokenRowByHash(normalized);
  if (!tokenRow) return null;
  const sessionRow = await findSessionById(tokenRow.session_id);
  if (!sessionRow || sessionRow.archived_at) return null;
  if (sessionRow.current_token_hash !== tokenRow.token_hash || tokenRow.revoked_at) {
    throw new Error('STALE_CART_TOKEN');
  }

  if (sessionRow.state !== 'cart_open') {
    const isAlreadyConfirmed = sessionRow.state === 'confirmed_waiting_review'
      || sessionRow.state === 'confirmed_waiting_payment'
      || sessionRow.state === 'accepted';
    if (!isAlreadyConfirmed) {
      throw new Error('CART_ALREADY_CLOSED');
    }
    const payload = await buildPublicResponse(normalized, sessionRow, tokenRow);
    return {
      ...payload,
      confirmation: {
        confirmed: true,
        alreadyConfirmed: true,
        state: payload.session.state,
        customerMessage: null,
      },
    };
  }

  const current = mapSessionRow(sessionRow);
  if (current.context === 'public_order') {
    const detailError = firstZeloMenuCheckoutError(validateZeloMenuCheckoutDetails({
      customerName: current.customer.name,
      customerPhone: current.customer.phone,
      fulfillmentType: current.fulfillment.type,
      deliveryAddress: current.fulfillment.deliveryAddress,
      pickupDate: current.fulfillment.pickupDate,
      pickupTime: current.fulfillment.pickupTime,
    }));
    if (detailError) throw new Error('CUSTOMER_DETAILS_REQUIRED');
  }
  const revalidation = await runRevalidation({
    ...current,
    metadata: { ...current.metadata, empresaId: sessionRow.empresa_id },
  });

  if (!revalidation.ok || !revalidation.previewCart || !revalidation.previewPricing || !revalidation.previewPayment) {
    await persistRevalidation(current.id, revalidation);
    const payload = await buildPublicResponse(normalized, sessionRow, tokenRow);
    return {
      ...payload,
      confirmation: {
        confirmed: false,
        alreadyConfirmed: false,
        state: payload.session.state,
        customerMessage: null,
      },
    };
  }

  const nextState = resolveConfirmedCartState(revalidation.previewPayment);
  const now = new Date().toISOString();
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .update({
      state: nextState,
      cart_snapshot: revalidation.previewCart,
      pricing_snapshot: revalidation.previewPricing,
      payment_snapshot: revalidation.previewPayment,
      last_revalidated_at: revalidation.checkedAt,
      last_revalidation: revalidation,
      confirmed_at: now,
      updated_at: now,
    })
    .eq('id', sessionRow.id)
    .select(CART_SESSION_COLUMNS)
    .single();
  if (error) throw error;

  const confirmedRow = data as SessionRow;
  const customerMessage = buildConfirmedCartCustomerMessage({
    orderingId: confirmedRow.ordering_id,
    state: nextState,
    cart: revalidation.previewCart,
    fulfillment: current.fulfillment,
    pricing: revalidation.previewPricing,
    payment: revalidation.previewPayment,
  });

  let waMessageId: string | undefined;
  let sendOk = true;
  if (confirmedRow.context === 'whatsapp_order') {
    try {
      waMessageId = await sendTextMessage(confirmedRow.source_ref, customerMessage, confirmedRow.empresa_id);
    } catch (sendErr) {
      sendOk = false;
      console.error('[ZeloMenu] confirmPublicCartSession: customer message failed after confirmation:', sendErr);
    }
    await addAssistantMessage(
      confirmedRow.source_ref,
      sendOk ? customerMessage : `[FALHA NO ENVIO — reenviar manualmente]\n${customerMessage}`,
      undefined,
      confirmedRow.empresa_id,
      undefined,
      { waMessageId },
    );
  } else if (confirmedRow.context === 'public_order') {
    // Público não tem thread de chat para "aceite": o pedido confirmado cai
    // direto na tela de Pedidos (D-037). Materializa zelochat_orders, baixa
    // estoque, notifica o gerente e avisa o cliente no WhatsApp dele.
    const customer = current.customer;
    try {
      const canonicalOrder = await createAcceptedOrderRecord({
        sessionId: confirmedRow.id,
        expectedRevision: confirmedRow.revision,
        empresaId: confirmedRow.empresa_id,
        context: 'public_order',
        customer,
        cart: revalidation.previewCart,
        fulfillment: current.fulfillment,
        pricing: revalidation.previewPricing,
        payment: revalidation.previewPayment,
      });
      const orderId = canonicalOrder.orderId;
      await getServiceSupabase()
        .from('zelomenu_cart_sessions')
        .update({ metadata: { ...parseMetadata(confirmedRow.metadata), productionOrderId: orderId } })
        .eq('id', confirmedRow.id);
      void Promise.resolve()
        .catch((err) => console.error('[ZeloMenu] public_order stock decrement failed:', err));
      void Promise.resolve({
        empresaId: confirmedRow.empresa_id,
        zelochatOrderId: orderId,
        context: 'public_order',
        customer,
        cart: revalidation.previewCart,
      }).catch((err) => console.error('[ZeloMenu] public_order pedidos materialization failed:', err));
      void notifyManagerForAcceptedOrder({
        empresaId: confirmedRow.empresa_id,
        customer,
        cart: revalidation.previewCart,
        fulfillment: current.fulfillment,
        pricing: revalidation.previewPricing,
        payment: revalidation.previewPayment,
      }).catch((err) => console.error('[ZeloMenu] public_order manager notify failed:', err));
    } catch (orderErr) {
      console.error('[ZeloMenu] public_order: failed to materialize order on confirm:', orderErr);
    }
    const phone = (customer.phone || '').replace(/\D/g, '');
    if (phone) {
      const customerJid = `${phone.startsWith('55') ? phone : `55${phone}`}@s.whatsapp.net`;
      try {
        await sendTextMessage(customerJid, customerMessage, confirmedRow.empresa_id);
      } catch (sendErr) {
        console.error('[ZeloMenu] public_order: customer WhatsApp notice failed:', sendErr);
      }
    }
  }

  const payload = await buildPublicResponse(normalized, confirmedRow, tokenRow);
  return {
    ...payload,
    confirmation: {
      confirmed: true,
      alreadyConfirmed: false,
      state: nextState,
      customerMessage,
    },
  };
}

// ─── ZLM-105 — Recuperação de carrinho abandonado ──────────────────────────────
//
// Um carrinho `cart_open` parado por mais de 2h (e até 24h) é "abandonado": o
// cliente recebeu o link mas não confirmou. O sweeper envia UMA única mensagem
// de lembrete com um link fresco. Invariantes (D-064 / ZLM-105):
//   - no máximo uma recuperação por carrinho (flag `metadata.recoveryNudgeSentAt`);
//   - nunca para carrinho confirmado/aguardando pagamento/aceito/cancelado/arquivado;
//   - respeita o gate global da IA — não manda nudge automático com a IA desligada
//     (kill-switch) nem fora da janela agendada (evita lembrete às 3h da manhã).

const RECOVERY_NUDGE_METADATA_KEY = 'recoveryNudgeSentAt';

function parseRecoveryNudgeSentAt(metadata: Record<string, unknown>): string | null {
  return typeof metadata[RECOVERY_NUDGE_METADATA_KEY] === 'string'
    ? (metadata[RECOVERY_NUDGE_METADATA_KEY] as string)
    : null;
}

export async function listAbandonedCartCandidates(params: {
  minAgeMs?: number;
  maxAgeMs?: number;
  limit?: number;
} = {}): Promise<SessionRow[]> {
  const now = Date.now();
  const minAge = params.minAgeMs ?? ABANDONED_CART_RECOVERY_MIN_AGE_MS;
  const maxAge = params.maxAgeMs ?? ABANDONED_CART_RECOVERY_MAX_AGE_MS;
  const limit = params.limit ?? 100;
  const olderThan = new Date(now - minAge).toISOString();
  const newerThan = new Date(now - maxAge).toISOString();

  const { data, error } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .select(CART_SESSION_COLUMNS)
    .eq('context', 'whatsapp_order')
    .eq('state', 'cart_open')
    .is('archived_at', null)
    .is(`metadata->>${RECOVERY_NUDGE_METADATA_KEY}`, null)
    .lt('updated_at', olderThan)
    .gt('updated_at', newerThan)
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as SessionRow[];
}

/**
 * Send the one-shot recovery nudge for a single abandoned cart, idempotently.
 *
 * Returns:
 *   - `'sent'`    — nudge delivered (or queued) and recorded in the chat.
 *   - `'skipped'` — not eligible, AI globally off, or another tick already claimed it.
 *   - `'failed'`  — the claim succeeded but the outbound WhatsApp send threw.
 *
 * The race-safe claim stamps `metadata.recoveryNudgeSentAt` only while the cart
 * is still `cart_open`, unarchived and un-nudged, so a second tick (or a
 * concurrent confirm) can never produce a duplicate nudge.
 */
export async function recoverAbandonedCart(sessionRow: SessionRow): Promise<'sent' | 'skipped' | 'failed'> {
  if (sessionRow.context !== 'whatsapp_order') return 'skipped';

  const metadata = parseMetadata(sessionRow.metadata);
  if (!isCartEligibleForAbandonedRecovery({
    state: sessionRow.state,
    archivedAt: sessionRow.archived_at,
    recoveryNudgeSentAt: parseRecoveryNudgeSentAt(metadata),
    updatedAt: sessionRow.updated_at,
  })) {
    return 'skipped';
  }

  // Respeita o operador: sem nudge automático com a IA desligada ou fora da
  // janela. Checamos ANTES de marcar a flag para que um carrinho abandonado em
  // horário humano ainda possa ser recuperado quando a automação voltar.
  await loadAiSettingsFromDb(sessionRow.empresa_id);
  if (!isAiGloballyEnabledNow(sessionRow.empresa_id)) return 'skipped';

  const now = new Date().toISOString();
  const mergedMetadata = { ...metadata, [RECOVERY_NUDGE_METADATA_KEY]: now };
  const { data: claimed, error: claimError } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .update({ metadata: mergedMetadata })
    .eq('id', sessionRow.id)
    .eq('state', 'cart_open')
    .is('archived_at', null)
    .is(`metadata->>${RECOVERY_NUDGE_METADATA_KEY}`, null)
    .select(CART_SESSION_COLUMNS)
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return 'skipped';

  const claimedRow = claimed as SessionRow;
  const session = mapSessionRow(claimedRow);
  const tokenData = await issueFreshCartToken(claimedRow.id, claimedRow.revision, now);
  const publicUrl = buildPublicCartUrl(getPublicAppBaseUrl(), tokenData.token);
  const itemsLine = session.cart.items.length > 0
    ? session.cart.items.map((item) => `${item.quantity}x ${formatModifierAwareCartItem(item)}`).join(', ')
    : null;
  const message = buildAbandonedCartRecoveryMessage({
    customerName: session.customer.name,
    itemsLine,
    publicUrl,
  });

  let waMessageId: string | undefined;
  let sendOk = true;
  try {
    waMessageId = await sendTextMessage(claimedRow.source_ref, message, claimedRow.empresa_id);
  } catch (sendErr) {
    sendOk = false;
    console.error('[ZeloMenu] recoverAbandonedCart: recovery message failed:', sendErr);
  }
  await addAssistantMessage(
    claimedRow.source_ref,
    sendOk ? message : `[FALHA NO ENVIO — reenviar manualmente]\n${message}`,
    undefined,
    claimedRow.empresa_id,
    undefined,
    { waMessageId },
  );

  return sendOk ? 'sent' : 'failed';
}

// ─── Expiração / limpeza de carrinho abandonado (housekeeping) ──────────────────
//
// Carrinho `cart_open` parado por mais de 24h é lixo: o cliente nunca confirmou.
// Fase 1 arquiva (soft) e marca `metadata.archivedReason='abandoned_expiry'`.
// Fase 2 apaga em definitivo só os arquivados-por-abandono após 90 dias.
//
// NUNCA toca em pedido confirmado/aceito/cancelado/rejeitado nem em
// `needs_customer_adjustment` — pedidos confirmados ficam preservados para o
// futuro "Peça novamente". O purge filtra pelo marcador (não pelo estado), então
// um `accepted` (que também tem `archived_at`) jamais entra na fase 2.

/**
 * Fase 1 — arquiva carrinhos `cart_open` parados há mais de 24h (todos os
 * contextos). Idempotente e race-safe: a cláusula da UPDATE exige `cart_open` +
 * `archived_at IS NULL`, então um confirm concorrente nunca é sobrescrito.
 * Faz merge por linha do `metadata` para preservar campos (`source`, etc.).
 * Retorna o número de carrinhos arquivados.
 */
export async function expireStaleCartOpenSessions(params: { limit?: number } = {}): Promise<number> {
  const limit = params.limit ?? 100;
  const cutoff = new Date(Date.now() - ABANDONED_CART_EXPIRY_AGE_MS).toISOString();

  const { data, error } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .select('id, metadata')
    .eq('state', 'cart_open')
    .is('archived_at', null)
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  const rows = (data ?? []) as Array<{ id: string; metadata: unknown }>;
  let archived = 0;
  for (const row of rows) {
    const now = new Date().toISOString();
    const mergedMetadata = {
      ...parseMetadata(row.metadata),
      archivedReason: ABANDONED_CART_ARCHIVED_REASON,
      archivedAt: now,
    };
    const { data: updated, error: updateError } = await getServiceSupabase()
      .from('zelomenu_cart_sessions')
      .update({ state: 'archived', archived_at: now, updated_at: now, metadata: mergedMetadata })
      .eq('id', row.id)
      .eq('state', 'cart_open')
      .is('archived_at', null)
      .select('id')
      .maybeSingle();
    if (updateError) throw updateError;
    if (updated) archived++;
  }
  return archived;
}

/**
 * Fase 2 — apaga em definitivo os carrinhos que ESTA rotina arquivou
 * (`metadata.archivedReason='abandoned_expiry'`) e que estão arquivados há mais
 * de 90 dias. O filtro por marcador garante que nenhum pedido confirmado/aceito
 * é apagado. Retorna o número de linhas removidas.
 */
export async function purgeExpiredArchivedCarts(params: { limit?: number } = {}): Promise<number> {
  const limit = params.limit ?? 100;
  const cutoff = new Date(Date.now() - ABANDONED_CART_PURGE_AGE_MS).toISOString();

  const { data, error } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .select('id')
    .eq('metadata->>archivedReason', ABANDONED_CART_ARCHIVED_REASON)
    .lt('archived_at', cutoff)
    .limit(limit);
  if (error) throw error;

  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (ids.length === 0) return 0;

  const { error: deleteError } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .delete()
    .in('id', ids);
  if (deleteError) throw deleteError;
  return ids.length;
}
