import {
  buildScheduleFromWizard,
  DEFAULT_WIZARD_STATE,
  reverseEngineerWizardState,
  summarizeScheduleResult,
  type ScheduleWizardState,
} from '../src/domain/aiScheduleWizard.js';
import { evaluateAiSchedule } from '../src/domain/aiSchedule.js';

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

function makeWizardState(overrides: Partial<ScheduleWizardState> = {}): ScheduleWizardState {
  return { ...DEFAULT_WIZARD_STATE, ...overrides };
}

console.log('Test 1: Casa dos Salgados scenario (human_covers_business)');
{
  const state = makeWizardState({
    scenario: 'human_covers_business',
    selectedDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    startTime: '06:00',
    endTime: '18:00',
  });
  const result = buildScheduleFromWizard(state);
  assert(result.mode === 'scheduled', 'mode is scheduled');
  assert(result.scheduleDays !== null, 'scheduleDays is set');
  if (result.scheduleDays) {
    assert(result.scheduleDays.mon.inverted === true, 'monday inverted=true');
    assert(result.scheduleDays.mon.start === '06:00' && result.scheduleDays.mon.end === '18:00', 'monday window matches');
    assert(result.scheduleDays.sat.inverted === true, 'saturday inverted=true');
    // Sunday wasn't selected → 24h AI on
    assert(
      result.scheduleDays.sun.enabled === true
      && result.scheduleDays.sun.start === '00:00'
      && result.scheduleDays.sun.end === '00:00',
      'sunday is 24h',
    );
  }

  // End-to-end through the evaluator: Monday 02:00 local should be ON (AI covers).
  const evalResult = evaluateAiSchedule({
    aiEnabled: true,
    aiMode: 'scheduled',
    aiScheduleDays: result.scheduleDays,
    timezone: 'America/Sao_Paulo',
  }, new Date('2026-05-04T05:00:00.000Z')); // Monday 02:00 BRT
  assert(evalResult.effectiveEnabledNow, 'monday 02:00 BRT: AI on (outside human window)');

  const evalResult2 = evaluateAiSchedule({
    aiEnabled: true,
    aiMode: 'scheduled',
    aiScheduleDays: result.scheduleDays,
    timezone: 'America/Sao_Paulo',
  }, new Date('2026-05-04T15:00:00.000Z')); // Monday 12:00 BRT
  assert(!evalResult2.effectiveEnabledNow, 'monday 12:00 BRT: AI off (human shift)');
}

console.log('\nTest 2: AI covers commercial hours (ai_covers_business)');
{
  const state = makeWizardState({
    scenario: 'ai_covers_business',
    selectedDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    startTime: '08:00',
    endTime: '18:00',
  });
  const result = buildScheduleFromWizard(state);
  assert(result.mode === 'scheduled', 'mode is scheduled');
  if (result.scheduleDays) {
    assert(result.scheduleDays.mon.enabled && !result.scheduleDays.mon.inverted, 'monday enabled, not inverted');
    assert(result.scheduleDays.mon.start === '08:00' && result.scheduleDays.mon.end === '18:00', 'monday window matches');
    assert(!result.scheduleDays.sat.enabled, 'saturday disabled');
    assert(!result.scheduleDays.sun.enabled, 'sunday disabled');
  }
}

console.log('\nTest 3: AI always (ai_always)');
{
  const state = makeWizardState({ scenario: 'ai_always' });
  const result = buildScheduleFromWizard(state);
  assert(result.mode === 'always_on', 'mode is always_on');
  assert(result.scheduleDays === null, 'no scheduleDays needed');
}

console.log('\nTest 4: Reverse-engineer Casa dos Salgados pattern from saved JSONB');
{
  const days = {
    sun: { enabled: true, start: '00:00', end: '00:00', inverted: false }, // 24h
    mon: { enabled: true, start: '06:00', end: '18:00', inverted: true },
    tue: { enabled: true, start: '06:00', end: '18:00', inverted: true },
    wed: { enabled: true, start: '06:00', end: '18:00', inverted: true },
    thu: { enabled: true, start: '06:00', end: '18:00', inverted: true },
    fri: { enabled: true, start: '06:00', end: '18:00', inverted: true },
    sat: { enabled: true, start: '06:00', end: '18:00', inverted: true },
  };
  const state = reverseEngineerWizardState('scheduled', days);
  assert(state !== null, 'state reverse-engineered');
  if (state) {
    assert(state.scenario === 'human_covers_business', 'scenario is human_covers_business');
    assert(state.startTime === '06:00' && state.endTime === '18:00', 'window matches');
    assert(state.selectedDays.length === 6, 'six human days');
    assert(!state.selectedDays.includes('sun'), 'sunday not in human days');
  }
}

console.log('\nTest 5: Reverse-engineer commercial hours pattern');
{
  const days = {
    sun: { enabled: false, start: '08:00', end: '18:00', inverted: false },
    mon: { enabled: true, start: '08:00', end: '18:00', inverted: false },
    tue: { enabled: true, start: '08:00', end: '18:00', inverted: false },
    wed: { enabled: true, start: '08:00', end: '18:00', inverted: false },
    thu: { enabled: true, start: '08:00', end: '18:00', inverted: false },
    fri: { enabled: true, start: '08:00', end: '18:00', inverted: false },
    sat: { enabled: false, start: '08:00', end: '18:00', inverted: false },
  };
  const state = reverseEngineerWizardState('scheduled', days);
  assert(state !== null, 'state reverse-engineered');
  if (state) {
    assert(state.scenario === 'ai_covers_business', 'scenario is ai_covers_business');
    assert(state.selectedDays.length === 5, 'five AI days');
  }
}

console.log('\nTest 6: Reverse-engineer returns null for non-uniform / hand-edited schedules');
{
  // Different windows per day — wizard can't express it.
  const days = {
    sun: { enabled: true, start: '00:00', end: '00:00', inverted: false },
    mon: { enabled: true, start: '08:00', end: '18:00', inverted: false },
    tue: { enabled: true, start: '09:00', end: '17:00', inverted: false }, // different
    wed: { enabled: true, start: '08:00', end: '18:00', inverted: false },
    thu: { enabled: true, start: '08:00', end: '18:00', inverted: false },
    fri: { enabled: true, start: '08:00', end: '18:00', inverted: false },
    sat: { enabled: false, start: '08:00', end: '18:00', inverted: false },
  };
  assert(reverseEngineerWizardState('scheduled', days) === null, 'returns null for non-uniform schedule');
}

console.log('\nTest 7: Summary lines describe each day in PT-BR');
{
  const state = makeWizardState({
    scenario: 'human_covers_business',
    selectedDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    startTime: '06:00',
    endTime: '18:00',
  });
  const result = buildScheduleFromWizard(state);
  const summary = summarizeScheduleResult(result);
  const sunLine = summary.lines.find((l) => l.day === 'sun');
  const monLine = summary.lines.find((l) => l.day === 'mon');
  assert(sunLine?.label.includes('24h') || sunLine?.label.includes('dia todo'), 'sunday line mentions 24h/dia todo');
  assert(monLine?.label.includes('Humano') && monLine?.label.includes('06:00'), 'monday line mentions human shift');
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
