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
  const customers = rows.map((row) => { const order = orders[row.id] ?? { count: Number(row.total_orders ?? 0), total: Number(row.total_value ?? 0), lastDeliveredAt: null }; const activity = row.activity_state ? { lastActivityAt: row.last_activity_at ?? null, state: row.activity_state } : resolveCustomerActivity({ lastDeliveredOrderAt: order.lastDeliveredAt, lastConversationAt: conversations[row.id] ?? null }); const hasWhatsApp = row.has_whatsapp ?? Boolean(row.contato); return { id: row.id, name: row.nome || 'Cliente', phone: row.contato ?? null, whatsapp: hasWhatsApp ? row.contato ?? null : null, hasWhatsApp, lastActivityAt: activity.lastActivityAt, activityState: activity.state, totalOrders: order.count, orderCount: order.count, totalValue: order.total, openBalance: null, tags: [] }; }).filter((customer) => !filters.activityState || customer.activityState === filters.activityState);
  const page = customers.slice(0, limit); const hasMore = customers.length > limit; const lastRow = rows[page.length - 1]; return { customers: page, hasMore, nextCursor: hasMore && lastRow ? encodeCustomerCursor(lastRow.updated_at, lastRow.id) : null };
}

export async function getCustomerDetail(empresaId: string, ownerUserId: string, personId: string, repository = defaultRepository): Promise<CustomerDetail | null> {
  const row = await repository.getPerson(empresaId, ownerUserId, personId);
  if (!row) return null;
  const listed = await listCustomers(empresaId, ownerUserId, { limit: 100 }, repository);
  const summary = listed.customers.find((item) => item.id === personId) ?? { id: personId, name: row.nome ?? 'Cliente', phone: row.contato ?? null, whatsapp: row.contato ?? null, hasWhatsApp: Boolean(row.contato), lastActivityAt: null, activityState: 'inactive' as const, totalOrders: 0, orderCount: 0, totalValue: 0, openBalance: null, tags: [] };
  const db = getServiceSupabase();
  const [{ data: sessionRows, error: sessionError }, { data: relationship, error: relationshipError }, { data: personTags, error: personTagsError }] = await Promise.all([
    db.from('zelochat_sessions').select('id,remote_jid,customer_name,customer_phone,last_message,last_message_time,unread_count,status').eq('empresa_id', empresaId).eq('pessoa_id', personId).order('last_message_time', { ascending: false }),
    db.from('zelochat_customer_relationships').select('internal_notes,ai_summary,whatsapp_blocked_at,whatsapp_block_reason,last_manual_contact_at').eq('empresa_id', empresaId).eq('pessoa_id', personId).maybeSingle(),
    db.from('zelochat_person_tags').select('tag_id').eq('empresa_id', empresaId).eq('pessoa_id', personId),
  ]);
  if (sessionError || relationshipError || personTagsError) throw sessionError ?? relationshipError ?? personTagsError;
  const tagIds = (personTags ?? []).map((item) => item.tag_id).filter((id): id is string => typeof id === 'string');
  const { data: tagRows, error: tagsError } = tagIds.length ? await db.from('zelochat_tags').select('id,name').eq('empresa_id', empresaId).in('id', tagIds) : { data: [], error: null };
  if (tagsError) throw tagsError;
  const tags = (tagRows ?? []).map((tag) => tag.name).filter((name): name is string => typeof name === 'string');
  const sessions = (sessionRows ?? []).map((session) => ({ id: session.remote_jid, remoteJid: session.remote_jid, customerName: session.customer_name ?? summary.name, customerPhone: session.customer_phone ?? summary.phone ?? '', lastMessage: session.last_message ?? '', lastMessageTime: session.last_message_time ?? '', unreadCount: Number(session.unread_count ?? 0), messages: [], status: session.status ?? 'active', hasMoreMessages: true }));
  const primaryJid = sessions.find((session) => /^\d{10,15}@s\.whatsapp\.net$/u.test(session.id))?.id ?? null;
  const birthday = row.aniversario_mes ? { day: Number(row.aniversario_dia ?? 0), month: Number(row.aniversario_mes), year: row.aniversario_ano ? Number(row.aniversario_ano) : null } : null;
  const relationshipDto = { blocked: Boolean(relationship?.whatsapp_blocked_at), blockReason: relationship?.whatsapp_block_reason ?? null, campaigns: 0, automations: 0 };
  return { ...summary, tags, birthday, aniversario: birthday, notes: relationship?.internal_notes ?? null, internalNotes: relationship?.internal_notes ?? null, automaticSummary: relationship?.ai_summary ?? null, aiSummary: relationship?.ai_summary ?? null, relationship: relationshipDto, whatsappBlockedAt: relationship?.whatsapp_blocked_at ?? null, whatsappBlockReason: relationship?.whatsapp_block_reason ?? null, lastManualContactAt: relationship?.last_manual_contact_at ?? null, orders: [], sessions, primaryJid };
}

export function customerReadRepository(): CustomerReadRepository { return defaultRepository; }
export type { CustomerTimelineEntry };

export async function listCustomerMessages(empresaId: string, personId: string, cursor: string | null, limit = 30) {
  const supabase = getServiceSupabase();
  const { data: sessions, error: sessionError } = await supabase.from('zelochat_sessions').select('id').eq('empresa_id', empresaId).eq('pessoa_id', personId);
  if (sessionError) throw sessionError;
  const ids = (sessions ?? []).map((row) => row.id); if (!ids.length) return { items: [], nextCursor: null, hasMore: false };
  let query = supabase.from('zelochat_messages').select('id,session_id,role,content,sent_at,outbound_status,outbound_error,attachment').eq('empresa_id', empresaId).in('session_id', ids).in('role', ['user', 'assistant']).order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(Math.min(limit, 100) + 1);
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
