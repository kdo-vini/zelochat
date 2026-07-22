import { Plus, X, CalendarDays, CopyPlus } from 'lucide-react';
import {
  DAY_KEYS,
  type DayKey,
  type HoursWindow,
  type WeeklyHours,
} from '../../domain/businessHours';

/**
 * Editor de horário por dia com múltiplas faixas.
 *
 * 7 linhas (Seg→Dom no display, chaves mon..sun). Cada dia: toggle Aberto/Fechado
 * + lista de faixas (início–fim) com adicionar/remover. `[]` = fechado.
 * Atalhos por dia: "Aplicar a todos os dias" e "Aplicar a seg–sex".
 *
 * Componente puramente apresentacional — não valida nem salva. A validação e o
 * botão "Salvar horários" ficam no SettingsView (mesma UX de antes).
 */

/** Ordem de exibição: Seg primeiro, Dom por último. */
const DISPLAY_ORDER: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const FULL_LABELS: Record<DayKey, string> = {
  mon: 'Segunda',
  tue: 'Terça',
  wed: 'Quarta',
  thu: 'Quinta',
  fri: 'Sexta',
  sat: 'Sábado',
  sun: 'Domingo',
};

const WEEKDAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

const DEFAULT_WINDOW: HoursWindow = { start: '09:00', end: '18:00' };

const cloneWindows = (windows: HoursWindow[]): HoursWindow[] =>
  windows.map((w) => ({ start: w.start, end: w.end }));

/** Reconstrói o mapa sempre na ordem canônica de DAY_KEYS (JSON estável). */
function withDay(value: WeeklyHours, day: DayKey, windows: HoursWindow[]): WeeklyHours {
  const next = {} as WeeklyHours;
  for (const key of DAY_KEYS) {
    next[key] = key === day ? windows : value[key];
  }
  return next;
}

interface BusinessHoursEditorProps {
  value: WeeklyHours;
  onChange: (next: WeeklyHours) => void;
  disabled?: boolean;
}

/** Input de horário compacto reaproveitando o mesmo visual do TimeInput. */
function InlineTime({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <input
      type="time"
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="bg-[var(--color-surface-muted)] border border-[var(--color-line)] rounded-lg px-2.5 py-2 text-[13.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/25 focus:border-[var(--color-brand)] transition-colors disabled:opacity-50"
    />
  );
}

export const BusinessHoursEditor = ({ value, onChange, disabled }: BusinessHoursEditorProps) => {
  const setDay = (day: DayKey, windows: HoursWindow[]) => {
    onChange(withDay(value, day, windows));
  };

  const setOpen = (day: DayKey, open: boolean) => {
    if (open) {
      // Reabrir: se não há faixa, semeia uma padrão.
      setDay(day, value[day].length > 0 ? value[day] : [{ ...DEFAULT_WINDOW }]);
    } else {
      setDay(day, []);
    }
  };

  const addWindow = (day: DayKey) => {
    setDay(day, [...value[day], { ...DEFAULT_WINDOW }]);
  };

  const removeWindow = (day: DayKey, index: number) => {
    setDay(day, value[day].filter((_, i) => i !== index));
  };

  const updateWindow = (day: DayKey, index: number, patch: Partial<HoursWindow>) => {
    setDay(
      day,
      value[day].map((w, i) => (i === index ? { ...w, ...patch } : w)),
    );
  };

  const applyToAll = (day: DayKey) => {
    const src = value[day];
    const next = {} as WeeklyHours;
    for (const key of DAY_KEYS) {
      next[key] = cloneWindows(src);
    }
    onChange(next);
  };

  const applyToWeekdays = (day: DayKey) => {
    const src = value[day];
    const next = {} as WeeklyHours;
    for (const key of DAY_KEYS) {
      next[key] = WEEKDAY_KEYS.includes(key) ? cloneWindows(src) : value[key];
    }
    onChange(next);
  };

  return (
    <div className="space-y-2.5">
      {DISPLAY_ORDER.map((day) => {
        const windows = value[day];
        const isOpen = windows.length > 0;
        return (
          <div
            key={day}
            className="border border-[var(--color-line)] rounded-xl p-3.5 bg-[var(--color-surface-muted)]/40"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13.5px] font-semibold">{FULL_LABELS[day]}</span>
              <div className="inline-flex rounded-lg overflow-hidden border border-[var(--color-line)]">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setOpen(day, true)}
                  className={`px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                    isOpen
                      ? 'bg-[var(--color-brand)] text-white'
                      : 'bg-[var(--color-surface)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]'
                  }`}
                >
                  Aberto
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setOpen(day, false)}
                  className={`px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                    !isOpen
                      ? 'bg-[var(--color-alert)] text-white'
                      : 'bg-[var(--color-surface)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]'
                  }`}
                >
                  Fechado
                </button>
              </div>
            </div>

            {!isOpen ? (
              <p className="text-[12px] text-[var(--color-ink-faint)] mt-2">
                Fechado o dia inteiro. A IA vai avisar o cliente que a loja não está atendendo.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {windows.map((w, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <InlineTime
                      ariaLabel={`Início da faixa ${i + 1} de ${FULL_LABELS[day]}`}
                      value={w.start}
                      disabled={disabled}
                      onChange={(v) => updateWindow(day, i, { start: v })}
                    />
                    <span className="text-[12.5px] text-[var(--color-ink-muted)]">até</span>
                    <InlineTime
                      ariaLabel={`Fim da faixa ${i + 1} de ${FULL_LABELS[day]}`}
                      value={w.end}
                      disabled={disabled}
                      onChange={(v) => updateWindow(day, i, { end: v })}
                    />
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => removeWindow(day, i)}
                      aria-label={`Remover faixa ${i + 1} de ${FULL_LABELS[day]}`}
                      className="p-1.5 rounded-lg text-[var(--color-ink-muted)] hover:text-[var(--color-alert)] hover:bg-[var(--color-line)] transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                <div className="flex items-center gap-3 flex-wrap pt-0.5">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => addWindow(day)}
                    className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--color-brand)] hover:text-[var(--color-brand-deep)] transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    adicionar faixa
                  </button>
                  <span className="text-[var(--color-line)]">·</span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => applyToAll(day)}
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors"
                  >
                    <CopyPlus className="w-3.5 h-3.5" />
                    Aplicar a todos os dias
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => applyToWeekdays(day)}
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors"
                  >
                    <CalendarDays className="w-3.5 h-3.5" />
                    Aplicar a seg–sex
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
