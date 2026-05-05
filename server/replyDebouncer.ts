import { sendPresence, markWhatsAppMessageAsRead } from './whatsapp.js';

// Three-stage debounce for AI auto-replies. Replaces the old single 1500ms
// timer with a "human-feeling" cadence: read receipt → typing indicator → reply.
//
// Why: customers fragment messages on WhatsApp ("oi" / "queria pedir" / "uma
// pizza"). A single short timer either replies too eagerly (3 separate AI runs)
// or never feels human. Staged timing batches the burst into one reply, with
// visual feedback that mirrors a real attendant.
//
// Each new inbound message in the same conversation cancels and re-arms the
// timers (timer reset semantics, identical to the old debounce). Read receipts
// are one-way — once sent, `hasMarkedAsRead` stays true across resets.

const READ_DELAY_MS = parseInt(process.env.AI_DEBOUNCE_READ_MS || '3000', 10);
const TYPING_DELAY_MS = parseInt(process.env.AI_DEBOUNCE_TYPING_MS || '3000', 10);
const REPLY_DELAY_MS = parseInt(process.env.AI_DEBOUNCE_REPLY_MS || '4000', 10);

// Kill switch — set in Railway to revert to legacy single-timer behavior
// without a redeploy. When disabled, no read/typing presence is sent; just a
// 1500ms debounce before fire (matching pre-2026-05 behavior).
const DEBOUNCE_DISABLED = process.env.AI_DEBOUNCE_DISABLED === '1';
const LEGACY_FALLBACK_MS = 1500;

interface PendingState {
  readTimer?: ReturnType<typeof setTimeout>;
  typingTimer?: ReturnType<typeof setTimeout>;
  replyTimer?: ReturnType<typeof setTimeout>;
  hasMarkedAsRead: boolean;
  hasShownTyping: boolean;
  // null when no inbound msg with a usable key.id has been observed for this
  // contact yet. We still want to debounce + reply in that case; we just skip
  // the markAsRead step (read receipt is non-critical).
  lastMessageId: string | null;
  empresaId: string;
  jid: string;
}

const pending = new Map<string, PendingState>();

function keyOf(empresaId: string, jid: string): string {
  return `${empresaId}:${jid}`;
}

function clearTimers(state: PendingState): void {
  if (state.readTimer) clearTimeout(state.readTimer);
  if (state.typingTimer) clearTimeout(state.typingTimer);
  if (state.replyTimer) clearTimeout(state.replyTimer);
  state.readTimer = undefined;
  state.typingTimer = undefined;
  state.replyTimer = undefined;
}

export interface ScheduleReplyArgs {
  empresaId: string;
  jid: string;
  // Optional: some Whatsmiau payload shapes (system, edge cases) may arrive
  // without a usable key.id. When absent, we skip the read receipt but still
  // debounce + reply normally. Customer never gets dropped.
  messageId?: string;
  fire: () => Promise<void>;
}

export function scheduleReply({ empresaId, jid, messageId, fire }: ScheduleReplyArgs): void {
  const key = keyOf(empresaId, jid);

  // Kill switch: legacy single-timer mode. Skip read/typing entirely.
  if (DEBOUNCE_DISABLED) {
    const existing = pending.get(key);
    if (existing) clearTimers(existing);
    const state: PendingState = existing ?? {
      hasMarkedAsRead: false,
      hasShownTyping: false,
      lastMessageId: messageId ?? null,
      empresaId,
      jid,
    };
    state.replyTimer = setTimeout(async () => {
      state.replyTimer = undefined;
      pending.delete(key);
      try {
        await fire();
      } catch (err) {
        console.error('[replyDebouncer] fire callback threw:', err);
      }
    }, LEGACY_FALLBACK_MS);
    pending.set(key, state);
    return;
  }

  const existing = pending.get(key);

  if (existing) {
    clearTimers(existing);
    // If we already showed "digitando..." in the previous cycle, clear it so
    // the customer doesn't see a stale typing indicator while the new timer
    // window restarts. Fire-and-forget — sendPresence already swallows errors.
    if (existing.hasShownTyping) {
      void sendPresence(jid, 'paused', 0, empresaId);
      existing.hasShownTyping = false;
    }
    if (messageId) existing.lastMessageId = messageId;
  }

  const state: PendingState = existing ?? {
    hasMarkedAsRead: false,
    hasShownTyping: false,
    lastMessageId: messageId ?? null,
    empresaId,
    jid,
  };

  state.readTimer = setTimeout(async () => {
    state.readTimer = undefined;
    if (!state.lastMessageId) return; // no usable id observed — skip silently
    state.hasMarkedAsRead = true;
    try {
      await markWhatsAppMessageAsRead(jid, state.lastMessageId, empresaId);
    } catch (err) {
      console.warn(
        '[replyDebouncer] markAsRead failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }, READ_DELAY_MS);

  state.typingTimer = setTimeout(() => {
    state.typingTimer = undefined;
    state.hasShownTyping = true;
    void sendPresence(jid, 'composing', 0, empresaId);
  }, READ_DELAY_MS + TYPING_DELAY_MS);

  state.replyTimer = setTimeout(async () => {
    state.replyTimer = undefined;
    pending.delete(key);
    try {
      await fire();
    } catch (err) {
      console.error('[replyDebouncer] fire callback threw:', err);
    }
  }, READ_DELAY_MS + TYPING_DELAY_MS + REPLY_DELAY_MS);

  pending.set(key, state);
}

export function cancelPendingReply(empresaId: string, jid: string): void {
  const key = keyOf(empresaId, jid);
  const state = pending.get(key);
  if (!state) return;
  clearTimers(state);
  if (state.hasShownTyping) {
    void sendPresence(jid, 'paused', 0, empresaId);
  }
  pending.delete(key);
}
