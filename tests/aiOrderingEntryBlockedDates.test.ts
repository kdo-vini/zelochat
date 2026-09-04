// PR I-15 — `storeOpen` fed to the canonical ordering entry must never be
// true on a blocked date: on `main`, a bare greeting on a blocked date got
// the entry card with a LIVE "Pedir por aqui" button (weekly hours alone
// said the store was open), inviting an order on a day the store isn't
// operating. Behavioral test using the exact empresa-timezone fixture style
// as tests/aiSchedule.test.ts (setConfig + a mocked Date), not a source grep,
// per the brief.
//
// Run via: npx tsx tests/aiOrderingEntryBlockedDates.test.ts

import { setConfig } from '../server/configStore.js';
import { resolveOrderingEntryStoreOpen } from '../server/ai.js';
import { assert, runSuite } from './testHarness.js';

function atUtc(value: string): Date {
  return new Date(value);
}

await runSuite('Ordering entry storeOpen respects blocked_dates', [
  {
    name: 'weekly-open day with no blocked dates stays open',
    run: () => {
      const empresaId = `entry-open-${Date.now()}`;
      setConfig(empresaId, {
        timezone: 'America/Sao_Paulo',
        weeklyHours: null,
        openTime: '09:00',
        closeTime: '18:00',
        closedDays: [],
        blockedDates: [],
      });
      // 2026-09-03 is a Thursday, 13:00 BRT (16:00 UTC) — inside hours.
      const open = resolveOrderingEntryStoreOpen(empresaId, atUtc('2026-09-03T16:00:00.000Z'), 'America/Sao_Paulo');
      assert(open === true, 'weekly hours alone say open, and nothing is blocked today');
    },
  },
  {
    name: 'a blocked TODAY forces the entry closed even though weekly hours say open',
    run: () => {
      const empresaId = `entry-blocked-${Date.now()}`;
      setConfig(empresaId, {
        timezone: 'America/Sao_Paulo',
        weeklyHours: null,
        openTime: '09:00',
        closeTime: '18:00',
        closedDays: [],
        blockedDates: [{ date: '2026-09-03', reason: 'Feriado municipal' }],
      });
      const open = resolveOrderingEntryStoreOpen(empresaId, atUtc('2026-09-03T16:00:00.000Z'), 'America/Sao_Paulo');
      assert(open === false, 'a blocked date must never offer the live entry button, regardless of weekly hours');
    },
  },
  {
    name: 'a blocked date that is NOT today never affects storeOpen',
    run: () => {
      const empresaId = `entry-other-day-blocked-${Date.now()}`;
      setConfig(empresaId, {
        timezone: 'America/Sao_Paulo',
        weeklyHours: null,
        openTime: '09:00',
        closeTime: '18:00',
        closedDays: [],
        blockedDates: [{ date: '2026-12-25', reason: 'Natal' }],
      });
      const open = resolveOrderingEntryStoreOpen(empresaId, atUtc('2026-09-03T16:00:00.000Z'), 'America/Sao_Paulo');
      assert(open === true, 'a blocked date on a different day must not close the entry today');
    },
  },
  {
    name: 'the empresa timezone resolves which calendar day is "today" for the blocked-date check',
    run: () => {
      const empresaId = `entry-timezone-${Date.now()}`;
      setConfig(empresaId, {
        timezone: 'America/Sao_Paulo',
        weeklyHours: null,
        openTime: '00:00',
        closeTime: '23:59',
        closedDays: [],
        blockedDates: [{ date: '2026-09-03', reason: 'Feriado' }],
      });
      // 2026-09-03T23:30:00-03:00 == 2026-09-04T02:30:00Z: UTC calendar day
      // is already the 4th, but São Paulo's local calendar day is still the
      // blocked 3rd — the empresa timezone, not UTC, must decide.
      const open = resolveOrderingEntryStoreOpen(empresaId, atUtc('2026-09-04T02:30:00.000Z'), 'America/Sao_Paulo');
      assert(open === false, 'the blocked date is resolved in the empresa\'s own timezone, not UTC');
    },
  },
]);
