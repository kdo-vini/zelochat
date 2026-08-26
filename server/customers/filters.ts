import type { CustomerFilters, CustomerActivityState } from '../../src/types.js';

const allowed = new Set(['q', 'activityState', 'hasPhone', 'tagId', 'birthdayMonth', 'cursor', 'limit', 'status', 'hasWhatsApp', 'tags', 'vip', 'birthdayOnly', 'origin']);
function isCanonicalTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && new Date(value).toISOString() === value;
}
export function parseCustomerFilters(query: Record<string, unknown>): CustomerFilters {
  for (const key of Object.keys(query)) if (!allowed.has(key)) throw new Error(`Filtro não permitido: ${key}`);
  const filters: CustomerFilters = {};
  if (typeof query.q === 'string') {
    const search = query.q.trim().slice(0, 120);
    if (/[(),.*%\\]/u.test(search)) throw new Error('Busca contém caracteres reservados');
    filters.q = search;
  }
  if (query.activityState === 'active' || query.activityState === 'inactive' || query.activityState === 'never') filters.activityState = query.activityState as CustomerActivityState;
  if (query.status === 'active' || query.status === 'inactive' || query.status === 'never') filters.activityState = query.status as CustomerActivityState;
  if (query.hasPhone === 'true' || query.hasPhone === 'false') filters.hasPhone = query.hasPhone === 'true';
  if (query.hasWhatsApp === 'true' || query.hasWhatsApp === 'false') filters.hasPhone = query.hasWhatsApp === 'true';
  if (typeof query.tagId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query.tagId)) filters.tagId = query.tagId;
  else if (query.tagId != null) throw new Error('Tag inválida');
  if (typeof query.tags === 'string' && query.tags.trim()) {
    const tagIds = query.tags.split(',').map((tag) => tag.trim()).filter((tag) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tag));
    if (tagIds.length) { filters.tagId = tagIds[0]; filters.tagIds = tagIds; }
  }
  if (query.vip === 'true') filters.vip = true;
  if (query.birthdayOnly === 'true') filters.birthdayOnly = true;
  if (typeof query.origin === 'string' && query.origin.trim()) filters.origin = query.origin.trim().slice(0, 80);
  if (query.birthdayMonth != null) { const month = Number(query.birthdayMonth); if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('Mês de aniversário inválido'); filters.birthdayMonth = month; }
  if (query.cursor != null) { if (typeof query.cursor !== 'string' || query.cursor.length > 200) throw new Error('Cursor inválido'); filters.cursor = query.cursor; }
  if (query.limit != null) { const limit = Number(query.limit); if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limite inválido'); filters.limit = limit; }
  return filters;
}

export function resolveCustomerActivity(input: { lastDeliveredOrderAt: string | null; lastConversationAt: string | null; now?: Date; inactiveAfterDays?: number }): { lastActivityAt: string | null; state: CustomerActivityState } {
  const lastActivityAt = input.lastDeliveredOrderAt ?? input.lastConversationAt;
  if (!lastActivityAt) return { lastActivityAt: null, state: 'never' };
  const threshold = (input.now ?? new Date()).getTime() - (input.inactiveAfterDays ?? 30) * 86400000;
  return { lastActivityAt, state: new Date(lastActivityAt).getTime() >= threshold ? 'active' : 'inactive' };
}

export function encodeCustomerCursor(updatedAt: string, id: string): string { return Buffer.from(`${updatedAt}|${id}`).toString('base64url'); }
export function decodeCustomerCursor(cursor: string | null | undefined): { updatedAt: string; id: string } | null {
  if (!cursor) return null;
  if (!/^[A-Za-z0-9_-]{8,300}$/u.test(cursor)) throw new Error('Cursor inválido');
  let value: string;
  try { value = Buffer.from(cursor, 'base64url').toString('utf8'); } catch { throw new Error('Cursor inválido'); }
  const [updatedAt, id] = value.split('|');
  if (!updatedAt || !id || !isCanonicalTimestamp(updatedAt) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) throw new Error('Cursor inválido');
  return { updatedAt, id };
}

export function encodeTimelineCursor(occurredAt: string, kind: 'message' | 'order', id: string): string {
  return Buffer.from(`${occurredAt}|${kind}|${id}`).toString('base64url');
}
export function decodeTimelineCursor(cursor: string | null | undefined): { occurredAt: string; kind: 'message' | 'order'; id: string } | null {
  if (!cursor || !/^[A-Za-z0-9_-]{8,300}$/u.test(cursor)) throw new Error('Cursor inválido');
  const [occurredAt, kind, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!occurredAt || (kind !== 'message' && kind !== 'order') || !id || !isCanonicalTimestamp(occurredAt) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) throw new Error('Cursor inválido');
  return { occurredAt, kind, id };
}
