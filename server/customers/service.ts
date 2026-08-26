import type { CustomerDetail, CustomerFilters, CustomerSummary, CustomerTimelineEntry } from '../../src/types.js';
import { decodeCustomerCursor, decodeTimelineCursor, encodeCustomerCursor, encodeTimelineCursor, resolveCustomerActivity } from './filters.js';
import { getServiceSupabase } from '../supabase.js';

export interface CustomerListResult { customers: CustomerSummary[]; nextCursor: string | null; hasMore: boolean; }
export interface CustomerReadRepository {
  listPeople(empresaId: string, ownerUserId: string, filters: CustomerFilters, limit: number): Promise<any[]>;
  countOrders(empresaId: string, personIds: string[]): Promise<Record<string, { count: number; total: number; lastDeliveredAt: string | null }> >;
  lastConversations(empresaId: string, personIds: string[]): Promise<Record<string, string | null>>;
  getPerson(empresaId: string, ownerUserId: string, personId: string): Promise<any | null>;
}

const defaultRepository: CustomerReadRepository = {
  async listPeople(empresaId, ownerUserId, filters, limit) {
    if (filters.q && /[(),.*%\\]/u.test(filters.q)) throw new Error('Busca contém caracteres reservados');
    const cursor = decodeCustomerCursor(filters.cursor);
    const { data, error } = await getServiceSupabase().rpc('list_zelochat_customers', {
      p_empresa_id: empresaId, p_owner_user_id: ownerUserId, p_search: filters.q ?? null,
      p_activity_state: filters.activityState ?? null, p_has_phone: filters.hasPhone ?? null,
      p_tag_id: filters.tagId ?? null, p_birthday_month: filters.birthdayMonth ?? null,
      p_cursor_updated_at: cursor?.updatedAt ?? null, p_cursor_id: cursor?.id ?? null,
      p_inactive_after_days: 30, p_limit: limit + 1,
    });
    if (error) throw error; return (data ?? []).map((row) => ({ ...row, empresa_id: empresaId }));
  },
  async countOrders(empresaId, personIds) {
    if (!personIds.length) return {};
    const { data, error } = await getServiceSupabase().from('zelo_orders').select('pessoa_id,total,status,closed_at,created_at').eq('empresa_id', empresaId).in('pessoa_id', personIds).eq('status', 'delivered').order('closed_at', { ascending: false }).limit(Math.min(5000, Math.max(100, personIds.length * 100)));
    if (error) throw error; const result: Record<string, { count: number; total: number; lastDeliveredAt: string | null }> = {};
    for (const row of data ?? []) { const current = result[row.pessoa_id] ?? { count: 0, total: 0, lastDeliveredAt: null }; current.count++; current.total += Number(row.total ?? 0); current.lastDeliveredAt = current.lastDeliveredAt && current.lastDeliveredAt > (row.closed_at ?? row.created_at) ? current.lastDeliveredAt : (row.closed_at ?? row.created_at); result[row.pessoa_id] = current; } return result;
  },
  async lastConversations(empresaId, personIds) {
    const { data, error } = await getServiceSupabase().from('zelochat_sessions').select('pessoa_id,last_message_time').eq('empresa_id', empresaId).in('pessoa_id', personIds).order('last_message_time', { ascending: false }).limit(Math.min(5000, Math.max(100, personIds.length * 100)));
    if (error) throw error; const result: Record<string, string | null> = {}; for (const row of data ?? []) if (!result[row.pessoa_id]) result[row.pessoa_id] = row.last_message_time; return result;
  },
  async getPerson(empresaId, ownerUserId, personId) { const { data, error } = await getServiceSupabase().from('pessoas').select('*').eq('id', personId).eq('id_usuario', ownerUserId).eq('tipo', 'cliente').maybeSingle(); if (error) throw error; return data ? { ...data, empresa_id: empresaId } : null; },
};

export async function listCustomers(empresaId: string, ownerUserId: string, filters: CustomerFilters, repository = defaultRepository): Promise<CustomerListResult> {
  const limit = Math.min(filters.limit ?? 30, 100); const rows = await repository.listPeople(empresaId, ownerUserId, filters, limit); const ids = rows.map((row) => row.id); const aggregated = rows.some((row) => row.total_orders != null); const orders = aggregated ? {} : await repository.countOrders(empresaId, ids); const conversations = aggregated ? {} : await repository.lastConversations(empresaId, ids);
  const customers = rows.map((row) => { const order = orders[row.id] ?? { count: Number(row.total_orders ?? 0), total: Number(row.total_value ?? 0), lastDeliveredAt: null }; const activity = row.activity_state ? { lastActivityAt: row.last_activity_at ?? null, state: row.activity_state } : resolveCustomerActivity({ lastDeliveredOrderAt: order.lastDeliveredAt, lastConversationAt: conversations[row.id] ?? null }); return { id: row.id, name: row.nome || 'Cliente', phone: row.contato ?? null, hasWhatsApp: row.has_whatsapp ?? Boolean(row.contato), lastActivityAt: activity.lastActivityAt, activityState: activity.state, totalOrders: order.count, totalValue: order.total, tags: [] }; }).filter((customer) => !filters.activityState || customer.activityState === filters.activityState);
  const page = customers.slice(0, limit); const hasMore = customers.length > limit; const lastRow = rows[page.length - 1]; return { customers: page, hasMore, nextCursor: hasMore && lastRow ? encodeCustomerCursor(lastRow.updated_at, lastRow.id) : null };
}

export async function getCustomerDetail(empresaId: string, ownerUserId: string, personId: string, repository = defaultRepository): Promise<CustomerDetail | null> { const row = await repository.getPerson(empresaId, ownerUserId, personId); if (!row) return null; const listed = await listCustomers(empresaId, ownerUserId, { limit: 100 }, repository); const summary = listed.customers.find((item) => item.id === personId) ?? { id: personId, name: row.nome ?? 'Cliente', phone: row.contato ?? null, hasWhatsApp: Boolean(row.contato), lastActivityAt: null, activityState: 'inactive' as const, totalOrders: 0, totalValue: 0, tags: [] }; return { ...summary, aniversario: row.aniversario_mes ? { day: Number(row.aniversario_dia ?? 0), month: Number(row.aniversario_mes), year: row.aniversario_ano ? Number(row.aniversario_ano) : null } : null, internalNotes: null, aiSummary: null, whatsappBlockedAt: null, whatsappBlockReason: null, lastManualContactAt: null, sessions: [] }; }

export function customerReadRepository(): CustomerReadRepository { return defaultRepository; }
export type { CustomerTimelineEntry };

export async function listCustomerMessages(empresaId: string, personId: string, cursor: string | null, limit = 30) {
  const supabase = getServiceSupabase();
  const { data: sessions, error: sessionError } = await supabase.from('zelochat_sessions').select('id').eq('empresa_id', empresaId).eq('pessoa_id', personId);
  if (sessionError) throw sessionError;
  const ids = (sessions ?? []).map((row) => row.id); if (!ids.length) return { items: [], nextCursor: null, hasMore: false };
  let query = supabase.from('zelochat_messages').select('id,session_id,role,content,sent_at').eq('empresa_id', empresaId).in('session_id', ids).order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(Math.min(limit, 100) + 1);
  const decoded = cursor ? decodeTimelineCursor(cursor) : null;
  if (decoded) query = query.or(`sent_at.lt.${decoded.occurredAt},and(sent_at.eq.${decoded.occurredAt},id.lt.${decoded.id})`);
  const { data, error } = await query; if (error) throw error; const rows = data ?? []; const hasMore = rows.length > limit; const last = rows[limit - 1]; return { items: rows.slice(0, limit), nextCursor: hasMore && last ? encodeTimelineCursor(last.sent_at, 'message', last.id) : null, hasMore };
}

export async function listCustomerOrders(empresaId: string, personId: string, cursor: string | null, limit = 30) {
  let query = getServiceSupabase().from('zelo_orders').select('id,status,total,created_at,closed_at').eq('empresa_id', empresaId).eq('pessoa_id', personId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(Math.min(limit, 100) + 1);
  const decoded = cursor ? decodeTimelineCursor(cursor) : null;
  if (decoded) query = query.or(`created_at.lt.${decoded.occurredAt},and(created_at.eq.${decoded.occurredAt},id.lt.${decoded.id})`);
  const { data, error } = await query; if (error) throw error; const rows = data ?? []; const hasMore = rows.length > limit; const last = rows[limit - 1]; return { items: rows.slice(0, limit), nextCursor: hasMore && last ? encodeTimelineCursor(last.created_at, 'order', last.id) : null, hasMore };
}

export async function listCustomerTimeline(empresaId: string, ownerUserId: string, personId: string, cursor: string | null, limit = 30) {
  const decoded = cursor ? decodeTimelineCursor(cursor) : null;
  const { data, error } = await getServiceSupabase().rpc('list_zelochat_customer_timeline', {
    p_empresa_id: empresaId, p_owner_user_id: ownerUserId, p_pessoa_id: personId,
    p_after_at: decoded?.occurredAt ?? null, p_after_kind: decoded?.kind ?? null,
    p_after_id: decoded?.id ?? null, p_limit: Math.min(limit, 100) + 1,
  });
  if (error) throw error;
  const rows = data ?? []; const hasMore = rows.length > limit; const page = rows.slice(0, limit);
  const items = page.map((row) => row.kind === 'message'
    ? { kind: 'message' as const, id: row.id, occurredAt: row.occurred_at, sessionId: row.session_id, direction: row.direction, preview: row.preview }
    : { kind: 'order' as const, id: row.id, occurredAt: row.occurred_at, status: row.order_status, total: Number(row.order_total ?? 0) });
  const last = page[page.length - 1];
  return { items, nextCursor: hasMore && last ? encodeTimelineCursor(last.occurred_at, last.kind, last.id) : null, hasMore };
}
