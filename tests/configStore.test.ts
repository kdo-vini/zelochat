import { evaluateGlobalAiState, getConfig, isAiGloballyEnabledNow, setConfig } from '../server/configStore.js';
import { assert, assertEqual, runSuite } from './testHarness.js';

function at(value: string): Date {
  return new Date(value);
}

await runSuite('Config store activation rules', [
  {
    name: 'always_off forces AI disabled',
    run: () => {
      const empresaId = `cfg-off-${Date.now()}`;
      setConfig(empresaId, { aiMode: 'always_off' });
      assertEqual(getConfig(empresaId).aiEnabled, false, 'always_off sets aiEnabled=false');
      assertEqual(isAiGloballyEnabledNow(empresaId), false, 'always_off is not active now');
    },
  },
  {
    name: 'always_on forces AI enabled',
    run: () => {
      const empresaId = `cfg-on-${Date.now()}`;
      setConfig(empresaId, { aiEnabled: false, aiMode: 'always_on' });
      assertEqual(getConfig(empresaId).aiEnabled, true, 'always_on sets aiEnabled=true');
      assertEqual(isAiGloballyEnabledNow(empresaId), true, 'always_on is active now');
    },
  },
  {
    name: 'scheduled mode respects configured window',
    run: () => {
      const empresaId = `cfg-schedule-${Date.now()}`;
      setConfig(empresaId, {
        aiMode: 'scheduled',
        aiScheduleStart: '09:00',
        aiScheduleEnd: '18:00',
        timezone: 'America/Sao_Paulo',
      });
      assert(evaluateGlobalAiState(empresaId, at('2026-05-17T13:00:00.000Z')).effectiveEnabledNow, 'scheduled AI is enabled inside window');
      assert(!evaluateGlobalAiState(empresaId, at('2026-05-17T23:00:00.000Z')).effectiveEnabledNow, 'scheduled AI is disabled outside window');
    },
  },
  {
    name: 'invalid schedule times fail closed',
    run: () => {
      const empresaId = `cfg-invalid-${Date.now()}`;
      setConfig(empresaId, {
        aiMode: 'scheduled',
        aiScheduleStart: '99:99',
        aiScheduleEnd: '18:00',
      });
      const state = evaluateGlobalAiState(empresaId);
      assertEqual(getConfig(empresaId).aiScheduleStart, null, 'invalid start time is normalized away');
      assert(!state.hasValidSchedule && !state.effectiveEnabledNow, 'invalid schedule is disabled');
    },
  },
  {
    name: 'hours string hydrates open and close times',
    run: () => {
      const empresaId = `cfg-hours-${Date.now()}`;
      setConfig(empresaId, { hours: '09:30–21:15' });
      assertEqual(getConfig(empresaId).openTime, '09:30', 'open time parsed from hours');
      assertEqual(getConfig(empresaId).closeTime, '21:15', 'close time parsed from hours');
    },
  },
]);
