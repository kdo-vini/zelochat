import { createHash } from 'node:crypto';
import { validateOutboundPayload, type OutboundPayload, type PersistedOutboundPayload } from '../../src/domain/outbound.js';
import { normalizeWhatsAppTextFormatting } from '../../src/domain/whatsappFormatting.js';
import type { OutboundJob } from './queue.js';
import { createOutboundMediaStore, type PreparedOutboundMedia } from './mediaStore.js';
import { prepareWhatsAppHttpRequest, sendPreparedWhatsAppHttpRequest, type PreparedWhatsAppHttpRequest, type WhatsAppOutboundRequestInput } from '../whatsapp.js';

type Payload = OutboundPayload | PersistedOutboundPayload;
type PersistedMedia = Extract<PersistedOutboundPayload, { storagePath: string }>;
type MediaPayload<K extends 'media' | 'audio' | 'sticker'> = PersistedMedia & { kind: K };
type TransportMedia = Omit<PreparedOutboundMedia, 'bytes'>;
type MaybeId = Promise<string | null | undefined>;
interface Contact { fullName: string; phoneNumber: string; organization?: string }

export type ProviderDispatchResult = { state: 'sent'; providerMessageId: string } | { state: 'delivery_uncertain'; reason: 'PROVIDER_MESSAGE_ID_MISSING' };
export interface PreparedProviderDispatch { job: OutboundJob; request: PreparedWhatsAppHttpRequest }

export interface ProviderAdapterDependencies {
  prepareRequest(input: WhatsAppOutboundRequestInput): PreparedWhatsAppHttpRequest;
  sendPrepared(request: PreparedWhatsAppHttpRequest): MaybeId;
  prepareMedia(job: OutboundJob, payload: PersistedMedia): Promise<PreparedOutboundMedia>;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
}
const sha256 = (parts: Array<string | Uint8Array>): string => { const hash = createHash('sha256'); for (const part of parts) hash.update(part); return hash.digest('hex'); };

export async function fingerprintOutboundPayload(payload: Payload, preparedMedia?: PreparedOutboundMedia): Promise<string> {
  switch (payload.kind) {
    case 'text': return sha256(['text\0', normalizeWhatsAppTextFormatting(payload.text).replace(/\r\n/g, '\n').normalize('NFC')]);
    case 'media': case 'audio': case 'sticker': {
      if (!('storagePath' in payload) || !preparedMedia) throw new Error('OUTBOUND_MEDIA_NOT_PREPARED');
      const metadata = payload.kind === 'media' ? { caption: payload.caption ?? '', quoted: payload.quoted ?? null } : payload.kind === 'audio' ? { ptt: payload.ptt, quoted: payload.quoted ?? null } : { quoted: payload.quoted ?? null };
      return sha256([`${payload.kind}\0${payload.mimeType}\0`, preparedMedia.bytes, `\0${JSON.stringify(stable(metadata))}`]);
    }
    case 'buttons': return sha256(['buttons\0', JSON.stringify(stable({ text: normalizeWhatsAppTextFormatting(payload.text), buttons: payload.buttons }))]);
    case 'contact': return sha256(['contact\0', payload.displayName.normalize('NFC'), '\0', payload.vcard.replace(/\r\n/g, '\n').normalize('NFC')]);
    case 'list': return sha256(['list\0', JSON.stringify(stable({ body: payload.body, buttonText: payload.buttonText, sections: payload.sections }))]);
    case 'location': return sha256(['location\0', JSON.stringify(stable({ latitude: payload.latitude, longitude: payload.longitude, name: payload.name ?? '', address: payload.address ?? '' }))]);
    case 'reaction': return sha256(['reaction\0', JSON.stringify({ targetMessageId: payload.targetMessageId, emoji: payload.emoji.normalize('NFC'), targetFromMe: payload.targetFromMe })]);
    case 'poll': return sha256(['poll\0', JSON.stringify({ name: payload.name.normalize('NFC'), options: payload.options.map((option) => option.normalize('NFC')), selectableCount: payload.selectableCount })]);
    default: return assertNever(payload);
  }
}
function assertNever(value: never): never { throw new Error(`OUTBOUND_PAYLOAD_UNSUPPORTED:${String((value as { kind?: unknown }).kind)}`); }
function contactFromVcard(payload: Extract<Payload, { kind: 'contact' }>): Contact {
  const lines = payload.vcard.replace(/\r\n/g, '\n').split('\n');
  if (!lines.some((line) => line.trim().toUpperCase() === 'BEGIN:VCARD') || !lines.some((line) => line.trim().toUpperCase() === 'END:VCARD')) throw new Error('OUTBOUND_CONTACT_VCARD_INVALID');
  const phoneNumber = lines.find((line) => /^TEL(?:;[^:]*)?:/i.test(line))?.split(':').slice(1).join(':').trim();
  const organization = lines.find((line) => /^ORG(?:;[^:]*)?:/i.test(line))?.split(':').slice(1).join(':').trim();
  if (!phoneNumber) throw new Error('OUTBOUND_CONTACT_PHONE_MISSING');
  return { fullName: payload.displayName, phoneNumber, ...(organization ? { organization } : {}) };
}

function defaultDependencies(): ProviderAdapterDependencies {
  const mediaStore = createOutboundMediaStore();
  return {
    prepareRequest: prepareWhatsAppHttpRequest,
    sendPrepared: sendPreparedWhatsAppHttpRequest,
    prepareMedia: (job, payload) => mediaStore.prepare(payload, { empresaId: job.empresaId, jobId: job.id }),
  };
}

function requestFor(job: OutboundJob, payload: Payload, media?: TransportMedia, contact?: Contact): WhatsAppOutboundRequestInput {
  const common = { jid: job.conversationJid ?? job.phone ?? '', instance: job.instanceKey };
  switch (payload.kind) {
    case 'text': return { ...common, kind: 'text', text: payload.text, quoted: payload.quoted };
    case 'media': if (!media || !('storagePath' in payload)) throw new Error('OUTBOUND_MEDIA_NOT_PREPARED'); return { ...common, kind: 'media', mediaType: payload.mimeType.startsWith('image/') ? 'image' : payload.mimeType.startsWith('video/') ? 'video' : 'document', mimeType: payload.mimeType, mediaUrl: media.transportUrl, caption: payload.caption, fileName: payload.fileName, quoted: payload.quoted };
    case 'audio': if (!media || !('storagePath' in payload)) throw new Error('OUTBOUND_MEDIA_NOT_PREPARED'); return { ...common, kind: 'audio', audioUrl: media.transportUrl, quoted: payload.quoted };
    case 'sticker': if (!media || !('storagePath' in payload)) throw new Error('OUTBOUND_MEDIA_NOT_PREPARED'); return { ...common, kind: 'sticker', stickerUrl: media.transportUrl, quoted: payload.quoted };
    case 'buttons': return { ...common, kind: 'buttons', text: payload.text, buttons: payload.buttons.map((button) => ({ id: button.id, displayText: button.label })) };
    case 'contact': if (!contact) throw new Error('OUTBOUND_CONTACT_INVALID'); return { ...common, kind: 'contact', contact };
    case 'list': return { ...common, kind: 'list', description: payload.body, buttonText: payload.buttonText, sections: payload.sections };
    case 'location': return { ...common, kind: 'location', latitude: payload.latitude, longitude: payload.longitude, name: payload.name, address: payload.address };
    case 'reaction': return { ...common, kind: 'reaction', targetMessageId: payload.targetMessageId, emoji: payload.emoji, targetFromMe: payload.targetFromMe };
    case 'poll': return { ...common, kind: 'poll', name: payload.name, options: payload.options, selectableCount: payload.selectableCount };
    default: return assertNever(payload);
  }
}

export function createProviderAdapter(dependencies: ProviderAdapterDependencies = defaultDependencies()) {
  return {
    async prepare(job: OutboundJob): Promise<PreparedProviderDispatch> {
      const payload = job.payload;
      if (!payload || typeof payload !== 'object' || typeof payload.kind !== 'string') throw new Error('OUTBOUND_PAYLOAD_INVALID');
      if (payload.kind === 'media' || payload.kind === 'audio' || payload.kind === 'sticker') {
        if (!('storagePath' in payload)) throw new Error('OUTBOUND_MEDIA_NOT_PERSISTED');
        if (payload.kind === 'audio' && typeof payload.ptt !== 'boolean') throw new Error('OUTBOUND_AUDIO_PTT_INVALID');
        if (payload.kind === 'media' && payload.caption != null && typeof payload.caption !== 'string') throw new Error('OUTBOUND_MEDIA_CAPTION_INVALID');
        const preparedMedia = await dependencies.prepareMedia(job, payload);
        const fingerprint = await fingerprintOutboundPayload(payload, preparedMedia);
        if (job.payloadFingerprint && job.payloadFingerprint !== fingerprint) throw new Error('OUTBOUND_PAYLOAD_FINGERPRINT_MISMATCH');
        const media: TransportMedia = { mimeType: preparedMedia.mimeType, transportUrl: preparedMedia.transportUrl };
        return { job, request: dependencies.prepareRequest(requestFor(job, payload, media)) };
      }
      const validationError = validateOutboundPayload(payload);
      if (validationError) throw new Error(validationError);
      const fingerprint = await fingerprintOutboundPayload(payload);
      if (job.payloadFingerprint && job.payloadFingerprint !== fingerprint) throw new Error('OUTBOUND_PAYLOAD_FINGERPRINT_MISMATCH');
      const contact = payload.kind === 'contact' ? contactFromVcard(payload) : undefined;
      return { job, request: dependencies.prepareRequest(requestFor(job, payload, undefined, contact)) };
    },
    async send(prepared: PreparedProviderDispatch): Promise<ProviderDispatchResult> {
      const id = await dependencies.sendPrepared(prepared.request);
      return id?.trim() ? { state: 'sent', providerMessageId: id } : { state: 'delivery_uncertain', reason: 'PROVIDER_MESSAGE_ID_MISSING' };
    },
  };
}
export type ProviderAdapter = ReturnType<typeof createProviderAdapter>;
