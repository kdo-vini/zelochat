export const CAMPAIGN_LIMITS = { defaultDailyLimit: 50, hardDailyCap: 200, startsPerMinute: 12 } as const;

export function canStartCampaign(input: { activeStartsLastMinute: number; dailySent: number; requested: number; dailyLimit?: number }): boolean {
  const dailyLimit = Math.min(input.dailyLimit ?? CAMPAIGN_LIMITS.defaultDailyLimit, CAMPAIGN_LIMITS.hardDailyCap);
  return input.activeStartsLastMinute < CAMPAIGN_LIMITS.startsPerMinute && input.dailySent < dailyLimit && input.requested > 0 && input.dailySent + input.requested <= dailyLimit;
}

export function createRateLimiter(maximum: number, windowMs: number, now: () => number = Date.now): { allow(key: string): boolean } {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return { allow(key) { const current = now(); const entry = windows.get(key); if (!entry || current - entry.startedAt >= windowMs) { windows.set(key, { startedAt: current, count: 1 }); return true; } if (entry.count >= maximum) return false; entry.count += 1; return true; } };
}

export function nextRetryAt(attempt: number, now = new Date()): Date | null { if (attempt >= 3) return null; return new Date(now.getTime() + Math.min(60_000 * 2 ** Math.max(attempt - 1, 0), 15 * 60_000)); }
