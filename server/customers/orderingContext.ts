import type {
  CustomerOrderingAddress,
  CustomerOrderingContextSnapshot,
  CustomerOrderingFrequentItem,
  CustomerOrderingHabitualTime,
  CustomerOrderingLastOrder,
  CustomerOrderingLastOrderItem,
  CustomerOrderingModifierGroup,
  CustomerOrderingOverrides,
} from '../../src/types.js';

export const COMMITTED_ORDER_STATUSES = [
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
] as const;

export type CommittedOrderStatus = (typeof COMMITTED_ORDER_STATUSES)[number];

export interface CustomerOrderingOrderItemRow {
  id: string;
  product_id: string | number | null;
  name: string;
  unit_price: string | number | null;
  quantity: string | number;
  subtotal: string | number | null;
  modifiers: unknown;
  position: string | number | null;
}

export interface CustomerOrderingOrderRow {
  id: string;
  empresa_id: string;
  pessoa_id: string | null;
  status: string;
  created_at: string;
  closed_at: string | null;
  fulfillment: unknown;
  payment: unknown;
  subtotal: string | number | null;
  delivery_fee: string | number | null;
  discount: string | number | null;
  total: string | number | null;
  observations: string | null;
  zelo_order_items: CustomerOrderingOrderItemRow[] | null;
}

export interface CustomerOrderingContextAdapter {
  listCommittedOrders(input: {
    empresaId: string;
    pessoaId: string;
    limit: number;
    statuses: readonly string[];
  }): Promise<CustomerOrderingOrderRow[]>;
  getOrderingOverrides(input: { empresaId: string; pessoaId: string }): Promise<unknown>;
  customerBelongsToTenant(input: { empresaId: string; pessoaId: string; ownerUserId: string }): Promise<boolean>;
  saveOrderingOverrides(input: {
    empresaId: string;
    pessoaId: string;
    ownerUserId: string;
    overrides: CustomerOrderingOverrides;
  }): Promise<void>;
}

export type CustomerOrderingOverridesPatch = Partial<Record<keyof CustomerOrderingOverrides, unknown>>;

export class OrderingOverridesValidationError extends Error {
  readonly code = 'INVALID_ORDERING_OVERRIDES';
  constructor(message: string) {
    super(message);
    this.name = 'OrderingOverridesValidationError';
  }
}

export function isOrderingOverridesValidationError(error: unknown): error is OrderingOverridesValidationError {
  return error instanceof OrderingOverridesValidationError;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function optionalText(source: Record<string, unknown>, keys: string[], maxLength: number): string | null {
  for (const key of keys) {
    const value = cleanText(source[key], maxLength);
    if (value) return value;
  }
  return null;
}

function normalizeAddress(value: unknown): CustomerOrderingAddress | null {
  if (typeof value === 'string') {
    const address = cleanText(value, 240);
    return address ? {
      address,
      neighborhood: null,
      complement: null,
      city: null,
      state: null,
      postalCode: null,
      reference: null,
      display: address,
    } : null;
  }
  const source = record(value);
  const address = optionalText(source, ['address', 'deliveryAddress', 'line1', 'street'], 240);
  if (!address) return null;
  const neighborhood = optionalText(source, ['neighborhood', 'deliveryNeighborhood', 'district'], 120);
  const complement = optionalText(source, ['complement', 'addressComplement'], 120);
  const city = optionalText(source, ['city'], 120);
  const state = optionalText(source, ['state'], 40);
  const postalCode = optionalText(source, ['postalCode', 'zipCode', 'cep'], 20);
  const reference = optionalText(source, ['reference', 'landmark'], 160);
  const display = [address, neighborhood, city && state ? `${city}/${state}` : city ?? state]
    .filter(Boolean)
    .join(' — ');
  return { address, neighborhood, complement, city, state, postalCode, reference, display };
}

function addressFromFulfillment(value: unknown): CustomerOrderingAddress | null {
  const fulfillment = record(value);
  const nested = fulfillment.deliveryAddress ?? fulfillment.address;
  if (nested && typeof nested === 'object') return normalizeAddress(nested);
  const address = cleanText(nested, 240);
  if (!address) return null;
  return normalizeAddress({
    address,
    neighborhood: fulfillment.deliveryNeighborhood ?? fulfillment.neighborhood,
    complement: fulfillment.deliveryComplement ?? fulfillment.complement,
    city: fulfillment.deliveryCity ?? fulfillment.city,
    state: fulfillment.deliveryState ?? fulfillment.state,
    postalCode: fulfillment.deliveryPostalCode ?? fulfillment.postalCode ?? fulfillment.cep,
    reference: fulfillment.deliveryReference ?? fulfillment.reference,
  });
}

function normalizeFulfillmentType(value: unknown): 'delivery' | 'pickup' | null {
  return value === 'delivery' || value === 'pickup' ? value : null;
}

function parseTime(value: unknown): CustomerOrderingHabitualTime | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{2}):(\d{2})$/u.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { minutes: hour * 60 + minute, label: `${match[1]}:${match[2]}` };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function derivedHabitualTime(orders: CustomerOrderingOrderRow[]): CustomerOrderingHabitualTime | null {
  const samples = orders
    .map((item) => parseTime(record(item.fulfillment).pickupTime ?? record(item.fulfillment).pickup_time))
    .filter((value): value is CustomerOrderingHabitualTime => Boolean(value));
  if (samples.length < 2) return null;
  const minutes = Math.round(median(samples.map((sample) => sample.minutes)) ?? 0);
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  return { minutes, label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

function recurrenceMedianDays(orders: CustomerOrderingOrderRow[]): number | null {
  const timestamps = orders.map((item) => Date.parse(item.created_at)).filter(Number.isFinite).sort((a, b) => a - b);
  if (timestamps.length < 2) return null;
  const intervals = timestamps.slice(1).map((timestamp, index) => (timestamp - timestamps[index]) / 86_400_000);
  const value = median(intervals);
  return value == null ? null : Math.round(value * 100) / 100;
}

function parseModifierGroups(value: unknown): CustomerOrderingModifierGroup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const group = record(candidate);
    const id = cleanText(group.groupId, 100);
    const name = cleanText(group.groupName, 160);
    if (!id || !name || !Array.isArray(group.selectedOptions)) return [];
    const options = group.selectedOptions.flatMap((optionCandidate) => {
      const option = record(optionCandidate);
      const optionId = cleanText(option.optionId, 100);
      const optionName = cleanText(option.optionName, 160);
      if (!optionId || !optionName) return [];
      return [{
        id: optionId,
        name: optionName,
        priceDelta: finiteNumber(option.priceDelta),
        quantity: Math.max(1, Math.trunc(finiteNumber(option.quantity) || 1)),
      }];
    });
    if (!options.length) return [];
    return [{ id, name, kind: group.kind === 'variacao' ? 'variacao' as const : 'adicional' as const, options }];
  });
}

function normalizeLastOrderItem(item: CustomerOrderingOrderItemRow): CustomerOrderingLastOrderItem {
  return {
    id: String(item.id),
    productId: item.product_id == null ? null : String(item.product_id),
    name: cleanText(item.name, 160) ?? 'Item',
    unitPrice: finiteNumber(item.unit_price),
    quantity: Math.max(0, Math.trunc(finiteNumber(item.quantity))),
    subtotal: finiteNumber(item.subtotal),
    position: Math.max(0, Math.trunc(finiteNumber(item.position))),
    modifiers: parseModifierGroups(item.modifiers),
  };
}

function normalizeLastOrder(order: CustomerOrderingOrderRow): CustomerOrderingLastOrder {
  const fulfillment = record(order.fulfillment);
  const payment = record(order.payment);
  return {
    id: order.id,
    status: order.status as CommittedOrderStatus,
    createdAt: order.created_at,
    closedAt: order.closed_at ?? null,
    fulfillment: {
      type: normalizeFulfillmentType(fulfillment.type),
      pickupDate: cleanText(fulfillment.pickupDate ?? fulfillment.pickup_date, 10),
      pickupTime: parseTime(fulfillment.pickupTime ?? fulfillment.pickup_time)?.label ?? null,
      address: addressFromFulfillment(fulfillment),
    },
    payment: {
      declaredMethod: cleanText(payment.declaredMethod ?? payment.method, 80),
      pixReceiptRequired: payment.pixReceiptRequired === true,
      pixReceiptApproved: payment.pixReceiptApproved === true,
    },
    totals: {
      subtotal: finiteNumber(order.subtotal),
      deliveryFee: finiteNumber(order.delivery_fee),
      discount: finiteNumber(order.discount),
      total: finiteNumber(order.total),
    },
    observations: cleanText(order.observations, 500),
    items: [...(order.zelo_order_items ?? [])]
      .sort((left, right) => finiteNumber(left.position) - finiteNumber(right.position) || String(left.id).localeCompare(String(right.id)))
      .map(normalizeLastOrderItem),
  };
}

function frequentItems(orders: CustomerOrderingOrderRow[]): CustomerOrderingFrequentItem[] {
  const aggregate = new Map<string, CustomerOrderingFrequentItem>();
  for (const order of orders) {
    const seen = new Set<string>();
    for (const item of order.zelo_order_items ?? []) {
      if (item.product_id == null) continue;
      const productId = String(item.product_id);
      const current = aggregate.get(productId) ?? {
        productId,
        name: cleanText(item.name, 160) ?? 'Item',
        orderFrequency: 0,
        totalQuantity: 0,
      };
      if (!seen.has(productId)) {
        current.orderFrequency += 1;
        seen.add(productId);
      }
      current.totalQuantity += Math.max(0, Math.trunc(finiteNumber(item.quantity)));
      aggregate.set(productId, current);
    }
  }
  return [...aggregate.values()]
    .sort((left, right) => right.orderFrequency - left.orderFrequency
      || right.totalQuantity - left.totalQuantity
      || left.productId.localeCompare(right.productId, 'en', { numeric: true }))
    .slice(0, 10);
}

function normalizeStoredOverrides(value: unknown): CustomerOrderingOverrides {
  const source = record(value);
  const normalized: CustomerOrderingOverrides = {};
  const fulfillmentType = normalizeFulfillmentType(source.fulfillmentType);
  if (fulfillmentType) normalized.fulfillmentType = fulfillmentType;
  const deliveryAddress = normalizeAddress(source.deliveryAddress);
  if (deliveryAddress) {
    const { display: _display, ...stored } = deliveryAddress;
    normalized.deliveryAddress = stored;
  }
  const paymentMethod = cleanText(source.paymentMethod, 80);
  if (paymentMethod) normalized.paymentMethod = paymentMethod;
  const habitualTime = parseTime(source.habitualTime)?.label;
  if (habitualTime) normalized.habitualTime = habitualTime;
  return normalized;
}

function validateOverridesPatch(value: unknown): CustomerOrderingOverridesPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OrderingOverridesValidationError('Informe os padrões que deseja alterar.');
  }
  const patch = value as Record<string, unknown>;
  const allowed = new Set<keyof CustomerOrderingOverrides>(['fulfillmentType', 'deliveryAddress', 'paymentMethod', 'habitualTime']);
  const keys = Object.keys(patch);
  if (!keys.length) throw new OrderingOverridesValidationError('Informe ao menos um padrão para alterar.');
  if (keys.some((key) => !allowed.has(key as keyof CustomerOrderingOverrides))) {
    throw new OrderingOverridesValidationError('Um dos padrões informados não pode ser alterado.');
  }
  const normalized: CustomerOrderingOverridesPatch = {};
  for (const key of keys as Array<keyof CustomerOrderingOverrides>) {
    const candidate = patch[key];
    if (candidate === null) { normalized[key] = null; continue; }
    if (key === 'fulfillmentType') {
      const fulfillmentType = normalizeFulfillmentType(candidate);
      if (!fulfillmentType) throw new OrderingOverridesValidationError('Escolha entrega ou retirada.');
      normalized.fulfillmentType = fulfillmentType;
    } else if (key === 'deliveryAddress') {
      if (typeof candidate !== 'object' || Array.isArray(candidate)) throw new OrderingOverridesValidationError('Informe um endereço válido.');
      const address = normalizeAddress(candidate);
      if (!address) throw new OrderingOverridesValidationError('Informe um endereço válido.');
      const { display: _display, ...stored } = address;
      normalized.deliveryAddress = stored;
    } else if (key === 'paymentMethod') {
      const method = cleanText(candidate, 80);
      if (!method) throw new OrderingOverridesValidationError('Informe uma forma de pagamento válida.');
      normalized.paymentMethod = method;
    } else {
      const time = parseTime(candidate)?.label;
      if (!time) throw new OrderingOverridesValidationError('Informe um horário válido no formato HH:MM.');
      normalized.habitualTime = time;
    }
  }
  return normalized;
}

function applyPatch(current: CustomerOrderingOverrides, patch: CustomerOrderingOverridesPatch): CustomerOrderingOverrides {
  const next: CustomerOrderingOverrides = { ...current };
  for (const [key, value] of Object.entries(patch) as Array<[keyof CustomerOrderingOverrides, unknown]>) {
    if (value === null) delete next[key];
    else Object.assign(next, { [key]: value });
  }
  return next;
}

function sortAndBoundOrders(rows: CustomerOrderingOrderRow[], empresaId: string, pessoaId: string): CustomerOrderingOrderRow[] {
  const committed = new Set<string>(COMMITTED_ORDER_STATUSES);
  return rows
    .filter((row) => row.empresa_id === empresaId && row.pessoa_id === pessoaId && committed.has(row.status))
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at) || right.id.localeCompare(left.id))
    .slice(0, 20);
}

export function createCustomerOrderingContext(adapter: CustomerOrderingContextAdapter) {
  const get = async (input: { empresaId: string; pessoaId: string }): Promise<CustomerOrderingContextSnapshot> => {
    const [rows, storedOverrides] = await Promise.all([
      adapter.listCommittedOrders({ ...input, limit: 20, statuses: COMMITTED_ORDER_STATUSES }),
      adapter.getOrderingOverrides(input),
    ]);
    const orders = sortAndBoundOrders(rows, input.empresaId, input.pessoaId);
    const overrides = normalizeStoredOverrides(storedOverrides);
    const last = orders[0] ?? null;
    const lastFulfillment = record(last?.fulfillment);
    const lastType = normalizeFulfillmentType(lastFulfillment.type);
    const lastAddress = lastType === 'delivery' ? addressFromFulfillment(lastFulfillment) : null;
    const lastPayment = cleanText(record(last?.payment).declaredMethod ?? record(last?.payment).method, 80);
    const derivedTime = derivedHabitualTime(orders);
    const recurrence = recurrenceMedianDays(orders);
    const items = frequentItems(orders);
    const fixedAddress = overrides.deliveryAddress ? normalizeAddress(overrides.deliveryAddress) : null;
    const fixedTime = overrides.habitualTime ? parseTime(overrides.habitualTime) : null;
    return {
      fulfillmentType: overrides.fulfillmentType
        ? { value: overrides.fulfillmentType, source: 'fixed' }
        : lastType ? { value: lastType, source: 'last_order' } : { value: null, source: 'none' },
      deliveryAddress: fixedAddress
        ? { value: fixedAddress, source: 'fixed' }
        : lastAddress ? { value: lastAddress, source: 'last_order' } : { value: null, source: 'none' },
      paymentMethod: overrides.paymentMethod
        ? { value: overrides.paymentMethod, source: 'fixed' }
        : lastPayment ? { value: lastPayment, source: 'last_order' } : { value: null, source: 'none' },
      habitualTime: fixedTime
        ? { value: fixedTime, source: 'fixed' }
        : derivedTime ? { value: derivedTime, source: 'derived' } : { value: null, source: 'none' },
      medianRecurrenceDays: recurrence == null
        ? { value: null, source: 'none' }
        : { value: recurrence, source: 'derived' },
      frequentItems: items.length
        ? { value: items, source: 'derived' }
        : { value: [], source: 'none' },
      lastOrder: last
        ? { value: normalizeLastOrder(last), source: 'last_order' }
        : { value: null, source: 'none' },
      overrides,
    };
  };

  const patchOverrides = async (input: {
    empresaId: string;
    pessoaId: string;
    ownerUserId: string;
    patch: unknown;
  }): Promise<CustomerOrderingContextSnapshot> => {
    const patch = validateOverridesPatch(input.patch);
    if (!await adapter.customerBelongsToTenant(input)) throw new Error('CUSTOMER_NOT_FOUND');
    const current = normalizeStoredOverrides(await adapter.getOrderingOverrides(input));
    const overrides = applyPatch(current, patch);
    await adapter.saveOrderingOverrides({ ...input, overrides });
    return get(input);
  };

  return { get, patchOverrides };
}

export type {
  CustomerOrderingContextSnapshot,
  CustomerOrderingOverrides,
};
