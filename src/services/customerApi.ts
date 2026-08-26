import { apiFetch, apiUrl } from '../config';

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
}

export interface CustomerPage {
  customers: CustomerSummary[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number | null;
}

export interface CustomerListQuery extends CustomerFilters {
  cursor?: string | null;
  limit?: number;
}

export class CustomerApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'CustomerApiError';
    this.status = status;
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

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function parseCustomerResponse<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try { body = await response.json(); } catch { /* friendly fallback below */ }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string'
      ? body.message
      : response.status === 403 ? 'Você não tem permissão para consultar clientes.' : 'Não foi possível carregar os clientes.';
    throw new CustomerApiError(message, response.status);
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
    customers: body.customers ?? body.data ?? [],
    nextCursor: body.nextCursor ?? null,
    hasMore: body.hasMore ?? Boolean(body.nextCursor),
    total: body.total ?? null,
  };
}

export async function fetchCustomer(token: string, personId: string): Promise<unknown> {
  const response = await apiFetch(apiUrl(`/api/customers/${encodeURIComponent(personId)}`), { headers: authHeaders(token) });
  return parseCustomerResponse(response);
}
