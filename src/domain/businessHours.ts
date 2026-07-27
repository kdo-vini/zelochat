/**
 * Horário de funcionamento — modelo por dia, com múltiplas janelas.
 *
 * Substitui a janela única (`horario_abertura`/`horario_fechamento`) por um mapa
 * por dia da semana, onde cada dia tem 0..N faixas de atendimento. Cobre lojas
 * que abrem no almoço, fecham e reabrem à noite, e horários diferentes por dia.
 *
 * Regras do modelo NOVO (`horario_semanal`):
 * - `[]` no dia = fechado o dia inteiro.
 * - Janela `{start,end}` em "HH:MM". `end` = "00:00" (ou "24:00") significa
 *   meia-noite / fim do dia (1440 min).
 * - `start < end` (sem wrap entre dias); para virar a madrugada, use duas janelas
 *   (ex.: sáb 18:00–00:00 + dom 00:00–02:00).
 *
 * A verificação de "dentro da janela" é wrap-aware (aceita `end <= start`) porque
 * o legado single-window suportava madrugada (abre 18:00, fecha 02:00). Isso
 * mantém `deriveWeeklyFromLegacy` fiel ao comportamento antigo.
 *
 * Módulo puro: zero dependências de React, servidor ou IA (regra de arquitetura
 * `src/domain/`). Espelhado no repo do ZeloMenu para o bloqueio de pedidos.
 */

export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export interface HoursWindow {
  /** "HH:MM" */
  start: string;
  /** "HH:MM"; "00:00" (ou "24:00") = meia-noite / fim do dia */
  end: string;
}

/** Dia da semana → lista de janelas. Lista vazia = fechado. */
export type WeeklyHours = Record<DayKey, HoursWindow[]>;

/** Ordem = índice de `Date.getDay()`. */
export const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Rótulos PT usados na coluna legada `dias_fechamento` — o ZeloMenu compara
 * contra EXATAMENTE estes valores (`PUBLIC_DAY_LABELS`). Não alterar.
 */
export const CLOSED_DAY_LABELS: Record<DayKey, string> = {
  sun: 'Dom',
  mon: 'Seg',
  tue: 'Ter',
  wed: 'Qua',
  thu: 'Qui',
  fri: 'Sex',
  sat: 'Sáb',
};

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" → minutos (0..1439). Retorna null se inválido. */
export function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '24:00') return 1440;
  const m = TIME_RE.exec(trimmed);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** minutos → "HH:MM" (1440 → "00:00"). */
export function minutesToTime(minutes: number): string {
  const norm = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const mm = norm % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Minutos de início de uma janela (null se inválido). */
export function windowStartMinutes(w: HoursWindow): number | null {
  return parseTimeToMinutes(w.start);
}

/**
 * Minutos de fim de uma janela. "00:00"/"24:00" viram 1440 (fim do dia) EXCETO
 * quando o início também é 00:00 (caso 24h / wrap). null se inválido.
 */
export function windowEndMinutes(w: HoursWindow): number | null {
  const raw = typeof w.end === 'string' ? w.end.trim() : null;
  const start = typeof w.start === 'string' ? w.start.trim() : null;
  if (raw === '24:00' || (raw === '00:00' && start !== '00:00')) return 1440;
  return parseTimeToMinutes(w.end);
}

function isValidWindow(w: unknown): w is HoursWindow {
  if (!w || typeof w !== 'object') return false;
  const start = (w as HoursWindow).start;
  const end = (w as HoursWindow).end;
  return typeof start === 'string'
    && typeof end === 'string'
    && parseTimeToMinutes(start) !== null
    && windowEndMinutes({ start, end }) !== null;
}

/**
 * Valida a regra do modelo semanal. A única faixa com início igual ao fim
 * permitida é 00:00–00:00, que representa uma loja aberta 24 horas.
 */
export function isValidWeeklyWindow(window: HoursWindow): boolean {
  const start = windowStartMinutes(window);
  const end = windowEndMinutes(window);
  if (start === null || end === null) return false;
  return end > start || (start === 0 && end === 0);
}

function emptyWeekly(): WeeklyHours {
  return { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] };
}

/**
 * Normaliza um valor cru (do banco/JSON) para `WeeklyHours`. Retorna null quando
 * não é um objeto reconhecível (o caller deve então cair no legado).
 */
export function normalizeWeeklyHours(raw: unknown): WeeklyHours | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const out = emptyWeekly();
  let sawAnyKey = false;
  for (const key of DAY_KEYS) {
    const dayVal = source[key];
    if (dayVal === undefined) continue;
    sawAnyKey = true;
    // Aceita tanto [] direto quanto { windows: [] } (tolerância de shape).
    const windows = Array.isArray(dayVal)
      ? dayVal
      : dayVal !== null
        && typeof dayVal === 'object'
        && Array.isArray((dayVal as { windows?: unknown }).windows)
        ? (dayVal as { windows: unknown[] }).windows
        : [];
    out[key] = windows
      .filter(isValidWindow)
      .map((w) => ({ start: w.start.trim(), end: w.end.trim() }));
  }
  return sawAnyKey ? out : null;
}

/**
 * Normaliza um payload de gravação sem descartar silenciosamente dias ou
 * janelas inválidas. Diferentemente da leitura tolerante acima, exige os sete
 * dias e uma lista de janelas em cada dia.
 */
export function normalizeWeeklyHoursForWrite(raw: unknown): WeeklyHours | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const out = emptyWeekly();

  for (const key of DAY_KEYS) {
    const dayVal = source[key];
    if (!Array.isArray(dayVal)) return null;
    const windows: HoursWindow[] = [];
    for (const rawWindow of dayVal) {
      if (!isValidWindow(rawWindow)) return null;
      const window = { start: rawWindow.start.trim(), end: rawWindow.end.trim() };
      if (!isValidWeeklyWindow(window)) return null;
      windows.push(window);
    }
    out[key] = windows;
  }

  return out;
}

/** True se a loja abre em pelo menos um dia. */
export function hasAnyOpenWindow(weekly: WeeklyHours): boolean {
  return DAY_KEYS.some((k) => weekly[k].length > 0);
}

/** Um minuto cai dentro de uma janela? Wrap-aware (end <= start = vira a madrugada). */
export function isMinuteWithinWindow(minutes: number, w: HoursWindow): boolean {
  const start = windowStartMinutes(w);
  const end = windowEndMinutes(w);
  if (start === null || end === null) return false;
  if (end > start) return minutes >= start && minutes <= end;
  // end <= start → janela cruza a meia-noite (legado overnight) ou 24h.
  return minutes >= start || minutes <= end;
}

/** Algum janela do dia contém o minuto? (validação de agendamento) */
export function isMinuteWithinDay(weekly: WeeklyHours, day: DayKey, minutes: number): boolean {
  return weekly[day].some((w) => isMinuteWithinWindow(minutes, w));
}

/** Dia da semana no fuso da empresa (padrão igual ao aiSchedule via Intl). */
export function weekdayKeyInTz(date: Date, timezone: string): DayKey {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date);
  const map: Record<string, DayKey> = {
    Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat',
  };
  return map[short] ?? 'sun';
}

/** Minutos do relógio (0..1439) no fuso da empresa. */
export function minutesInTz(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hourRaw = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const hour = hourRaw === 24 ? 0 : hourRaw;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

export interface OpenStatus {
  open: boolean;
  currentWindow: HoursWindow | null;
  /** Próxima abertura a partir de agora (varre até 7 dias à frente). */
  nextOpen: { day: DayKey; start: string } | null;
}

/** A loja está aberta em `date` (no fuso `timezone`)? + próxima abertura. */
export function isOpenAt(weekly: WeeklyHours, date: Date, timezone: string): OpenStatus {
  const todayKey = weekdayKeyInTz(date, timezone);
  const nowMinutes = minutesInTz(date, timezone);

  let currentWindow: HoursWindow | null = null;
  for (const w of weekly[todayKey]) {
    if (isMinuteWithinWindow(nowMinutes, w)) {
      currentWindow = w;
      break;
    }
  }

  const todayIdx = DAY_KEYS.indexOf(todayKey);
  let nextOpen: { day: DayKey; start: string } | null = null;
  for (let offset = 0; offset <= 7 && !nextOpen; offset++) {
    const key = DAY_KEYS[(todayIdx + offset) % 7];
    const starts = weekly[key]
      .map((w) => ({ w, m: windowStartMinutes(w) }))
      .filter((x): x is { w: HoursWindow; m: number } => x.m !== null)
      .sort((a, b) => a.m - b.m);
    for (const { w, m } of starts) {
      if (offset === 0 && m <= nowMinutes) continue; // já passou hoje
      nextOpen = { day: key, start: w.start };
      break;
    }
  }

  return { open: currentWindow !== null, currentWindow, nextOpen };
}

/**
 * Deriva `WeeklyHours` das colunas legadas (janela única + dias fechados).
 * Usado quando `horario_semanal` é NULL — contas antigas continuam idênticas.
 */
export function deriveWeeklyFromLegacy(
  openTime: string | null | undefined,
  closeTime: string | null | undefined,
  closedDays: string[] | null | undefined,
): WeeklyHours {
  const out = emptyWeekly();
  const hasWindow = parseTimeToMinutes(openTime) !== null && windowEndMinutes({ start: openTime!, end: closeTime! } as HoursWindow) !== null;
  const closedSet = new Set((closedDays ?? []).map((d) => d.trim()));
  for (const key of DAY_KEYS) {
    const isClosed = closedSet.has(CLOSED_DAY_LABELS[key]);
    if (hasWindow && !isClosed) {
      out[key] = [{ start: openTime!.trim(), end: closeTime!.trim() }];
    }
  }
  return out;
}

/**
 * Deriva as colunas legadas (shadow lossy) a partir de `WeeklyHours`. Escrito no
 * save para o ZeloMenu (que lê o legado) NÃO quebrar antes de ser atualizado.
 * Janela única: shadow FIEL. Multi-janela: abrange o vão (lossy).
 */
export function deriveLegacyFromWeekly(weekly: WeeklyHours): {
  openTime: string | null;
  closeTime: string | null;
  closedDays: string[];
} {
  const closedDays: string[] = [];
  let minStart: number | null = null;
  let maxEnd: number | null = null;

  for (const key of DAY_KEYS) {
    const windows = weekly[key];
    if (windows.length === 0) {
      closedDays.push(CLOSED_DAY_LABELS[key]);
      continue;
    }
    for (const w of windows) {
      const s = windowStartMinutes(w);
      const e = windowEndMinutes(w);
      if (s !== null) minStart = minStart === null ? s : Math.min(minStart, s);
      if (e !== null) maxEnd = maxEnd === null ? e : Math.max(maxEnd, e);
    }
  }

  // 1440 (meia-noite) não é representável como HH:MM legado sem virar 00:00 (=0),
  // o que quebraria o check [open,close] do ZeloMenu. Clampa em 23:59.
  const closeMinutes = maxEnd === 1440 ? 1439 : maxEnd;

  return {
    openTime: minStart === null ? null : minutesToTime(minStart),
    closeTime: closeMinutes === null ? null : minutesToTime(closeMinutes),
    closedDays,
  };
}

const DAY_DISPLAY: Record<DayKey, string> = {
  sun: 'Dom', mon: 'Seg', tue: 'Ter', wed: 'Qua', thu: 'Qui', fri: 'Sex', sat: 'Sáb',
};

/** Resumo curto para exibição/prompt. Ex.: "Seg–Sex 11:00–14:00, 18:00–23:00; Sáb 18:00–00:00; Dom fechado". */
export function summarizeWeekly(weekly: WeeklyHours): string {
  const parts = DAY_KEYS.map((key) => {
    const windows = weekly[key];
    if (windows.length === 0) return `${DAY_DISPLAY[key]} fechado`;
    const ranges = windows.map((w) => `${w.start}–${w.end}`).join(', ');
    return `${DAY_DISPLAY[key]} ${ranges}`;
  });
  return parts.join('; ');
}
