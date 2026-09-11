import type { CustomerFilters, CustomerActivityState } from '../../src/types.js';
import {
  DEFAULT_CUSTOMER_SEGMENT,
  DEFAULT_CUSTOMER_SORT,
  isCustomerSortKey,
  parseCustomerSegment,
  type CustomerSortKey,
} from '../../src/domain/customerSegment.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const allowed = new Set([
  'q', 'activityState', 'hasPhone', 'tagId', 'tagIds', 'birthdayMonth', 'cursor', 'limit',
  'status', 'hasWhatsApp', 'tags', 'vip', 'birthdayOnly', 'origin', 'buyers', 'minOrders',
  'maxOrders', 'minTotalValue', 'minDaysSinceLastOrder', 'maxDaysSinceLastOrder', 'sort',
]);

const POSTGRES_TIMESTAMP = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.([0-9]{1,6}))?(?:Z|\+00:00)$/u;

function isCanonicalTimestamp(value: string): boolean {
  const match = POSTGRES_TIMESTAMP.exec(value);
  if (!match) return false;

  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;

  const [, year, month, day, hour, minute, second, , fraction = ''] = match;
  const milliseconds = Number(`${fraction}000`.slice(0, 3));
  return parsed.getUTCFullYear() === Number(year)
    && parsed.getUTCMonth() + 1 === Number(month)
    && parsed.getUTCDate() === Number(day)
    && parsed.getUTCHours() === Number(hour)
    && parsed.getUTCMinutes() === Number(minute)
    && parsed.getUTCSeconds() === Number(second)
    && parsed.getUTCMilliseconds() === milliseconds;
}

function numberQueryValue(query: Record<string, unknown>, key: string, label: string): number | undefined {
  if (query[key] === undefined || query[key] === null || query[key] === '') return undefined;
  const value = Number(query[key]);
  if (!Number.isFinite(value)) throw new Error(`${label} inválido.`);
  return value;
}

function queryTags(query: Record<string, unknown>): string[] {
  const values: unknown[] = [];
  for (const key of ['tagId', 'tagIds', 'tags']) {
    const value = query[key];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) values.push(...value);
    else if (typeof value === 'string') values.push(...value.split(','));
    else values.push(value);
  }
  return values.map((tag) => typeof tag === 'string' ? tag.trim() : tag as string).filter((tag) => tag !== '');
}

export function parseCustomerFilters(query: Record<string, unknown>): CustomerFilters {
  for (const key of Object.keys(query)) if (!allowed.has(key)) throw new Error(`Filtro não permitido: ${key}`);

  const filters: CustomerFilters = {};
  const rawSegment: Record<string, unknown> = {};
  if (query.q !== undefined) rawSegment.search = query.q;
  if (query.buyers !== undefined) rawSegment.buyers = query.buyers;

  for (const [key, label] of [
    ['minOrders', 'Quantidade mínima de pedidos'],
    ['maxOrders', 'Quantidade máxima de pedidos'],
    ['minTotalValue', 'Valor mínimo gasto'],
    ['minDaysSinceLastOrder', 'Mínimo de dias desde o último pedido'],
    ['maxDaysSinceLastOrder', 'Máximo de dias desde o último pedido'],
  ] as const) {
    const value = numberQueryValue(query, key, label);
    if (value !== undefined) rawSegment[key] = value;
  }

  const phoneValue = query.hasWhatsApp === 'true' || query.hasWhatsApp === 'false'
    ? query.hasWhatsApp === 'true'
    : query.hasPhone === 'true' || query.hasPhone === 'false'
      ? query.hasPhone === 'true'
      : undefined;
  if (phoneValue !== undefined) rawSegment.hasWhatsApp = phoneValue;
  if (phoneValue !== undefined) filters.hasPhone = phoneValue;
  const tagIds = queryTags(query);
  if (tagIds.length) rawSegment.tagIds = tagIds;

  if (query.activityState === 'active' || query.activityState === 'inactive' || query.activityState === 'never') filters.activityState = query.activityState as CustomerActivityState;
  if (query.status === 'active' || query.status === 'inactive' || query.status === 'never') filters.activityState = query.status as CustomerActivityState;
  if (tagIds.length) {
    filters.tagId = tagIds[0];
    filters.tagIds = [...new Set(tagIds)];
  }
  if (query.vip === 'true') filters.vip = true;
  if (query.birthdayOnly === 'true') filters.birthdayOnly = true;
  if (typeof query.origin === 'string' && query.origin.trim()) {
    filters.origin = query.origin.trim().slice(0, 80);
    rawSegment.origin = query.origin;
  }
  const birthdayMonth = numberQueryValue(query, 'birthdayMonth', 'Mês de aniversário');
  if (birthdayMonth !== undefined) {
    filters.birthdayMonth = birthdayMonth;
    rawSegment.birthdayMonth = birthdayMonth;
  }
  if (query.cursor != null) {
    if (typeof query.cursor !== 'string' || query.cursor.length > 1000) throw new Error('Cursor inválido');
    filters.cursor = query.cursor;
  }
  if (query.limit != null) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limite inválido');
    filters.limit = limit;
  }

  const sort = query.sort === undefined ? DEFAULT_CUSTOMER_SORT : query.sort;
  if (!isCustomerSortKey(sort)) throw new Error('Ordenação inválida.');
  filters.sort = sort;

  const parsedSegment = parseCustomerSegment(rawSegment);
  filters.segment = query.buyers === undefined
    ? { ...DEFAULT_CUSTOMER_SEGMENT, ...parsedSegment }
    : parsedSegment;
  if (typeof parsedSegment.search === 'string') filters.q = parsedSegment.search;
  if (typeof parsedSegment.origin === 'string') filters.origin = parsedSegment.origin;
  if (parsedSegment.birthdayMonth !== undefined) filters.birthdayMonth = parsedSegment.birthdayMonth;
  return filters;
}

export function resolveCustomerActivity(input: { lastDeliveredOrderAt: string | null; lastConversationAt: string | null; now?: Date; inactiveAfterDays?: number }): { lastActivityAt: string | null; state: CustomerActivityState } {
  const lastActivityAt = input.lastDeliveredOrderAt ?? input.lastConversationAt;
  if (!lastActivityAt) return { lastActivityAt: null, state: 'never' };
  const threshold = (input.now ?? new Date()).getTime() - (input.inactiveAfterDays ?? 30) * 86400000;
  return { lastActivityAt, state: new Date(lastActivityAt).getTime() >= threshold ? 'active' : 'inactive' };
}

export interface CustomerCursor { sort: CustomerSortKey; value: string; id: string; }

function validCustomerId(id: string): boolean { return UUID.test(id); }

export function encodeCustomerCursor(sort: CustomerSortKey, value: string | number | null, id: string): string {
  if (!isCustomerSortKey(sort) || !validCustomerId(id)) throw new Error('Cursor inválido');
  let serialized: string;
  if (sort === 'recent') {
    if (value === null || value === '') serialized = '';
    else if (typeof value !== 'string' || !isCanonicalTimestamp(value)) throw new Error('Cursor inválido');
    else serialized = value;
  } else if (sort === 'orders') {
    if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+$/u.test(String(value))) throw new Error('Cursor inválido');
    serialized = String(value);
  } else if (sort === 'value') {
    serialized = String(value ?? '');
    if (!serialized || !Number.isFinite(Number(serialized))) throw new Error('Cursor inválido');
  } else {
    serialized = encodeURIComponent(String(value ?? '').toLowerCase());
  }
  return Buffer.from(`v2|${sort}|${serialized}|${id}`).toString('base64url');
}

export function decodeCustomerCursor(cursor: string | null | undefined, expectedSort: CustomerSortKey = DEFAULT_CUSTOMER_SORT): CustomerCursor | null {
  if (!cursor) return null;
  if (!/^[A-Za-z0-9_-]{8,1000}$/u.test(cursor) || !isCustomerSortKey(expectedSort)) throw new Error('Cursor inválido');
  let value: string;
  try { value = Buffer.from(cursor, 'base64url').toString('utf8'); } catch { throw new Error('Cursor inválido'); }
  const parts = value.split('|');
  if (parts.length !== 4 || parts[0] !== 'v2' || !isCustomerSortKey(parts[1]) || parts[1] !== expectedSort || !validCustomerId(parts[3])) throw new Error('Cursor inválido');
  const sort = parts[1];
  let cursorValue = parts[2];
  if (sort === 'name') {
    try { cursorValue = decodeURIComponent(cursorValue); } catch { throw new Error('Cursor inválido'); }
  } else if (sort === 'orders') {
    if (!/^\d+$/u.test(cursorValue)) throw new Error('Cursor inválido');
  } else if (sort === 'value') {
    if (!cursorValue || !Number.isFinite(Number(cursorValue))) throw new Error('Cursor inválido');
  } else if (cursorValue && !isCanonicalTimestamp(cursorValue)) {
    throw new Error('Cursor inválido');
  }
  return { sort, value: cursorValue, id: parts[3] };
}

export function encodeTimelineCursor(occurredAt: string, kind: 'message' | 'order', id: string): string {
  return Buffer.from(`${occurredAt}|${kind}|${id}`).toString('base64url');
}
export type TimelineCursor = { occurredAt: string; kind: 'message' | 'order'; id: string };

export function decodeTimelineCursor(cursor: string | null | undefined): TimelineCursor | null {
  if (!cursor || !/^[A-Za-z0-9_-]{8,300}$/u.test(cursor)) throw new Error('Cursor inválido');
  const parts = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (parts.length !== 3) throw new Error('Cursor inválido');
  const [occurredAt, kind, id] = parts;
  if (!occurredAt || (kind !== 'message' && kind !== 'order') || !id || !isCanonicalTimestamp(occurredAt)) throw new Error('Cursor inválido');
  if (kind === 'message' ? !validCustomerId(id) : !validCustomerId(id) && !/^\d+$/u.test(id)) throw new Error('Cursor inválido');
  return { occurredAt, kind, id };
}
