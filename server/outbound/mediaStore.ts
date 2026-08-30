import { createHash } from 'node:crypto';
import type { OutboundPayload, PersistedOutboundPayload } from '../../src/domain/outbound.js';
import { getServiceSupabase } from '../supabase.js';

const MEDIA_BUCKET = 'zelochat-media';
export const OUTBOUND_MEDIA_MAX_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
type PersistedMedia = Extract<PersistedOutboundPayload, { storagePath: string }>;

export interface OutboundMediaStorage {
  upload(path: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  download(path: string): Promise<Uint8Array>;
  transportUrl(path: string): Promise<string>;
  remove(path: string): Promise<void>;
}
export interface PreparedOutboundMedia { bytes: Uint8Array; mimeType: string; transportUrl: string }

const assertHttps = (raw: string): string => {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('OUTBOUND_MEDIA_HTTPS_REQUIRED');
  return url.toString();
};

function defaultStorage(): OutboundMediaStorage {
  const bucket = getServiceSupabase().storage.from(MEDIA_BUCKET);
  return {
    async upload(path, bytes, mimeType) { const { error } = await bucket.upload(path, bytes, { contentType: mimeType, upsert: false }); if (error && !/already exists|duplicate/i.test(error.message)) throw new Error('OUTBOUND_MEDIA_UPLOAD_FAILED'); },
    async download(path) { const { data, error } = await bucket.download(path); if (error || !data) throw new Error('OUTBOUND_MEDIA_DOWNLOAD_FAILED'); const bytes = new Uint8Array(await data.arrayBuffer()); if (bytes.byteLength > OUTBOUND_MEDIA_MAX_BYTES) throw new Error('OUTBOUND_MEDIA_TOO_LARGE'); return bytes; },
    async transportUrl(path) { const { data, error } = await bucket.createSignedUrl(path, 7 * 24 * 60 * 60); if (error || !data?.signedUrl) throw new Error('OUTBOUND_MEDIA_SIGNED_URL_FAILED'); return assertHttps(data.signedUrl); },
    async remove(path) { const { error } = await bucket.remove([path]); if (error) throw new Error('OUTBOUND_MEDIA_REMOVE_FAILED'); },
  };
}

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType?: string } {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) throw new Error('OUTBOUND_MEDIA_DATA_URL_INVALID');
  if (match[2]!.replace(/\s/g, '').length > Math.ceil(OUTBOUND_MEDIA_MAX_BYTES / 3) * 4) throw new Error('OUTBOUND_MEDIA_TOO_LARGE');
  const bytes = Uint8Array.from(Buffer.from(match[2]!.replace(/\s/g, ''), 'base64'));
  if (bytes.byteLength > OUTBOUND_MEDIA_MAX_BYTES) throw new Error('OUTBOUND_MEDIA_TOO_LARGE');
  return { bytes, mimeType: match[1] };
}

async function controlledSource(source: string): Promise<{ bytes: Uint8Array; mimeType?: string }> {
  if (source.startsWith('data:')) return decodeDataUrl(source);
  const url = new URL(source);
  const allowed = new Set([new URL(process.env.SUPABASE_URL || 'https://invalid.local').hostname, 'storage.googleapis.com']);
  if (url.protocol !== 'https:' || !allowed.has(url.hostname)) throw new Error('OUTBOUND_MEDIA_SOURCE_NOT_ALLOWED');
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('OUTBOUND_MEDIA_SOURCE_UNAVAILABLE');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > OUTBOUND_MEDIA_MAX_BYTES) { await reader.cancel(); throw new Error('OUTBOUND_MEDIA_TOO_LARGE'); } chunks.push(value); }
  return { bytes: Uint8Array.from(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))), mimeType: response.headers.get('content-type') ?? undefined };
}

export function createOutboundMediaStore(storage: OutboundMediaStorage = defaultStorage()) {
  return {
    async persistPayload(params: { empresaId: string; jobId: string; payload: OutboundPayload }): Promise<PersistedOutboundPayload> {
      const { payload } = params;
      if (!['media', 'audio', 'sticker'].includes(payload.kind)) return payload as PersistedOutboundPayload;
      const media = payload as Extract<OutboundPayload, { kind: 'media' | 'audio' | 'sticker' }>;
      if (!media.attachment.dataUrl) throw new Error('OUTBOUND_MEDIA_SOURCE_MISSING');
      const source = await controlledSource(media.attachment.dataUrl); const mimeType = media.attachment.mimeType || source.mimeType || 'application/octet-stream';
      const checksum = createHash('sha256').update(source.bytes).digest('hex'); const storagePath = `outbound/${params.empresaId}/${params.jobId}/${checksum}`;
      await storage.upload(storagePath, source.bytes, mimeType);
      return { kind: media.kind, storagePath, mimeType, fileName: media.attachment.fileName, sizeBytes: source.bytes.byteLength, checksum,
        ...(media.kind === 'audio' ? { ptt: media.ptt } : {}), ...(media.kind === 'media' && media.caption ? { caption: media.caption } : {}), ...(media.quoted ? { quoted: media.quoted } : {}) } as PersistedOutboundPayload;
    },
    async prepare(payload: PersistedMedia): Promise<PreparedOutboundMedia> {
      if (!/^outbound\/[^/]+\/[^/]+\/[a-f0-9]{64}$/i.test(payload.storagePath)) throw new Error('OUTBOUND_MEDIA_STORAGE_PATH_INVALID');
      const bytes = await storage.download(payload.storagePath); if (bytes.byteLength !== payload.sizeBytes) throw new Error('OUTBOUND_MEDIA_SIZE_MISMATCH');
      if (createHash('sha256').update(bytes).digest('hex') !== payload.checksum) throw new Error('OUTBOUND_MEDIA_CHECKSUM_MISMATCH');
      return { bytes, mimeType: payload.mimeType, transportUrl: assertHttps(await storage.transportUrl(payload.storagePath)) };
    },
    async cleanupTerminal(payload: PersistedMedia, timing: { terminalAtMs: number; graceMs: number; nowMs?: number }): Promise<boolean> { if ((timing.nowMs ?? Date.now()) < timing.terminalAtMs + timing.graceMs) return false; await storage.remove(payload.storagePath); return true; },
  };
}

export async function cleanupTerminalOutboundMedia(limit = 100, graceMs = 24 * 60 * 60 * 1000): Promise<number> {
  const db = getServiceSupabase(); const cutoff = new Date(Date.now() - graceMs).toISOString();
  const { data, error } = await db.from('zelochat_outbound_jobs').select('id,empresa_id,payload,updated_at').in('status', ['sent','failed','failed_before_dispatch','delivery_uncertain','cancelled']).is('media_cleaned_at', null).lt('updated_at', cutoff).limit(limit);
  if (error) throw error; const store = createOutboundMediaStore(); let cleaned = 0;
  for (const row of data ?? []) { const payload = row.payload as PersistedOutboundPayload; if (!payload || !['media','audio','sticker'].includes(payload.kind) || !('storagePath' in payload)) continue; await store.cleanupTerminal(payload as PersistedMedia, { terminalAtMs: Date.parse(row.updated_at), graceMs, nowMs: Date.now() }); const { data: marked } = await db.from('zelochat_outbound_jobs').update({ media_cleaned_at: new Date().toISOString() }).eq('id', row.id).eq('empresa_id', row.empresa_id).is('media_cleaned_at', null).select('id'); if (marked?.length) cleaned++; }
  return cleaned;
}
export type OutboundMediaStore = ReturnType<typeof createOutboundMediaStore>;
