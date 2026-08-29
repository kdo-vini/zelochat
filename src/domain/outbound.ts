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
  | { kind: 'sticker'; attachment: ChatAttachment }
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
    };

export const policyForOrigin = (origin: OutboundOrigin): TakeoverPolicy =>
  origin === 'human_zelochat' || origin === 'human_native_whatsapp'
    ? 'take_over'
    : 'preserve_ai';

/** Returns a stable internal code; null means the payload is valid. */
export function validateOutboundPayload(payload: OutboundPayload): string | null {
  if (!payload || typeof payload !== 'object' || typeof payload.kind !== 'string') {
    return 'OUTBOUND_PAYLOAD_INVALID';
  }

  switch (payload.kind) {
    case 'text':
      return payload.text.trim() ? null : 'OUTBOUND_TEXT_EMPTY';
    case 'media':
    case 'audio':
    case 'sticker':
      return payload.attachment?.mimeType?.trim()
        ? null
        : 'OUTBOUND_ATTACHMENT_MIME_MISSING';
    case 'buttons':
      return payload.text.trim() && payload.buttons.length > 0 && payload.buttons.every((button) => button.id.trim() && button.label.trim())
        ? null
        : 'OUTBOUND_BUTTONS_INVALID';
    case 'contact':
      return payload.displayName.trim() && payload.vcard.trim() ? null : 'OUTBOUND_CONTACT_INVALID';
    case 'list':
      return payload.body.trim() && payload.buttonText.trim() && payload.sections.length > 0
        ? null
        : 'OUTBOUND_LIST_INVALID';
    case 'location':
      return Number.isFinite(payload.latitude) && Number.isFinite(payload.longitude)
        && payload.latitude >= -90 && payload.latitude <= 90
        && payload.longitude >= -180 && payload.longitude <= 180
        ? null
        : 'OUTBOUND_LOCATION_INVALID';
    case 'reaction':
      return payload.targetMessageId.trim() ? null : 'OUTBOUND_REACTION_TARGET_MISSING';
    case 'poll':
      return payload.name.trim() && payload.options.length > 0 && payload.options.every((option) => option.trim())
        && Number.isInteger(payload.selectableCount) && payload.selectableCount > 0
        && payload.selectableCount <= payload.options.length
        ? null
        : 'OUTBOUND_POLL_EMPTY';
    default:
      return 'OUTBOUND_PAYLOAD_INVALID';
  }
}
