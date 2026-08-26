import { apiFetch, apiUrl } from '../config';

export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';
export type CampaignRecipientStatus = 'eligible' | 'suppressed' | 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';
export type SuppressionReason = 'sem_telefone' | 'funcionario' | 'conflito_identidade' | 'bloqueado' | 'opt_out';

export interface CampaignDefinition {
  activityState?: 'active' | 'inactive' | 'never';
  hasPhone?: boolean;
  minOrders?: number;
  minTotalValue?: number;
}

export interface CustomerSegment {
  id: string;
  name: string;
  definition: CampaignDefinition;
  created_at?: string;
  updated_at?: string;
}

export interface Campaign {
  id: string;
  name: string;
  message: string;
  segment_id: string | null;
  status: CampaignStatus;
  scheduled_at: string | null;
  audience_version: number | null;
  preview_version: number | null;
  created_at?: string;
  updated_at?: string;
  metrics?: Record<string, number> | null;
}

export interface AudiencePerson {
  id: string;
  name: string;
  phone: string | null;
  activityState: 'active' | 'inactive' | 'never';
  orderCount: number;
  totalValue: number;
  isEmployee?: boolean;
  hasConflict?: boolean;
  blocked?: boolean;
  optedOut?: boolean;
}

export interface SuppressedPerson extends AudiencePerson {
  suppressionReason: SuppressionReason;
}

export interface CampaignPreview {
  eligible: AudiencePerson[];
  suppressed: SuppressedPerson[];
  version: number;
}

export interface CampaignRecipient {
  id: string;
  pessoa_id: string;
  name_snapshot: string;
  phone_snapshot: string | null;
  status: CampaignRecipientStatus;
  suppression_reason: SuppressionReason | null;
  failure_reason?: string | null;
  created_at?: string;
  sent_at?: string | null;
}

export class CampaignApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status = 0, code: string | null = null) {
    super(message);
    this.name = 'CampaignApiError';
    this.status = status;
    this.code = code;
  }
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function friendlyCampaignError(code: string | null, status: number): string {
  if (status === 403) return 'Você não tem permissão para gerenciar campanhas.';
  if (code === 'CAMPAIGN_TEST_PHONE_REQUIRED') return 'Informe um número para testar a mensagem.';
  if (code === 'CAMPAIGN_MESSAGE_REQUIRED') return 'Escreva uma mensagem antes de continuar.';
  if (code === 'CAMPAIGN_NOT_FOUND') return 'Essa campanha não está mais disponível.';
  return 'Não foi possível concluir essa ação. Tente novamente.';
}

async function parseResponse<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try { body = await response.json(); } catch { /* friendly fallback below */ }
  if (!response.ok) {
    const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
    const code = typeof record.code === 'string' ? record.code : null;
    throw new CampaignApiError(friendlyCampaignError(code, response.status), response.status, code);
  }
  return body as T;
}

export async function fetchSegments(token: string): Promise<CustomerSegment[]> {
  const response = await apiFetch(apiUrl('/api/customer-segments'), { headers: authHeaders(token) });
  const body = await parseResponse<{ segments?: CustomerSegment[] }>(response);
  return body.segments ?? [];
}

export async function createSegment(token: string, input: { name: string; definition: CampaignDefinition }): Promise<CustomerSegment> {
  const response = await apiFetch(apiUrl('/api/customer-segments'), { method: 'POST', headers: authHeaders(token), body: JSON.stringify(input) });
  return parseResponse<CustomerSegment>(response);
}

export async function fetchCampaigns(token: string): Promise<Campaign[]> {
  const response = await apiFetch(apiUrl('/api/campaigns'), { headers: authHeaders(token) });
  const body = await parseResponse<{ campaigns?: Campaign[] }>(response);
  return body.campaigns ?? [];
}

export async function createCampaign(token: string, input: { name: string; message: string; segmentId?: string | null }): Promise<Campaign> {
  const response = await apiFetch(apiUrl('/api/campaigns'), { method: 'POST', headers: authHeaders(token), body: JSON.stringify(input) });
  return parseResponse<Campaign>(response);
}

export async function updateCampaign(token: string, id: string, input: { name?: string; message?: string; segmentId?: string | null }): Promise<Campaign> {
  const response = await apiFetch(apiUrl(`/api/campaigns/${encodeURIComponent(id)}`), { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify(input) });
  return parseResponse<Campaign>(response);
}

export async function previewCampaign(token: string, id: string, definition: CampaignDefinition): Promise<CampaignPreview> {
  const response = await apiFetch(apiUrl(`/api/campaigns/${encodeURIComponent(id)}/preview`), { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ definition }) });
  return parseResponse<CampaignPreview>(response);
}

export async function sendCampaignTest(token: string, id: string, phone: string): Promise<{ ok: boolean; status: 'queued' }> {
  const response = await apiFetch(apiUrl(`/api/campaigns/${encodeURIComponent(id)}/test`), { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ phone }) });
  return parseResponse(response);
}

export async function scheduleCampaign(token: string, id: string, scheduledAt: string | null): Promise<{ campaign: Campaign; recipientCount: number }> {
  const response = await apiFetch(apiUrl(`/api/campaigns/${encodeURIComponent(id)}/schedule`), { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ scheduledAt }) });
  return parseResponse(response);
}

export async function setCampaignStatus(token: string, id: string, action: 'pause' | 'resume' | 'cancel'): Promise<Campaign> {
  const response = await apiFetch(apiUrl(`/api/campaigns/${encodeURIComponent(id)}/${action}`), { method: 'POST', headers: authHeaders(token), body: '{}' });
  return parseResponse<Campaign>(response);
}

export async function fetchCampaignRecipients(token: string, id: string): Promise<CampaignRecipient[]> {
  const response = await apiFetch(apiUrl(`/api/campaigns/${encodeURIComponent(id)}/recipients`), { headers: authHeaders(token) });
  const body = await parseResponse<{ recipients?: CampaignRecipient[] }>(response);
  return body.recipients ?? [];
}
