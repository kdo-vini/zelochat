import {
  CLOSED_DAY_LABELS,
  deriveLegacyFromWeekly,
  deriveWeeklyFromLegacy,
  isMinuteWithinDay,
  isMinuteWithinWindow,
  isOpenAt,
  minutesInTz,
  normalizeWeeklyHours,
  summarizeWeekly,
  weekdayKeyInTz,
  windowEndMinutes,
  type WeeklyHours,
} from '../src/domain/businessHours.js';
import { assert, pass, fail } from './testHarness.js';

function emptyWeekly(): WeeklyHours {
  return { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] };
}

// ---------------------------------------------------------------------------
console.log('\nCLOSED_DAY_LABELS (contrato com ZeloMenu — não alterar)');
assert(CLOSED_DAY_LABELS.sun === 'Dom', 'sun → Dom');
assert(CLOSED_DAY_LABELS.mon === 'Seg', 'mon → Seg');
assert(CLOSED_DAY_LABELS.sat === 'Sáb', 'sat → Sáb');

// ---------------------------------------------------------------------------
console.log('\nwindowEndMinutes');
assert(windowEndMinutes({ start: '18:00', end: '23:00' }) === 1380, 'end 23:00 = 1380');
assert(windowEndMinutes({ start: '18:00', end: '00:00' }) === 1440, 'end 00:00 (start≠00:00) = 1440 (meia-noite)');
assert(windowEndMinutes({ start: '00:00', end: '00:00' }) === 0, 'end 00:00 com start 00:00 = 0 (caso 24h/wrap)');
assert(windowEndMinutes({ start: '18:00', end: '24:00' }) === 1440, 'end 24:00 = 1440');

// ---------------------------------------------------------------------------
console.log('\nisMinuteWithinWindow');
const lunch = { start: '11:00', end: '14:00' };
assert(isMinuteWithinWindow(12 * 60, lunch), '12:00 dentro de 11:00–14:00');
assert(!isMinuteWithinWindow(16 * 60, lunch), '16:00 fora de 11:00–14:00');
assert(isMinuteWithinWindow(23 * 60, { start: '18:00', end: '00:00' }), '23:00 dentro de 18:00–00:00 (meia-noite)');
// wrap (legado overnight): 18:00–02:00
const overnight = { start: '18:00', end: '02:00' };
assert(isMinuteWithinWindow(60, overnight), '01:00 dentro de 18:00–02:00 (wrap)');
assert(isMinuteWithinWindow(20 * 60, overnight), '20:00 dentro de 18:00–02:00 (wrap)');
assert(!isMinuteWithinWindow(10 * 60, overnight), '10:00 fora de 18:00–02:00 (wrap)');

// ---------------------------------------------------------------------------
console.log('\nisMinuteWithinDay — vão almoço/jantar é fechado');
const splitDay = emptyWeekly();
splitDay.mon = [{ start: '11:00', end: '14:00' }, { start: '18:00', end: '23:00' }];
assert(isMinuteWithinDay(splitDay, 'mon', 12 * 60), '12:00 aberto (almoço)');
assert(!isMinuteWithinDay(splitDay, 'mon', 16 * 60), '16:00 FECHADO (vão entre almoço e jantar)');
assert(isMinuteWithinDay(splitDay, 'mon', 19 * 60), '19:00 aberto (jantar)');
assert(!isMinuteWithinDay(splitDay, 'sun', 12 * 60), 'domingo sem janela = fechado');

// ---------------------------------------------------------------------------
console.log('\nnormalizeWeeklyHours');
assert(normalizeWeeklyHours(null) === null, 'null → null (cai no legado)');
assert(normalizeWeeklyHours('x') === null, 'string → null');
const norm = normalizeWeeklyHours({ mon: [{ start: '11:00', end: '14:00' }], sun: [] });
assert(norm !== null && norm.mon.length === 1 && norm.sun.length === 0, 'objeto por dia normalizado; dia ausente = []');
const tolerant = normalizeWeeklyHours({ mon: { windows: [{ start: '18:00', end: '23:00' }] } });
assert(tolerant !== null && tolerant.mon.length === 1, 'tolera shape { windows: [...] }');
const filtered = normalizeWeeklyHours({ mon: [{ start: '25:99', end: '14:00' }, { start: '11:00', end: '14:00' }] });
assert(filtered !== null && filtered.mon.length === 1, 'janela inválida é descartada');

// ---------------------------------------------------------------------------
console.log('\nderiveWeeklyFromLegacy');
const fromLegacy = deriveWeeklyFromLegacy('09:00', '18:00', ['Dom']);
assert(fromLegacy.mon.length === 1 && fromLegacy.mon[0].start === '09:00', 'janela única aplicada seg');
assert(fromLegacy.sun.length === 0, 'Dom fechado (estava em dias_fechamento)');
assert(fromLegacy.sat.length === 1, 'Sáb aberto');
assert(deriveWeeklyFromLegacy(null, null, []).mon.length === 0, 'sem horário → tudo fechado');

// ---------------------------------------------------------------------------
console.log('\nderiveLegacyFromWeekly — shadow p/ ZeloMenu não quebrar');
// Janela única em todos os dias exceto domingo → shadow FIEL
const single = emptyWeekly();
for (const k of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const) single[k] = [{ start: '09:00', end: '18:00' }];
const legacySingle = deriveLegacyFromWeekly(single);
assert(legacySingle.openTime === '09:00' && legacySingle.closeTime === '18:00', 'single-window: open/close fiéis');
assert(legacySingle.closedDays.length === 1 && legacySingle.closedDays[0] === 'Dom', 'single-window: Dom em dias_fechamento (label PT)');

// Multi-janela → span (lossy)
const multi = emptyWeekly();
multi.mon = [{ start: '11:00', end: '14:00' }, { start: '18:00', end: '23:00' }];
const legacyMulti = deriveLegacyFromWeekly(multi);
assert(legacyMulti.openTime === '11:00' && legacyMulti.closeTime === '23:00', 'multi-window: span 11:00–23:00');

// Meia-noite (1440) clampa em 23:59
const midnight = emptyWeekly();
midnight.sat = [{ start: '18:00', end: '00:00' }];
assert(deriveLegacyFromWeekly(midnight).closeTime === '23:59', 'end 00:00 (meia-noite) → close 23:59 no shadow');

// Tudo fechado
const allClosed = deriveLegacyFromWeekly(emptyWeekly());
assert(allClosed.openTime === null && allClosed.closedDays.length === 7, 'tudo fechado → nulls + 7 labels');

// ---------------------------------------------------------------------------
console.log('\nround-trip legado → weekly → legado (fiel p/ janela única)');
const rtWeekly = deriveWeeklyFromLegacy('10:00', '22:00', ['Dom', 'Sáb']);
const rtLegacy = deriveLegacyFromWeekly(rtWeekly);
assert(rtLegacy.openTime === '10:00' && rtLegacy.closeTime === '22:00', 'round-trip: horários preservados');
assert(rtLegacy.closedDays.includes('Dom') && rtLegacy.closedDays.includes('Sáb') && rtLegacy.closedDays.length === 2, 'round-trip: dias fechados preservados');

// ---------------------------------------------------------------------------
console.log('\nweekdayKeyInTz / minutesInTz — fuso desloca o dia');
// 02:00 UTC → 23:00 do dia anterior em São Paulo (UTC-3)
const nearMidnight = new Date('2026-07-22T02:00:00Z');
assert(weekdayKeyInTz(nearMidnight, 'UTC') !== weekdayKeyInTz(nearMidnight, 'America/Sao_Paulo'), 'dia difere entre UTC e SP perto da meia-noite');
assert(minutesInTz(nearMidnight, 'America/Sao_Paulo') === 23 * 60, '02:00 UTC = 23:00 em SP');

// ---------------------------------------------------------------------------
console.log('\nisOpenAt — aberto/fechado/próxima abertura (independente do dia via janela uniforme)');
const everyday = emptyWeekly();
for (const k of ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const) {
  everyday[k] = [{ start: '11:00', end: '14:00' }, { start: '18:00', end: '23:00' }];
}
// 21:00 UTC = 18:00 SP → dentro do jantar
const atDinner = new Date('2026-07-22T21:00:00Z');
assert(isOpenAt(everyday, atDinner, 'America/Sao_Paulo').open === true, '18:00 SP → aberto (jantar)');
// 19:00 UTC = 16:00 SP → no vão
const atGap = new Date('2026-07-22T19:00:00Z');
const gapStatus = isOpenAt(everyday, atGap, 'America/Sao_Paulo');
assert(gapStatus.open === false, '16:00 SP → fechado (vão)');
assert(gapStatus.nextOpen?.start === '18:00', 'próxima abertura às 18:00 hoje');
// Loja toda fechada → nextOpen null
assert(isOpenAt(emptyWeekly(), atDinner, 'America/Sao_Paulo').nextOpen === null, 'loja sem horário → sem próxima abertura');

// ---------------------------------------------------------------------------
console.log('\nsummarizeWeekly');
const sum = summarizeWeekly(splitDay);
assert(sum.includes('Seg 11:00–14:00, 18:00–23:00'), 'resumo mostra múltiplas faixas');
assert(sum.includes('Dom fechado'), 'resumo mostra dia fechado');

// ---------------------------------------------------------------------------
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
