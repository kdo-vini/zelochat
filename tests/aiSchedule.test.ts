import { DEFAULT_PIX_RECEIPT_CONFIG } from '../src/domain/pixReceipt.js';
import { DEFAULT_ZELOCHAT_MODE } from '../src/domain/zelochatMode.js';
import {
  evaluateAiSchedule,
  isAiGloballyEnabledNow,
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
    timezone: 'America/Sao_Paulo',
    address: 'Rua A, 123',
    pixKey: 'pix@example.com',
    products: [
      {
        available: true,
      } as BusinessConfig['products'][number],
    ],
    catalogHierarchy: [],
    blockedDates: [],
    dailyContext: [],
    aiInstructions: '',
    managerPhone: '5511999999999',
    aiEnabled: true,
    aiMode: 'always_on',
    aiScheduleStart: null,
    aiScheduleEnd: null,
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

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
