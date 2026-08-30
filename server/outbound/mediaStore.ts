import { createHash } from 'node:crypto';
import type { OutboundPayload, PersistedOutboundPayload } from '../../src/domain/outbound.js';
import { getServiceSupabase } from '../supabase.js';

const MEDIA_BUCKET = 'zelochat-media';
type PersistedMedia = Extract<PersistedOutboundPayload, { kind: 'media' | 'audio' | 'sticker' }>;

export interface OutboundMediaStorage {
  upload(path: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  download(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
}

export interface MaterializedOutboundMedia {
  bytes: Uint8Array;
  mimeType: string;
  dataUrl: string;
}

function defaultStorage(): OutboundMediaStorage {
  const bucket = getServiceSupabase().storage.from(MEDIA_BUCKET);
  return {
    async upload(path, bytes, mimeType) {
      const { error } = await bucket.upload(path, bytes, { contentType: mimeType, upsert: false });
      if (error && !/already exists|duplicate/i.test(error.message)) throw new Error('OUTBOUND_MEDIA_UPLOAD_FAILED');
    },
    async download(path) {
      const { data, error } = await bucket.download(path);
      if (error || !data) throw new Error('OUTBOUND_MEDIA_DOWNLOAD_FAILED');
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(path) {
      const { error } = await bucket.remove([path]);
      if (error) throw new Error('OUTBOUND_MEDIA_REMOVE_FAILED');
    },
  };
}

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType?: string } {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) throw new Error('OUTBOUND_MEDIA_DATA_URL_INVALID');
  return { bytes: Uint8Array.from(Buffer.from(match[2]!.replace(/\s/g, ''), 'base64')), mimeType: match[1] };
}

async function attachmentBytes(dataUrl: string): Promise<{ bytes: Uint8Array; mimeType?: string }> {
  if (dataUrl.startsWith('data:')) return decodeDataUrl(dataUrl);
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error('OUTBOUND_MEDIA_SOURCE_UNAVAILABLE');
  return { bytes: new Uint8Array(await response.arrayBuffer()), mimeType: response.headers.get('content-type') ?? undefined };
}

export function createOutboundMediaStore(storage: OutboundMediaStorage = defaultStorage()) {
  return {
    async persistPayload(params: { empresaId: string; jobId: string; payload: OutboundPayload }): Promise<PersistedOutboundPayload> {
      const { payload } = params;
      if (payload.kind !== 'media' && payload.kind !== 'audio' && payload.kind !== 'sticker') return payload;
      if (!payload.attachment.dataUrl) throw new Error('OUTBOUND_MEDIA_SOURCE_MISSING');
      const source = await attachmentBytes(payload.attachment.dataUrl);
      const mimeType = payload.attachment.mimeType || source.mimeType || 'application/octet-stream';
      const checksum = createHash('sha256').update(source.bytes).digest('hex');
      const storagePath = `outbound/${params.empresaId}/${params.jobId}/${checksum}`;
      await storage.upload(storagePath, source.bytes, mimeType);
      return {
        kind: payload.kind,
        storagePath,
        mimeType,
        fileName: payload.attachment.fileName,
        sizeBytes: source.bytes.byteLength,
        checksum,
        ...(payload.kind === 'audio' ? { ptt: payload.ptt } : {}),
        ...(payload.kind === 'media' && payload.caption ? { caption: payload.caption } : {}),
        ...(payload.quoted ? { quoted: payload.quoted } : {}),
      } as PersistedOutboundPayload;
    },

    async materialize(payload: PersistedMedia): Promise<MaterializedOutboundMedia> {
      if (payload.storagePath.startsWith('data:')) throw new Error('OUTBOUND_MEDIA_STORAGE_PATH_INVALID');
      const bytes = await storage.download(payload.storagePath);
      const checksum = createHash('sha256').update(bytes).digest('hex');
      if (checksum !== payload.checksum) throw new Error('OUTBOUND_MEDIA_CHECKSUM_MISMATCH');
      return { bytes, mimeType: payload.mimeType, dataUrl: `data:${payload.mimeType};base64,${Buffer.from(bytes).toString('base64')}` };
    },

    async cleanupTerminal(payload: PersistedMedia, timing: { terminalAtMs: number; graceMs: number; nowMs?: number }): Promise<boolean> {
      const now = timing.nowMs ?? Date.now();
      if (now < timing.terminalAtMs + timing.graceMs) return false;
      await storage.remove(payload.storagePath);
      return true;
    },
  };
}

export type OutboundMediaStore = ReturnType<typeof createOutboundMediaStore>;
