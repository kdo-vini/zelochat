import { format, isToday, isYesterday, differenceInCalendarDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { ChatAttachment, ChatMessage } from '../types';

const STRUCTURED_MESSAGE_PREFIX = '__ZELOCHAT_MEDIA__:';

type StructuredMessagePayload = {
  version: 1;
  text: string;
  preview: string;
  contentForModel: string;
  attachment: ChatAttachment;
};

export type ParsedChatContent = {
  kind: 'text' | ChatAttachment['type'];
  text: string;
  preview: string;
  contentForModel: string;
  attachment?: ChatAttachment;
};

export type ImageContentForModel = {
  text: string;
  imageUrl?: {
    url: string;
    detail: 'low';
  };
};

const MODEL_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export function normalizePhoneNumber(value: string): string {
  return value.replace(/\D/g, '');
}

/** Formats a Brazilian phone number as the user types: (XX) XXXXX-XXXX or (XX) XXXX-XXXX */
export function maskBrazilianPhone(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Formats time input as HH:MM (24-hour) as the user types */
export function maskTime24h(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 4);
  if (d.length === 0) return '';
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}:${d.slice(2)}`;
}

export function isLikelyPhoneLabel(value: string | null | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;

  const digits = normalizePhoneNumber(trimmed);
  return digits.length >= 10 && digits.length >= trimmed.replace(/\s/g, '').length - 4;
}

export function buildContactKey(value: string): string {
  let normalized = normalizePhoneNumber(value);
  // Strip Brazilian country code so "5514997000091" and "14997000091" map to the same key
  if (normalized.startsWith('55') && normalized.length >= 12) {
    normalized = normalized.slice(2);
  }
  // P1.8 — Normalize 11-digit mobile (DDD + '9' + 8 digits) to 10-digit base so the
  // modern WhatsApp format ("14997000091") and the legacy registration ("1497000091")
  // for the same contact end up in the same session family.
  // The '9' sits at index 2 (right after the 2-digit DDD). Landlines are also 10 digits
  // but their 3rd digit is never '9' in the ANATEL numbering plan, so they are unaffected.
  if (normalized.length === 11 && normalized.charAt(2) === '9') {
    normalized = normalized.slice(0, 2) + normalized.slice(3);
  }
  return normalized || value.trim().toLowerCase();
}

export function buildAttachmentPreview(
  attachment: Pick<ChatAttachment, 'type' | 'fileName'>,
  text: string,
): string {
  const trimmed = text.trim();

  if (attachment.type === 'image') {
    return trimmed ? `[Imagem] ${trimmed}` : '[Imagem]';
  }

  if (attachment.type === 'sticker') {
    return '[Figurinha]';
  }

  if (attachment.type === 'audio') {
    return '[Áudio]';
  }

  if (attachment.type === 'video') {
    return trimmed ? `[Vídeo] ${trimmed}` : '[Vídeo]';
  }

  const name = attachment.fileName?.trim();
  if (trimmed) {
    return `[Documento] ${trimmed}`;
  }

  return name ? `[Documento] ${name}` : '[Documento]';
}

export function normalizeWhatsAppTextFormatting(text: string): string {
  return text
    .replace(/\*\*([^*\n](?:[\s\S]*?[^*\n])?)\*\*/g, '*$1*')
    .replace(/__([^_\n](?:[\s\S]*?[^_\n])?)__/g, '_$1_')
    .replace(/~~([^~\n](?:[\s\S]*?[^~\n])?)~~/g, '~$1~');
}

export function serializeStructuredMessage(params: {
  text?: string;
  attachment?: ChatAttachment;
}): string {
  const text = normalizeWhatsAppTextFormatting(params.text?.trim() ?? '');
  const attachment = params.attachment;

  if (!attachment) {
    return text;
  }

  const preview = buildAttachmentPreview(attachment, text);
  const payload: StructuredMessagePayload = {
    version: 1,
    text,
    preview,
    contentForModel: preview,
    attachment,
  };

  return `${STRUCTURED_MESSAGE_PREFIX}${JSON.stringify(payload)}`;
}

/**
 * Renders a session's "last message" timestamp relative to today, always in Brasília time.
 * Accepts ISO 8601 strings (current format) and bare "HH:MM" strings (legacy data
 * stored before the format migration — assumed to be today, value passed through as-is
 * since we can't know which TZ produced it).
 */
export function formatLastMessageTime(value: string | null | undefined): string {
  if (!value) return '';

  if (/^\d{2}:\d{2}$/.test(value)) {
    return `Hoje às ${value}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const TZ = 'America/Sao_Paulo';
  // YYYY-MM-DD in Brasília TZ — used as a stable day key regardless of viewer timezone.
  const brasiliaDayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const time = date.toLocaleTimeString('pt-BR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  });

  if (brasiliaDayKey(date) === brasiliaDayKey(now)) return `Hoje às ${time}`;
  if (brasiliaDayKey(date) === brasiliaDayKey(yesterday)) return `Ontem às ${time}`;

  const dayMonth = date.toLocaleDateString('pt-BR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
  });
  return `${dayMonth} às ${time}`;
}

/**
 * Resolves what the AI should "see" for a given message. For audio with a
 * completed Whisper transcript, returns `[Áudio: "<transcript>"]` so the model
 * can reply meaningfully. For pending/failed/missing transcripts, falls back
 * to the structured preview (`[Áudio]`). The backend waits before auto-replying
 * so normal customer audio reaches the model as text instead of a placeholder.
 */
export function buildContentForModel(message: ChatMessage): string {
  const baseContent = message.content
    ? parseStructuredMessage(message.kind === 'text' ? message.content : message.preview).contentForModel
    : '';

  if (
    message.kind === 'audio' &&
    message.audio_transcript_status === 'done' &&
    message.audio_transcript
  ) {
    return `[Áudio: "${message.audio_transcript}"]`;
  }

  return baseContent;
}

export function getModelImageUrl(message: ChatMessage): ImageContentForModel['imageUrl'] | undefined {
  const attachment = message.attachment;
  if (message.kind !== 'image' || !attachment?.dataUrl) return undefined;
  const mimeType = attachment.mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!MODEL_IMAGE_MIME_TYPES.has(mimeType)) return undefined;
  return { url: attachment.dataUrl, detail: 'low' };
}

export function buildImageContentForModel(message: ChatMessage): ImageContentForModel {
  const text = buildContentForModel(message) || message.preview || '[Imagem]';
  const imageUrl = getModelImageUrl(message);
  return imageUrl ? { text, imageUrl } : { text };
}

/**
 * Returns a human-readable pt-BR label for a date separator in the chat view.
 * Falls back to today's date on invalid/missing input (mirrors formatLastMessageTime convention).
 */
export function formatDateSeparatorLabel(value: string | Date | null | undefined): string {
  let date: Date;

  if (!value) {
    date = new Date();
  } else if (value instanceof Date) {
    date = value;
  } else if (/^\d{2}:\d{2}$/.test(value)) {
    // Legacy bare "HH:MM" — treat as today
    date = new Date();
  } else {
    date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      date = new Date();
    }
  }

  if (isToday(date)) return 'Hoje';
  if (isYesterday(date)) return 'Ontem';

  const daysAgo = differenceInCalendarDays(new Date(), date);
  if (daysAgo < 7) {
    // e.g. "segunda-feira" → capitalize first letter → "Segunda-feira"
    const weekday = format(date, 'EEEE', { locale: ptBR });
    return weekday.charAt(0).toUpperCase() + weekday.slice(1);
  }

  const now = new Date();
  if (date.getFullYear() === now.getFullYear()) {
    // e.g. "2 de maio"
    return format(date, "d 'de' MMMM", { locale: ptBR });
  }

  // Different year — "02/05/2025"
  return format(date, 'dd/MM/yyyy');
}

/**
 * Returns a 'YYYY-MM-DD' string (local calendar day) for grouping messages by day.
 * Falls back to today on invalid/missing input.
 */
export function startOfDayKey(value: string | Date | null | undefined): string {
  let date: Date;

  if (!value) {
    date = new Date();
  } else if (value instanceof Date) {
    date = value;
  } else if (/^\d{2}:\d{2}$/.test(value)) {
    date = new Date();
  } else {
    date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      date = new Date();
    }
  }

  return format(date, 'yyyy-MM-dd');
}

export function parseStructuredMessage(content: string): ParsedChatContent {
  if (!content.startsWith(STRUCTURED_MESSAGE_PREFIX)) {
    return {
      kind: 'text',
      text: content,
      preview: content,
      contentForModel: content,
    };
  }

  try {
    const parsed = JSON.parse(
      content.slice(STRUCTURED_MESSAGE_PREFIX.length),
    ) as StructuredMessagePayload;

    return {
      kind: parsed.attachment.type,
      text: parsed.text,
      preview: parsed.preview,
      contentForModel: parsed.contentForModel,
      attachment: parsed.attachment,
    };
  } catch {
    return {
      kind: 'text',
      text: content,
      preview: content,
      contentForModel: content,
    };
  }
}
