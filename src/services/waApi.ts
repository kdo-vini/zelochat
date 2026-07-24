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
import type { AiGlobalMode, AiScheduleDays } from '../domain/aiSchedule';

type SessionsResponse = ChatSessionsPage;
type SessionResponse = { session: ChatSession };
export type AiHealthSummaryStatus = 'ready' | 'disabled' | 'scheduled_off' | 'needs_configuration';
export interface AiSettings {
  mode: AiGlobalMode;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  scheduleDays: AiScheduleDays | null;
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
export interface ZeloMenuReviewSession {
  id: string;
  orderingId: string;
  state: 'cart_open' | 'confirmed_waiting_review' | 'confirmed_waiting_payment' | 'needs_customer_adjustment' | 'accepted' | 'rejected' | 'cancelled' | 'archived';
  revision: number;
  customer: {
    name: string | null;
    phone: string | null;
  };
  cart: {
    items: Array<{
      productName: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      notes?: string | null;
    }>;
    observations: string | null;
  };
  fulfillment: {
    type: 'pickup' | 'delivery';
    pickupDate: string | null;
    pickupTime: string | null;
    deliveryAddress: string | null;
    deliveryNeighborhood: string | null;
    deliveryFee: number;
    deliveryFeeToConfirm: boolean;
  };
  pricing: {
    subtotal: number;
    deliveryFee: number;
    total: number;
  };
  payment: {
    declaredMethod: string | null;
    pixReceiptRequired: boolean;
    pixReceiptApproved: boolean;
  };
  acceptance: {
    acceptedAt: string | null;
    acceptedByUserId: string | null;
    acceptedByName: string | null;
  };
  productionOrder: {
    id: string | null;
    shortId: string | null;
  };
  confirmedAt: string | null;
  updatedAt: string;
  archivedAt: string | null;
}
export interface ZeloMenuReviewRevalidation {
  checkedAt: string;
  ok: boolean;
  issues: Array<{
    code: string;
    message: string;
    productName?: string;
    requestedQuantity?: number;
    availableQuantity?: number | null;
    previousUnitPrice?: number;
    currentUnitPrice?: number;
  }>;
}
export interface ZeloMenuReviewResponse {
  session: ZeloMenuReviewSession;
  revalidation: ZeloMenuReviewRevalidation | null;
  review: {
    canAccept: boolean;
    blockingReason: string | null;
  };
}
export interface ZeloMenuReviewAcceptResponse extends ZeloMenuReviewResponse {
  accepted: boolean;
  alreadyAccepted: boolean;
  customerMessage: string | null;
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

// ZLM-203 — slug público da loja (menu.zelopdv.com.br/{slug}).
export type ZeloMenuSlugResponse = { slug: string | null; publicUrl: string | null };

export type ZeloMenuStoreSettings = {
  logoUrl: string | null;
  companyName: string;
  companySpecialty: string;
  welcomeText: string | null;
  featuredEnabled: boolean;
  featuredProductIds: number[];
  categoryOrder: string[];
  availableProducts: Array<{ id: number; name: string; categoryName: string }>;
  availableCategories: string[];
};

export async function getZeloMenuSettings(token: string): Promise<ZeloMenuStoreSettings> {
  const response = await apiFetch(apiUrl('/api/zelomenu/settings'), { headers: authHeaders(token) });
  return parseResponse<ZeloMenuStoreSettings>(response);
}

export async function generateZeloMenuWelcome(
  token: string,
  opts: { companyName: string; companySpecialty: string; categories: string[] },
): Promise<string> {
  const { companyName, companySpecialty, categories } = opts;
  const catList = categories.slice(0, 8).join(', ');
  const response = await apiFetch(apiUrl('/api/ai/complete'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          content: `Escreva um texto de boas-vindas para o cardápio digital da loja "${companyName}"${companySpecialty ? ` (${companySpecialty})` : ''}. Categorias do cardápio: ${catList || 'variadas'}.\n\nRegras: máximo 2 a 3 linhas, tom acolhedor e animado, sem usar emojis, em português brasileiro. Retorne apenas o texto, sem aspas ou explicações.`,
        },
      ],
      temperature: 0.8,
    }),
  });
  const body = await parseResponse<{ content?: string }>(response);
  const text = body.content?.trim() ?? '';
  if (!text) throw new Error('A IA não retornou um texto. Tente de novo.');
  return text;
}

export async function updateZeloMenuSettings(
  token: string,
  patch: Partial<Pick<ZeloMenuStoreSettings, 'welcomeText' | 'featuredEnabled' | 'featuredProductIds' | 'categoryOrder'>>,
): Promise<void> {
  const response = await apiFetch(apiUrl('/api/zelomenu/settings'), {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  });
  await parseResponse<{ ok: boolean }>(response);
}

export async function getZeloMenuSlug(token: string): Promise<ZeloMenuSlugResponse> {
  const response = await apiFetch(apiUrl('/api/zelomenu/slug'), { headers: authHeaders(token) });
  return parseResponse<ZeloMenuSlugResponse>(response);
}

export async function setZeloMenuSlug(token: string, slug: string): Promise<ZeloMenuSlugResponse> {
  const response = await apiFetch(apiUrl('/api/zelomenu/slug'), {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ slug }),
  });
  return parseResponse<ZeloMenuSlugResponse>(response);
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

export async function getZeloMenuReviewSession(
  token: string,
  input: { remoteJid: string; shortId?: string | null },
): Promise<ZeloMenuReviewResponse> {
  const params = new URLSearchParams({ remoteJid: input.remoteJid });
  if (input.shortId?.trim()) params.set('shortId', input.shortId.trim());
  const response = await apiFetch(
    apiUrl(`/api/zelomenu/cart-sessions/review?${params.toString()}`),
    { headers: authHeaders(token) },
  );
  return parseResponse<ZeloMenuReviewResponse>(response);
}

export async function acceptZeloMenuReviewSession(
  token: string,
  sessionId: string,
  acceptedByName?: string | null,
): Promise<ZeloMenuReviewAcceptResponse> {
  const response = await apiFetch(apiUrl(`/api/zelomenu/cart-sessions/${encodeURIComponent(sessionId)}/accept`), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ acceptedByName: acceptedByName ?? null }),
  });
  return parseResponse<ZeloMenuReviewAcceptResponse>(response);
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

export async function sendPresence(
  token: string,
  jid: string,
  presence: 'composing' | 'available',
): Promise<void> {
  try {
    await fetch(apiUrl('/api/presence'), {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ jid, presence }),
      keepalive: true,
    });
  } catch {
    // best-effort
  }
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
  redirectPhone?: string | null,
  redirectMessage?: string | null,
): Promise<Trigger> {
  const response = await apiFetch(apiUrl('/api/triggers'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ naturalInput, kind, redirectPhone, redirectMessage }),
  });
  const body = await parseResponse<{ trigger: Trigger }>(response);
  return body.trigger;
}

export async function updateTrigger(
  token: string,
  id: string,
  patch: {
    name?: string;
    conditionDescription?: string;
    active?: boolean;
    kind?: TriggerKind;
    redirectPhone?: string | null;
    redirectMessage?: string | null;
  },
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
    scheduleDays: body.scheduleDays ?? null,
  };
}

export interface BlockedDateEntry {
  date: string;
  reason: string;
}

export interface ScheduleParseResponse {
  mode: AiGlobalMode;
  scheduleDays: AiScheduleDays | null;
  /** Null = no change. Array = full proposed list (replaces current). */
  blockedDates: BlockedDateEntry[] | null;
  summary: string;
}

export async function parseScheduleDescription(
  token: string,
  payload: {
    description: string;
    currentSchedule: AiScheduleDays | null;
    currentBlockedDates?: BlockedDateEntry[];
  },
): Promise<ScheduleParseResponse> {
  const response = await apiFetch(apiUrl('/api/ai/schedule-parse'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return parseResponse<ScheduleParseResponse>(response);
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
  expectedRevision: number,
): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/orders/${encodeURIComponent(orderId)}/status`), {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ status, expectedRevision }),
  });
  await parseResponse(response);
}

export async function cancelOrderApi(token: string, orderId: string, expectedRevision: number): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/orders/${encodeURIComponent(orderId)}`), {
    method: 'DELETE', headers: authHeaders(token), body: JSON.stringify({ expectedRevision }),
  });
  await parseResponse(response);
}

export interface ManualOrderPayload {
  customerName: string;
  customerPhone: string;
  items: Array<{ product: string; quantity: number; unitPrice: number }>;
  pickupDate: string;
  pickupTime: string;
  deliveryAddress?: string;
  paymentMethod?: string;
  observations?: string;
  idempotencyKey?: string;
}

export async function createManualOrderApi(token: string, payload: ManualOrderPayload): Promise<{ order: import('../types').Order }> {
  const response = await apiFetch(apiUrl('/api/orders/manual'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return parseResponse<{ order: import('../types').Order }>(response);
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
  data: { name: string; color: string; aiInstructions: string | null; autoApplyCondition?: string | null },
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
  patch: Partial<{ name: string; color: string; aiInstructions: string | null; autoApplyCondition: string | null }>,
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
