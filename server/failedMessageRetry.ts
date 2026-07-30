import { parseStructuredMessage } from '../src/domain/chat.js';
import type { ChatAttachment } from '../src/types.js';
import type { QuotedContext } from './whatsapp.js';

export interface FailedAssistantMessageRecord {
  id: string;
  content: string | null;
  quoted_wa_id: string | null;
  quoted_from_me: boolean | null;
  quoted_preview: string | null;
}

export interface FailedMessageRetryPayload {
  jid: string;
  text: string;
  attachment?: ChatAttachment;
  quoted: QuotedContext | null;
}

export function buildFailedMessageRetryPayload(
  message: FailedAssistantMessageRecord,
  jid: string,
): FailedMessageRetryPayload | null {
  const parsed = parseStructuredMessage(message.content ?? '');
  const text = parsed.text?.trim() ?? '';
  const attachment = parsed.attachment;
  if (!text && !attachment?.dataUrl) return null;

  return {
    jid,
    text,
    attachment,
    quoted: message.quoted_wa_id
      ? {
          waMessageId: message.quoted_wa_id,
          fromMe: message.quoted_from_me ?? false,
          remoteJid: jid,
          previewText: message.quoted_preview ?? undefined,
        }
      : null,
  };
}

export type RetryFailedMessageResult =
  | { type: 'not_retryable' }
  | { type: 'already_sending' }
  | { type: 'sent'; waMessageId: string | undefined }
  | { type: 'send_failed'; error: unknown; message: string };

export async function retryFailedAssistantMessage(
  message: FailedAssistantMessageRecord,
  jid: string,
  deps: {
    claim: (messageId: string) => Promise<boolean>;
    send: (payload: FailedMessageRetryPayload) => Promise<string | undefined>;
    markSucceeded: (messageId: string, waMessageId: string | undefined) => Promise<void>;
    markFailed: (messageId: string, errorMessage: string) => Promise<void>;
    getErrorMessage: (error: unknown) => string;
  },
): Promise<RetryFailedMessageResult> {
  const payload = buildFailedMessageRetryPayload(message, jid);
  if (!payload) return { type: 'not_retryable' };
  if (!await deps.claim(message.id)) return { type: 'already_sending' };

  try {
    const waMessageId = await deps.send(payload);
    await deps.markSucceeded(message.id, waMessageId);
    return { type: 'sent', waMessageId };
  } catch (error) {
    const errorMessage = deps.getErrorMessage(error);
    await deps.markFailed(message.id, errorMessage);
    return { type: 'send_failed', error, message: errorMessage };
  }
}
