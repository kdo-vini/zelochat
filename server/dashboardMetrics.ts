import type { DashboardAttentionItem, DashboardOverview, DashboardRange, Order } from '../src/types.js';
import { buildAiHealthReport } from './aiHealth.js';
import { getConfig } from './configStore.js';
import { getServiceSupabase } from './supabase.js';

type SessionMetricRow = {
  id: string;
  remote_jid: string;
  customer_name: string | null;
  customer_phone: string | null;
  last_message: string | null;
  last_message_time: string | null;
  unread_count: number | null;
  status: string | null;
  auto_reply: boolean | null;
  updated_at: string;
};

type MessageMetricRow = {
  id: string;
  session_id: string;
  role: string;
  content: string | null;
  sent_at: string;
  tool_calls: unknown[] | null;
};

type ResponseEventRow = {
  responder_type: 'ai' | 'human';
  latency_ms: number;
  sent_at: string;
};

type EscalationMetricRow = {
  id: string;
  session_id: string;
  trigger_name: string | null;
  reason_category: string | null;
  triggered_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
};

type OrderMetricRow = {
  id: string;
  customer_name: string;
  pickup_date: string;
  pickup_time: string;
  status: Order['status'];
  total: number | string;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function saoPauloDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function minutesInSaoPaulo(date: Date): number {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

function dateKeyDaysAgo(daysAgo: number): string {
  return saoPauloDateKey(new Date(Date.now() - daysAgo * MS_PER_DAY));
}

function parseDateKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function dateKeyToSaoPauloStart(value: string): Date {
  return new Date(`${value}T00:00:00-03:00`);
}

function addDaysToDateKey(value: string, days: number): string {
  const date = dateKeyToSaoPauloStart(value);
  date.setUTCDate(date.getUTCDate() + days);
  return saoPauloDateKey(date);
}

function resolvePeriod(
  range: DashboardRange,
  customStart?: unknown,
  customEnd?: unknown,
): { start: Date; end: Date; startDateKey: string; endDateKey: string; periodLabel: string } {
  const todayKey = saoPauloDateKey(new Date());
  if (range === 'custom') {
    const rawStart = parseDateKey(customStart) ?? todayKey;
    const rawEnd = parseDateKey(customEnd) ?? rawStart;
    const [startDateKey, endDateKey] = rawStart <= rawEnd ? [rawStart, rawEnd] : [rawEnd, rawStart];
    const days = Math.max(
      1,
      Math.round(
        (dateKeyToSaoPauloStart(endDateKey).getTime() - dateKeyToSaoPauloStart(startDateKey).getTime())
          / MS_PER_DAY,
      ) + 1,
    );
    return {
      start: dateKeyToSaoPauloStart(startDateKey),
      end: dateKeyToSaoPauloStart(addDaysToDateKey(endDateKey, 1)),
      startDateKey,
      endDateKey,
      periodLabel: days === 1 ? startDateKey : `${startDateKey} a ${endDateKey}`,
    };
  }

  if (range === '30d') {
    const startDateKey = dateKeyDaysAgo(29);
    return {
      start: dateKeyToSaoPauloStart(startDateKey),
      end: dateKeyToSaoPauloStart(addDaysToDateKey(todayKey, 1)),
      startDateKey,
      endDateKey: todayKey,
      periodLabel: 'últimos 30 dias',
    };
  }

  if (range === '7d') {
    const startDateKey = dateKeyDaysAgo(6);
    return {
      start: dateKeyToSaoPauloStart(startDateKey),
      end: dateKeyToSaoPauloStart(addDaysToDateKey(todayKey, 1)),
      startDateKey,
      endDateKey: todayKey,
      periodLabel: 'últimos 7 dias',
    };
  }

  return {
    start: new Date(Date.now() - MS_PER_DAY),
    end: new Date(),
    startDateKey: todayKey,
    endDateKey: todayKey,
    periodLabel: 'últimas 24h',
  };
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function parsePickupMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function isAssistantCustomerReply(message: MessageMetricRow): boolean {
  return message.role === 'assistant'
    && !!message.content
    && (!message.tool_calls || message.tool_calls.length === 0);
}

function computeFirstResponseLatencies(messages: MessageMetricRow[]): number[] {
  const bySession = new Map<string, MessageMetricRow[]>();
  for (const message of messages) {
    const list = bySession.get(message.session_id) ?? [];
    list.push(message);
    bySession.set(message.session_id, list);
  }

  const latencies: number[] = [];
  for (const list of bySession.values()) {
    list.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
    let pendingUserSentAt: string | null = null;
    for (const message of list) {
      if (message.role === 'user') {
        pendingUserSentAt = message.sent_at;
        continue;
      }
      if (pendingUserSentAt && isAssistantCustomerReply(message)) {
        latencies.push(Math.max(
          0,
          new Date(message.sent_at).getTime() - new Date(pendingUserSentAt).getTime(),
        ));
        pendingUserSentAt = null;
      }
    }
  }
  return latencies;
}

function metric(value: number | null, samples = 0) {
  return { value, samples };
}

function attentionItem(
  item: DashboardAttentionItem,
): DashboardAttentionItem {
  return item;
}

async function fetchResponseEvents(
  empresaId: string,
  start: Date,
  end: Date,
): Promise<ResponseEventRow[]> {
  const { data, error } = await getServiceSupabase()
    .from('zelochat_response_events')
    .select('responder_type, latency_ms, sent_at')
    .eq('empresa_id', empresaId)
    .gte('sent_at', start.toISOString())
    .lt('sent_at', end.toISOString())
    .order('sent_at', { ascending: false })
    .limit(5000);

  if (error) {
    console.warn('[dashboard] response events unavailable:', error.message);
    return [];
  }

  return (data ?? []) as ResponseEventRow[];
}

export async function buildDashboardOverview(
  empresaId: string,
  range: DashboardRange,
  customStart?: unknown,
  customEnd?: unknown,
): Promise<DashboardOverview> {
  const supabase = getServiceSupabase();
  const period = resolvePeriod(range, customStart, customEnd);
  const { start, end, startDateKey, endDateKey, periodLabel } = period;
  const todayKey = saoPauloDateKey(new Date());

  const [
    sessionsResult,
    messagesResult,
    responseEvents,
    escalationsResult,
    ordersResult,
  ] = await Promise.all([
    supabase
      .from('zelochat_sessions')
      .select('id, remote_jid, customer_name, customer_phone, last_message, last_message_time, unread_count, status, auto_reply, updated_at')
      .eq('empresa_id', empresaId),
    supabase
      .from('zelochat_messages')
      .select('id, session_id, role, content, sent_at, tool_calls')
      .eq('empresa_id', empresaId)
      .in('role', ['user', 'assistant'])
      .gte('sent_at', start.toISOString())
      .lt('sent_at', end.toISOString())
      .order('session_id', { ascending: true })
      .order('sent_at', { ascending: true })
      .limit(5000),
    fetchResponseEvents(empresaId, start, end),
    supabase
      .from('zelochat_escalation_events')
      .select('id, session_id, trigger_name, reason_category, triggered_at, acknowledged_at, resolved_at')
      .eq('empresa_id', empresaId)
      .order('triggered_at', { ascending: false })
      .limit(1000),
    supabase
      .from('zelochat_orders')
      .select('id, customer_name, pickup_date, pickup_time, status, total')
      .eq('empresa_id', empresaId)
      .gte('pickup_date', startDateKey)
      .lte('pickup_date', endDateKey)
      .order('pickup_date', { ascending: true })
      .order('pickup_time', { ascending: true })
      .limit(1000),
  ]);

  if (sessionsResult.error) throw new Error(sessionsResult.error.message);
  if (messagesResult.error) throw new Error(messagesResult.error.message);
  if (escalationsResult.error) throw new Error(escalationsResult.error.message);
  if (ordersResult.error) throw new Error(ordersResult.error.message);

  const sessions = (sessionsResult.data ?? []) as SessionMetricRow[];
  const messages = (messagesResult.data ?? []) as MessageMetricRow[];
  const escalations = (escalationsResult.data ?? []) as EscalationMetricRow[];
  const periodEscalations = escalations
    .filter((event) => {
      const time = new Date(event.triggered_at).getTime();
      return time >= start.getTime() && time < end.getTime();
    });
  const orders = (ordersResult.data ?? []) as OrderMetricRow[];

  const waitingSessions = sessions
    .filter((session) => (session.unread_count ?? 0) > 0)
    .sort((a, b) => (b.unread_count ?? 0) - (a.unread_count ?? 0));
  const openEscalations = escalations.filter((event) => !event.resolved_at);
  const manualSessions = sessions.filter((session) => session.auto_reply === false && session.status !== 'archived');
  const aiSessions = sessions.filter((session) => session.auto_reply !== false && session.status === 'active');
  const now = Date.now();
  const staleManual = manualSessions.filter((session) => {
    if ((session.unread_count ?? 0) <= 0 || !session.last_message_time) return false;
    return now - new Date(session.last_message_time).getTime() > 10 * 60 * 1000;
  });

  const periodOrders = orders;
  const periodRevenue = periodOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const pendingOrders = periodOrders.filter((order) => order.status === 'pending');
  const preparingOrders = periodOrders.filter((order) => order.status === 'preparing');
  const currentMinutes = minutesInSaoPaulo(new Date());
  const todayOrders = orders.filter((order) => order.pickup_date === todayKey);
  const atRiskOrders = todayOrders.filter((order) => {
    if (order.status === 'delivered') return false;
    const pickupMinutes = parsePickupMinutes(order.pickup_time);
    if (pickupMinutes === null) return false;
    return pickupMinutes <= currentMinutes + 30;
  });
  const upcomingOrders = todayOrders
    .filter((order) => order.status !== 'delivered')
    .filter((order) => {
      const pickupMinutes = parsePickupMinutes(order.pickup_time);
      return pickupMinutes === null || pickupMinutes >= currentMinutes - 30;
    })
    .slice(0, 5)
    .map((order) => ({
      id: order.id,
      customerName: order.customer_name,
      pickupTime: order.pickup_time,
      status: order.status,
      total: Number(order.total || 0),
    }));

  const firstResponseLatencies = computeFirstResponseLatencies(messages);
  const aiLatencies = responseEvents
    .filter((event) => event.responder_type === 'ai')
    .map((event) => Number(event.latency_ms))
    .filter(Number.isFinite);
  const humanLatencies = responseEvents
    .filter((event) => event.responder_type === 'human')
    .map((event) => Number(event.latency_ms))
    .filter(Number.isFinite);
  const ackLatencies = periodEscalations
    .filter((event) => event.acknowledged_at)
    .map((event) => new Date(event.acknowledged_at as string).getTime() - new Date(event.triggered_at).getTime())
    .filter((value) => Number.isFinite(value) && value >= 0);
  const resolveLatencies = periodEscalations
    .filter((event) => event.resolved_at)
    .map((event) => new Date(event.resolved_at as string).getTime() - new Date(event.triggered_at).getTime())
    .filter((value) => Number.isFinite(value) && value >= 0);

  const aiHealth = buildAiHealthReport(getConfig(empresaId));
  const attentionItems: DashboardAttentionItem[] = [];

  for (const event of openEscalations.slice(0, 2)) {
    attentionItems.push(attentionItem({
      id: `esc-${event.id}`,
      type: 'open_escalation',
      title: 'Atendimento humano aberto',
      description: event.trigger_name || 'Conversa esperando acompanhamento.',
      action: 'chat',
      tone: 'danger',
    }));
  }

  for (const session of staleManual.slice(0, 2)) {
    attentionItems.push(attentionItem({
      id: `manual-${session.id}`,
      type: 'stale_manual',
      title: session.customer_name || session.customer_phone || 'Cliente em atendimento',
      description: 'Está no manual e o cliente espera há mais de 10 minutos.',
      action: 'chat',
      tone: 'warning',
    }));
  }

  for (const session of waitingSessions.slice(0, 2)) {
    attentionItems.push(attentionItem({
      id: `wait-${session.id}`,
      type: 'waiting_chat',
      title: session.customer_name || session.customer_phone || 'Cliente aguardando',
      description: `${session.unread_count ?? 0} mensagem(ns) não lida(s).`,
      action: 'chat',
      tone: 'warning',
    }));
  }

  for (const order of atRiskOrders.slice(0, 2)) {
    attentionItems.push(attentionItem({
      id: `order-${order.id}`,
      type: 'order_risk',
      title: order.customer_name,
      description: `Pedido para ${order.pickup_time} precisa de atenção.`,
      action: 'kanban',
      tone: 'warning',
    }));
  }

  if (aiHealth.safeSummaryStatus !== 'ready') {
    attentionItems.push(attentionItem({
      id: 'ai-health',
      type: 'ai_config',
      title: 'Cérebro IA incompleto',
      description: aiHealth.safeSummaryStatus === 'disabled'
        ? 'A IA está desligada para respostas automáticas.'
        : aiHealth.safeSummaryStatus === 'scheduled_off'
          ? 'A IA está agendada e ficará ativa na próxima janela automática.'
          : 'Revise cardápio, horários, Pix ou telefone do gerente.',
      action: 'ai-configs',
      tone: 'neutral',
    }));
  }

  return {
    range,
    generatedAt: new Date().toISOString(),
    periodLabel,
    startDate: startDateKey,
    endDate: endDateKey,
    now: {
      waitingConversations: waitingSessions.length,
      openEscalations: openEscalations.length,
      manualConversations: manualSessions.length,
      aiConversations: aiSessions.length,
      staleManualConversations: staleManual.length,
    },
    speed: {
      firstResponseMs: metric(avg(firstResponseLatencies), firstResponseLatencies.length),
      aiResponseMs: metric(avg(aiLatencies), aiLatencies.length),
      humanResponseMs: metric(avg(humanLatencies), humanLatencies.length),
      escalationAckMs: metric(avg(ackLatencies), ackLatencies.length),
      escalationResolveMs: metric(avg(resolveLatencies), resolveLatencies.length),
    },
    orders: {
      count: periodOrders.length,
      revenue: periodRevenue,
      averageTicket: periodOrders.length > 0 ? periodRevenue / periodOrders.length : null,
      pendingCount: pendingOrders.length,
      preparingCount: preparingOrders.length,
      atRiskCount: atRiskOrders.length,
      upcoming: upcomingOrders,
    },
    aiHealth,
    attentionItems: attentionItems.slice(0, 6),
  };
}
