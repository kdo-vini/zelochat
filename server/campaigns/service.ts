import { getServiceSupabase } from '../supabase.js';
import { evaluateAudience, parseSegmentDefinition, type AudiencePerson, type SegmentDefinition } from './filters.js';
import { resolveCustomerActivity } from '../customers/filters.js';
import { CAMPAIGN_LIMITS, canStartCampaign, createRateLimiter } from '../outbound/policy.js';
import { getInstanceForEmpresa } from '../instanceManager.js';
import { fingerprintOutboundPayload } from '../outbound/providerAdapter.js';
import { wakeOutboundWorker } from '../outbound/wake.js';

export interface CampaignPreview { eligible: AudiencePerson[]; suppressed: Array<AudiencePerson & { suppressionReason: string }>; version: number; }

export function canSendCampaignNow(campaign: { status: string; scheduledAt?: string | null }, now = new Date()): boolean {
  if (campaign.status === 'running') return true;
  return campaign.status === 'scheduled' && Boolean(campaign.scheduledAt) && Date.parse(campaign.scheduledAt as string) <= now.getTime();
}
export function campaignDailyLimit(requested: number): number { return Math.min(Math.max(Math.trunc(requested || CAMPAIGN_LIMITS.defaultDailyLimit), 1), CAMPAIGN_LIMITS.hardDailyCap); }
export function campaignStartKey(empresaId: string, instanceKey: string): string { return `${empresaId}:${instanceKey}`; }
const campaignStarts = createRateLimiter(CAMPAIGN_LIMITS.startsPerMinute, 60_000);

async function ownerForEmpresa(empresaId: string): Promise<string> {
  const { data, error } = await getServiceSupabase().from('empresa_perfil').select('user_id').eq('id', empresaId).maybeSingle();
  if (error || !data?.user_id) throw new Error('EMPRESA_NOT_FOUND');
  return data.user_id;
}

export async function listSegments(empresaId: string): Promise<unknown[]> { const { data, error } = await getServiceSupabase().from('zelochat_segments').select('*').eq('empresa_id', empresaId).order('name'); if (error) throw error; return data ?? []; }
export async function createSegment(empresaId: string, actorId: string, input: { name: string; definition: unknown }): Promise<unknown> {
  const definition = parseSegmentDefinition(input.definition); const owner = await ownerForEmpresa(empresaId);
  const { data, error } = await getServiceSupabase().from('zelochat_segments').insert({ empresa_id: empresaId, id_usuario: owner, name: input.name.trim(), definition, created_by: actorId }).select('*').single();
  if (error) throw error; return data;
}
export async function updateSegment(empresaId: string, id: string, input: { name?: string; definition?: unknown }): Promise<unknown> {
  const values: Record<string, unknown> = { updated_at: new Date().toISOString() }; if (input.name !== undefined) values.name = input.name.trim(); if (input.definition !== undefined) values.definition = parseSegmentDefinition(input.definition);
  const { data, error } = await getServiceSupabase().from('zelochat_segments').update(values).eq('id', id).eq('empresa_id', empresaId).select('*').single(); if (error) throw error; return data;
}
export async function deleteSegment(empresaId: string, id: string): Promise<void> { const { error } = await getServiceSupabase().from('zelochat_segments').delete().eq('id', id).eq('empresa_id', empresaId); if (error) throw error; }

async function loadAudience(empresaId: string, ownerUserId: string, definition: SegmentDefinition): Promise<CampaignPreview> {
  const db = getServiceSupabase();
  const [{ data: people, error: peopleError }, { data: blocked }, { data: conflicts }, { data: optouts }, { data: orders }, { data: personTags }, { data: tags }, { data: sessions }] = await Promise.all([
    db.from('pessoas').select('*').eq('id_usuario', ownerUserId),
    db.from('zelochat_customer_relationships').select('pessoa_id,whatsapp_blocked_at').eq('empresa_id', empresaId).not('whatsapp_blocked_at', 'is', null),
    db.from('zelochat_person_match_conflicts').select('candidate_person_ids').eq('empresa_id', empresaId).eq('state', 'open'),
    db.from('zelochat_customer_optouts').select('pessoa_id').eq('empresa_id', empresaId),
    db.from('zelo_orders').select('pessoa_id,total,status,closed_at,created_at').eq('empresa_id', empresaId).eq('status', 'delivered').not('pessoa_id', 'is', null),
    db.from('zelochat_person_tags').select('pessoa_id,tag_id').eq('empresa_id', empresaId),
    db.from('zelochat_tags').select('id,name').eq('empresa_id', empresaId),
    db.from('zelochat_sessions').select('pessoa_id,last_message_time').eq('empresa_id', empresaId).not('pessoa_id', 'is', null),
  ]);
  if (peopleError) throw peopleError;
  const count = new Map<string, { count: number; total: number; lastOrderAt: string | null }>();
  for (const row of orders ?? []) {
    const deliveredAt = row.closed_at ?? row.created_at ?? null;
    const current = count.get(row.pessoa_id) ?? { count: 0, total: 0, lastOrderAt: null };
    current.count += 1;
    current.total += Number(row.total ?? 0);
    if (deliveredAt && (!current.lastOrderAt || deliveredAt > current.lastOrderAt)) current.lastOrderAt = deliveredAt;
    count.set(row.pessoa_id, current);
  }
  const blockedIds = new Set((blocked ?? []).map((row) => row.pessoa_id)); const optedOutIds = new Set((optouts ?? []).map((row) => row.pessoa_id)); const conflictIds = new Set<string>();
  for (const conflict of conflicts ?? []) for (const id of Array.isArray(conflict.candidate_person_ids) ? conflict.candidate_person_ids : []) if (typeof id === 'string') conflictIds.add(id);
  const tagIdsByPerson = new Map<string, string[]>();
  for (const row of personTags ?? []) {
    if (typeof row.pessoa_id !== 'string' || typeof row.tag_id !== 'string') continue;
    tagIdsByPerson.set(row.pessoa_id, [...(tagIdsByPerson.get(row.pessoa_id) ?? []), row.tag_id]);
  }
  const vipTagIds = new Set((tags ?? []).filter((tag) => typeof tag.name === 'string' && tag.name.trim().toLocaleLowerCase() === 'vip').map((tag) => tag.id));
  const lastConversationByPerson = new Map<string, string | null>();
  for (const row of sessions ?? []) {
    if (typeof row.pessoa_id !== 'string' || typeof row.last_message_time !== 'string') continue;
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/u.test(row.last_message_time.trim())) continue;
    const parsed = new Date(row.last_message_time);
    if (Number.isNaN(parsed.getTime())) continue;
    const current = lastConversationByPerson.get(row.pessoa_id);
    const candidate = parsed.toISOString();
    if (!current || candidate > current) lastConversationByPerson.set(row.pessoa_id, candidate);
  }
  const audience: AudiencePerson[] = (people ?? []).map((person) => {
    const stats = count.get(person.id) ?? { count: 0, total: 0, lastOrderAt: null };
    const tagsForPerson = tagIdsByPerson.get(person.id) ?? [];
    const activity = resolveCustomerActivity({ lastDeliveredOrderAt: stats.lastOrderAt, lastConversationAt: lastConversationByPerson.get(person.id) ?? null });
    const origin = typeof person.origem === 'string' ? person.origem : typeof person.origin === 'string' ? person.origin : null;
    const birthdayMonth = person.aniversario_mes == null ? null : Number(person.aniversario_mes);
    return {
      id: person.id,
      name: person.nome || 'Cliente',
      phone: person.contato || null,
      activityState: activity.state,
      orderCount: stats.count,
      totalValue: stats.total,
      lastOrderAt: stats.lastOrderAt,
      tagIds: tagsForPerson,
      birthdayMonth,
      origin,
      isVip: tagsForPerson.some((tagId) => vipTagIds.has(tagId)),
      isEmployee: person.tipo !== 'cliente',
      hasConflict: conflictIds.has(person.id),
      blocked: blockedIds.has(person.id),
      optedOut: optedOutIds.has(person.id),
    };
  });
  const result = evaluateAudience(audience, definition); return { ...result, version: Date.now() };
}

export async function previewCampaign(empresaId: string, ownerUserId: string, definition: unknown): Promise<CampaignPreview> { return loadAudience(empresaId, ownerUserId, parseSegmentDefinition(definition)); }

export async function createCampaign(empresaId: string, actorId: string, input: { name: string; message: string; segmentId?: string | null }): Promise<unknown> {
  const owner = await ownerForEmpresa(empresaId); const message = input.message.trim(); if (!message) throw new Error('CAMPAIGN_MESSAGE_REQUIRED');
  const { data, error } = await getServiceSupabase().from('zelochat_campaigns').insert({ empresa_id: empresaId, id_usuario: owner, name: input.name.trim(), message, segment_id: input.segmentId ?? null, created_by: actorId }).select('*').single(); if (error) throw error; return data;
}
export async function listCampaigns(empresaId: string): Promise<unknown[]> { const { data, error } = await getServiceSupabase().from('zelochat_campaigns').select('*').eq('empresa_id', empresaId).order('created_at', { ascending: false }); if (error) throw error; return data ?? []; }
export async function updateCampaignDraft(empresaId: string, id: string, input: { name?: string; message?: string; segmentId?: string | null }): Promise<unknown> {
  const values: Record<string, unknown> = { updated_at: new Date().toISOString() }; if (input.name !== undefined) values.name = input.name.trim(); if (input.message !== undefined) { if (!input.message.trim()) throw new Error('CAMPAIGN_MESSAGE_REQUIRED'); values.message = input.message.trim(); } if (input.segmentId !== undefined) values.segment_id = input.segmentId;
  const { data, error } = await getServiceSupabase().from('zelochat_campaigns').update(values).eq('empresa_id', empresaId).eq('id', id).eq('status', 'draft').select('*').single(); if (error) throw error; return data;
}

export async function scheduleCampaign(empresaId: string, ownerUserId: string, id: string, scheduledAt: string | null): Promise<{ campaign: unknown; recipientCount: number }> {
  const db = getServiceSupabase(); const { data: campaign, error: campaignError } = await db.from('zelochat_campaigns').select('*').eq('empresa_id', empresaId).eq('id', id).eq('status', 'draft').maybeSingle(); if (campaignError) throw campaignError; if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');
  const segment = campaign.segment_id ? await db.from('zelochat_segments').select('definition').eq('id', campaign.segment_id).eq('empresa_id', empresaId).maybeSingle() : { data: { definition: {} }, error: null }; if (segment.error) throw segment.error;
  const preview = await previewCampaign(empresaId, ownerUserId, segment.data?.definition ?? {}); const now = new Date(); const targetAt = scheduledAt ? new Date(scheduledAt) : now; if (Number.isNaN(targetAt.getTime()) || targetAt.getTime() < now.getTime() - 60_000) throw new Error('CAMPAIGN_SCHEDULE_INVALID');
  const instanceKey = await getInstanceForEmpresa(empresaId); const startKey = campaignStartKey(empresaId, instanceKey); if (!campaignStarts.allow(startKey)) throw new Error('CAMPAIGN_START_RATE_LIMIT');
  const startOfDay = new Date(now); startOfDay.setUTCHours(0, 0, 0, 0); const { count: dailySent, error: sentCountError } = await db.from('zelochat_outbound_jobs').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('status', 'sent').gte('sent_at', startOfDay.toISOString()); if (sentCountError) throw sentCountError;
  const requested = preview.eligible.length; const dailyLimit = campaignDailyLimit(campaign.daily_limit); if (!canStartCampaign({ activeStartsLastMinute: 0, dailySent: dailySent ?? 0, requested, dailyLimit })) throw new Error('CAMPAIGN_DAILY_LIMIT');
  const recipients = [...preview.eligible, ...preview.suppressed].map((person) => ({ campaign_id: id, empresa_id: empresaId, pessoa_id: person.id, phone_snapshot: person.phone, name_snapshot: person.name, status: 'suppressionReason' in person ? 'suppressed' : 'queued', suppression_reason: 'suppressionReason' in person ? person.suppressionReason : null, idempotency_key: `${id}:${person.id}`, queued_at: 'suppressionReason' in person ? null : now.toISOString() }));
  if (recipients.length) { const { error } = await db.from('zelochat_campaign_recipients').upsert(recipients, { onConflict: 'campaign_id,pessoa_id', ignoreDuplicates: true }); if (error) throw error; }
  const eligibleRecipients = recipients.filter((recipient) => recipient.status === 'queued');
  if (eligibleRecipients.length) {
    const jobs = await Promise.all(eligibleRecipients.map(async (recipient) => {
      const message = interpolateCampaignMessage(campaign.message, recipient.name_snapshot);
      const payload = { kind: 'text' as const, text: message };
      return { empresa_id: empresaId, campaign_id: id, recipient_id: undefined, pessoa_id: recipient.pessoa_id, job_type: 'campaign', idempotency_key: `${id}:${recipient.pessoa_id}`, instance_key: instanceKey, phone_snapshot: recipient.phone_snapshot, message, outbound_origin: 'campaign', takeover_policy: 'preserve_ai', payload, payload_fingerprint: await fingerprintOutboundPayload(payload), status: 'queued', next_attempt_at: targetAt.toISOString() };
    }));
    const { data: savedRecipients, error: recipientLookupError } = await db.from('zelochat_campaign_recipients').select('id,pessoa_id').eq('campaign_id', id).eq('status', 'queued'); if (recipientLookupError) throw recipientLookupError; const ids = new Map((savedRecipients ?? []).map((recipient) => [recipient.pessoa_id, recipient.id])); for (const job of jobs) job.recipient_id = ids.get(job.pessoa_id);
    const { error: jobsError } = await db.from('zelochat_outbound_jobs').upsert(jobs, { onConflict: 'empresa_id,idempotency_key', ignoreDuplicates: true }); if (jobsError) throw jobsError;
    wakeOutboundWorker();
  }
  const { data: updated, error } = await db.from('zelochat_campaigns').update({ status: scheduledAt ? 'scheduled' : 'running', scheduled_at: scheduledAt, audience_version: preview.version, preview_version: preview.version, updated_at: new Date().toISOString() }).eq('id', id).eq('empresa_id', empresaId).eq('status', 'draft').select('*').single(); if (error) throw error;
  return { campaign: updated, recipientCount: recipients.length };
}
export function interpolateCampaignMessage(message: string, name: string | null): string { const firstName = String(name ?? 'cliente').trim().split(/\s+/u)[0] || 'cliente'; return message.replace(/\{\s*primeiro_nome\s*\}/giu, firstName); }
export function validateTestPhone(value: string): string { const digits = value.replace(/\D/g, ''); if (digits.length < 10 || digits.length > 15) throw new Error('CAMPAIGN_TEST_PHONE_INVALID'); return digits; }
export async function enqueueCampaignTest(empresaId: string, actorId: string, id: string, requestedPhone?: string): Promise<unknown> {
  const db = getServiceSupabase(); const { data: campaign, error: campaignError } = await db.from('zelochat_campaigns').select('message,status').eq('empresa_id', empresaId).eq('id', id).maybeSingle(); if (campaignError) throw campaignError; if (!campaign || campaign.status === 'cancelled') throw new Error('CAMPAIGN_NOT_FOUND'); const phone = validateTestPhone(requestedPhone?.trim() ?? ''); const instanceKey = await getInstanceForEmpresa(empresaId); const idempotencyKey = `campaign-test:${id}:${actorId}:${Math.floor(Date.now() / 60_000)}`; const message = interpolateCampaignMessage(campaign.message, 'teste'); const payload = { kind: 'text' as const, text: message }; const { data: job, error } = await db.from('zelochat_outbound_jobs').upsert({ empresa_id: empresaId, campaign_id: id, job_type: 'campaign', idempotency_key: idempotencyKey, instance_key: instanceKey, phone_snapshot: phone, message, outbound_origin: 'campaign', takeover_policy: 'preserve_ai', payload, payload_fingerprint: await fingerprintOutboundPayload(payload), status: 'queued', next_attempt_at: new Date().toISOString() }, { onConflict: 'empresa_id,idempotency_key', ignoreDuplicates: true }).select('id,status').maybeSingle(); if (error) throw error; if (!job) throw new Error('CAMPAIGN_TEST_ALREADY_QUEUED'); wakeOutboundWorker(); return job;
}
export async function setCampaignStatus(empresaId: string, id: string, status: 'paused' | 'running' | 'cancelled'): Promise<unknown> { const db = getServiceSupabase(); const { data: current, error: currentError } = await db.from('zelochat_campaigns').select('status,scheduled_at').eq('empresa_id', empresaId).eq('id', id).maybeSingle(); if (currentError) throw currentError; if (!current) throw new Error('CAMPAIGN_NOT_FOUND'); const next = status === 'running' && current.status === 'scheduled' && current.scheduled_at && Date.parse(current.scheduled_at) > Date.now() ? 'scheduled' : status; const { data, error } = await db.from('zelochat_campaigns').update({ status: next, updated_at: new Date().toISOString() }).eq('empresa_id', empresaId).in('status', ['scheduled', 'running', 'paused']).eq('id', id).select('*').single(); if (error) throw error; if (next === 'cancelled') await db.from('zelochat_campaign_recipients').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('campaign_id', id).in('status', ['queued', 'eligible']); return data; }
export async function listRecipients(empresaId: string, campaignId: string, limit = 50): Promise<unknown[]> { const { data, error } = await getServiceSupabase().from('zelochat_campaign_recipients').select('*').eq('empresa_id', empresaId).eq('campaign_id', campaignId).order('created_at').limit(Math.min(limit, 100)); if (error) throw error; return data ?? []; }
