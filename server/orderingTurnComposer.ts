import type { ChatMessage } from '../src/types.js';

export interface OrderingTurnComposerState {
  consumedMessageIds?: string[];
}

export interface OrderingTurnComposition {
  text: string;
  sourceMessageIds: string[];
  pendingAudioMessageIds: string[];
  failedAudioMessageIds: string[];
  consumedMessageIds: string[];
}

export type ComposerMessage = Pick<
  ChatMessage,
  'id' | 'role' | 'content' | 'preview' | 'timestamp' | 'kind' | 'audio_transcript' | 'audio_transcript_status'
>;
export type TimedComposerMessage = ComposerMessage & { providerTimestamp?: string | number | null; dbTimestamp?: string | number | null };

const AUDIO_PLACEHOLDER_REGEX = /^\[(?:áudio|audio) receb/i;

function timeValue(value: string | number | null | undefined): number {
  const valueAsDate = typeof value === 'number' ? value : new Date(value ?? '').getTime();
  return Number.isFinite(valueAsDate) ? valueAsDate : 0;
}

function messageTime(message: TimedComposerMessage): number {
  const value = timeValue(message.providerTimestamp) || timeValue(message.dbTimestamp) || timeValue(message.timestamp);
  return Number.isFinite(value) ? value : 0;
}

function comparableId(message: ComposerMessage): string {
  return message.id || '';
}

function textForMessage(message: ComposerMessage): string | null {
  if (message.kind === 'audio') {
    const transcript = message.audio_transcript?.trim();
    if (transcript) return transcript;
    return null;
  }
  const preferred = (message.content ?? '').trim() || (message.preview ?? '').trim();
  if (!preferred || AUDIO_PLACEHOLDER_REGEX.test(preferred)) return null;
  return preferred;
}

export function composeOrderingTurn(
  messages: TimedComposerMessage[],
  state: OrderingTurnComposerState | null = {},
): OrderingTurnComposition {
  state ??= {};
  const consumed = new Set(state.consumedMessageIds ?? []);
  const lastAssistantIndex = [...messages].map((message) => message.role).lastIndexOf('assistant');
  const source = state.consumedMessageIds?.length
    ? messages
    : messages.slice(lastAssistantIndex + 1);

  const candidates = source
    .filter((message) => message.role === 'user' && !consumed.has(message.id))
    .sort((left, right) => {
      const timeDiff = messageTime(left) - messageTime(right);
      if (timeDiff !== 0) return timeDiff;
      return comparableId(left).localeCompare(comparableId(right));
    });

  const texts: string[] = [];
  const sourceMessageIds: string[] = [];
  const pendingAudioMessageIds: string[] = [];
  const failedAudioMessageIds: string[] = [];

  for (const message of candidates) {
    if (message.kind === 'audio') {
      if (message.audio_transcript_status === 'pending') {
        pendingAudioMessageIds.push(message.id);
        continue;
      }
      if (message.audio_transcript_status === 'failed' && !message.audio_transcript?.trim()) {
        failedAudioMessageIds.push(message.id);
        continue;
      }
    }
    const text = textForMessage(message);
    if (!text) continue;
    texts.push(text);
    sourceMessageIds.push(message.id);
  }

  return {
    text: texts.join('\n').trim(),
    sourceMessageIds,
    pendingAudioMessageIds,
    failedAudioMessageIds,
    consumedMessageIds: [...new Set([...(state.consumedMessageIds ?? []), ...sourceMessageIds])],
  };
}
