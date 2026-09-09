export type CustomerBuyerScope = 'buyers' | 'contacts' | 'all';
export type CustomerSortKey = 'orders' | 'value' | 'recent' | 'name';

export interface CustomerSegment {
  search?: string;
  buyers?: CustomerBuyerScope;
  minOrders?: number;
  maxOrders?: number;
  minTotalValue?: number;
  minDaysSinceLastOrder?: number;
  maxDaysSinceLastOrder?: number;
  hasWhatsApp?: boolean;
  tagIds?: string[];
  birthdayMonth?: number;
  origin?: string;
}

export const DEFAULT_CUSTOMER_SEGMENT: CustomerSegment = { buyers: 'buyers' };
export const DEFAULT_CUSTOMER_SORT: CustomerSortKey = 'orders';
export const CUSTOMER_SORT_KEYS: readonly CustomerSortKey[] = ['orders', 'value', 'recent', 'name'];
export const CUSTOMER_SORT_LABELS: Record<CustomerSortKey, string> = {
  orders: 'Mais pedidos',
  value: 'Maior valor gasto',
  recent: 'Compraram por último',
  name: 'Nome (A–Z)',
};
export const CUSTOMER_BUYER_SCOPE_LABELS: Record<CustomerBuyerScope, string> = {
  buyers: 'Somente quem já comprou',
  contacts: 'Somente contatos sem compra',
  all: 'Todos os cadastros',
};

export interface CustomerSegmentPreset {
  id: string;
  label: string;
  description: string;
  segment: CustomerSegment;
  sort: CustomerSortKey;
}

export const CUSTOMER_SEGMENT_PRESETS: readonly CustomerSegmentPreset[] = [
  {
    id: 'melhores',
    label: 'Melhores clientes',
    description: 'Já fizeram 3 pedidos ou mais',
    segment: { buyers: 'buyers', minOrders: 3 },
    sort: 'orders',
  },
  {
    id: 'sumiram',
    label: 'Sumiram',
    description: 'Já compraram, mas não pedem há mais de 30 dias',
    segment: { buyers: 'buyers', minDaysSinceLastOrder: 30 },
    sort: 'recent',
  },
  {
    id: 'uma-vez',
    label: 'Compraram uma vez só',
    description: 'Fizeram um único pedido e podem virar frequentes',
    segment: { buyers: 'buyers', minOrders: 1, maxOrders: 1 },
    sort: 'recent',
  },
  {
    id: 'da-semana',
    label: 'Compraram esta semana',
    description: 'Pediram nos últimos 7 dias',
    segment: { buyers: 'buyers', maxDaysSinceLastOrder: 7 },
    sort: 'recent',
  },
];

export interface CustomerSegmentSubject {
  name?: string | null;
  phone?: string | null;
  orderCount: number;
  totalValue: number;
  lastOrderAt?: string | null;
  tagIds?: string[];
  birthdayMonth?: number | null;
  origin?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RESERVED_SEARCH = /[(),.*%\\]/u;

export function isCustomerSortKey(value: unknown): value is CustomerSortKey {
  return typeof value === 'string' && (CUSTOMER_SORT_KEYS as readonly string[]).includes(value);
}

function invalidNumber(label: string): Error {
  return new Error(`${label} inválido.`);
}

function parseIntegerCriterion(input: Record<string, unknown>, key: 'minOrders' | 'maxOrders' | 'minDaysSinceLastOrder' | 'maxDaysSinceLastOrder', min: number, max: number, label: string, result: CustomerSegment): void {
  if (input[key] === undefined) return;
  if (typeof input[key] !== 'number' || !Number.isInteger(input[key]) || input[key] < min || input[key] > max) throw invalidNumber(label);
  result[key] = input[key];
}

export function parseCustomerSegment(value: unknown): CustomerSegment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Filtros inválidos.');
  const input = value as Record<string, unknown>;
  const allowed = new Set<keyof CustomerSegment>([
    'search', 'buyers', 'minOrders', 'maxOrders', 'minTotalValue',
    'minDaysSinceLastOrder', 'maxDaysSinceLastOrder', 'hasWhatsApp',
    'tagIds', 'birthdayMonth', 'origin',
  ]);
  for (const key of Object.keys(input)) if (!allowed.has(key as keyof CustomerSegment)) throw new Error(`Filtro não permitido: ${key}`);

  const result: CustomerSegment = {};
  if (input.search !== undefined) {
    if (typeof input.search !== 'string') throw new Error('Busca inválida.');
    const search = input.search.trim().slice(0, 120);
    if (RESERVED_SEARCH.test(search)) throw new Error('Busca contém caracteres reservados');
    if (search) result.search = search;
  }
  if (input.buyers !== undefined) {
    if (input.buyers !== 'buyers' && input.buyers !== 'contacts' && input.buyers !== 'all') throw new Error('Filtro de compras inválido.');
    result.buyers = input.buyers;
  }
  parseIntegerCriterion(input, 'minOrders', 0, 10000, 'Quantidade mínima de pedidos', result);
  parseIntegerCriterion(input, 'maxOrders', 0, 10000, 'Quantidade máxima de pedidos', result);
  if (result.minOrders !== undefined && result.maxOrders !== undefined && result.minOrders > result.maxOrders) throw new Error('Faixa de pedidos inválida.');
  if (input.minTotalValue !== undefined) {
    if (typeof input.minTotalValue !== 'number' || !Number.isFinite(input.minTotalValue) || input.minTotalValue < 0 || input.minTotalValue > 10_000_000) throw invalidNumber('Valor mínimo gasto');
    result.minTotalValue = input.minTotalValue;
  }
  parseIntegerCriterion(input, 'minDaysSinceLastOrder', 0, 3650, 'Mínimo de dias desde o último pedido', result);
  parseIntegerCriterion(input, 'maxDaysSinceLastOrder', 0, 3650, 'Máximo de dias desde o último pedido', result);
  if (result.minDaysSinceLastOrder !== undefined && result.maxDaysSinceLastOrder !== undefined && result.minDaysSinceLastOrder > result.maxDaysSinceLastOrder) throw new Error('Faixa de dias inválida.');
  if (input.hasWhatsApp !== undefined) {
    if (typeof input.hasWhatsApp !== 'boolean') throw new Error('Filtro de WhatsApp inválido.');
    result.hasWhatsApp = input.hasWhatsApp;
  }
  if (input.tagIds !== undefined) {
    if (!Array.isArray(input.tagIds) || input.tagIds.length > 30 || input.tagIds.some((tag) => typeof tag !== 'string' || !UUID.test(tag))) throw new Error('Tags do segmento inválidas.');
    result.tagIds = [...new Set(input.tagIds as string[])];
  }
  if (input.birthdayMonth !== undefined) {
    if (typeof input.birthdayMonth !== 'number' || !Number.isInteger(input.birthdayMonth) || input.birthdayMonth < 1 || input.birthdayMonth > 12) throw new Error('Mês de aniversário inválido.');
    result.birthdayMonth = input.birthdayMonth;
  }
  if (input.origin !== undefined) {
    if (typeof input.origin !== 'string' || input.origin.trim().length > 80) throw new Error('Origem inválida.');
    const origin = input.origin.trim();
    if (origin) result.origin = origin;
  }
  return result;
}

export function serializeCustomerSegment(segment: CustomerSegment): Record<string, string> {
  const parsed = parseCustomerSegment(segment);
  const result: Record<string, string> = {};
  if (parsed.search) result.search = parsed.search;
  if (parsed.buyers) result.buyers = parsed.buyers;
  if (parsed.minOrders !== undefined) result.minOrders = String(parsed.minOrders);
  if (parsed.maxOrders !== undefined) result.maxOrders = String(parsed.maxOrders);
  if (parsed.minTotalValue !== undefined) result.minTotalValue = String(parsed.minTotalValue);
  if (parsed.minDaysSinceLastOrder !== undefined) result.minDaysSinceLastOrder = String(parsed.minDaysSinceLastOrder);
  if (parsed.maxDaysSinceLastOrder !== undefined) result.maxDaysSinceLastOrder = String(parsed.maxDaysSinceLastOrder);
  if (parsed.hasWhatsApp !== undefined) result.hasWhatsApp = String(parsed.hasWhatsApp);
  if (parsed.tagIds?.length) result.tagIds = parsed.tagIds.join(',');
  if (parsed.birthdayMonth !== undefined) result.birthdayMonth = String(parsed.birthdayMonth);
  if (parsed.origin) result.origin = parsed.origin;
  return result;
}

export function countActiveSegmentCriteria(segment: CustomerSegment): number {
  return [
    Boolean(segment.search),
    segment.buyers !== undefined && segment.buyers !== 'all',
    segment.minOrders !== undefined,
    segment.maxOrders !== undefined,
    segment.minTotalValue !== undefined,
    segment.minDaysSinceLastOrder !== undefined,
    segment.maxDaysSinceLastOrder !== undefined,
    segment.hasWhatsApp !== undefined,
    Boolean(segment.tagIds?.length),
    segment.birthdayMonth !== undefined,
    Boolean(segment.origin),
  ].filter(Boolean).length;
}

export function describeCustomerSegment(segment: CustomerSegment): string {
  const parts: string[] = [];
  if (segment.buyers === 'buyers') parts.push('quem já comprou');
  else if (segment.buyers === 'contacts') parts.push('contatos sem compra');
  else if (segment.buyers === 'all') parts.push('todos os cadastros');
  if (segment.minOrders !== undefined && segment.maxOrders !== undefined && segment.minOrders === segment.maxOrders) parts.push(`${segment.minOrders} pedido${segment.minOrders === 1 ? '' : 's'}`);
  else {
    if (segment.minOrders !== undefined) parts.push(`${segment.minOrders}+ pedidos`);
    if (segment.maxOrders !== undefined) parts.push(`até ${segment.maxOrders} pedidos`);
  }
  if (segment.minTotalValue !== undefined) parts.push(`a partir de R$ ${segment.minTotalValue}`);
  if (segment.minDaysSinceLastOrder !== undefined) parts.push(`sumiram há ${segment.minDaysSinceLastOrder} dias ou mais`);
  if (segment.maxDaysSinceLastOrder !== undefined) parts.push(`compraram nos últimos ${segment.maxDaysSinceLastOrder} dias`);
  if (segment.hasWhatsApp === true) parts.push('com WhatsApp');
  else if (segment.hasWhatsApp === false) parts.push('sem WhatsApp');
  if (segment.tagIds?.length) parts.push(`${segment.tagIds.length} tag${segment.tagIds.length === 1 ? '' : 's'}`);
  if (segment.birthdayMonth !== undefined) parts.push(`aniversário em ${segment.birthdayMonth}`);
  if (segment.origin) parts.push(`origem ${segment.origin}`);
  if (segment.search) parts.push(`busca “${segment.search}”`);
  return parts.join(' · ');
}

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function matchesCustomerSegment(person: CustomerSegmentSubject, segment: CustomerSegment, now = new Date()): boolean {
  if (segment.buyers === 'buyers' && person.orderCount <= 0) return false;
  if (segment.buyers === 'contacts' && person.orderCount !== 0) return false;
  if (segment.minOrders !== undefined && person.orderCount < segment.minOrders) return false;
  if (segment.maxOrders !== undefined && person.orderCount > segment.maxOrders) return false;
  if (segment.minTotalValue !== undefined && person.totalValue < segment.minTotalValue) return false;
  const lastOrder = validDate(person.lastOrderAt);
  if (segment.minDaysSinceLastOrder !== undefined && (!lastOrder || now.getTime() - lastOrder.getTime() < segment.minDaysSinceLastOrder * 86_400_000)) return false;
  if (segment.maxDaysSinceLastOrder !== undefined && (!lastOrder || now.getTime() - lastOrder.getTime() > segment.maxDaysSinceLastOrder * 86_400_000)) return false;
  if (segment.hasWhatsApp !== undefined && Boolean(person.phone) !== segment.hasWhatsApp) return false;
  if (segment.tagIds?.some((tagId) => !(person.tagIds ?? []).includes(tagId))) return false;
  if (segment.birthdayMonth !== undefined && person.birthdayMonth !== segment.birthdayMonth) return false;
  if (segment.origin !== undefined && (person.origin ?? '').toLocaleLowerCase() !== segment.origin.toLocaleLowerCase()) return false;
  if (segment.search) {
    const search = segment.search.toLocaleLowerCase();
    if (!(person.name ?? '').toLocaleLowerCase().includes(search) && !(person.phone ?? '').toLocaleLowerCase().includes(search)) return false;
  }
  return true;
}
