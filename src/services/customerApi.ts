import { apiFetch, apiUrl } from '../config';
import type {
  CustomerOrderingAddress,
  CustomerOrderingContextField,
  CustomerOrderingContextSnapshot,
  CustomerOrderingContextSource,
  CustomerOrderingFrequentItem,
  CustomerOrderingHabitualTime,
  CustomerOrderingLastOrder,
  CustomerOrderingOverrides,
} from '../types';

export type {
  CustomerOrderingAddress,
  CustomerOrderingContextSnapshot,
  CustomerOrderingOverrides,
} from '../types';

export type CustomerActivityState = 'active' | 'inactive' | 'never';
export type CustomerStatusFilter = 'all' | CustomerActivityState;

export interface CustomerFilters {
  search?: string;
  status?: CustomerStatusFilter;
  tags?: string[];
  birthdayMonth?: number;
  origin?: string;
  hasWhatsApp?: boolean;
  vip?: boolean;
  birthdayOnly?: boolean;
}

export interface CustomerSummary {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  lastActivityAt: string | null;
  activityState: CustomerActivityState;
  orderCount: number;
  totalValue: number;
  openBalance: number | null;
  tags: string[];
}

export interface CustomerPage {
  customers: CustomerSummary[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number | null;
}

export interface CustomerMessagesPage {
  items: Array<{ id: string; session_id: string; role: string; content: string | null; sent_at: string; outbound_status?: string | null; outbound_error?: string | null; attachment?: import('../types').ChatAttachment | null }>;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CustomerDetail extends CustomerSummary {
  birthday: { day: number; month: number; year?: number | null } | null;
  origin: string | null;
  tags: string[];
  notes: string | null;
  automaticSummary: string | null;
  relationship: { blocked: boolean; blockReason: string | null; optedOut?: boolean; campaigns: number; automations: number };
  orders: Array<{ id: string; createdAt: string; status: string; total: number }>;
  primaryJid: string | null;
  sessions: Array<{ id: string; remoteJid: string; lastMessageTime: string; status: string }>;
  orderingContext: CustomerOrderingContextSnapshot;
}

export interface CustomerListQuery extends CustomerFilters {
  cursor?: string | null;
  limit?: number;
}

export class CustomerApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status = 0, code: string | null = null) {
    super(message);
    this.name = 'CustomerApiError';
    this.status = status;
    this.code = code;
  }
}

export function countActiveCustomerFilters(filters: CustomerFilters): number {
  return [
    filters.status && filters.status !== 'all',
    filters.tags && filters.tags.length > 0,
    filters.birthdayMonth,
    filters.origin?.trim(),
    filters.hasWhatsApp !== undefined,
    filters.vip === true,
    filters.birthdayOnly === true,
  ].filter(Boolean).length;
}

export function serializeCustomerFilters(filters: CustomerFilters): string {
  const params = new URLSearchParams();
  if (filters.search?.trim()) params.set('q', filters.search.trim());
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.tags?.length) params.set('tags', filters.tags.slice().sort().join(','));
  if (filters.birthdayMonth) params.set('birthdayMonth', String(filters.birthdayMonth));
  if (filters.origin?.trim()) params.set('origin', filters.origin.trim());
  if (filters.hasWhatsApp !== undefined) params.set('hasWhatsApp', String(filters.hasWhatsApp));
  if (filters.vip === true) params.set('vip', 'true');
  if (filters.birthdayOnly === true) params.set('birthdayOnly', 'true');
  return params.toString();
}

export function shouldResetCustomerCursor(previous: CustomerFilters, next: CustomerFilters): boolean {
  return serializeCustomerFilters(previous) !== serializeCustomerFilters(next);
}

function normalizeCustomerSummary(value: Partial<CustomerSummary> & Record<string, unknown>): CustomerSummary {
  const hasWhatsApp = typeof value.hasWhatsApp === 'boolean' ? value.hasWhatsApp : Boolean(value.whatsapp ?? value.phone);
  return { id: String(value.id ?? ''), name: String(value.name ?? 'Cliente'), phone: (value.phone as string | null | undefined) ?? null, whatsapp: (value.whatsapp as string | null | undefined) ?? (hasWhatsApp ? (value.phone as string | null | undefined) ?? null : null), lastActivityAt: (value.lastActivityAt as string | null | undefined) ?? null, activityState: value.activityState === 'active' ? 'active' : value.activityState === 'never' ? 'never' : 'inactive', orderCount: Number(value.orderCount ?? value.totalOrders ?? 0), totalValue: Number(value.totalValue ?? 0), openBalance: (value.openBalance as number | null | undefined) ?? null, tags: Array.isArray(value.tags) ? value.tags as string[] : [] };
}

const orderingContextSources = new Set<CustomerOrderingContextSource>(['fixed', 'last_order', 'derived', 'none']);

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function orderingSource(value: unknown): CustomerOrderingContextSource | null {
  return typeof value === 'string' && orderingContextSources.has(value as CustomerOrderingContextSource)
    ? value as CustomerOrderingContextSource
    : null;
}

function normalizeOrderingField<T>(
  value: unknown,
  normalize: (candidate: unknown) => T | null,
): CustomerOrderingContextField<T> {
  const source = objectValue(value);
  const normalizedSource = orderingSource(source.source);
  const normalizedValue = normalize(source.value);
  return normalizedSource && normalizedValue !== null
    ? { value: normalizedValue, source: normalizedSource }
    : { value: null, source: 'none' };
}

function normalizeOrderingAddress(value: unknown): CustomerOrderingAddress | null {
  const source = objectValue(value);
  if (typeof source.address !== 'string' || !source.address.trim()) return null;
  const nullableText = (candidate: unknown): string | null => typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
  const address = source.address.trim();
  const neighborhood = nullableText(source.neighborhood);
  const city = nullableText(source.city);
  const state = nullableText(source.state);
  return {
    address,
    neighborhood,
    complement: nullableText(source.complement),
    city,
    state,
    postalCode: nullableText(source.postalCode),
    reference: nullableText(source.reference),
    display: typeof source.display === 'string' && source.display.trim()
      ? source.display.trim()
      : [address, neighborhood, city && state ? `${city}/${state}` : city ?? state].filter(Boolean).join(' — '),
  };
}

function normalizeHabitualTime(value: unknown): CustomerOrderingHabitualTime | null {
  const source = objectValue(value);
  const minutes = Number(source.minutes);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 1440 || typeof source.label !== 'string' || !/^\d{2}:\d{2}$/u.test(source.label)) return null;
  return { minutes, label: source.label };
}

function normalizeFrequentItems(value: unknown): CustomerOrderingFrequentItem[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.flatMap((candidate) => {
    const source = objectValue(candidate);
    const orderFrequency = Number(source.orderFrequency);
    const totalQuantity = Number(source.totalQuantity);
    if (typeof source.productId !== 'string' || !source.productId || typeof source.name !== 'string' || !source.name.trim()
      || !Number.isFinite(orderFrequency) || orderFrequency < 1 || !Number.isFinite(totalQuantity) || totalQuantity < 1) return [];
    return [{ productId: source.productId, name: source.name.trim(), orderFrequency, totalQuantity }];
  });
  return items;
}

function normalizeLastOrder(value: unknown): CustomerOrderingLastOrder | null {
  const source = objectValue(value);
  const statuses = new Set(['accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered']);
  if (typeof source.id !== 'string' || typeof source.createdAt !== 'string' || typeof source.status !== 'string'
    || !statuses.has(source.status) || !Array.isArray(source.items)) return null;
  return value as CustomerOrderingLastOrder;
}

function normalizeOrderingOverrides(value: unknown): CustomerOrderingOverrides {
  const source = objectValue(value);
  const overrides: CustomerOrderingOverrides = {};
  if (source.fulfillmentType === 'delivery' || source.fulfillmentType === 'pickup') overrides.fulfillmentType = source.fulfillmentType;
  const address = normalizeOrderingAddress(source.deliveryAddress);
  if (address) {
    const { display: _display, ...storedAddress } = address;
    overrides.deliveryAddress = storedAddress;
  }
  if (typeof source.paymentMethod === 'string' && source.paymentMethod.trim()) overrides.paymentMethod = source.paymentMethod.trim();
  if (typeof source.habitualTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/u.test(source.habitualTime)) overrides.habitualTime = source.habitualTime;
  return overrides;
}

export function normalizeCustomerOrderingContext(value: unknown): CustomerOrderingContextSnapshot {
  const source = objectValue(value);
  const fulfillmentType = normalizeOrderingField(source.fulfillmentType, (candidate) => candidate === 'delivery' || candidate === 'pickup' ? candidate : null);
  const frequentItemsSource = objectValue(source.frequentItems);
  const frequentItemsOrigin = orderingSource(frequentItemsSource.source);
  const frequentItems = normalizeFrequentItems(frequentItemsSource.value);
  return {
    fulfillmentType,
    deliveryAddress: normalizeOrderingField(source.deliveryAddress, normalizeOrderingAddress),
    paymentMethod: normalizeOrderingField(source.paymentMethod, (candidate) => typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null),
    habitualTime: normalizeOrderingField(source.habitualTime, normalizeHabitualTime),
    medianRecurrenceDays: normalizeOrderingField(source.medianRecurrenceDays, (candidate) => {
      return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
    }),
    frequentItems: frequentItemsOrigin && frequentItems !== null
      ? { value: frequentItems, source: frequentItemsOrigin }
      : { value: [], source: 'none' },
    lastOrder: normalizeOrderingField(source.lastOrder, normalizeLastOrder),
    overrides: normalizeOrderingOverrides(source.overrides),
  };
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function parseCustomerResponse<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try { body = await response.json(); } catch { /* friendly fallback below */ }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string'
      ? body.message
      : typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
      : response.status === 403 ? 'Você não tem permissão para consultar clientes.' : 'Não foi possível carregar os clientes.';
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : null;
    throw new CustomerApiError(message, response.status, code);
  }
  return body as T;
}

export async function fetchCustomers(token: string, query: CustomerListQuery = {}): Promise<CustomerPage> {
  const params = new URLSearchParams(serializeCustomerFilters(query));
  params.set('limit', String(Math.min(Math.max(query.limit ?? 30, 1), 100)));
  if (query.cursor) params.set('cursor', query.cursor);
  const response = await apiFetch(apiUrl(`/api/customers?${params.toString()}`), { headers: authHeaders(token) });
  const body = await parseCustomerResponse<Partial<CustomerPage> & { data?: CustomerSummary[] }>(response);
  return {
    customers: (body.customers ?? body.data ?? []).map((customer) => normalizeCustomerSummary(customer as Partial<CustomerSummary> & Record<string, unknown>)),
    nextCursor: body.nextCursor ?? null,
    hasMore: body.hasMore ?? Boolean(body.nextCursor),
    total: body.total ?? null,
  };
}

export async function fetchCustomer(token: string, personId: string): Promise<CustomerDetail> {
  const response = await apiFetch(apiUrl(`/api/customers/${encodeURIComponent(personId)}`), { headers: authHeaders(token) });
  const body = await parseCustomerResponse<Partial<CustomerDetail> & Record<string, unknown>>(response);
  const summary = normalizeCustomerSummary(body);
  return { ...summary, birthday: (body.birthday ?? body.aniversario ?? null) as CustomerDetail['birthday'], origin: (body.origin as string | null | undefined) ?? null, notes: (body.notes ?? body.internalNotes ?? null) as string | null, automaticSummary: (body.automaticSummary ?? body.aiSummary ?? null) as string | null, relationship: (body.relationship ?? { blocked: Boolean(body.whatsappBlockedAt), blockReason: body.whatsappBlockReason ?? null, campaigns: 0, automations: 0 }) as CustomerDetail['relationship'], orders: Array.isArray(body.orders) ? body.orders as CustomerDetail['orders'] : [], primaryJid: (body.primaryJid as string | null | undefined) ?? null, sessions: Array.isArray(body.sessions) ? body.sessions as CustomerDetail['sessions'] : [], orderingContext: normalizeCustomerOrderingContext(body.orderingContext) };
}

export type CustomerPatch = Partial<Pick<CustomerDetail, 'name' | 'tags' | 'notes'>> & { birthday?: CustomerDetail['birthday']; phones?: string[]; whatsappBlocked?: boolean };
export type CustomerOrderingOverridesPatch = Partial<{ [Key in keyof CustomerOrderingOverrides]: CustomerOrderingOverrides[Key] | null }>;

export async function updateCustomerOrderingOverrides(token: string, personId: string, patch: CustomerOrderingOverridesPatch): Promise<CustomerOrderingContextSnapshot> {
  const response = await apiFetch(apiUrl(`/api/customers/${encodeURIComponent(personId)}/ordering-overrides`), {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  });
  return normalizeCustomerOrderingContext(await parseCustomerResponse<unknown>(response));
}

export async function updateCustomer(token: string, personId: string, patch: CustomerPatch): Promise<CustomerDetail> {
  const response = await apiFetch(apiUrl(`/api/customers/${encodeURIComponent(personId)}`), { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify(patch) });
  return parseCustomerResponse<CustomerDetail>(response);
}

export async function createCustomer(token: string, patch: CustomerPatch): Promise<CustomerDetail> {
  const response = await apiFetch(apiUrl('/api/customers'), { method: 'POST', headers: authHeaders(token), body: JSON.stringify(patch) });
  return parseCustomerResponse<CustomerDetail>(response);
}

export async function deleteCustomer(token: string, personId: string): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/customers/${encodeURIComponent(personId)}`), { method: 'DELETE', headers: authHeaders(token) });
  await parseCustomerResponse(response);
}

export async function previewCustomerMerge(token: string, sourceId: string, targetId: string): Promise<{ source: CustomerSummary; target: CustomerSummary; conversations: number; orders: number }> {
  const response = await apiFetch(apiUrl(`/api/customers/${encodeURIComponent(sourceId)}/merge`), { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ targetId, preview: true }) });
  return parseCustomerResponse(response);
}

export async function mergeCustomers(token: string, sourceId: string, targetId: string): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/customers/${encodeURIComponent(sourceId)}/merge`), { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ targetId, execute: true }) });
  await parseCustomerResponse(response);
}

export async function fetchCustomerMessages(token: string, personId: string, cursor: string | null = null, limit = 30): Promise<CustomerMessagesPage> {
  const params = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 100)) });
  if (cursor) params.set('cursor', cursor);
  const response = await apiFetch(apiUrl(`/api/customers/${encodeURIComponent(personId)}/messages?${params.toString()}`), { headers: authHeaders(token) });
  return parseCustomerResponse<CustomerMessagesPage>(response);
}

export async function sendCustomerMessage(token: string, personId: string, primaryJid: string, payload: { message?: string; attachment?: import('../types').ChatAttachment }): Promise<{ dbMessageId: string; messageId: string | null; status: 'sent' | 'failed' }> {
  const response = await apiFetch(apiUrl(`/api/customers/${encodeURIComponent(personId)}/messages`), { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ primaryJid, ...payload }) });
  return parseCustomerResponse(response);
}

export async function retryCustomerMessage(token: string, dbMessageId: string): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/messages/${encodeURIComponent(dbMessageId)}/retry`), { method: 'POST', headers: authHeaders(token) });
  await parseCustomerResponse(response);
}
