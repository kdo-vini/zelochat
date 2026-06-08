import {
  AI_SCHEDULE_DAY_KEYS,
  type AiGlobalMode,
  type AiScheduleDay,
  type AiScheduleDayKey,
  type AiScheduleDays,
} from './aiSchedule';

/**
 * The wizard's "cenário" — chosen on step 1, determines polarity and the
 * shape of the answers in subsequent steps.
 *
 *  - human_covers_business: humans staff the shop during a window; the AI
 *    fills everything *outside* that window. On days NOT selected, the AI
 *    covers 24h (no human present at all). This is the Casa dos Salgados
 *    pattern.
 *  - ai_covers_business: the AI is on inside a specific window on selected
 *    days; outside the window — and on non-selected days — there's no AI
 *    (manual only). This is the "small shop, owner away" pattern.
 *  - ai_always: always_on global mode, no schedule needed.
 */
export type ScheduleWizardScenario = 'human_covers_business' | 'ai_covers_business' | 'ai_always';

export type ScheduleWizardStep = 'cenario' | 'dias' | 'horario' | 'preview';

export interface ScheduleWizardState {
  step: ScheduleWizardStep;
  scenario: ScheduleWizardScenario | null;
  /** Which weekdays are "covered" — meaning depends on `scenario`. */
  selectedDays: AiScheduleDayKey[];
  /** 'HH:MM'. */
  startTime: string;
  /** 'HH:MM'. */
  endTime: string;
}

export const DEFAULT_WIZARD_STATE: ScheduleWizardState = {
  step: 'cenario',
  scenario: null,
  selectedDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  startTime: '08:00',
  endTime: '18:00',
};

export const WIZARD_DAY_LABELS: Record<AiScheduleDayKey, string> = {
  sun: 'Dom',
  mon: 'Seg',
  tue: 'Ter',
  wed: 'Qua',
  thu: 'Qui',
  fri: 'Sex',
  sat: 'Sáb',
};

export interface ScheduleWizardResult {
  mode: AiGlobalMode;
  scheduleDays: AiScheduleDays | null;
}

/**
 * Builds the final `{ mode, scheduleDays }` from the wizard answers. Pure
 * function — UI calls it on every state change to render the preview, and
 * once more when the operator confirms. The result is what gets POSTed to
 * /api/ai-settings.
 */
export function buildScheduleFromWizard(state: ScheduleWizardState): ScheduleWizardResult {
  if (state.scenario === 'ai_always') {
    return { mode: 'always_on', scheduleDays: null };
  }

  const selected = new Set(state.selectedDays);

  if (state.scenario === 'human_covers_business') {
    const days = {} as AiScheduleDays;
    for (const key of AI_SCHEDULE_DAY_KEYS) {
      if (selected.has(key)) {
        // Human window on this day; AI fills the rest via inverted=true.
        days[key] = {
          enabled: true,
          start: state.startTime,
          end: state.endTime,
          inverted: true,
        };
      } else {
        // No human → AI on 24h.
        days[key] = { enabled: true, start: '00:00', end: '00:00', inverted: false };
      }
    }
    return { mode: 'scheduled', scheduleDays: days };
  }

  if (state.scenario === 'ai_covers_business') {
    const days = {} as AiScheduleDays;
    for (const key of AI_SCHEDULE_DAY_KEYS) {
      if (selected.has(key)) {
        days[key] = {
          enabled: true,
          start: state.startTime,
          end: state.endTime,
          inverted: false,
        };
      } else {
        // AI off on non-selected days.
        days[key] = { enabled: false, start: '08:00', end: '18:00', inverted: false };
      }
    }
    return { mode: 'scheduled', scheduleDays: days };
  }

  // Defensive: caller forgot to pick a scenario.
  return { mode: 'always_on', scheduleDays: null };
}

/**
 * Tries to reverse-engineer a wizard state from a saved AiScheduleDays so
 * that "Reconfigurar" can pre-fill the wizard with the operator's current
 * answers instead of starting blank. Heuristic — returns null when the
 * saved schedule can't be cleanly mapped (e.g. operator hand-edited the
 * advanced editor to a pattern the wizard doesn't express).
 */
export function reverseEngineerWizardState(
  mode: AiGlobalMode,
  scheduleDays: AiScheduleDays | null,
): ScheduleWizardState | null {
  if (mode === 'always_on') {
    return { ...DEFAULT_WIZARD_STATE, scenario: 'ai_always', step: 'preview' };
  }
  if (!scheduleDays) return null;

  // Categorize each weekday by the wizard primitive it represents.
  //  - humanDay  : enabled, inverted, start ≠ end → user is at the shop in [start, end]
  //  - cover24   : enabled, start === end → AI is on 24h (no human present)
  //  - aiWindow  : enabled, not inverted, start ≠ end → AI replies inside [start, end]
  //  - offDay    : !enabled
  const humanDays = AI_SCHEDULE_DAY_KEYS.filter((k) => {
    const d = scheduleDays[k];
    return d.enabled && d.inverted && d.start !== d.end;
  });
  const cover24Days = AI_SCHEDULE_DAY_KEYS.filter((k) => {
    const d = scheduleDays[k];
    return d.enabled && d.start === d.end;
  });
  const aiWindowDays = AI_SCHEDULE_DAY_KEYS.filter((k) => {
    const d = scheduleDays[k];
    return d.enabled && !d.inverted && d.start !== d.end;
  });
  const offDays = AI_SCHEDULE_DAY_KEYS.filter((k) => !scheduleDays[k].enabled);

  // Pattern A — human_covers_business: every day is either a human shift
  // (uniform window) or AI-on-24h. No partial AI windows, no off days.
  if (
    humanDays.length > 0
    && humanDays.length + cover24Days.length === AI_SCHEDULE_DAY_KEYS.length
  ) {
    const sample = scheduleDays[humanDays[0]];
    const uniform = humanDays.every((k) => {
      const d = scheduleDays[k];
      return d.start === sample.start && d.end === sample.end;
    });
    if (uniform) {
      return {
        step: 'preview',
        scenario: 'human_covers_business',
        selectedDays: humanDays,
        startTime: sample.start,
        endTime: sample.end,
      };
    }
  }

  // Pattern B — ai_covers_business: every day is either an AI window
  // (uniform) or off. No human shifts, no 24h days.
  if (
    aiWindowDays.length > 0
    && aiWindowDays.length + offDays.length === AI_SCHEDULE_DAY_KEYS.length
  ) {
    const sample: AiScheduleDay = scheduleDays[aiWindowDays[0]];
    const uniform = aiWindowDays.every((k) => {
      const d = scheduleDays[k];
      return d.start === sample.start && d.end === sample.end;
    });
    if (uniform) {
      return {
        step: 'preview',
        scenario: 'ai_covers_business',
        selectedDays: aiWindowDays,
        startTime: sample.start,
        endTime: sample.end,
      };
    }
  }

  return null;
}

export interface ScheduleWizardSummary {
  /** Short human-readable summary in PT-BR. */
  headline: string;
  /** A line per relevant day, in display order (Dom first). */
  lines: { day: AiScheduleDayKey; label: string }[];
}

export function summarizeScheduleResult(result: ScheduleWizardResult): ScheduleWizardSummary {
  if (result.mode === 'always_on' || !result.scheduleDays) {
    return {
      headline: 'IA respondendo 24 horas, todos os dias.',
      lines: AI_SCHEDULE_DAY_KEYS.map((day) => ({ day, label: 'IA ligada o dia todo' })),
    };
  }
  if (result.mode === 'always_off') {
    return {
      headline: 'IA desligada — atendimento manual.',
      lines: AI_SCHEDULE_DAY_KEYS.map((day) => ({ day, label: 'IA desligada' })),
    };
  }
  const days = result.scheduleDays;
  const lines = AI_SCHEDULE_DAY_KEYS.map((day) => {
    const d = days[day];
    if (!d.enabled) return { day, label: 'IA desligada' };
    if (d.start === d.end) return { day, label: 'IA o dia todo (24h)' };
    if (d.inverted) return { day, label: `Humano ${d.start}–${d.end}, IA cobre o resto` };
    return { day, label: `IA das ${d.start} às ${d.end}` };
  });
  return { headline: 'Agenda personalizada da IA.', lines };
}
