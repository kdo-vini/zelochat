import { DEFAULT_PIX_RECEIPT_CONFIG } from '../src/domain/pixReceipt.js';
import { DEFAULT_ZELOCHAT_MODE } from '../src/domain/zelochatMode.js';
import {
  buildDefaultAiScheduleDays,
  evaluateAiSchedule,
  isAiGloballyEnabledNow,
  normalizeAiScheduleDays,
  type AiScheduleDays,
} from '../src/domain/aiSchedule.js';
import { buildAiHealthReport } from '../server/aiHealth.js';
import type { BusinessConfig } from '../server/configStore.js';

function atUtc(value: string): Date {
  return new Date(value);
}

function withMockedNow<T>(value: string, run: () => T): T {
  const RealDate = Date;
  class MockDate extends Date {
    constructor(input?: string | number | Date) {
      super(input ?? value);
    }

    static override now(): number {
      return new RealDate(value).getTime();
    }
  }
  globalThis.Date = MockDate as DateConstructor;
  try {
    return run();
  } finally {
    globalThis.Date = RealDate;
  }
}

let pass = 0;
let fail = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log('  PASS', message);
    pass++;
    return;
  }
  console.log('  FAIL', message);
  fail++;
}

function makeConfig(overrides: Partial<BusinessConfig> = {}): BusinessConfig {
  return {
    name: 'Loja teste',
    specialty: 'Lanches',
    hours: 'Todos os dias',
    openTime: '09:00',
    closeTime: '18:00',
    closedDays: [],
    weeklyHours: null,
    timezone: 'America/Sao_Paulo',
    address: 'Rua A, 123',
    pixKey: 'pix@example.com',
    zelomenuSlug: 'loja-teste',
    products: [
      {
        available: true,
      } as BusinessConfig['products'][number],
    ],
    catalogHierarchy: [],
    blockedDates: [],
    aiInstructions: '',
    managerPhone: '5511999999999',
    aiEnabled: true,
    aiMode: 'always_on',
    aiScheduleStart: null,
    aiScheduleEnd: null,
    aiScheduleDays: null,
    aiCanReengagePending: false,
    deliveryConfig: { enabled: false, neighborhoods: [] },
    pixReceiptConfig: { ...DEFAULT_PIX_RECEIPT_CONFIG },
    zelochatMode: DEFAULT_ZELOCHAT_MODE,
    ...overrides,
  };
}

console.log('Test 1: always_on and always_off modes');
{
  assert(
    isAiGloballyEnabledNow({
      aiEnabled: true,
      aiMode: 'always_on',
      timezone: 'America/Sao_Paulo',
    }),
    'always_on stays enabled',
  );
  assert(
    !isAiGloballyEnabledNow({
      aiEnabled: false,
      aiMode: 'always_off',
      timezone: 'America/Sao_Paulo',
    }),
    'always_off stays disabled',
  );
}

console.log('\nTest 2: scheduled daytime window');
{
  const active = evaluateAiSchedule({
    aiEnabled: true,
    aiMode: 'scheduled',
    aiScheduleStart: '09:00',
    aiScheduleEnd: '18:00',
    timezone: 'America/Sao_Paulo',
  }, atUtc('2026-05-06T12:00:00.000Z'));
  const inactive = evaluateAiSchedule({
    aiEnabled: true,
    aiMode: 'scheduled',
    aiScheduleStart: '09:00',
    aiScheduleEnd: '18:00',
    timezone: 'America/Sao_Paulo',
  }, atUtc('2026-05-06T21:30:00.000Z'));
  assert(active.effectiveEnabledNow, '09:00-18:00 is active at 09:00 local');
  assert(!inactive.effectiveEnabledNow, '09:00-18:00 is inactive after 18:00 local');
}

console.log('\nTest 3: overnight window');
{
  const config = {
    aiEnabled: true,
    aiMode: 'scheduled' as const,
    aiScheduleStart: '18:00',
    aiScheduleEnd: '08:00',
    timezone: 'America/Sao_Paulo',
  };
  assert(
    evaluateAiSchedule(config, atUtc('2026-05-07T02:30:00.000Z')).effectiveEnabledNow,
    '18:00-08:00 is active at 23:30 local',
  );
  assert(
    evaluateAiSchedule(config, atUtc('2026-05-07T10:59:00.000Z')).effectiveEnabledNow,
    '18:00-08:00 is active at 07:59 local',
  );
  assert(
    !evaluateAiSchedule(config, atUtc('2026-05-07T11:01:00.000Z')).effectiveEnabledNow,
    '18:00-08:00 is inactive at 08:01 local',
  );
  assert(
    !evaluateAiSchedule(config, atUtc('2026-05-06T20:59:00.000Z')).effectiveEnabledNow,
    '18:00-08:00 is inactive at 17:59 local',
  );
}

console.log('\nTest 4: invalid scheduled config fails closed');
{
  const missingTimes = evaluateAiSchedule({
    aiEnabled: true,
    aiMode: 'scheduled',
    aiScheduleStart: null,
    aiScheduleEnd: '08:00',
    timezone: 'America/Sao_Paulo',
  });
  const sameTimes = evaluateAiSchedule({
    aiEnabled: true,
    aiMode: 'scheduled',
    aiScheduleStart: '08:00',
    aiScheduleEnd: '08:00',
    timezone: 'America/Sao_Paulo',
  });
  assert(!missingTimes.effectiveEnabledNow && !missingTimes.hasValidSchedule, 'missing schedule fails closed');
  assert(!sameTimes.effectiveEnabledNow && !sameTimes.hasValidSchedule, 'equal schedule bounds are invalid');
}

console.log('\nTest 5: AI health summary tracks scheduled state');
{
  const disabled = buildAiHealthReport(makeConfig({
    aiEnabled: false,
    aiMode: 'always_off',
  }));
  const scheduledOff = withMockedNow('2026-05-06T20:59:00.000Z', () => buildAiHealthReport(makeConfig({
    aiEnabled: true,
    aiMode: 'scheduled',
    aiScheduleStart: '18:00',
    aiScheduleEnd: '08:00',
  })));
  assert(disabled.safeSummaryStatus === 'disabled', 'health reports disabled when mode is always_off');
  assert(
    scheduledOff.safeSummaryStatus === 'scheduled_off',
    'health reports scheduled_off when outside the active window',
  );
}

console.log('\nTest 6: per-day schedule applies the right window for the right weekday');
{
  // 2026-05-02 = Saturday, 2026-05-03 = Sunday, 2026-05-04 = Monday
  // (verified via Intl.DateTimeFormat with America/Sao_Paulo)
  const days: AiScheduleDays = {
    sun: { enabled: true, start: '00:00', end: '00:00', inverted: false }, // 24h
    mon: { enabled: true, start: '08:00', end: '18:00', inverted: false },
    tue: { enabled: true, start: '08:00', end: '18:00', inverted: false },
    wed: { enabled: true, start: '08:00', end: '18:00', inverted: false },
    thu: { enabled: true, start: '08:00', end: '18:00', inverted: false },
    fri: { enabled: true, start: '08:00', end: '18:00', inverted: false },
    sat: { enabled: true, start: '13:00', end: '23:59', inverted: false },
  };
  const base = {
    aiEnabled: true,
    aiMode: 'scheduled' as const,
    aiScheduleStart: null,
    aiScheduleEnd: null,
    aiScheduleDays: days,
    timezone: 'America/Sao_Paulo',
  };
  // Sunday 04:00 local (2026-05-03 07:00 UTC) — Sunday is 24h → active
  assert(
    evaluateAiSchedule(base, atUtc('2026-05-03T07:00:00.000Z')).effectiveEnabledNow,
    'sunday 24h is active at 04:00',
  );
  // Saturday 15:00 local (2026-05-02 18:00 UTC) — Saturday 13:00-23:59 → active
  assert(
    evaluateAiSchedule(base, atUtc('2026-05-02T18:00:00.000Z')).effectiveEnabledNow,
    'saturday 13:00-23:59 is active at 15:00',
  );
  // Saturday 11:00 local (2026-05-02 14:00 UTC) — before the saturday window → inactive
  assert(
    !evaluateAiSchedule(base, atUtc('2026-05-02T14:00:00.000Z')).effectiveEnabledNow,
    'saturday 13:00-23:59 is inactive at 11:00',
  );
  // Monday 10:00 local (2026-05-04 13:00 UTC) — within commercial hours → active
  assert(
    evaluateAiSchedule(base, atUtc('2026-05-04T13:00:00.000Z')).effectiveEnabledNow,
    'monday 08:00-18:00 is active at 10:00',
  );
  // Monday 20:00 local (2026-05-04 23:00 UTC) — outside commercial hours → inactive
  assert(
    !evaluateAiSchedule(base, atUtc('2026-05-04T23:00:00.000Z')).effectiveEnabledNow,
    'monday 08:00-18:00 is inactive at 20:00',
  );
}

console.log('\nTest 7: disabled day silences the AI even mid-window');
{
  const days = buildDefaultAiScheduleDays('08:00', '18:00');
  days.mon = { enabled: false, start: '08:00', end: '18:00', inverted: false };
  // Monday 12:00 local (2026-05-04 15:00 UTC) — should be silenced
  assert(
    !evaluateAiSchedule({
      aiEnabled: true,
      aiMode: 'scheduled',
      aiScheduleStart: null,
      aiScheduleEnd: null,
      aiScheduleDays: days,
      timezone: 'America/Sao_Paulo',
    }, atUtc('2026-05-04T15:00:00.000Z')).effectiveEnabledNow,
    'monday disabled = inactive even at 12:00',
  );
  // Tuesday 12:00 local (2026-05-05 15:00 UTC) — Tuesday is enabled → active
  assert(
    evaluateAiSchedule({
      aiEnabled: true,
      aiMode: 'scheduled',
      aiScheduleStart: null,
      aiScheduleEnd: null,
      aiScheduleDays: days,
      timezone: 'America/Sao_Paulo',
    }, atUtc('2026-05-05T15:00:00.000Z')).effectiveEnabledNow,
    'tuesday still active when only monday is disabled',
  );
}

console.log('\nTest 8: per-day schedule takes precedence over legacy single window');
{
  const days = buildDefaultAiScheduleDays('00:00', '00:00'); // every day 24h
  // Legacy says 09:00-18:00 (inactive at 21:00); per-day says 24h (active).
  assert(
    evaluateAiSchedule({
      aiEnabled: true,
      aiMode: 'scheduled',
      aiScheduleStart: '09:00',
      aiScheduleEnd: '18:00',
      aiScheduleDays: days,
      timezone: 'America/Sao_Paulo',
    }, atUtc('2026-05-07T00:00:00.000Z')).effectiveEnabledNow,
    'per-day 24h wins over legacy 09:00-18:00 at 21:00 local',
  );
}

console.log('\nTest 8b: inverted flag flips the window (Casa dos Salgados pattern)');
{
  // Casa dos Salgados: humans 06:00–18:00, AI covers 18:00→06:00 next day, Sunday 24h.
  const days: AiScheduleDays = {
    sun: { enabled: true, start: '00:00', end: '00:00', inverted: false },
    mon: { enabled: true, start: '06:00', end: '18:00', inverted: true },
    tue: { enabled: true, start: '06:00', end: '18:00', inverted: true },
    wed: { enabled: true, start: '06:00', end: '18:00', inverted: true },
    thu: { enabled: true, start: '06:00', end: '18:00', inverted: true },
    fri: { enabled: true, start: '06:00', end: '18:00', inverted: true },
    sat: { enabled: true, start: '06:00', end: '18:00', inverted: true },
  };
  const base = {
    aiEnabled: true,
    aiMode: 'scheduled' as const,
    aiScheduleStart: null,
    aiScheduleEnd: null,
    aiScheduleDays: days,
    timezone: 'America/Sao_Paulo',
  };
  // Monday 02:00 local (2026-05-04 05:00 UTC) — outside [06:00, 18:00], AI on
  assert(
    evaluateAiSchedule(base, atUtc('2026-05-04T05:00:00.000Z')).effectiveEnabledNow,
    'inverted monday 06-18: 02:00 is AI on',
  );
  // Monday 12:00 local (2026-05-04 15:00 UTC) — inside window, AI off (human shift)
  assert(
    !evaluateAiSchedule(base, atUtc('2026-05-04T15:00:00.000Z')).effectiveEnabledNow,
    'inverted monday 06-18: 12:00 is AI off',
  );
  // Monday 22:00 local (2026-05-05 01:00 UTC) — outside, AI on
  assert(
    evaluateAiSchedule(base, atUtc('2026-05-05T01:00:00.000Z')).effectiveEnabledNow,
    'inverted monday 06-18: 22:00 is AI on',
  );
  // Sunday 12:00 local (2026-05-03 15:00 UTC) — 24h on
  assert(
    evaluateAiSchedule(base, atUtc('2026-05-03T15:00:00.000Z')).effectiveEnabledNow,
    'sunday 24h overrides inverted check',
  );
}

console.log('\nTest 8c: inverted flag is optional in normalizer (backward compat)');
{
  // Existing JSONB rows without the inverted key default to inverted=false.
  const days = normalizeAiScheduleDays({
    sun: { enabled: true, start: '08:00', end: '18:00' },
    mon: { enabled: true, start: '08:00', end: '18:00' },
    tue: { enabled: true, start: '08:00', end: '18:00' },
    wed: { enabled: true, start: '08:00', end: '18:00' },
    thu: { enabled: true, start: '08:00', end: '18:00' },
    fri: { enabled: true, start: '08:00', end: '18:00' },
    sat: { enabled: true, start: '08:00', end: '18:00' },
  });
  assert(days !== null, 'days without inverted key are accepted');
  assert(days?.mon.inverted === false, 'missing inverted defaults to false');
}

console.log('\nTest 9: normalizeAiScheduleDays rejects malformed payloads');
{
  assert(normalizeAiScheduleDays(null) === null, 'null returns null');
  assert(normalizeAiScheduleDays({}) === null, 'empty object returns null (missing days)');
  assert(
    normalizeAiScheduleDays({
      sun: { enabled: true, start: '08:00', end: '18:00' },
      // missing mon..sat
    }) === null,
    'partial weekdays return null',
  );
  const enabledWithoutTimes = normalizeAiScheduleDays({
    sun: { enabled: true },
    mon: { enabled: true, start: '08:00', end: '18:00' },
    tue: { enabled: true, start: '08:00', end: '18:00' },
    wed: { enabled: true, start: '08:00', end: '18:00' },
    thu: { enabled: true, start: '08:00', end: '18:00' },
    fri: { enabled: true, start: '08:00', end: '18:00' },
    sat: { enabled: true, start: '08:00', end: '18:00' },
  });
  assert(enabledWithoutTimes === null, 'enabled day without times is rejected');
}

console.log('\nTest 10: blocked_dates force AI on 24h on Casa dos Salgados pattern');
{
  // Casa dos Salgados: humans 06–18, AI overnight. Without blocked_dates,
  // monday 12:00 BRT = AI off. Add today (2026-05-04 = Monday) to
  // blocked_dates → AI must be on 24h regardless of the schedule.
  const days: AiScheduleDays = {
    sun: { enabled: true, start: '00:00', end: '00:00', inverted: false },
    mon: { enabled: true, start: '06:00', end: '18:00', inverted: true },
    tue: { enabled: true, start: '06:00', end: '18:00', inverted: true },
    wed: { enabled: true, start: '06:00', end: '18:00', inverted: true },
    thu: { enabled: true, start: '06:00', end: '18:00', inverted: true },
    fri: { enabled: true, start: '06:00', end: '18:00', inverted: true },
    sat: { enabled: true, start: '06:00', end: '18:00', inverted: true },
  };
  const base = {
    aiEnabled: true,
    aiMode: 'scheduled' as const,
    aiScheduleDays: days,
    timezone: 'America/Sao_Paulo',
  };
  // Monday 12:00 BRT (2026-05-04 15:00 UTC) — normally AI off (human shift)
  const withoutBlocked = evaluateAiSchedule(base, atUtc('2026-05-04T15:00:00.000Z'));
  assert(!withoutBlocked.effectiveEnabledNow, 'baseline: monday 12:00 BRT is AI off without blocked_dates');

  // Same instant, but today is in blocked_dates → AI on
  const withBlocked = evaluateAiSchedule({
    ...base,
    blockedDates: [{ date: '2026-05-04', reason: 'Folga do dono' }],
  }, atUtc('2026-05-04T15:00:00.000Z'));
  assert(withBlocked.effectiveEnabledNow, 'blocked_dates: monday 12:00 BRT becomes AI on');
}

console.log('\nTest 11: always_off still wins over blocked_dates');
{
  // Operator deliberately killed the AI globally — blocked_dates should NOT
  // resurrect it. Respecting the deliberate kill switch is the safer
  // posture (e.g. operator handles WhatsApp themselves during a holiday).
  const evalResult = evaluateAiSchedule({
    aiEnabled: false,
    aiMode: 'always_off',
    blockedDates: [{ date: '2026-05-04', reason: 'Folga do dono' }],
    timezone: 'America/Sao_Paulo',
  }, atUtc('2026-05-04T15:00:00.000Z'));
  assert(!evalResult.effectiveEnabledNow, 'always_off + blocked date = still off');
}

console.log('\nTest 12: timezone matters — blocked date is local, not UTC');
{
  // 2026-05-04T02:00:00 UTC = 2026-05-03 23:00 BRT (Sunday still).
  // If the operator blocked 2026-05-03 (Sunday), this UTC instant should
  // count as blocked in BRT even though UTC says May 4.
  const evalResult = evaluateAiSchedule({
    aiEnabled: true,
    aiMode: 'scheduled',
    aiScheduleDays: {
      sun: { enabled: false, start: '08:00', end: '18:00', inverted: false },
      mon: { enabled: true, start: '08:00', end: '18:00', inverted: false },
      tue: { enabled: true, start: '08:00', end: '18:00', inverted: false },
      wed: { enabled: true, start: '08:00', end: '18:00', inverted: false },
      thu: { enabled: true, start: '08:00', end: '18:00', inverted: false },
      fri: { enabled: true, start: '08:00', end: '18:00', inverted: false },
      sat: { enabled: false, start: '08:00', end: '18:00', inverted: false },
    },
    blockedDates: [{ date: '2026-05-03', reason: 'Dia da Mãe' }],
    timezone: 'America/Sao_Paulo',
  }, atUtc('2026-05-04T02:00:00.000Z')); // Sunday 23:00 BRT
  assert(evalResult.effectiveEnabledNow, 'blocked date resolves in empresa timezone');
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
