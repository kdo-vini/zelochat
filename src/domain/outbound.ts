import type { ChatAttachment } from '../types.js';

export type OutboundOrigin =
  | 'human_zelochat'
  | 'human_native_whatsapp'
  | 'ai_auto'
  | 'ai_followup'
  | 'system_handoff'
  | 'system_transactional'
  | 'campaign'
  | 'automation'
  | 'internal_system';

export type TakeoverPolicy = 'take_over' | 'preserve_ai';

export type OutboundState =
  | 'preparing'
  | 'queued'
  | 'sending'
  | 'dispatch_started'
  | 'sent'
  | 'failed_before_dispatch'
  | 'delivery_uncertain'
  | 'cancelled';

export interface QuotedContext {
  waMessageId: string;
  fromMe: boolean;
  remoteJid: string;
  previewText?: string;
}

export type OutboundPayload =
  | { kind: 'text'; text: string; quoted?: QuotedContext | null }
  | { kind: 'media'; attachment: ChatAttachment; caption?: string; quoted?: QuotedContext | null }
  | { kind: 'audio'; attachment: ChatAttachment; ptt: boolean; quoted?: QuotedContext | null }
  | { kind: 'sticker'; attachment: ChatAttachment; quoted?: QuotedContext | null }
  | { kind: 'buttons'; text: string; buttons: Array<{ id: string; label: string }> }
  | { kind: 'contact'; displayName: string; vcard: string }
  | { kind: 'list'; body: string; buttonText: string; sections: unknown[] }
  | { kind: 'location'; latitude: number; longitude: number; name?: string; address?: string }
  | { kind: 'reaction'; targetMessageId: string; emoji: string; targetFromMe: boolean }
  | { kind: 'poll'; name: string; options: string[]; selectableCount: number };

export type PersistedOutboundPayload =
  | Exclude<OutboundPayload, { kind: 'media' | 'audio' | 'sticker' }>
  | {
      kind: 'media' | 'audio' | 'sticker';
      storagePath: string;
      mimeType: string;
      fileName: string;
      sizeBytes: number;
      checksum: string;
      ptt?: boolean;
      caption?: string;
      quoted?: QuotedContext | null;
    };

export const policyForOrigin = (origin: OutboundOrigin): TakeoverPolicy =>
  origin === 'human_zelochat' || origin === 'human_native_whatsapp'
    ? 'take_over'
    : 'preserve_ai';

export function isRetryableOutboundFailure(status: string | null | undefined): boolean {
  return status === 'failed' || status === 'failed_before_dispatch';
}

/** Returns a stable internal code; null means the payload is valid. */
export function validateOutboundPayload(payload: unknown): string | null {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

  if (!isRecord(payload) || typeof payload.kind !== 'string') {
    return 'OUTBOUND_PAYLOAD_INVALID';
  }

  switch (payload.kind) {
    case 'text':
      return nonEmptyString(payload.text) ? null : 'OUTBOUND_TEXT_EMPTY';
    case 'media':
    case 'audio':
    case 'sticker':
      if (!isRecord(payload.attachment) || !nonEmptyString(payload.attachment.mimeType)) {
        return 'OUTBOUND_ATTACHMENT_MIME_MISSING';
      }
      if (!nonEmptyString(payload.attachment.fileName)
        || !['image', 'document', 'audio', 'video', 'sticker'].includes(String(payload.attachment.type))) {
        return 'OUTBOUND_ATTACHMENT_INVALID';
      }
      if (payload.kind === 'audio' && typeof payload.ptt !== 'boolean') {
        return 'OUTBOUND_AUDIO_PTT_INVALID';
      }
      return null;
    case 'buttons':
      return nonEmptyString(payload.text) && Array.isArray(payload.buttons) && payload.buttons.length > 0
        && payload.buttons.every((button) => isRecord(button) && nonEmptyString(button.id) && nonEmptyString(button.label))
        ? null : 'OUTBOUND_BUTTONS_INVALID';
    case 'contact':
      return nonEmptyString(payload.displayName) && nonEmptyString(payload.vcard) ? null : 'OUTBOUND_CONTACT_INVALID';
    case 'list':
      return nonEmptyString(payload.body) && nonEmptyString(payload.buttonText) && Array.isArray(payload.sections) && payload.sections.length > 0
        ? null : 'OUTBOUND_LIST_INVALID';
    case 'location':
      return typeof payload.latitude === 'number' && typeof payload.longitude === 'number'
        && Number.isFinite(payload.latitude) && Number.isFinite(payload.longitude)
        && payload.latitude >= -90 && payload.latitude <= 90
        && payload.longitude >= -180 && payload.longitude <= 180
        ? null
        : 'OUTBOUND_LOCATION_INVALID';
    case 'reaction':
      if (!nonEmptyString(payload.targetMessageId)) return 'OUTBOUND_REACTION_TARGET_MISSING';
      return typeof payload.emoji === 'string' && payload.emoji.trim().length > 0 && typeof payload.targetFromMe === 'boolean'
        ? null : 'OUTBOUND_REACTION_INVALID';
    case 'poll':
      return nonEmptyString(payload.name) && Array.isArray(payload.options) && payload.options.length > 0 && payload.options.every((option) => nonEmptyString(option))
        && typeof payload.selectableCount === 'number' && Number.isInteger(payload.selectableCount) && payload.selectableCount > 0
        && payload.selectableCount <= payload.options.length
        ? null
        : 'OUTBOUND_POLL_EMPTY';
    default:
      return 'OUTBOUND_PAYLOAD_INVALID';
  }
}
