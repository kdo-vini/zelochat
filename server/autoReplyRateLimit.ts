/**
 * Per-contact AI reply rate limiter — sliding window, extracted from
 * server/index.ts (FN I2 / PR 1.9-adjacent) so the decision logic is testable
 * without booting the whole server process (index.ts starts real sweepers,
 * WhatsApp lifecycle, etc. at import time).
 *
 * FIX 2026-09-03 (FN I2): the 4th text turn inside a 60s window used to be
 * dropped SILENTLY — `return` before `generateAndSendReply`, no reply, no
 * retry. A customer answering a guided flow by text ("quero massa" ->
 * "talharim" -> "molho branco" -> "entrega") lost the 4th answer with no
 * sign anything went wrong; if that 4th message was their LAST one in the
 * burst, they got no reply at all until they proactively wrote again.
 *
 * Ruling: coalesce, no extra customer-facing message. The rate-limited
 * message stays unconsumed (composeOrderingTurn folds it into the next
 * composed turn), and this module hands back `retryAfterMs` so the caller
 * can GUARANTEE that "next turn" happens on its own schedule — see
 * `scheduleCoalescedRetry` in index.ts — rather than only hoping the
 * customer sends another message. A short "recebi sua mensagem" text was
 * considered and rejected: the pipeline already guarantees a later turn via
 * the scheduled retry, so an extra send would just be one more message for
 * no informational gain.
 */

export interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Present only when `allowed` is false: ms until the window resets. */
  retryAfterMs?: number;
}

export interface AutoReplyRateLimiter {
  check(key: string): RateLimitDecision;
}

export function createAutoReplyRateLimiter(opts: {
  maxPerWindow?: number;
  windowMs?: number;
  now?: () => number;
} = {}): AutoReplyRateLimiter {
  const maxPerWindow = opts.maxPerWindow ?? 3;
  const windowMs = opts.windowMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const limits = new Map<string, RateLimitEntry>();

  return {
    check(key: string): RateLimitDecision {
      const current = now();
      const entry = limits.get(key);

      if (!entry || current >= entry.windowStart + windowMs) {
        // No entry yet, or window expired — start fresh.
        limits.set(key, { count: 1, windowStart: current });
        return { allowed: true };
      }

      if (entry.count < maxPerWindow) {
        entry.count += 1;
        return { allowed: true };
      }

      return { allowed: false, retryAfterMs: Math.max(0, entry.windowStart + windowMs - current) };
    },
  };
}

/** Process-wide singleton — same semantics as the old in-index.ts Map. */
export const autoReplyRateLimiter = createAutoReplyRateLimiter();
