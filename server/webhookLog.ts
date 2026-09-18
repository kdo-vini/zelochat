import { getServiceSupabase } from './supabase.js';
import { createHash } from 'node:crypto';

/**
 * Selective replay log for inbound webhook payloads. The log exists because
 * the 2026-04-29 P0.14 regression silently dropped inbound messages and the
 * provider exposes no history endpoint. Only events with recovery or security
 * value are written on the happy path; low-value lifecycle/contact/delete
 * events are captured retroactively if their processing throws.
 *
 * Migration: supabase/migrations/016_webhook_events_raw.sql
 */

export type WebhookAuthStatus = 'token_match' | 'token_missing' | 'token_mismatch';

export interface RawEventRow {
  instance: string;
  empresa_id: string | null;
  event_type: string | null;
  wa_message_id: string | null;
  payload: unknown;
  auth_status: WebhookAuthStatus;
  dedupe_fingerprint: string | null;
}

export type RawWebhookInsertResult = { id: string; inserted: boolean };
export type RawWebhookInsert = (row: RawEventRow) => Promise<RawWebhookInsertResult | null>;

export type RawWebhookRecordResult =
  | { status: 'persisted'; id: string; reason: 'replayable_event' | 'security_evidence' | 'forced_failure_capture' }
  | { status: 'skipped'; id: null; reason: 'low_value_event' | 'delivery_receipt' | 'duplicate_message' | 'unsupported_event' }
  | { status: 'failed'; id: null; reason: 'insert_failed' };

interface RawWebhookRecorderOptions { forcePersist?: boolean }
interface RawWebhookRecorderDependencies {
  insert: RawWebhookInsert;
  now?: () => number;
  captureAll?: () => boolean;
}

const MESSAGE_DEDUPE_TTL_MS = 10 * 60 * 1000;
const MESSAGE_DEDUPE_MAX_ENTRIES = 10_000;
const LOW_VALUE_EVENTS = new Set(['contacts.upsert', 'connection.update', 'messages.delete']);
const METRIC_FLUSH_INTERVAL_MS = 5 * 60 * 1000;
const rawMetricCounts = new Map<string, number>();
let nextMetricFlushAt = Date.now() + METRIC_FLUSH_INTERVAL_MS;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
  return `{${entries.join(',')}}`;
}

function payloadFingerprint(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function recordRawMetric(
  empresaId: string | null,
  body: unknown,
  result: RawWebhookRecordResult,
  now: number,
): void {
  const eventType = extractEventType(body) ?? '<unknown>';
  const fromMe = (body as any)?.data?.key?.fromMe;
  const remoteJid = (body as any)?.data?.key?.remoteJid;
  const direction = fromMe === true ? 'sent' : fromMe === false ? 'received' : 'na';
  const scope = typeof remoteJid === 'string' && remoteJid.endsWith('@g.us') ? 'group' : 'individual_or_na';
  const key = [empresaId ?? '<unknown>', eventType, direction, scope, result.status, result.reason].join('|');
  rawMetricCounts.set(key, (rawMetricCounts.get(key) ?? 0) + 1);
  if (now < nextMetricFlushAt) return;
  for (const [dimensions, count] of rawMetricCounts) {
    console.log(`[webhook_raw_metric] dimensions=${dimensions} count=${count}`);
  }
  rawMetricCounts.clear();
  nextMetricFlushAt = now + METRIC_FLUSH_INTERVAL_MS;
}

function sanitizePayloadForLog(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  let cloned: any;
  try { cloned = structuredClone(body); } catch { return body; }

  const stripField = (obj: any, key: string) => {
    if (obj && typeof obj[key] === 'string' && obj[key].length > 1024) {
      const len = obj[key].length;
      obj[key] = `[base64 stripped: ${len} chars]`;
    }
  };
  const data = cloned?.data;
  if (data && typeof data === 'object') {
    stripField(data, 'base64');
    const message = data.message;
    if (message && typeof message === 'object') {
      stripField(message, 'base64');
      stripField(message.imageMessage, 'base64');
      stripField(message.videoMessage, 'base64');
      stripField(message.audioMessage, 'base64');
      stripField(message.documentMessage, 'base64');
      stripField(message.stickerMessage, 'base64');
    }
  }
  return cloned;
}

function extractEventType(body: unknown): string | null {
  const event = (body as any)?.event;
  return typeof event === 'string' ? event.toLowerCase().replace(/_/g, '.') : null;
}

function extractWaMessageId(body: unknown): string | null {
  const id = (body as any)?.data?.key?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function pruneDedupeEntries(entries: Map<string, number>, now: number): void {
  for (const [key, expiresAt] of entries) {
    if (expiresAt > now && entries.size <= MESSAGE_DEDUPE_MAX_ENTRIES) break;
    entries.delete(key);
  }
}

/**
 * Testable recording seam. A short process-local cache avoids immediate retry
 * calls; the database fingerprint constraint remains authoritative across
 * replicas and restarts.
 */
export function createRawWebhookRecorder(dependencies: RawWebhookRecorderDependencies) {
  const recentDurableMessages = new Map<string, number>();
  const now = dependencies.now ?? Date.now;

  return {
    async record(
      instance: string,
      empresaId: string | null,
      body: unknown,
      authStatus: WebhookAuthStatus,
      options: RawWebhookRecorderOptions = {},
    ): Promise<RawWebhookRecordResult> {
      const eventType = extractEventType(body);
      const waMessageId = extractWaMessageId(body);
      const securityEvidence = authStatus === 'token_mismatch';
      const rolloutEvidence = authStatus === 'token_missing';
      const captureAll = dependencies.captureAll?.() ?? false;
      const sanitizedPayload = sanitizePayloadForLog(body);
      const dedupeFingerprint = !options.forcePersist
        && !captureAll
        && authStatus === 'token_match'
        && eventType === 'messages.upsert'
        && waMessageId
        ? payloadFingerprint(sanitizedPayload)
        : null;

      if (!options.forcePersist && !securityEvidence && !rolloutEvidence && !captureAll) {
        if (eventType === 'messages.update') return { status: 'skipped', id: null, reason: 'delivery_receipt' };
        if (eventType && LOW_VALUE_EVENTS.has(eventType)) return { status: 'skipped', id: null, reason: 'low_value_event' };
        if (eventType !== 'messages.upsert') return { status: 'skipped', id: null, reason: 'unsupported_event' };
        if (eventType === 'messages.upsert' && waMessageId) {
          const key = `${empresaId ?? '<unknown>'}:${instance}:${waMessageId}:${dedupeFingerprint}`;
          const expiresAt = recentDurableMessages.get(key);
          if (expiresAt && expiresAt > now()) return { status: 'skipped', id: null, reason: 'duplicate_message' };
        }
      }

      const inserted = await dependencies.insert({
        instance,
        empresa_id: empresaId,
        event_type: eventType,
        wa_message_id: waMessageId,
        payload: sanitizedPayload,
        auth_status: authStatus,
        dedupe_fingerprint: dedupeFingerprint,
      });
      if (!inserted) return { status: 'failed', id: null, reason: 'insert_failed' };
      if (!inserted.inserted) return { status: 'skipped', id: null, reason: 'duplicate_message' };

      if (!options.forcePersist && !captureAll && authStatus === 'token_match' && eventType === 'messages.upsert' && waMessageId) {
        const currentTime = now();
        pruneDedupeEntries(recentDurableMessages, currentTime);
        const key = `${empresaId ?? '<unknown>'}:${instance}:${waMessageId}:${dedupeFingerprint}`;
        recentDurableMessages.set(key, currentTime + MESSAGE_DEDUPE_TTL_MS);
      }
      return {
        status: 'persisted', id: inserted.id,
        reason: options.forcePersist ? 'forced_failure_capture' : securityEvidence ? 'security_evidence' : 'replayable_event',
      };
    },
  };
}

const productionRecorder = createRawWebhookRecorder({
  captureAll: () => /^(1|true|yes)$/i.test(process.env.WEBHOOK_RAW_CAPTURE_ALL ?? ''),
  async insert(row) {
    try {
      const { data, error } = await getServiceSupabase().rpc('record_zelochat_raw_webhook', {
        p_instance: row.instance,
        p_empresa_id: row.empresa_id,
        p_event_type: row.event_type,
        p_wa_message_id: row.wa_message_id,
        p_payload: row.payload,
        p_auth_status: row.auth_status,
        p_dedupe_fingerprint: row.dedupe_fingerprint,
      });
      if (error) {
        console.error('[webhook-log] insert failed:', error.message);
        return null;
      }
      const result = Array.isArray(data) ? data[0] : data;
      return result?.id ? { id: String(result.id), inserted: result.inserted === true } : null;
    } catch (err) {
      console.error('[webhook-log] insert threw:', err);
      return null;
    }
  },
});

export async function recordRawWebhookEvent(
  instance: string,
  empresaId: string | null,
  body: unknown,
  authStatus: WebhookAuthStatus,
  options: RawWebhookRecorderOptions = {},
): Promise<RawWebhookRecordResult> {
  const result = await productionRecorder.record(instance, empresaId, body, authStatus, options);
  recordRawMetric(empresaId, body, result, Date.now());
  return result;
}

export async function markWebhookEventProcessed(rawEventId: string | null, correlationState: string | null = null): Promise<void> {
  if (!rawEventId) return;
  try {
    const { error } = await getServiceSupabase().from('zelochat_webhook_events_raw').update({
      processed_at: new Date().toISOString(), processing_error: null, lease_owner: null, lease_expires_at: null,
      ...(correlationState ? { correlation_state: correlationState } : {}),
    }).eq('id', rawEventId);
    if (error) console.error('[webhook-log] mark-processed failed:', error.message);
  } catch (err) { console.error('[webhook-log] mark-processed threw:', err); }
}

export async function markWebhookEventFailed(rawEventId: string | null, error: unknown): Promise<void> {
  if (!rawEventId) return;
  const errorText = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  try {
    const { error: updateError } = await getServiceSupabase().from('zelochat_webhook_events_raw').update({
      processed_at: null, processing_error: errorText, next_attempt_at: new Date(Date.now() + 5_000).toISOString(),
      lease_owner: null, lease_expires_at: null,
    }).eq('id', rawEventId);
    if (updateError) console.error('[webhook-log] mark-failed failed:', updateError.message);
  } catch (failure) { console.error('[webhook-log] mark-failed threw:', failure); }
}
