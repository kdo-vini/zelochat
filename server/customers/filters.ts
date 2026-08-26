import type { CustomerFilters, CustomerActivityState } from '../../src/types.js';

const allowed = new Set(['q', 'activityState', 'hasPhone', 'tagId', 'birthdayMonth', 'cursor', 'limit']);
export function parseCustomerFilters(query: Record<string, unknown>): CustomerFilters {
  for (const key of Object.keys(query)) if (!allowed.has(key)) throw new Error(`Filtro não permitido: ${key}`);
  const filters: CustomerFilters = {};
  if (typeof query.q === 'string') filters.q = query.q.trim().slice(0, 120);
  if (query.activityState === 'active' || query.activityState === 'inactive') filters.activityState = query.activityState as CustomerActivityState;
  if (query.hasPhone === 'true' || query.hasPhone === 'false') filters.hasPhone = query.hasPhone === 'true';
  if (typeof query.tagId === 'string' && /^[0-9a-f-]{8,64}$/i.test(query.tagId)) filters.tagId = query.tagId;
  if (query.birthdayMonth != null) { const month = Number(query.birthdayMonth); if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('Mês de aniversário inválido'); filters.birthdayMonth = month; }
  if (query.cursor != null) { if (typeof query.cursor !== 'string' || query.cursor.length > 200) throw new Error('Cursor inválido'); filters.cursor = query.cursor; }
  if (query.limit != null) { const limit = Number(query.limit); if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limite inválido'); filters.limit = limit; }
  return filters;
}

export function resolveCustomerActivity(input: { lastDeliveredOrderAt: string | null; lastConversationAt: string | null; now?: Date; inactiveAfterDays?: number }): { lastActivityAt: string | null; state: CustomerActivityState } {
  const lastActivityAt = input.lastDeliveredOrderAt ?? input.lastConversationAt;
  if (!lastActivityAt) return { lastActivityAt: null, state: 'inactive' };
  const threshold = (input.now ?? new Date()).getTime() - (input.inactiveAfterDays ?? 30) * 86400000;
  return { lastActivityAt, state: new Date(lastActivityAt).getTime() >= threshold ? 'active' : 'inactive' };
}

export function encodeCustomerCursor(updatedAt: string, id: string): string { return Buffer.from(`${updatedAt}|${id}`).toString('base64url'); }
export function decodeCustomerCursor(cursor: string | null | undefined): { updatedAt: string; id: string } | null {
  if (!cursor) return null;
  const value = Buffer.from(cursor, 'base64url').toString('utf8');
  const [updatedAt, id] = value.split('|');
  return updatedAt && id ? { updatedAt, id } : null;
}
