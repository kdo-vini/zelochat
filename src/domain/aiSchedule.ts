export type AiGlobalMode = 'always_on' | 'always_off' | 'scheduled';

export const DEFAULT_AI_GLOBAL_MODE: AiGlobalMode = 'always_on';

export interface AiScheduleLike {
  aiEnabled?: boolean;
  aiMode?: AiGlobalMode | null;
  aiScheduleStart?: string | null;
  aiScheduleEnd?: string | null;
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

  const startMinutes = parseAiScheduleMinutes(config.aiScheduleStart);
  const endMinutes = parseAiScheduleMinutes(config.aiScheduleEnd);
  if (startMinutes === null || endMinutes === null || !config.timezone) {
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
