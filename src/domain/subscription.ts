export interface SubscriptionExpiryLike {
  current_period_end: string | null;
  manually_extended_until: string | null;
}

export interface ActiveSubscriptionLike extends SubscriptionExpiryLike {
  status: string | null;
}

function parseExpiryCandidate(raw: string | null | undefined): { raw: string; ms: number } | null {
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  if (Number.isNaN(ms)) return null;
  return { raw, ms };
}

// FIX 2026-06-11: an expired manual extension must not shorten a renewed plan.
// The effective expiry is always the later valid timestamp between the normal
// billing period and any manual extension.
export function getEffectiveSubscriptionExpiry(
  subscription: SubscriptionExpiryLike | null | undefined,
): string | null {
  if (!subscription) return null;

  const candidates = [
    parseExpiryCandidate(subscription.current_period_end),
    parseExpiryCandidate(subscription.manually_extended_until),
  ].filter((candidate): candidate is { raw: string; ms: number } => candidate != null);

  if (candidates.length === 0) return null;

  return candidates.reduce((latest, current) => (current.ms > latest.ms ? current : latest)).raw;
}

export function getEffectiveSubscriptionExpiryMs(
  subscription: SubscriptionExpiryLike | null | undefined,
): number | null {
  const expiry = getEffectiveSubscriptionExpiry(subscription);
  if (!expiry) return null;
  return new Date(expiry).getTime();
}

export function isSubscriptionCurrentlyActive(
  subscription: ActiveSubscriptionLike | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!subscription || subscription.status !== 'active') return false;
  const expiryMs = getEffectiveSubscriptionExpiryMs(subscription);
  return expiryMs != null && expiryMs > nowMs;
}
