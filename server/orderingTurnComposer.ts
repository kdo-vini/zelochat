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
// FIX 2026-09-03 (PR I-1 / PR 1.13): `ChatMessage` (src/types.ts) and the
// `zelochat_messages` row it is read from (server/messageHandler.ts) carry a
// SINGLE timestamp — `timestamp`/`sent_at`. For inbound customer messages
// that column is populated from the WhatsApp provider's own
// `messageTimestamp` (see `resolveMessageDate` in messageHandler.ts), so
// `timestamp` already IS the provider clock; there is no second,
// independently captured server-insertion clock today. `providerTimestamp`/
// `dbTimestamp` below exist so a caller that DOES have a distinct signal
// (or a test fixture) can supply one explicitly — real production messages
// never populate them, and the comparator below must not silently discard a
// real `dbTimestamp` tiebreak just because a `providerTimestamp` happens to
// be present and equal on both sides (that discard was the actual bug: see
// the old single merged `messageTime()` below, replaced by the tiered
// comparator).
export type TimedComposerMessage = ComposerMessage & { providerTimestamp?: string | number | null; dbTimestamp?: string | number | null };

const AUDIO_PLACEHOLDER_REGEX = /^\[(?:áudio|audio) receb/i;

function timeValue(value: string | number | null | undefined): number {
  const valueAsDate = typeof value === 'number' ? value : new Date(value ?? '').getTime();
  return Number.isFinite(valueAsDate) ? valueAsDate : 0;
}

/** Provider clock: an explicit `providerTimestamp` when supplied, else the
 * message's own `timestamp` (which, for real stored messages, already is the
 * provider's clock — see the module comment above). */
function providerTime(message: TimedComposerMessage): number {
  return timeValue(message.providerTimestamp) || timeValue(message.timestamp);
}

function comparableId(message: ComposerMessage): string {
  return message.id || '';
}

/** Tiered, deterministic comparator: provider clock, then an explicit
 * `dbTimestamp` tiebreak (only meaningful when the provider clock ties), then
 * message id as a last-resort deterministic fallback. Each tier is compared
 * independently — unlike a single merged `||` value, a tie at the provider
 * level never hides a real `dbTimestamp` difference. */
function compareMessages(left: TimedComposerMessage, right: TimedComposerMessage): number {
  const providerDiff = providerTime(left) - providerTime(right);
  if (providerDiff !== 0) return providerDiff;
  const dbDiff = timeValue(left.dbTimestamp) - timeValue(right.dbTimestamp);
  if (dbDiff !== 0) return dbDiff;
  return comparableId(left).localeCompare(comparableId(right));
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
    .sort(compareMessages);

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
    // FIX 2026-09-03 (PR C-6 / FN C3): a failed/unsupported audio message is
    // resolved — the customer already got the "can't hear you" reply for it —
    // so it must never be replayed into a later turn's composition. Pending
    // audio is deliberately excluded here: it is not resolved yet and must
    // stay eligible to be picked up once transcription settles.
    consumedMessageIds: [...new Set([
      ...(state.consumedMessageIds ?? []),
      ...sourceMessageIds,
      ...failedAudioMessageIds,
    ])],
  };
}
