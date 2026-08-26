import type { CustomerDetail, CustomerFilters, CustomerSummary, CustomerTimelineEntry } from '../../src/types.js';
import { decodeCustomerCursor, encodeCustomerCursor, resolveCustomerActivity } from './filters.js';
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
    let query = getServiceSupabase().from('pessoas').select('id, nome, contato, tipo, updated_at, aniversario_dia, aniversario_mes, aniversario_ano').eq('id_usuario', ownerUserId).eq('tipo', 'cliente').order('updated_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
    if (filters.q) query = query.or(`nome.ilike.%${filters.q}%,contato.ilike.%${filters.q}%`);
    if (filters.hasPhone === true) query = query.not('contato', 'is', null);
    if (filters.hasPhone === false) query = query.is('contato', null);
    if (filters.birthdayMonth) query = query.eq('aniversario_mes', filters.birthdayMonth);
    const cursor = decodeCustomerCursor(filters.cursor); if (cursor) query = query.lt('updated_at', cursor.updatedAt);
    const { data, error } = await query; if (error) throw error; return (data ?? []).map((row) => ({ ...row, empresa_id: empresaId }));
  },
  async countOrders(empresaId, personIds) {
    if (!personIds.length) return {};
    const { data, error } = await getServiceSupabase().from('zelo_orders').select('pessoa_id,total,status,closed_at,created_at').eq('empresa_id', empresaId).in('pessoa_id', personIds).eq('status', 'delivered');
    if (error) throw error; const result: Record<string, { count: number; total: number; lastDeliveredAt: string | null }> = {};
    for (const row of data ?? []) { const current = result[row.pessoa_id] ?? { count: 0, total: 0, lastDeliveredAt: null }; current.count++; current.total += Number(row.total ?? 0); current.lastDeliveredAt = current.lastDeliveredAt && current.lastDeliveredAt > (row.closed_at ?? row.created_at) ? current.lastDeliveredAt : (row.closed_at ?? row.created_at); result[row.pessoa_id] = current; } return result;
  },
  async lastConversations(empresaId, personIds) {
    const { data, error } = await getServiceSupabase().from('zelochat_sessions').select('pessoa_id,last_message_time').eq('empresa_id', empresaId).in('pessoa_id', personIds).order('last_message_time', { ascending: false });
    if (error) throw error; const result: Record<string, string | null> = {}; for (const row of data ?? []) if (!result[row.pessoa_id]) result[row.pessoa_id] = row.last_message_time; return result;
  },
  async getPerson(empresaId, ownerUserId, personId) { const { data, error } = await getServiceSupabase().from('pessoas').select('*').eq('id', personId).eq('id_usuario', ownerUserId).eq('tipo', 'cliente').maybeSingle(); if (error) throw error; return data ? { ...data, empresa_id: empresaId } : null; },
};

export async function listCustomers(empresaId: string, ownerUserId: string, filters: CustomerFilters, repository = defaultRepository): Promise<CustomerListResult> {
  const limit = Math.min(filters.limit ?? 30, 100); const rows = await repository.listPeople(empresaId, ownerUserId, filters, limit); const hasMore = rows.length > limit; const page = rows.slice(0, limit); const ids = page.map((row) => row.id); const orders = await repository.countOrders(empresaId, ids); const conversations = await repository.lastConversations(empresaId, ids);
  const customers = page.map((row) => { const order = orders[row.id] ?? { count: 0, total: 0, lastDeliveredAt: null }; const activity = resolveCustomerActivity({ lastDeliveredOrderAt: order.lastDeliveredAt, lastConversationAt: conversations[row.id] ?? null }); return { id: row.id, name: row.nome || 'Cliente', phone: row.contato ?? null, hasWhatsApp: Boolean(row.contato), lastActivityAt: activity.lastActivityAt, activityState: activity.state, totalOrders: order.count, totalValue: order.total, tags: [] }; }).filter((customer) => !filters.activityState || customer.activityState === filters.activityState);
  const last = page[page.length - 1]; return { customers, hasMore, nextCursor: hasMore && last ? encodeCustomerCursor(last.updated_at, last.id) : null };
}

export async function getCustomerDetail(empresaId: string, ownerUserId: string, personId: string, repository = defaultRepository): Promise<CustomerDetail | null> { const row = await repository.getPerson(empresaId, ownerUserId, personId); if (!row) return null; const listed = await listCustomers(empresaId, ownerUserId, { q: row.nome, limit: 100 }, repository); const summary = listed.customers.find((item) => item.id === personId) ?? { id: personId, name: row.nome ?? 'Cliente', phone: row.contato ?? null, hasWhatsApp: Boolean(row.contato), lastActivityAt: null, activityState: 'inactive' as const, totalOrders: 0, totalValue: 0, tags: [] }; return { ...summary, aniversario: row.aniversario_mes ? { day: Number(row.aniversario_dia ?? 0), month: Number(row.aniversario_mes), year: row.aniversario_ano ? Number(row.aniversario_ano) : null } : null, internalNotes: null, aiSummary: null, whatsappBlockedAt: null, whatsappBlockReason: null, lastManualContactAt: null, sessions: [] }; }

export function customerReadRepository(): CustomerReadRepository { return defaultRepository; }
export type { CustomerTimelineEntry };

export async function listCustomerMessages(empresaId: string, personId: string, cursor: string | null, limit = 30) {
  const supabase = getServiceSupabase();
  const { data: sessions, error: sessionError } = await supabase.from('zelochat_sessions').select('id').eq('empresa_id', empresaId).eq('pessoa_id', personId);
  if (sessionError) throw sessionError;
  const ids = (sessions ?? []).map((row) => row.id); if (!ids.length) return { items: [], nextCursor: null, hasMore: false };
  let query = supabase.from('zelochat_messages').select('id,session_id,role,content,sent_at').eq('empresa_id', empresaId).in('session_id', ids).order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(Math.min(limit, 100) + 1);
  if (cursor) query = query.lt('sent_at', cursor);
  const { data, error } = await query; if (error) throw error; const rows = data ?? []; const hasMore = rows.length > limit; return { items: rows.slice(0, limit), nextCursor: hasMore ? rows[limit - 1]?.sent_at ?? null : null, hasMore };
}

export async function listCustomerOrders(empresaId: string, personId: string, cursor: string | null, limit = 30) {
  let query = getServiceSupabase().from('zelo_orders').select('id,status,total,created_at,closed_at').eq('empresa_id', empresaId).eq('pessoa_id', personId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(Math.min(limit, 100) + 1);
  if (cursor) query = query.lt('created_at', cursor);
  const { data, error } = await query; if (error) throw error; const rows = data ?? []; const hasMore = rows.length > limit; return { items: rows.slice(0, limit), nextCursor: hasMore ? rows[limit - 1]?.created_at ?? null : null, hasMore };
}

export async function listCustomerTimeline(empresaId: string, personId: string, cursor: string | null, limit = 30) {
  const [messages, orders] = await Promise.all([listCustomerMessages(empresaId, personId, cursor, limit), listCustomerOrders(empresaId, personId, cursor, limit)]);
  const items = [
    ...messages.items.map((row) => ({ kind: 'message', id: row.id, occurredAt: row.sent_at, sessionId: row.session_id, direction: row.role === 'user' ? 'inbound' : 'outbound', preview: String(row.content ?? '').slice(0, 240) })),
    ...orders.items.map((row) => ({ kind: 'order', id: row.id, occurredAt: row.closed_at ?? row.created_at, status: row.status, total: Number(row.total ?? 0) })),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit);
  return { items, nextCursor: messages.nextCursor ?? orders.nextCursor, hasMore: messages.hasMore || orders.hasMore };
}
