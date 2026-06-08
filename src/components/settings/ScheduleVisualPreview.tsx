import { AI_SCHEDULE_DAY_KEYS, parseAiScheduleMinutes, type AiScheduleDay, type AiScheduleDays, type AiScheduleDayKey } from '../../domain/aiSchedule';
import { WIZARD_DAY_LABELS } from '../../domain/aiScheduleWizard';

interface ScheduleVisualPreviewProps {
  scheduleDays: AiScheduleDays | null;
  /** When true, every day shows full active bar (used for "always_on" preview). */
  allActive?: boolean;
  /** Compact removes hour ticks and shrinks row height — used in inline summaries. */
  compact?: boolean;
}

/**
 * 24-hour horizontal bar per weekday, split into 48 half-hour segments.
 * Brand color = AI active, neutral muted = manual / off.
 *
 * Pure render — no interactivity. Used inside the wizard preview and the
 * "current schedule" summary so operators see exactly what they configured
 * without having to mentally re-evaluate the JSONB.
 */
export const ScheduleVisualPreview = ({ scheduleDays, allActive, compact }: ScheduleVisualPreviewProps) => {
  const cellHeight = compact ? 8 : 14;
  const labelClass = compact ? 'text-[10.5px]' : 'text-[11.5px]';

  return (
    <div className="space-y-1.5">
      {AI_SCHEDULE_DAY_KEYS.map((key) => {
        const day = scheduleDays?.[key];
        const segments = computeHalfHourSegments(day, allActive);
        return (
          <div key={key} className="flex items-center gap-2">
            <span className={`${labelClass} w-9 text-[var(--color-ink-muted)] font-medium`}>
              {WIZARD_DAY_LABELS[key]}
            </span>
            <div
              className="flex-1 flex rounded overflow-hidden border border-[var(--color-line)]"
              style={{ height: cellHeight }}
              aria-label={describeDayForA11y(key, day, allActive)}
            >
              {segments.map((active, i) => (
                <div
                  key={i}
                  className={`flex-1 ${active ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-surface-muted)]'}`}
                />
              ))}
            </div>
          </div>
        );
      })}
      {!compact && (
        <div className="flex justify-between text-[10.5px] text-[var(--color-ink-faint)] pl-11 pt-0.5">
          <span>00h</span>
          <span>06h</span>
          <span>12h</span>
          <span>18h</span>
          <span>24h</span>
        </div>
      )}
    </div>
  );
};

/**
 * Splits a day into 48 half-hour segments and decides for each whether the
 * AI is active. Implements the same semantics as `isWithinAiScheduleDay`
 * but exposes per-slot booleans for the visualization.
 */
function computeHalfHourSegments(day: AiScheduleDay | undefined, allActive?: boolean): boolean[] {
  if (allActive) return new Array(48).fill(true);
  if (!day || !day.enabled) return new Array(48).fill(false);
  const start = parseAiScheduleMinutes(day.start);
  const end = parseAiScheduleMinutes(day.end);
  if (start === null || end === null) return new Array(48).fill(false);
  if (start === end) return new Array(48).fill(true); // 24h
  if (start > end) return new Array(48).fill(false);  // invalid for per-day

  return Array.from({ length: 48 }, (_, i) => {
    // Treat each segment by its mid-point so the visual matches gut feeling
    // ("the slot at 09:00-09:30 belongs to the 09:15 instant").
    const minutes = i * 30 + 15;
    const inWindow = minutes >= start && minutes <= end;
    return day.inverted ? !inWindow : inWindow;
  });
}

function describeDayForA11y(
  key: AiScheduleDayKey,
  day: AiScheduleDay | undefined,
  allActive?: boolean,
): string {
  if (allActive) return `${WIZARD_DAY_LABELS[key]}: IA o dia todo`;
  if (!day || !day.enabled) return `${WIZARD_DAY_LABELS[key]}: IA desligada`;
  if (day.start === day.end) return `${WIZARD_DAY_LABELS[key]}: IA o dia todo`;
  if (day.inverted) return `${WIZARD_DAY_LABELS[key]}: Humano ${day.start}–${day.end}, IA cobre o resto`;
  return `${WIZARD_DAY_LABELS[key]}: IA das ${day.start} às ${day.end}`;
}
