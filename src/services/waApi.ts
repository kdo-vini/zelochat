import type {
  BuiltinTriggerInfo,
  ChatAttachment,
  ChatMessage,
  ChatSession,
  ChatSessionsPage,
  ChatSessionsQuery,
  DashboardOverview,
  DashboardRange,
  EscalationEvent,
  Tag,
  Trigger,
  TriggerKind,
} from '../types';
import { apiUrl, apiFetch } from '../config';
import type { AiGlobalMode } from '../domain/aiSchedule';

type SessionsResponse = ChatSessionsPage;
type SessionResponse = { session: ChatSession };
export type AiHealthSummaryStatus = 'ready' | 'disabled' | 'scheduled_off' | 'needs_configuration';
export interface AiSettings {
  mode: AiGlobalMode;
  scheduleStart: string | null;
  scheduleEnd: string | null;
}
export interface AiHealthReport {
  catalogLoaded: boolean;
  operatingHoursConfigured: boolean;
  deliveryConfigConfigured: boolean;
  managerPhonePresent: boolean;
  pixPresent: boolean;
  pixReceiptConfigured: boolean;
  pixReceiptEnabled: boolean;
  aiEnabled: boolean;
  aiMode: AiGlobalMode;
  aiEffectiveEnabledNow: boolean;
  blockedDatesCount: number;
  safeSummaryStatus: AiHealthSummaryStatus;
}
export interface ManagerAssistantStatePatch {
  blockedDates?: { date: string; reason: string }[];
  dailyContext?: { id: string; text: string }[];
  businessInfo?: {
    openTime?: string;
    closeTime?: string;
    closedDays?: string[];
  };
  aiEnabled?: boolean;
  aiInstructionsDraft?: string;
  notificationToggles?: {
    notify_customer_preparing?: boolean;
    notify_customer_ready?: boolean;
    notify_customer_out_for_delivery?: boolean;
  };
  health?: AiHealthReport;
}
export interface ManagerAssistantResult {
  reply: string;
  managerHistory: ChatMessage[];
  statePatch: ManagerAssistantStatePatch;
  actionsApplied: { type: string; label: string }[];
  actionsRejected: string[];
}
type SendMessagePayload = {
  message?: string;
  attachment?: ChatAttachment;
  quoted?: { waMessageId: string; fromMe: boolean; remoteJid: string; previewText?: string } | null;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error((body as { error?: string }).error || `HTTP ${response.status}`);
  }

  return body as T;
}

function authHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function bindEmpresa(token: string): Promise<void> {
  const response = await apiFetch(apiUrl('/api/bind-empresa'), {
    method: 'POST',
    headers: authHeaders(token),
  });

  await parseResponse(response);
}

export async function getSessions(token: string, query: ChatSessionsQuery = {}): Promise<ChatSessionsPage> {
  const params = new URLSearchParams();
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.status && query.status !== 'all') params.set('status', query.status);
  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.tagId) params.set('tagId', query.tagId);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await apiFetch(apiUrl(`/api/sessions${suffix}`), {
    headers: authHeaders(token),
  });

  const body = await parseResponse<SessionsResponse>(response);
  return {
    sessions: body.sessions,
    nextCursor: body.nextCursor ?? null,
    hasMore: body.hasMore ?? false,
  };
}

export async function getSession(token: string, jid: string): Promise<ChatSession & { hasMore: boolean }> {
  const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(jid)}?limit=50`), {
    headers: authHeaders(token),
  });

  const body = await parseResponse<SessionResponse & { hasMore?: boolean }>(response);
  return { ...body.session, hasMore: body.hasMore ?? false };
}

export async function getOlderMessages(
  token: string,
  jid: string,
  before: string,
  limit = 50,
): Promise<{ messages: ChatSession['messages']; hasMore: boolean }> {
  const params = new URLSearchParams({ before, limit: String(limit) });
  const response = await apiFetch(
    apiUrl(`/api/sessions/${encodeURIComponent(jid)}/messages?${params.toString()}`),
    { headers: authHeaders(token) },
  );
  const body = await parseResponse<{ messages: ChatSession['messages']; hasMore: boolean }>(response);
  return body;
}

export async function sendMessage(
  token: string,
  to: string,
  payload: SendMessagePayload,
): Promise<void> {
  const response = await apiFetch(apiUrl('/api/send'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ to, ...payload }),
  });

  await parseResponse(response);
}

export async function sendContact(
  token: string,
  to: string,
  contact: { fullName: string; phoneNumber: string; organization?: string },
): Promise<void> {
  const response = await apiFetch(apiUrl('/api/send-contact'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ to, ...contact }),
  });
  await parseResponse(response);
}

export async function deleteMessage(
  token: string,
  messageId: string,
  payload: { remoteJid: string; fromMe: boolean; dbMessageId?: string },
): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/messages/${encodeURIComponent(messageId)}`), {
    method: 'DELETE',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });

  await parseResponse(response);
}

export async function markSessionRead(token: string, jid: string): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(jid)}/read`), {
    method: 'POST',
    headers: authHeaders(token),
  });

  await parseResponse(response);
}

export async function markSessionsRead(token: string, jids: string[]): Promise<void> {
  if (jids.length === 0) return;
  const response = await apiFetch(apiUrl('/api/sessions/bulk/read'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ jids }),
  });
  await parseResponse(response);
}

export async function archiveSessions(token: string, jids: string[]): Promise<void> {
  if (jids.length === 0) return;
  const response = await apiFetch(apiUrl('/api/sessions/bulk/archive'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ jids }),
  });
  await parseResponse(response);
}

export async function bulkDeleteSessions(token: string, jids: string[]): Promise<void> {
  if (jids.length === 0) return;
  const response = await apiFetch(apiUrl('/api/sessions/bulk/delete'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ jids }),
  });
  await parseResponse(response);
}

export async function setSessionPinned(
  token: string,
  jid: string,
  pinned: boolean,
): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(jid)}/pin`), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ pinned }),
  });
  await parseResponse(response);
}

export async function setSessionAutoReply(
  token: string,
  jid: string,
  enabled: boolean,
): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(jid)}/auto-reply`), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ enabled }),
  });

  await parseResponse(response);
}

export async function deleteSession(token: string, jid: string): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(jid)}`), {
    method: 'DELETE',
    headers: authHeaders(token),
  });

  await parseResponse(response);
}

export async function fetchProfilePicture(token: string, jid: string): Promise<string | null> {
  try {
    const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(jid)}/profile-picture`), {
      headers: authHeaders(token),
    });
    const body = await parseResponse<{ url: string | null }>(response);
    return body.url;
  } catch {
    return null;
  }
}

export async function listTriggers(token: string): Promise<Trigger[]> {
  const response = await apiFetch(apiUrl('/api/triggers'), {
    headers: authHeaders(token),
  });
  const body = await parseResponse<{ triggers: Trigger[] }>(response);
  return body.triggers;
}

export async function createTrigger(
  token: string,
  naturalInput: string,
  kind: TriggerKind,
): Promise<Trigger> {
  const response = await apiFetch(apiUrl('/api/triggers'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ naturalInput, kind }),
  });
  const body = await parseResponse<{ trigger: Trigger }>(response);
  return body.trigger;
}

export async function updateTrigger(
  token: string,
  id: string,
  patch: { name?: string; conditionDescription?: string; active?: boolean; kind?: TriggerKind },
): Promise<Trigger> {
  const response = await apiFetch(apiUrl(`/api/triggers/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  });
  const body = await parseResponse<{ trigger: Trigger }>(response);
  return body.trigger;
}

export async function deleteTrigger(token: string, id: string): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/triggers/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  await parseResponse(response);
}

export async function updateSessionName(token: string, jid: string, name: string): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(jid)}/name`), {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ name }),
  });
  await parseResponse(response);
}

export async function getAiEnabled(token: string): Promise<boolean> {
  const response = await apiFetch(apiUrl('/api/ai-enabled'), {
    headers: authHeaders(token),
  });
  const body = await parseResponse<{ enabled: boolean }>(response);
  return body.enabled !== false;
}

export async function getAiSettings(token: string): Promise<AiSettings> {
  const response = await apiFetch(apiUrl('/api/ai-settings'), {
    headers: authHeaders(token),
  });
  return parseResponse<AiSettings>(response);
}

export async function getAiHealth(token: string): Promise<AiHealthReport> {
  const response = await apiFetch(apiUrl('/api/ai/health'), {
    headers: authHeaders(token),
  });
  const body = await parseResponse<{ health: AiHealthReport }>(response);
  return body.health;
}

export async function sendManagerAssistantMessage(
  token: string,
  payload: { message: string; history?: ChatMessage[] },
): Promise<ManagerAssistantResult> {
  const response = await apiFetch(apiUrl('/api/ai/manager'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return parseResponse<ManagerAssistantResult>(response);
}

export async function setAiEnabled(token: string, enabled: boolean): Promise<void> {
  const response = await apiFetch(apiUrl('/api/ai-enabled'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ enabled }),
  });
  await parseResponse(response);
}

export async function setAiSettings(token: string, payload: AiSettings): Promise<AiSettings> {
  const response = await apiFetch(apiUrl('/api/ai-settings'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  const body = await parseResponse<AiSettings & { ok?: boolean }>(response);
  return {
    mode: body.mode,
    scheduleStart: body.scheduleStart,
    scheduleEnd: body.scheduleEnd,
  };
}

export async function dispatchDriver(token: string, driverId: string, orderId: string): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/drivers/${encodeURIComponent(driverId)}/dispatch`), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ orderId }),
  });
  await parseResponse(response);
}

export async function updateOrderStatusApi(
  token: string,
  orderId: string,
  status: string,
): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/orders/${encodeURIComponent(orderId)}/status`), {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ status }),
  });
  await parseResponse(response);
}

// --- Escalation ---

export async function listEscalationEvents(
  token: string,
  jid: string,
): Promise<EscalationEvent[]> {
  const response = await apiFetch(
    apiUrl(`/api/sessions/${encodeURIComponent(jid)}/escalation-events`),
    { headers: authHeaders(token) },
  );
  const body = await parseResponse<{ events: EscalationEvent[] }>(response);
  return body.events;
}

export async function resolveSession(token: string, jid: string): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/sessions/${encodeURIComponent(jid)}/resolve`),
    { method: 'POST', headers: authHeaders(token) },
  );
  await parseResponse(response);
}

export async function escalateSessionManually(
  token: string,
  jid: string,
  reason?: string,
): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/sessions/${encodeURIComponent(jid)}/escalate`),
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ reason }),
    },
  );
  await parseResponse(response);
}

export async function acknowledgeSession(token: string, jid: string): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/sessions/${encodeURIComponent(jid)}/acknowledge`),
    { method: 'POST', headers: authHeaders(token) },
  );
  await parseResponse(response);
}

export async function getOpenEscalationCount(token: string): Promise<number> {
  const response = await apiFetch(apiUrl('/api/escalations/open-count'), {
    headers: authHeaders(token),
  });
  const body = await parseResponse<{ count: number }>(response);
  return body.count ?? 0;
}

export async function getDashboardOverview(
  token: string,
  range: DashboardRange,
  period?: { startDate?: string; endDate?: string },
): Promise<DashboardOverview> {
  const params = new URLSearchParams({ range });
  if (period?.startDate) params.set('startDate', period.startDate);
  if (period?.endDate) params.set('endDate', period.endDate);
  const response = await apiFetch(apiUrl(`/api/dashboard/overview?${params.toString()}`), {
    headers: authHeaders(token),
  });
  const body = await parseResponse<{ overview: DashboardOverview }>(response);
  return body.overview;
}

export async function listBuiltinTriggers(token: string): Promise<BuiltinTriggerInfo[]> {
  const response = await apiFetch(apiUrl('/api/triggers/builtin'), {
    headers: authHeaders(token),
  });
  const body = await parseResponse<{ builtins: BuiltinTriggerInfo[] }>(response);
  return body.builtins;
}

export async function setBuiltinTriggerDisabled(
  token: string,
  builtinId: string,
  disabled: boolean,
): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/triggers/builtin/${encodeURIComponent(builtinId)}`),
    {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ disabled }),
    },
  );
  await parseResponse(response);
}

// ── Tags ─────────────────────────────────────────────────────────────────────

export async function getSessionTagsMap(token: string): Promise<Record<string, Tag[]>> {
  const response = await apiFetch(apiUrl('/api/sessions/tags-map'), { headers: authHeaders(token) });
  const body = await parseResponse<{ map: Record<string, Tag[]> }>(response);
  return body.map;
}

export async function listTags(token: string): Promise<Tag[]> {
  const response = await apiFetch(apiUrl('/api/tags'), { headers: authHeaders(token) });
  const body = await parseResponse<{ tags: Tag[] }>(response);
  return body.tags;
}

export async function createTag(
  token: string,
  data: { name: string; color: string; aiInstructions: string | null },
): Promise<Tag> {
  const response = await apiFetch(apiUrl('/api/tags'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  const body = await parseResponse<{ tag: Tag }>(response);
  return body.tag;
}

export async function updateTag(
  token: string,
  tagId: string,
  patch: Partial<{ name: string; color: string; aiInstructions: string | null }>,
): Promise<Tag> {
  const response = await apiFetch(apiUrl(`/api/tags/${encodeURIComponent(tagId)}`), {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  });
  const body = await parseResponse<{ tag: Tag }>(response);
  return body.tag;
}

export async function deleteTag(token: string, tagId: string): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/tags/${encodeURIComponent(tagId)}`), {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  await parseResponse(response);
}

export async function applyTagToSession(
  token: string,
  sessionId: string,
  tagId: string,
): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/tags/${encodeURIComponent(tagId)}`),
    { method: 'POST', headers: authHeaders(token) },
  );
  await parseResponse(response);
}

export async function removeTagFromSession(
  token: string,
  sessionId: string,
  tagId: string,
): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/tags/${encodeURIComponent(tagId)}`),
    { method: 'DELETE', headers: authHeaders(token) },
  );
  await parseResponse(response);
}
