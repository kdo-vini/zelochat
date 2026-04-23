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
