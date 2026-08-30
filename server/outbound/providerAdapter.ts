import { createHash } from 'node:crypto';
import type { OutboundPayload, PersistedOutboundPayload } from '../../src/domain/outbound.js';
import { normalizeWhatsAppTextFormatting } from '../../src/domain/chat.js';
import type { OutboundJob } from './queue.js';
import { createOutboundMediaStore, type MaterializedOutboundMedia } from './mediaStore.js';
import {
  sendButtonMessage,
  sendContactMessage,
  isProviderMessageIdMissingError,
  sendListMessage,
  sendLocationMessage,
  sendMediaMessage,
  sendPollMessage,
  sendReaction,
  sendStickerMessage,
  sendTextMessage,
  sendWhatsAppAudio,
} from '../whatsapp.js';

type Payload = OutboundPayload | PersistedOutboundPayload;
type PersistedMedia = Extract<PersistedOutboundPayload, { storagePath: string }>;
type MediaPayload<K extends 'media' | 'audio' | 'sticker'> = Extract<OutboundPayload, { kind: K }> | (PersistedMedia & { kind: K });

export type ProviderDispatchResult =
  | { state: 'sent'; providerMessageId: string }
  | { state: 'delivery_uncertain'; reason: 'PROVIDER_MESSAGE_ID_MISSING' };

type MaybeId = Promise<string | undefined>;

export interface ProviderAdapterDependencies {
  text(job: OutboundJob, payload: Extract<Payload, { kind: 'text' }>): MaybeId;
  media(job: OutboundJob, payload: MediaPayload<'media'>, media: MaterializedOutboundMedia): MaybeId;
  audio(job: OutboundJob, payload: MediaPayload<'audio'>, media: MaterializedOutboundMedia): MaybeId;
  sticker(job: OutboundJob, payload: MediaPayload<'sticker'>, media: MaterializedOutboundMedia): MaybeId;
  buttons(job: OutboundJob, payload: Extract<Payload, { kind: 'buttons' }>): MaybeId;
  contact(job: OutboundJob, payload: Extract<Payload, { kind: 'contact' }>): MaybeId;
  list(job: OutboundJob, payload: Extract<Payload, { kind: 'list' }>): MaybeId;
  location(job: OutboundJob, payload: Extract<Payload, { kind: 'location' }>): MaybeId;
  reaction(job: OutboundJob, payload: Extract<Payload, { kind: 'reaction' }>): MaybeId;
  poll(job: OutboundJob, payload: Extract<Payload, { kind: 'poll' }>): MaybeId;
  materializeMedia(payload: PersistedMedia): Promise<MaterializedOutboundMedia>;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
}

const sha256 = (parts: Array<string | Uint8Array>): string => {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex');
};

function rawMediaBytes(payload: Extract<OutboundPayload, { kind: 'media' | 'audio' | 'sticker' }>): Uint8Array {
  const source = payload.attachment.dataUrl;
  if (!source) throw new Error('OUTBOUND_MEDIA_SOURCE_MISSING');
  const match = /^data:[^,]*;base64,([A-Za-z0-9+/=\s]+)$/i.exec(source);
  if (!match) throw new Error('OUTBOUND_MEDIA_DATA_URL_INVALID');
  return Uint8Array.from(Buffer.from(match[1]!.replace(/\s/g, ''), 'base64'));
}

export async function fingerprintOutboundPayload(
  payload: Payload,
  materialize?: (payload: PersistedMedia) => Promise<MaterializedOutboundMedia>,
): Promise<string> {
  switch (payload.kind) {
    case 'text':
      return sha256(['text\0', normalizeWhatsAppTextFormatting(payload.text).replace(/\r\n/g, '\n').normalize('NFC')]);
    case 'media':
    case 'audio':
    case 'sticker': {
      const persisted = 'storagePath' in payload;
      const bytes = persisted
        ? (await (materialize ?? createOutboundMediaStore().materialize)(payload as PersistedMedia)).bytes
        : rawMediaBytes(payload as Extract<OutboundPayload, { kind: 'media' | 'audio' | 'sticker' }>);
      const mimeType = persisted ? payload.mimeType : payload.attachment.mimeType;
      const metadata = payload.kind === 'media'
        ? { caption: payload.caption ?? '', quoted: payload.quoted ?? null }
        : payload.kind === 'audio' ? { ptt: payload.ptt, quoted: payload.quoted ?? null } : { quoted: payload.quoted ?? null };
      return sha256([`${payload.kind}\0${mimeType}\0`, bytes, `\0${JSON.stringify(stable(metadata))}`]);
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

function contactFromVcard(payload: Extract<Payload, { kind: 'contact' }>): { fullName: string; phoneNumber: string; organization?: string } {
  const lines = payload.vcard.replace(/\r\n/g, '\n').split('\n');
  const phoneNumber = lines.find((line) => /^TEL(?:;[^:]*)?:/i.test(line))?.split(':').slice(1).join(':').trim();
  const organization = lines.find((line) => /^ORG(?:;[^:]*)?:/i.test(line))?.split(':').slice(1).join(':').trim();
  if (!phoneNumber) throw new Error('OUTBOUND_CONTACT_PHONE_MISSING');
  return { fullName: payload.displayName, phoneNumber, ...(organization ? { organization } : {}) };
}

function defaultDependencies(): ProviderAdapterDependencies {
  const mediaStore = createOutboundMediaStore();
  return {
    text: (job, payload) => sendTextMessage(job.conversationJid ?? job.phone ?? '', payload.text, job.empresaId, payload.quoted),
    media: (job, payload, media) => {
      if (!('storagePath' in payload)) throw new Error('OUTBOUND_MEDIA_NOT_PERSISTED');
      return sendMediaMessage(job.conversationJid ?? job.phone ?? '', {
        mediatype: payload.mimeType.startsWith('image/') ? 'image' : payload.mimeType.startsWith('video/') ? 'video' : 'document',
        mimetype: payload.mimeType, media: media.dataUrl, caption: payload.caption, fileName: payload.fileName,
      }, job.empresaId, payload.quoted);
    },
    audio: (job, payload, media) => sendWhatsAppAudio(job.conversationJid ?? job.phone ?? '', media.dataUrl, job.empresaId, payload.quoted),
    sticker: (job, payload, media) => sendStickerMessage(job.conversationJid ?? job.phone ?? '', media.dataUrl, job.empresaId, payload.quoted),
    buttons: (job, payload) => sendButtonMessage(job.conversationJid ?? job.phone ?? '', '', payload.text, '', payload.buttons.map((button) => ({ id: button.id, displayText: button.label })), job.empresaId),
    contact: (job, payload) => sendContactMessage(job.conversationJid ?? job.phone ?? '', contactFromVcard(payload), job.empresaId),
    list: (job, payload) => sendListMessage(job.conversationJid ?? job.phone ?? '', { description: payload.body, buttonText: payload.buttonText, sections: payload.sections as never[] }, job.empresaId),
    location: (job, payload) => sendLocationMessage(job.conversationJid ?? job.phone ?? '', payload, job.empresaId),
    reaction: (job, payload) => sendReaction(job.conversationJid ?? job.phone ?? '', payload.targetMessageId, payload.emoji, payload.targetFromMe, job.empresaId),
    poll: (job, payload) => sendPollMessage(job.conversationJid ?? job.phone ?? '', { name: payload.name, values: payload.options, selectableCount: payload.selectableCount }, job.empresaId),
    materializeMedia: (payload) => mediaStore.materialize(payload),
  };
}

export function createProviderAdapter(dependencies: ProviderAdapterDependencies = defaultDependencies()) {
  return {
    async dispatch(job: OutboundJob): Promise<ProviderDispatchResult> {
      const payload = job.payload;
      await fingerprintOutboundPayload(payload, dependencies.materializeMedia);
      let providerMessageId: string | undefined;
      try {
        switch (payload.kind) {
        case 'text': providerMessageId = await dependencies.text(job, payload); break;
        case 'media': {
          if (!('storagePath' in payload)) throw new Error('OUTBOUND_MEDIA_NOT_PERSISTED');
          providerMessageId = await dependencies.media(job, payload as MediaPayload<'media'>, await dependencies.materializeMedia(payload)); break;
        }
        case 'audio': {
          if (!('storagePath' in payload)) throw new Error('OUTBOUND_MEDIA_NOT_PERSISTED');
          providerMessageId = await dependencies.audio(job, payload as MediaPayload<'audio'>, await dependencies.materializeMedia(payload)); break;
        }
        case 'sticker': {
          if (!('storagePath' in payload)) throw new Error('OUTBOUND_MEDIA_NOT_PERSISTED');
          providerMessageId = await dependencies.sticker(job, payload as MediaPayload<'sticker'>, await dependencies.materializeMedia(payload)); break;
        }
        case 'buttons': providerMessageId = await dependencies.buttons(job, payload); break;
        case 'contact': providerMessageId = await dependencies.contact(job, payload); break;
        case 'list': providerMessageId = await dependencies.list(job, payload); break;
        case 'location': providerMessageId = await dependencies.location(job, payload); break;
        case 'reaction': providerMessageId = await dependencies.reaction(job, payload); break;
        case 'poll': providerMessageId = await dependencies.poll(job, payload); break;
          default: return assertNever(payload);
        }
      } catch (error) {
        if (isProviderMessageIdMissingError(error)) {
          return { state: 'delivery_uncertain', reason: 'PROVIDER_MESSAGE_ID_MISSING' };
        }
        throw error;
      }
      return providerMessageId?.trim()
        ? { state: 'sent', providerMessageId }
        : { state: 'delivery_uncertain', reason: 'PROVIDER_MESSAGE_ID_MISSING' };
    },
  };
}

export type ProviderAdapter = ReturnType<typeof createProviderAdapter>;
