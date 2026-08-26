import { apiFetch, apiUrl } from '../config';
import { AUTOMATION_KINDS, getAutomationLabel, type AutomationKind } from '../domain/customerAutomation';

export { AUTOMATION_KINDS, getAutomationLabel };
export type { AutomationKind };

export interface AutomationRule {
  id?: string;
  kind: AutomationKind;
  enabled: boolean;
  message: string;
  timezone: string;
  sendStart: string;
  sendEnd: string;
  audience: string;
  dailyLimit: number;
  config: Record<string, unknown>;
  version: number;
  whatsappConnected?: boolean;
  pausedReason?: string | null;
}

export interface AutomationDispatch {
  id: string;
  status: string;
  personName?: string | null;
  suppressionReason?: string | null;
  createdAt?: string;
  sentAt?: string | null;
  failureReason?: string | null;
}

const defaults: Record<AutomationKind, Omit<AutomationRule, 'kind'>> = {
  birthday: { enabled: false, message: '', timezone: 'America/Sao_Paulo', sendStart: '09:00', sendEnd: '20:00', audience: 'Clientes com telefone e sem bloqueio', dailyLimit: 50, config: { daysBefore: 0, sendAt: '10:00' }, version: 1 },
  reactivation: { enabled: false, message: '', timezone: 'America/Sao_Paulo', sendStart: '09:00', sendEnd: '20:00', audience: 'Clientes inativos com telefone', dailyLimit: 50, config: { inactiveDays: 30, cooldownDays: 30 }, version: 1 },
  post_purchase: { enabled: false, message: '', timezone: 'America/Sao_Paulo', sendStart: '09:00', sendEnd: '20:00', audience: 'Clientes com pedido entregue', dailyLimit: 50, config: { delayHours: 24 }, version: 1 },
  vip: { enabled: false, message: '', timezone: 'America/Sao_Paulo', sendStart: '09:00', sendEnd: '20:00', audience: 'Clientes VIP com telefone', dailyLimit: 50, config: { deliveredOrders: 5, totalSpentCents: 30000, thresholdVersion: 1 }, version: 1 },
  abandoned_cart: { enabled: false, message: '', timezone: 'America/Sao_Paulo', sendStart: '09:00', sendEnd: '20:00', audience: 'Clientes com carrinho abandonado', dailyLimit: 50, config: { delayHours: 2 }, version: 1 },
};

export function getDefaultAutomationRule(kind: AutomationKind): AutomationRule {
  const base = defaults[kind];
  return { kind, ...base, config: { ...base.config } };
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export class CustomerAutomationApiError extends Error {
  readonly code: string | null;
  constructor(message: string, code: string | null = null) { super(message); this.name = 'CustomerAutomationApiError'; this.code = code; }
}

function friendlyError(code: string | null, status: number): string {
  if (status === 403) return 'Você não tem permissão para gerenciar automações.';
  if (code === 'AUTOMATION_INVALID') return 'Revise a mensagem, horário, público e limite antes de ativar.';
  if (code === 'AUTOMATION_KIND_INVALID') return 'Essa jornada não está disponível.';
  return 'Não foi possível atualizar as automações. Tente novamente.';
}

async function parse<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try { body = await response.json(); } catch { /* friendly fallback */ }
  if (!response.ok) {
    const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const code = typeof record.code === 'string' ? record.code : null;
    throw new CustomerAutomationApiError(friendlyError(code, response.status), code);
  }
  return body as T;
}

function normalize(raw: Record<string, unknown>, kind: AutomationKind): AutomationRule {
  const base = getDefaultAutomationRule(kind);
  const rawConfig = raw.config && typeof raw.config === 'object' ? raw.config as Record<string, unknown> : {};
  return {
    ...base,
    ...raw,
    kind,
    enabled: Boolean(raw.enabled),
    message: typeof raw.message === 'string' ? raw.message : base.message,
    timezone: typeof raw.timezone === 'string' ? raw.timezone : base.timezone,
    sendStart: typeof raw.sendStart === 'string' ? raw.sendStart : typeof raw.send_start === 'string' ? raw.send_start : base.sendStart,
    sendEnd: typeof raw.sendEnd === 'string' ? raw.sendEnd : typeof raw.send_end === 'string' ? raw.send_end : base.sendEnd,
    audience: typeof raw.audience === 'string' ? raw.audience : typeof raw.audience_label === 'string' ? raw.audience_label : base.audience,
    dailyLimit: typeof raw.dailyLimit === 'number' ? raw.dailyLimit : typeof raw.daily_limit === 'number' ? raw.daily_limit : typeof rawConfig.dailyLimit === 'number' ? rawConfig.dailyLimit : base.dailyLimit,
    config: { ...base.config, ...rawConfig },
    version: typeof raw.version === 'number' ? raw.version : base.version,
    whatsappConnected: typeof raw.whatsappConnected === 'boolean' ? raw.whatsappConnected : typeof raw.whatsapp_connected === 'boolean' ? raw.whatsapp_connected : undefined,
    pausedReason: typeof raw.pausedReason === 'string' ? raw.pausedReason : typeof raw.paused_reason === 'string' ? raw.paused_reason : null,
  };
}

export async function fetchCustomerAutomations(token: string): Promise<AutomationRule[]> {
  const response = await apiFetch(apiUrl('/api/customer-automations'), { headers: authHeaders(token) });
  const body = await parse<{ automations?: Record<string, unknown>[] }>(response);
  const rows = new Map((body.automations ?? []).map((row) => [row.kind, row]));
  return AUTOMATION_KINDS.map((kind) => normalize(rows.get(kind) ?? {}, kind));
}

export async function updateCustomerAutomation(token: string, rule: AutomationRule): Promise<AutomationRule> {
  const response = await apiFetch(apiUrl(`/api/customer-automations/${encodeURIComponent(rule.kind)}`), { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ enabled: rule.enabled, message: rule.message, timezone: rule.timezone, sendStart: rule.sendStart, sendEnd: rule.sendEnd, config: { ...rule.config, audience: rule.audience, dailyLimit: rule.dailyLimit }, version: rule.version }) });
  return normalize(await parse<Record<string, unknown>>(response), rule.kind);
}

export async function setCustomerAutomationStatus(token: string, kind: AutomationKind, enabled: boolean): Promise<AutomationRule> {
  const response = await apiFetch(apiUrl(`/api/customer-automations/${encodeURIComponent(kind)}/${enabled ? 'enable' : 'disable'}`), { method: 'POST', headers: authHeaders(token), body: '{}' });
  return normalize(await parse<Record<string, unknown>>(response), kind);
}

export async function sendCustomerAutomationTest(token: string, kind: AutomationKind, phone: string): Promise<{ ok: boolean; status: string }> {
  const response = await apiFetch(apiUrl(`/api/customer-automations/${encodeURIComponent(kind)}/test`), { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ phone }) });
  return parse(response);
}

export async function fetchCustomerAutomationHistory(token: string, kind: AutomationKind): Promise<AutomationDispatch[]> {
  const response = await apiFetch(apiUrl(`/api/customer-automations/${encodeURIComponent(kind)}/history`), { headers: authHeaders(token) });
  const body = await parse<{ dispatches?: Record<string, unknown>[] }>(response);
  return (body.dispatches ?? []).map((raw) => ({ id: String(raw.id ?? ''), status: String(raw.status ?? 'queued'), personName: typeof raw.person_name === 'string' ? raw.person_name : null, suppressionReason: typeof raw.suppression_reason === 'string' ? raw.suppression_reason : null, createdAt: typeof raw.created_at === 'string' ? raw.created_at : undefined, sentAt: typeof raw.sent_at === 'string' ? raw.sent_at : null, failureReason: typeof raw.failure_reason === 'string' ? raw.failure_reason : null }));
}
