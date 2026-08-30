import { createHash } from 'node:crypto';
import { validateOutboundPayload, type OutboundPayload, type PersistedOutboundPayload } from '../../src/domain/outbound.js';
import { normalizeWhatsAppTextFormatting } from '../../src/domain/whatsappFormatting.js';
import type { OutboundJob } from './queue.js';
import { createOutboundMediaStore, type PreparedOutboundMedia } from './mediaStore.js';
import { sendButtonMessage, sendContactMessage, sendListMessage, sendLocationMessage, sendMediaMessage, sendPollMessage, sendReaction, sendStickerMessage, sendTextMessage, sendWhatsAppAudio } from '../whatsapp.js';

type Payload = OutboundPayload | PersistedOutboundPayload;
type PersistedMedia = Extract<PersistedOutboundPayload, { storagePath: string }>;
type MediaPayload<K extends 'media' | 'audio' | 'sticker'> = PersistedMedia & { kind: K };
type TransportMedia = Omit<PreparedOutboundMedia, 'bytes'>;
type MaybeId = Promise<string | null | undefined>;
interface Contact { fullName: string; phoneNumber: string; organization?: string }

export type ProviderDispatchResult = { state: 'sent'; providerMessageId: string } | { state: 'delivery_uncertain'; reason: 'PROVIDER_MESSAGE_ID_MISSING' };
export type PreparedProviderDispatch =
  | { kind: 'text'; job: OutboundJob; payload: Extract<Payload, { kind: 'text' }> }
  | { kind: 'media'; job: OutboundJob; payload: MediaPayload<'media'>; media: TransportMedia }
  | { kind: 'audio'; job: OutboundJob; payload: MediaPayload<'audio'>; media: TransportMedia }
  | { kind: 'sticker'; job: OutboundJob; payload: MediaPayload<'sticker'>; media: TransportMedia }
  | { kind: 'buttons'; job: OutboundJob; payload: Extract<Payload, { kind: 'buttons' }> }
  | { kind: 'contact'; job: OutboundJob; payload: Extract<Payload, { kind: 'contact' }>; contact: Contact }
  | { kind: 'list'; job: OutboundJob; payload: Extract<Payload, { kind: 'list' }> }
  | { kind: 'location'; job: OutboundJob; payload: Extract<Payload, { kind: 'location' }> }
  | { kind: 'reaction'; job: OutboundJob; payload: Extract<Payload, { kind: 'reaction' }> }
  | { kind: 'poll'; job: OutboundJob; payload: Extract<Payload, { kind: 'poll' }> };

export interface ProviderAdapterDependencies {
  text(job: OutboundJob, payload: Extract<Payload, { kind: 'text' }>): MaybeId;
  media(job: OutboundJob, payload: MediaPayload<'media'>, media: TransportMedia): MaybeId;
  audio(job: OutboundJob, payload: MediaPayload<'audio'>, media: TransportMedia): MaybeId;
  sticker(job: OutboundJob, payload: MediaPayload<'sticker'>, media: TransportMedia): MaybeId;
  buttons(job: OutboundJob, payload: Extract<Payload, { kind: 'buttons' }>): MaybeId;
  contact(job: OutboundJob, payload: Extract<Payload, { kind: 'contact' }>, contact: Contact): MaybeId;
  list(job: OutboundJob, payload: Extract<Payload, { kind: 'list' }>): MaybeId;
  location(job: OutboundJob, payload: Extract<Payload, { kind: 'location' }>): MaybeId;
  reaction(job: OutboundJob, payload: Extract<Payload, { kind: 'reaction' }>): MaybeId;
  poll(job: OutboundJob, payload: Extract<Payload, { kind: 'poll' }>): MaybeId;
  prepareMedia(payload: PersistedMedia): Promise<PreparedOutboundMedia>;
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
  const mediaStore = createOutboundMediaStore(); const jid = (job: OutboundJob) => job.conversationJid ?? job.phone ?? '';
  return {
    text: (job, payload) => sendTextMessage(jid(job), payload.text, job.empresaId, payload.quoted, job.instanceKey),
    media: (job, payload, media) => sendMediaMessage(jid(job), { mediatype: payload.mimeType.startsWith('image/') ? 'image' : payload.mimeType.startsWith('video/') ? 'video' : 'document', mimetype: payload.mimeType, media: media.transportUrl, caption: payload.caption, fileName: payload.fileName }, job.empresaId, payload.quoted, job.instanceKey),
    audio: (job, payload, media) => sendWhatsAppAudio(jid(job), media.transportUrl, job.empresaId, payload.quoted, job.instanceKey),
    sticker: (job, payload, media) => sendStickerMessage(jid(job), media.transportUrl, job.empresaId, payload.quoted, job.instanceKey),
    buttons: (job, payload) => sendButtonMessage(jid(job), '', payload.text, '', payload.buttons.map((button) => ({ id: button.id, displayText: button.label })), job.empresaId, job.instanceKey),
    contact: (job, _payload, contact) => sendContactMessage(jid(job), contact, job.empresaId, job.instanceKey),
    list: (job, payload) => sendListMessage(jid(job), { description: payload.body, buttonText: payload.buttonText, sections: payload.sections as never[] }, job.empresaId, job.instanceKey),
    location: (job, payload) => sendLocationMessage(jid(job), payload, job.empresaId, job.instanceKey),
    reaction: (job, payload) => sendReaction(jid(job), payload.targetMessageId, payload.emoji, payload.targetFromMe, job.empresaId, job.instanceKey),
    poll: (job, payload) => sendPollMessage(jid(job), { name: payload.name, values: payload.options, selectableCount: payload.selectableCount }, job.empresaId, job.instanceKey),
    prepareMedia: (payload) => mediaStore.prepare(payload),
  };
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
        const preparedMedia = await dependencies.prepareMedia(payload);
        const fingerprint = await fingerprintOutboundPayload(payload, preparedMedia);
        if (job.payloadFingerprint && job.payloadFingerprint !== fingerprint) throw new Error('OUTBOUND_PAYLOAD_FINGERPRINT_MISMATCH');
        const media: TransportMedia = { mimeType: preparedMedia.mimeType, transportUrl: preparedMedia.transportUrl };
        return { kind: payload.kind, job, payload, media } as PreparedProviderDispatch;
      }
      const validationError = validateOutboundPayload(payload);
      if (validationError) throw new Error(validationError);
      const fingerprint = await fingerprintOutboundPayload(payload);
      if (job.payloadFingerprint && job.payloadFingerprint !== fingerprint) throw new Error('OUTBOUND_PAYLOAD_FINGERPRINT_MISMATCH');
      if (payload.kind === 'contact') return { kind: 'contact', job, payload, contact: contactFromVcard(payload) };
      return { kind: payload.kind, job, payload } as PreparedProviderDispatch;
    },
    async send(prepared: PreparedProviderDispatch): Promise<ProviderDispatchResult> {
      let id: string | null | undefined;
      switch (prepared.kind) {
        case 'text': id = await dependencies.text(prepared.job, prepared.payload); break;
        case 'media': id = await dependencies.media(prepared.job, prepared.payload, prepared.media); break;
        case 'audio': id = await dependencies.audio(prepared.job, prepared.payload, prepared.media); break;
        case 'sticker': id = await dependencies.sticker(prepared.job, prepared.payload, prepared.media); break;
        case 'buttons': id = await dependencies.buttons(prepared.job, prepared.payload); break;
        case 'contact': id = await dependencies.contact(prepared.job, prepared.payload, prepared.contact); break;
        case 'list': id = await dependencies.list(prepared.job, prepared.payload); break;
        case 'location': id = await dependencies.location(prepared.job, prepared.payload); break;
        case 'reaction': id = await dependencies.reaction(prepared.job, prepared.payload); break;
        case 'poll': id = await dependencies.poll(prepared.job, prepared.payload); break;
        default: return assertNever(prepared);
      }
      return id?.trim() ? { state: 'sent', providerMessageId: id } : { state: 'delivery_uncertain', reason: 'PROVIDER_MESSAGE_ID_MISSING' };
    },
  };
}
export type ProviderAdapter = ReturnType<typeof createProviderAdapter>;
