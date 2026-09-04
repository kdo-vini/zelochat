/**
 * FIX 2026-09-04 (PR I-5): ZeloMenu unavailability (503 TIMEOUT/INDISPONIVEL,
 * 429, 5xx) used to reach `transferOnFailure` with no rate limit at all —
 * during an outage, EVERY active ordering conversation escalated
 * independently and the owner's WhatsApp got one manager notification per
 * open conversation. This breaker tracks consecutive transport failures per
 * empresa and, once it trips, gives every turn the same friendly "tente de
 * novo" reply directly (no further ZeloMenu round trip attempted) instead of
 * letting each conversation discover the outage — and escalate — on its own.
 *
 * Pure and side-effect free: no manager notification, no logging, no I/O.
 * The caller (`zeloMenuInternalClient.ts`) decides what to do with the
 * boolean `recordFailure` returns (send exactly one notification the turn it
 * flips to true) and with `isOpen` (skip the network call and fail fast).
 *
 * Scope: one breaker state PER EMPRESA (not one global breaker for the whole
 * process) — a ZeloMenu outage affecting only one tenant's integration
 * (e.g. a bad `zelomenu_slug`/misconfigured instance) must not silence a
 * healthy tenant's ordering, and "one manager notification" only makes
 * sense addressed to a specific empresa's manager phone. State is in-memory,
 * per process — same caveat as this codebase's other in-memory dedupe/rate
 * limiters (`autoReplyRateLimit.ts`, the button-click dedupe maps in
 * `aiWhatsAppOrdering.ts`): a horizontally-scaled deployment has one
 * independent breaker per replica, not one shared across replicas.
 */

export interface OrderingCircuitBreakerOptions {
  /** Consecutive failures inside `windowMs` before the breaker trips. Default 5. */
  threshold?: number;
  /** Sliding window a failure streak must stay inside to count. Default 60_000. */
  windowMs?: number;
  /** How long the breaker stays open once tripped. Default 30_000. */
  openMs?: number;
  /** Injectable clock — production defaults to `Date.now`. */
  now?: () => number;
}

export interface OrderingCircuitBreaker {
  /** True while this key's breaker is currently open. */
  isOpen(key: string): boolean;
  /**
   * Records a transport failure for this key. Returns `true` exactly once —
   * on the specific call that transitions the breaker from closed to open —
   * so the caller knows to send its single "just opened" side effect
   * (the one manager notification). Every other call (already open, or
   * still under threshold) returns `false`.
   */
  recordFailure(key: string): boolean;
  /** Records a transport success, resetting this key's failure streak. */
  recordSuccess(key: string): void;
}

export function createOrderingCircuitBreaker(
  options: OrderingCircuitBreakerOptions = {},
): OrderingCircuitBreaker {
  const threshold = options.threshold ?? 5;
  const windowMs = options.windowMs ?? 60_000;
  const openMs = options.openMs ?? 30_000;
  const now = options.now ?? Date.now;

  const failureTimestamps = new Map<string, number[]>();
  const openUntil = new Map<string, number>();

  function closeIfExpired(key: string, current: number): void {
    const until = openUntil.get(key);
    if (until !== undefined && current >= until) {
      openUntil.delete(key);
      failureTimestamps.delete(key);
    }
  }

  return {
    isOpen(key: string): boolean {
      const current = now();
      closeIfExpired(key, current);
      const until = openUntil.get(key);
      return until !== undefined && current < until;
    },
    recordFailure(key: string): boolean {
      const current = now();
      closeIfExpired(key, current);
      if (openUntil.has(key)) return false;
      const withinWindow = (failureTimestamps.get(key) ?? []).filter((t) => current - t < windowMs);
      withinWindow.push(current);
      if (withinWindow.length >= threshold) {
        openUntil.set(key, current + openMs);
        failureTimestamps.delete(key);
        return true;
      }
      failureTimestamps.set(key, withinWindow);
      return false;
    },
    recordSuccess(key: string): void {
      failureTimestamps.delete(key);
    },
  };
}

/**
 * Process-wide singleton used by production code (`zeloMenuInternalClient.ts`
 * defaults to this). Tests should construct their own instance via
 * `createOrderingCircuitBreaker` for full isolation and a fake clock instead
 * of reaching into this shared state.
 */
export const orderingCircuitBreaker = createOrderingCircuitBreaker();
