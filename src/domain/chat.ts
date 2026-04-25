import type { ChatAttachment } from '../types';

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

  if (attachment.type === 'audio') {
    return '[Áudio]';
  }

  const name = attachment.fileName?.trim();
  if (trimmed) {
    return `[Documento] ${trimmed}`;
  }

  return name ? `[Documento] ${name}` : '[Documento]';
}

export function serializeStructuredMessage(params: {
  text?: string;
  attachment?: ChatAttachment;
}): string {
  const text = params.text?.trim() ?? '';
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
