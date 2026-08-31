import { getServiceSupabase } from './supabase.js';

/**
 * Append-only log of inbound webhook payloads. Defensive layer added after
 * the 2026-04-29 P0.14 regression that silently dropped ~4h of inbound
 * messages — Whatsmiau exposes no history endpoint, so without this log a
 * future bug in the persistence path is unrecoverable.
 *
 * Volume target: 10s of events/day at 1 customer, scales linearly. Keep the
 * write path cheap and never let it block or break the webhook ack — log
 * insert failures are logged and swallowed.
 *
 * Migration: supabase/migrations/016_webhook_events_raw.sql
 */

export type WebhookAuthStatus = 'token_match' | 'token_missing' | 'token_mismatch';

interface RawEventRow {
  instance: string;
  empresa_id: string | null;
  event_type: string | null;
  wa_message_id: string | null;
  payload: unknown;
  auth_status: WebhookAuthStatus;
}

/**
 * Strip large base64 media blobs from a webhook payload before logging.
 * Whatsmiau embeds inbound media as base64 (up to the P1.9 25MB cap); storing
 * those in JSONB blows up row size with no recovery value (we already store
 * the persisted media URL in zelochat_messages.content for replay).
 */
function sanitizePayloadForLog(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  let cloned: any;
  try {
    cloned = structuredClone(body);
  } catch {
    return body;
  }

  const stripField = (obj: any, key: string) => {
    if (obj && typeof obj[key] === 'string' && obj[key].length > 1024) {
      const len = obj[key].length;
      obj[key] = `[base64 stripped: ${len} chars]`;
    }
  };

  const data = cloned?.data;
  if (data && typeof data === 'object') {
    stripField(data, 'base64');
    const m = data.message;
    if (m && typeof m === 'object') {
      // outbound (fromMe) messages carry media as data.message.base64 — strip it
      stripField(m, 'base64');
      stripField(m.imageMessage, 'base64');
      stripField(m.videoMessage, 'base64');
      stripField(m.audioMessage, 'base64');
      stripField(m.documentMessage, 'base64');
      stripField(m.stickerMessage, 'base64');
    }
  }
  return cloned;
}

function extractEventType(body: unknown): string | null {
  const ev = (body as any)?.event;
  if (typeof ev !== 'string') return null;
  return ev.toLowerCase().replace(/_/g, '.');
}

function extractWaMessageId(body: unknown): string | null {
  const id = (body as any)?.data?.key?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Insert a row into zelochat_webhook_events_raw. Returns the inserted row id
 * on success, null on failure. Failures are logged but never thrown — the
 * webhook ack path must not depend on this side-channel succeeding.
 */
export async function recordRawWebhookEvent(
  instance: string,
  empresaId: string | null,
  body: unknown,
  authStatus: WebhookAuthStatus,
): Promise<string | null> {
  // Delivery/read receipts — pure WebSocket broadcasts with no DB persistence
  // and no replay value. Skipping them avoids ~78% of rows in the table.
  if (extractEventType(body) === 'messages.update') return null;

  const row: RawEventRow = {
    instance,
    empresa_id: empresaId,
    event_type: extractEventType(body),
    wa_message_id: extractWaMessageId(body),
    payload: sanitizePayloadForLog(body),
    auth_status: authStatus,
  };
  try {
    const { data, error } = await getServiceSupabase()
      .from('zelochat_webhook_events_raw')
      .insert(row)
      .select('id')
      .single();
    if (error) {
      console.error('[webhook-log] insert failed:', error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error('[webhook-log] insert threw:', err);
    return null;
  }
}

/**
 * Mark a previously-logged event as processed. Best-effort: if the original
 * insert returned null (logging failed), the caller skips this. Failures are
 * swallowed — processing already succeeded by the time we get here.
 */
export async function markWebhookEventProcessed(
  rawEventId: string | null,
  correlationState: string | null = null,
): Promise<void> {
  if (!rawEventId) return;
  try {
    const { error: updateError } = await getServiceSupabase()
      .from('zelochat_webhook_events_raw')
      .update({
        processed_at: new Date().toISOString(),
        processing_error: null,
        lease_owner: null,
        lease_expires_at: null,
        ...(correlationState ? { correlation_state: correlationState } : {}),
      })
      .eq('id', rawEventId);
    if (updateError) {
      console.error('[webhook-log] mark-processed failed:', updateError.message);
    }
  } catch (err) {
    console.error('[webhook-log] mark-processed threw:', err);
  }
}

/** Keep a failed event replayable; processed_at is success-only. */
export async function markWebhookEventFailed(rawEventId: string | null, error: unknown): Promise<void> {
  if (!rawEventId) return;
  const errorText = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  try {
    const { error: updateError } = await getServiceSupabase()
      .from('zelochat_webhook_events_raw')
      .update({
        processed_at: null,
        processing_error: errorText,
        next_attempt_at: new Date(Date.now() + 5_000).toISOString(),
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq('id', rawEventId);
    if (updateError) console.error('[webhook-log] mark-failed failed:', updateError.message);
  } catch (failure) {
    console.error('[webhook-log] mark-failed threw:', failure);
  }
}
