export type AiGlobalMode = 'always_on' | 'always_off' | 'scheduled';

export const DEFAULT_AI_GLOBAL_MODE: AiGlobalMode = 'always_on';

export type AiScheduleDayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export const AI_SCHEDULE_DAY_KEYS: readonly AiScheduleDayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export interface AiScheduleDay {
  /** When false, the AI never replies on this weekday regardless of start/end. */
  enabled: boolean;
  /** 'HH:MM' (00:00–23:59). When start === end on an enabled day, the day is treated as 24h on. */
  start: string;
  end: string;
}

export type AiScheduleDays = Record<AiScheduleDayKey, AiScheduleDay>;

export interface AiScheduleLike {
  aiEnabled?: boolean;
  aiMode?: AiGlobalMode | null;
  /** Legacy single-window schedule applied to every day. Used when `aiScheduleDays` is null. */
  aiScheduleStart?: string | null;
  aiScheduleEnd?: string | null;
  /** Per-day schedule. When present (non-null), takes precedence over the legacy fields. */
  aiScheduleDays?: AiScheduleDays | null;
  timezone?: string | null;
}

export interface AiScheduleEvaluation {
  mode: AiGlobalMode;
  effectiveEnabledNow: boolean;
  hasValidSchedule: boolean;
}

export function normalizeAiGlobalMode(value: unknown): AiGlobalMode | undefined {
  return value === 'always_on' || value === 'always_off' || value === 'scheduled'
    ? value
    : undefined;
}

export function normalizeAiScheduleTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function parseAiScheduleMinutes(value: unknown): number | null {
  const normalized = normalizeAiScheduleTime(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(':').map(Number);
  return hour * 60 + minute;
}

const DEFAULT_DAY_START = '08:00';
const DEFAULT_DAY_END = '18:00';

export function buildDefaultAiScheduleDays(
  start: string = DEFAULT_DAY_START,
  end: string = DEFAULT_DAY_END,
): AiScheduleDays {
  const normalizedStart = normalizeAiScheduleTime(start) ?? DEFAULT_DAY_START;
  const normalizedEnd = normalizeAiScheduleTime(end) ?? DEFAULT_DAY_END;
  const day: AiScheduleDay = { enabled: true, start: normalizedStart, end: normalizedEnd };
  return {
    sun: { ...day },
    mon: { ...day },
    tue: { ...day },
    wed: { ...day },
    thu: { ...day },
    fri: { ...day },
    sat: { ...day },
  };
}

/**
 * Normalizes the raw per-day schedule shape coming from the DB or frontend.
 * Returns null if the value is not a plausible per-day object — caller falls
 * back to the legacy single-window fields.
 *
 * Each day is independent. Disabled days keep their (validated) start/end so
 * the UI can preserve the operator's last choice when they toggle the day
 * back on; if a disabled day has missing/invalid times we substitute the
 * default 08:00–18:00.
 */
export function normalizeAiScheduleDays(value: unknown): AiScheduleDays | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const out = {} as AiScheduleDays;
  for (const key of AI_SCHEDULE_DAY_KEYS) {
    const entry = row[key];
    if (!entry || typeof entry !== 'object') return null;
    const e = entry as { enabled?: unknown; start?: unknown; end?: unknown };
    const enabled = e.enabled === true;
    const start = normalizeAiScheduleTime(e.start);
    const end = normalizeAiScheduleTime(e.end);
    if (enabled) {
      if (!start || !end) return null;
      out[key] = { enabled: true, start, end };
    } else {
      out[key] = {
        enabled: false,
        start: start ?? DEFAULT_DAY_START,
        end: end ?? DEFAULT_DAY_END,
      };
    }
  }
  return out;
}

/**
 * Single-day window check. No overnight wrap on purpose: per-day mode treats
 * each weekday as independent so the operator's mental model ("Saturday 13:00
 * to end of day") doesn't bleed into Sunday. To mean "until end of day" the
 * operator sets end = 23:59. start === end on an enabled day means 24h on.
 */
export function isWithinAiScheduleDay(nowMinutes: number, day: AiScheduleDay): boolean {
  if (!day.enabled) return false;
  const startMinutes = parseAiScheduleMinutes(day.start);
  const endMinutes = parseAiScheduleMinutes(day.end);
  if (startMinutes === null || endMinutes === null) return false;
  if (startMinutes === endMinutes) return true;
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
  }
  return false;
}

export function isWithinAiScheduleWindow(
  nowMinutes: number,
  startMinutes: number,
  endMinutes: number,
): boolean {
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function getNowMinutesInTimezone(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return get('hour') * 60 + get('minute');
}

const WEEKDAY_SHORT_TO_KEY: Record<string, AiScheduleDayKey> = {
  Sun: 'sun',
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
};

function getDayKeyInTimezone(now: Date, timezone: string): AiScheduleDayKey {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(now);
  return WEEKDAY_SHORT_TO_KEY[weekday] ?? 'sun';
}

function hasAnyEnabledDay(days: AiScheduleDays): boolean {
  return AI_SCHEDULE_DAY_KEYS.some((key) => {
    const day = days[key];
    if (!day.enabled) return false;
    const start = parseAiScheduleMinutes(day.start);
    const end = parseAiScheduleMinutes(day.end);
    if (start === null || end === null) return false;
    return start === end || start < end;
  });
}

export function evaluateAiSchedule(config: AiScheduleLike, now = new Date()): AiScheduleEvaluation {
  const mode = normalizeAiGlobalMode(config.aiMode) ?? DEFAULT_AI_GLOBAL_MODE;
  if (config.aiEnabled !== true) {
    return {
      mode,
      effectiveEnabledNow: false,
      hasValidSchedule: mode !== 'scheduled',
    };
  }
  if (mode === 'always_on') {
    return { mode, effectiveEnabledNow: true, hasValidSchedule: true };
  }
  if (mode === 'always_off') {
    return { mode, effectiveEnabledNow: false, hasValidSchedule: true };
  }

  if (!config.timezone) {
    return { mode, effectiveEnabledNow: false, hasValidSchedule: false };
  }

  const days = normalizeAiScheduleDays(config.aiScheduleDays);
  if (days) {
    const nowMinutes = getNowMinutesInTimezone(now, config.timezone);
    const dayKey = getDayKeyInTimezone(now, config.timezone);
    return {
      mode,
      effectiveEnabledNow: isWithinAiScheduleDay(nowMinutes, days[dayKey]),
      hasValidSchedule: hasAnyEnabledDay(days),
    };
  }

  const startMinutes = parseAiScheduleMinutes(config.aiScheduleStart);
  const endMinutes = parseAiScheduleMinutes(config.aiScheduleEnd);
  if (startMinutes === null || endMinutes === null) {
    return { mode, effectiveEnabledNow: false, hasValidSchedule: false };
  }

  const nowMinutes = getNowMinutesInTimezone(now, config.timezone);
  return {
    mode,
    effectiveEnabledNow: isWithinAiScheduleWindow(nowMinutes, startMinutes, endMinutes),
    hasValidSchedule: startMinutes !== endMinutes,
  };
}

export function isAiGloballyEnabledNow(config: AiScheduleLike, now = new Date()): boolean {
  return evaluateAiSchedule(config, now).effectiveEnabledNow;
}
