import type { CustomerDetail, CustomerFilters, CustomerSummary, CustomerTimelineEntry } from '../../src/types.js';
import {
  decodeCustomerCursor,
  decodeTimelineCursor,
  encodeCustomerCursor,
  encodeTimelineCursor,
  resolveCustomerActivity,
  type CustomerCursor,
} from './filters.js';
import { getServiceSupabase } from '../supabase.js';
import { parseStructuredMessage } from '../../src/domain/chat.js';
import {
  CUSTOMER_SEGMENT_CHIPS,
  DEFAULT_CUSTOMER_SEGMENT,
  DEFAULT_CUSTOMER_SORT,
  isCustomerSortKey,
  parseCustomerSegment,
  type CustomerSegment,
  type CustomerSortKey,
} from '../../src/domain/customerSegment.js';
import { CustomerOrderingContext } from './orderingContextAdapter.js';

export interface CustomerListResult { customers: CustomerSummary[]; nextCursor: string | null; hasMore: boolean; total: number | null; }
export type CustomerSegmentCounts = { sumiram: number; 'uma-vez': number; melhores: number };
export interface CustomerRpcClient {
  rpc(name: string, params: Record<string, unknown>): unknown;
}
export interface CustomerRelationshipSummary { blocked: boolean; blockReason: string | null; optedOut: boolean; campaigns: number; automations: number; }
export function buildCustomerRelationship(input: { blockedAt?: string | null; blockReason?: string | null; optedOut?: boolean; campaigns?: number | null; automations?: number | null }): CustomerRelationshipSummary {
  return {
    blocked: Boolean(input.blockedAt),
    blockReason: input.blockReason ?? null,
    optedOut: input.optedOut === true,
    campaigns: Math.max(0, Number(input.campaigns ?? 0)),
    automations: Math.max(0, Number(input.automations ?? 0)),
  };
}
export interface CustomerReadRepository {
  listPeople(empresaId: string, ownerUserId: string, filters: CustomerFilters, limit: number): Promise<any[]>;
  countOrders(empresaId: string, personIds: string[]): Promise<Record<string, { count: number; total: number; lastDeliveredAt: string | null }> >;
  lastConversations(empresaId: string, personIds: string[]): Promise<Record<string, string | null>>;
  listTags?(empresaId: string, personIds: string[]): Promise<Record<string, string[]>>;
  getPerson(empresaId: string, ownerUserId: string, personId: string): Promise<any | null>;
}

function buildCustomerRpcParams(
  empresaId: string,
  ownerUserId: string,
  segment: CustomerSegment,
  sort: CustomerSortKey,
  pageCursor: CustomerCursor | null,
  rpcLimit: number,
  tagIds: string[] | null = segment.tagIds ?? null,
): Record<string, unknown> {
  return {
    p_empresa_id: empresaId,
    p_owner_user_id: ownerUserId,
    p_search: segment.search ?? null,
    p_buyers: segment.buyers ?? null,
    p_min_orders: segment.minOrders ?? null,
    p_max_orders: segment.maxOrders ?? null,
    p_min_total_value: segment.minTotalValue ?? null,
    p_min_days_since_last_order: segment.minDaysSinceLastOrder ?? null,
    p_max_days_since_last_order: segment.maxDaysSinceLastOrder ?? null,
    p_has_phone: segment.hasWhatsApp ?? null,
    p_tag_ids: tagIds,
    p_birthday_month: segment.birthdayMonth ?? null,
    p_origin: segment.origin ?? null,
    p_sort: sort,
    p_cursor_orders: pageCursor?.sort === 'orders' ? Number(pageCursor.value) : null,
    p_cursor_value: pageCursor?.sort === 'value' ? pageCursor.value : null,
    p_cursor_at: pageCursor?.sort === 'recent' ? (pageCursor.value || '-infinity') : null,
    p_cursor_name: pageCursor?.sort === 'name' ? pageCursor.value : null,
    p_cursor_id: pageCursor?.id ?? null,
    p_inactive_after_days: 30,
    p_limit: rpcLimit,
  };
}

const defaultRepository: CustomerReadRepository = {
  async listPeople(empresaId, ownerUserId, filters, limit) {
    const segment = parseCustomerSegment({
      ...DEFAULT_CUSTOMER_SEGMENT,
      ...(filters.segment ?? {}),
      ...(filters.q !== undefined && filters.segment?.search === undefined ? { search: filters.q } : {}),
      ...(filters.hasPhone !== undefined && filters.segment?.hasWhatsApp === undefined ? { hasWhatsApp: filters.hasPhone } : {}),
      ...(filters.tagIds !== undefined && filters.segment?.tagIds === undefined ? { tagIds: filters.tagIds } : {}),
      ...(filters.tagId !== undefined && filters.segment?.tagIds === undefined && filters.tagIds === undefined ? { tagIds: [filters.tagId] } : {}),
      ...(filters.birthdayMonth !== undefined && filters.segment?.birthdayMonth === undefined ? { birthdayMonth: filters.birthdayMonth } : {}),
      ...(filters.origin !== undefined && filters.segment?.origin === undefined ? { origin: filters.origin } : {}),
    });
    const sort: CustomerSortKey = filters.sort && isCustomerSortKey(filters.sort) ? filters.sort : DEFAULT_CUSTOMER_SORT;
    let tagIds = segment.tagIds ?? null;
    if (filters.vip) {
      const { data: vipTags, error: vipError } = await getServiceSupabase().from('zelochat_tags').select('id').eq('empresa_id', empresaId).ilike('name', 'vip');
      if (vipError) throw vipError;
      const vipIds = (vipTags ?? []).map((tag) => tag.id).filter((id): id is string => typeof id === 'string');
      if (!vipIds.length) return [];
      tagIds = [...new Set([...(tagIds ?? []), ...vipIds])];
    }
    const cursor = decodeCustomerCursor(filters.cursor, sort);
    const fetchPage = async (pageCursor: CustomerCursor | null): Promise<any[]> => {
      const { data, error } = await getServiceSupabase().rpc('list_zelochat_customers', buildCustomerRpcParams(empresaId, ownerUserId, segment, sort, pageCursor, limit + 1, tagIds));
      if (error) throw error;
      return (data ?? []).map((row) => ({ ...row, empresa_id: empresaId }));
    };
    const firstPage = await fetchPage(cursor);
    if (!filters.activityState && !filters.birthdayOnly) return firstPage;

    let birthdayIds: Set<string> | null = null;
    if (filters.birthdayOnly) {
      const { data, error } = await getServiceSupabase().from('pessoas').select('id').eq('id_usuario', ownerUserId).eq('tipo', 'cliente').not('aniversario_mes', 'is', null);
      if (error) throw error;
      birthdayIds = new Set((data ?? []).map((row) => row.id).filter((id): id is string => typeof id === 'string'));
    }
    const matchesLegacyFilters = (row: any): boolean => (
      (!filters.activityState || row.activity_state === filters.activityState)
      && (!birthdayIds || birthdayIds.has(row.id))
    );
    const matchingRows: any[] = [];
    let page = firstPage;
    let pageCursor = cursor;
    while (true) {
      matchingRows.push(...page.filter(matchesLegacyFilters));
      if (filters.cursor && matchingRows.length > limit) break;
      if (page.length <= limit) break;
      const last = page[page.length - 1];
      const nextValue = sort === 'orders'
        ? String(last.total_orders ?? 0)
        : sort === 'value'
          ? String(last.total_value ?? 0)
          : sort === 'recent'
            ? last.last_order_at ?? ''
            : String(last.nome ?? '').toLowerCase();
      pageCursor = { sort, value: nextValue, id: last.id };
      page = await fetchPage(pageCursor);
    }
    if (!filters.cursor && matchingRows[0]) matchingRows[0] = { ...matchingRows[0], total_count: matchingRows.length };
    return matchingRows;
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
  async listTags(empresaId, personIds) {
    if (!personIds.length) return {};
    const { data, error } = await getServiceSupabase().from('zelochat_person_tags').select('pessoa_id, zelochat_tags(name)').eq('empresa_id', empresaId).in('pessoa_id', personIds);
    if (error) throw error;
    const result: Record<string, string[]> = {};
    for (const row of data ?? []) {
      const embedded = Array.isArray(row.zelochat_tags) ? row.zelochat_tags : row.zelochat_tags ? [row.zelochat_tags] : [];
      const names = embedded.map((tag) => tag?.name).filter((name): name is string => typeof name === 'string');
      if (names.length) result[row.pessoa_id] = [...(result[row.pessoa_id] ?? []), ...names];
    }
    return result;
  },
  async getPerson(empresaId, ownerUserId, personId) { const { data, error } = await getServiceSupabase().from('pessoas').select('*').eq('id', personId).eq('id_usuario', ownerUserId).eq('tipo', 'cliente').maybeSingle(); if (error) throw error; return data ? { ...data, empresa_id: empresaId } : null; },
};

export async function listCustomers(empresaId: string, ownerUserId: string, filters: CustomerFilters, repository = defaultRepository): Promise<CustomerListResult> {
  const limit = Math.min(filters.limit ?? 30, 100);
  const sort: CustomerSortKey = filters.sort && isCustomerSortKey(filters.sort) ? filters.sort : DEFAULT_CUSTOMER_SORT;
  const rows = await repository.listPeople(empresaId, ownerUserId, filters, limit);
  const ids = rows.map((row) => row.id);
  const aggregated = rows.some((row) => row.total_orders != null);
  const [orders, conversations, tagsByPerson] = await Promise.all([
    aggregated ? Promise.resolve({}) : repository.countOrders(empresaId, ids),
    aggregated ? Promise.resolve({}) : repository.lastConversations(empresaId, ids),
    repository.listTags ? repository.listTags(empresaId, ids) : Promise.resolve({}),
  ]);
  const customers = rows.map((row) => {
    const order = orders[row.id] ?? { count: Number(row.total_orders ?? 0), total: Number(row.total_value ?? 0), lastDeliveredAt: row.last_order_at ?? null };
    const activity = row.activity_state
      ? { lastActivityAt: row.last_activity_at ?? null, state: row.activity_state }
      : resolveCustomerActivity({ lastDeliveredOrderAt: order.lastDeliveredAt, lastConversationAt: conversations[row.id] ?? null });
    const hasWhatsApp = row.has_whatsapp ?? Boolean(row.contato);
    return {
      id: row.id,
      name: row.nome || 'Cliente',
      phone: row.contato ?? null,
      whatsapp: hasWhatsApp ? row.contato ?? null : null,
      hasWhatsApp,
      lastOrderAt: row.last_order_at ?? order.lastDeliveredAt ?? null,
      lastActivityAt: activity.lastActivityAt,
      activityState: activity.state,
      totalOrders: order.count,
      orderCount: order.count,
      totalValue: order.total,
      openBalance: null,
      tags: tagsByPerson[row.id] ?? [],
    };
  });
  const page = customers.slice(0, limit);
  const hasMore = customers.length > limit;
  const lastRow = rows[page.length - 1];
  let nextCursor: string | null = null;
  if (hasMore && lastRow) {
    const lastCustomer = page[page.length - 1];
    const value = sort === 'orders'
      ? String(lastCustomer.totalOrders)
      : sort === 'value'
        ? String(lastRow.total_value ?? lastCustomer.totalValue)
        : sort === 'recent'
          ? lastCustomer.lastOrderAt ?? ''
          : String(lastRow.nome ?? '').toLowerCase();
    nextCursor = encodeCustomerCursor(sort, value, lastRow.id);
  }
  const total = filters.cursor ? null : Number(rows[0]?.total_count ?? 0);
  return { customers: page, hasMore, nextCursor, total };
}

export async function countCustomerSegments(empresaId: string, ownerUserId: string, client: CustomerRpcClient = getServiceSupabase() as unknown as CustomerRpcClient): Promise<CustomerSegmentCounts> {
  const entries = await Promise.all(CUSTOMER_SEGMENT_CHIPS.map(async (preset) => {
    const response = await client.rpc('list_zelochat_customers', buildCustomerRpcParams(empresaId, ownerUserId, preset.segment, preset.sort, null, 1)) as { data: unknown; error: unknown | null };
    if (response.error) throw response.error;
    const firstRow = Array.isArray(response.data) && response.data[0] && typeof response.data[0] === 'object'
      ? response.data[0] as Record<string, unknown>
      : null;
    const rawCount = Number(firstRow?.total_count ?? 0);
    return [preset.id, Number.isFinite(rawCount) ? Math.max(0, rawCount) : 0] as const;
  }));
  return Object.fromEntries(entries) as CustomerSegmentCounts;
}

export async function getCustomerDetail(empresaId: string, ownerUserId: string, personId: string, repository = defaultRepository): Promise<CustomerDetail | null> {
  const row = await repository.getPerson(empresaId, ownerUserId, personId);
  if (!row) return null;
  const phoneSearch = typeof row.contato === 'string' ? row.contato.replace(/\D/g, '') : '';
  const nameSearch = typeof row.nome === 'string' ? row.nome.replace(/[(),.*%\\]/gu, '').trim().slice(0, 120) : '';
  const detailSearch = phoneSearch || nameSearch;
  const detailSegment: CustomerSegment = { buyers: 'all', ...(detailSearch ? { search: detailSearch } : {}) };
  const listed = await listCustomers(empresaId, ownerUserId, { limit: 100, segment: detailSegment }, repository);
  const summary = listed.customers.find((item) => item.id === personId) ?? { id: personId, name: row.nome ?? 'Cliente', phone: row.contato ?? null, whatsapp: row.contato ?? null, hasWhatsApp: Boolean(row.contato), lastOrderAt: null, lastActivityAt: null, activityState: 'inactive' as const, totalOrders: 0, orderCount: 0, totalValue: 0, openBalance: null, tags: [] };
  const db = getServiceSupabase();
  const [{ data: sessionRows, error: sessionError }, { data: relationship, error: relationshipError }, { data: personTags, error: personTagsError }, { count: campaignCount, error: campaignError }, { count: automationCount, error: automationError }, { data: optOut, error: optOutError }] = await Promise.all([
    db.from('zelochat_sessions').select('id,remote_jid,customer_name,customer_phone,last_message,last_message_time,unread_count,status').eq('empresa_id', empresaId).eq('pessoa_id', personId).order('last_message_time', { ascending: false }),
    db.from('zelochat_customer_relationships').select('internal_notes,ai_summary,whatsapp_blocked_at,whatsapp_block_reason,last_manual_contact_at').eq('empresa_id', empresaId).eq('pessoa_id', personId).maybeSingle(),
    db.from('zelochat_person_tags').select('tag_id').eq('empresa_id', empresaId).eq('pessoa_id', personId),
    db.from('zelochat_campaign_recipients').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('pessoa_id', personId).eq('status', 'sent'),
    db.from('zelochat_automation_dispatches').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('pessoa_id', personId).eq('status', 'sent'),
    db.from('zelochat_customer_optouts').select('id').eq('empresa_id', empresaId).eq('pessoa_id', personId).maybeSingle(),
  ]);
  if (sessionError || relationshipError || personTagsError || campaignError || automationError || optOutError) throw sessionError ?? relationshipError ?? personTagsError ?? campaignError ?? automationError ?? optOutError;
  const tagIds = (personTags ?? []).map((item) => item.tag_id).filter((id): id is string => typeof id === 'string');
  const { data: tagRows, error: tagsError } = tagIds.length ? await db.from('zelochat_tags').select('id,name').eq('empresa_id', empresaId).in('id', tagIds) : { data: [], error: null };
  if (tagsError) throw tagsError;
  const tags = (tagRows ?? []).map((tag) => tag.name).filter((name): name is string => typeof name === 'string');
  const sessions = (sessionRows ?? []).map((session) => ({ id: session.id, remoteJid: session.remote_jid, customerName: session.customer_name ?? summary.name, customerPhone: session.customer_phone ?? summary.phone ?? '', lastMessage: session.last_message ?? '', lastMessageTime: session.last_message_time ?? '', unreadCount: Number(session.unread_count ?? 0), messages: [], status: session.status ?? 'active', hasMoreMessages: true }));
  const primaryJid = sessions.find((session) => /^\d{10,15}@s\.whatsapp\.net$/u.test(session.remoteJid))?.remoteJid ?? null;
  const birthday = row.aniversario_mes ? { day: Number(row.aniversario_dia ?? 0), month: Number(row.aniversario_mes), year: row.aniversario_ano ? Number(row.aniversario_ano) : null } : null;
  const relationshipDto = buildCustomerRelationship({ blockedAt: relationship?.whatsapp_blocked_at, blockReason: relationship?.whatsapp_block_reason, optedOut: Boolean(optOut), campaigns: campaignCount, automations: automationCount });
  const [orderPage, orderingContext] = await Promise.all([
    listCustomerOrders(empresaId, personId, null, 30),
    CustomerOrderingContext.get({ empresaId, pessoaId: personId }),
  ]);
  const orders = orderPage.items.map((order) => ({ id: order.id, createdAt: order.created_at, status: order.status, total: Number(order.total ?? 0) }));
  return { ...summary, tags, birthday, aniversario: birthday, notes: relationship?.internal_notes ?? null, internalNotes: relationship?.internal_notes ?? null, automaticSummary: relationship?.ai_summary ?? null, aiSummary: relationship?.ai_summary ?? null, relationship: relationshipDto, whatsappBlockedAt: relationship?.whatsapp_blocked_at ?? null, whatsappBlockReason: relationship?.whatsapp_block_reason ?? null, lastManualContactAt: relationship?.last_manual_contact_at ?? null, orders, ordersNextCursor: orderPage.nextCursor, ordersHasMore: orderPage.hasMore, sessions, primaryJid, orderingContext };
}

export function customerReadRepository(): CustomerReadRepository { return defaultRepository; }
export type { CustomerTimelineEntry };

export async function listCustomerMessages(empresaId: string, personId: string, cursor: string | null, limit = 30) {
  const supabase = getServiceSupabase();
  const { data: sessions, error: sessionError } = await supabase.from('zelochat_sessions').select('id').eq('empresa_id', empresaId).eq('pessoa_id', personId);
  if (sessionError) throw sessionError;
  const ids = (sessions ?? []).map((row) => row.id); if (!ids.length) return { items: [], nextCursor: null, hasMore: false };
  let query = supabase.from('zelochat_messages').select('id,session_id,role,content,sent_at,outbound_status,outbound_error').eq('empresa_id', empresaId).in('session_id', ids).in('role', ['user', 'assistant']).order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(Math.min(limit, 100) + 1);
  const decoded = cursor ? decodeTimelineCursor(cursor) : null;
  if (decoded) query = query.or(`sent_at.lt.${decoded.occurredAt},and(sent_at.eq.${decoded.occurredAt},id.lt.${decoded.id})`);
  const { data, error } = await query; if (error) throw error; const rows = data ?? []; const hasMore = rows.length > limit; const last = rows[limit - 1]; const items = rows.slice(0, limit).map((row) => { const parsed = parseStructuredMessage(row.content ?? ''); return { ...row, content: parsed.text || null, attachment: parsed.attachment ?? null }; }); return { items, nextCursor: hasMore && last ? encodeTimelineCursor(last.sent_at, 'message', last.id) : null, hasMore };
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
