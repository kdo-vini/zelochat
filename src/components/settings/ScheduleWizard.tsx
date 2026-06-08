import { useMemo, useState } from 'react';
import { ChevronRight, Check, Loader2, ArrowLeft, Users, Bot, Clock } from 'lucide-react';
import { AI_SCHEDULE_DAY_KEYS, type AiScheduleDayKey, type AiScheduleDays } from '../../domain/aiSchedule';
import {
  buildScheduleFromWizard,
  DEFAULT_WIZARD_STATE,
  summarizeScheduleResult,
  WIZARD_DAY_LABELS,
  type ScheduleWizardScenario,
  type ScheduleWizardState,
} from '../../domain/aiScheduleWizard';
import { ScheduleVisualPreview } from './ScheduleVisualPreview';

const FIELD = 'w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-[var(--color-brand)]/25 focus:border-[var(--color-brand)] transition-colors';
const LABEL = 'block text-[11.5px] font-medium text-[var(--color-ink-muted)] mb-1';

interface ScheduleWizardProps {
  /** Initial state — pass reverse-engineered state to pre-fill when "Reconfigurar". */
  initial?: ScheduleWizardState | null;
  saving: boolean;
  onConfirm: (payload: { mode: 'always_on' | 'scheduled'; scheduleDays: AiScheduleDays | null }) => Promise<void> | void;
  onCancel?: () => void;
}

const SCENARIOS: { value: ScheduleWizardScenario; title: string; description: string; icon: typeof Users }[] = [
  {
    value: 'human_covers_business',
    title: 'IA cobre quando ninguém atende',
    description: 'Você (ou sua equipe) atende em horário definido. A IA cobre tudo fora disso — noites, madrugadas e dias sem expediente humano.',
    icon: Users,
  },
  {
    value: 'ai_covers_business',
    title: 'IA atende em horário específico',
    description: 'A IA fica ligada apenas em dias e horas que você escolher. Fora disso, o WhatsApp fica em modo manual.',
    icon: Clock,
  },
  {
    value: 'ai_always',
    title: 'IA atende sempre',
    description: '24 horas, 7 dias por semana. Sem agenda.',
    icon: Bot,
  },
];

const QUICK_DAY_PRESETS: { label: string; days: AiScheduleDayKey[] }[] = [
  { label: 'Seg a Sex', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
  { label: 'Seg a Sáb', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] },
  { label: 'Todos os dias', days: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] },
  { label: 'Só fim de semana', days: ['sat', 'sun'] },
];

const QUICK_HOUR_PRESETS = [
  { label: 'Comercial 8h–18h', start: '08:00', end: '18:00' },
  { label: 'Manhã/tarde 6h–18h', start: '06:00', end: '18:00' },
  { label: 'Tarde/noite 14h–22h', start: '14:00', end: '22:00' },
];

export const ScheduleWizard = ({ initial, saving, onConfirm, onCancel }: ScheduleWizardProps) => {
  const [state, setState] = useState<ScheduleWizardState>(() => initial ?? DEFAULT_WIZARD_STATE);
  const [error, setError] = useState<string | null>(null);

  const result = useMemo(() => buildScheduleFromWizard(state), [state]);
  const summary = useMemo(() => summarizeScheduleResult(result), [result]);

  const setScenario = (scenario: ScheduleWizardScenario) => {
    setError(null);
    setState((prev) => ({
      ...prev,
      scenario,
      // ai_always skips directly to preview — no days/hours needed.
      step: scenario === 'ai_always' ? 'preview' : 'dias',
    }));
  };

  const goBack = () => {
    setError(null);
    setState((prev) => {
      if (prev.step === 'dias') return { ...prev, step: 'cenario' };
      if (prev.step === 'horario') return { ...prev, step: 'dias' };
      if (prev.step === 'preview') {
        if (prev.scenario === 'ai_always') return { ...prev, step: 'cenario' };
        return { ...prev, step: 'horario' };
      }
      return prev;
    });
  };

  const goNext = () => {
    setError(null);
    setState((prev) => {
      if (prev.step === 'cenario') return prev; // cenario advances via setScenario
      if (prev.step === 'dias') {
        if (prev.selectedDays.length === 0) {
          setError('Selecione pelo menos um dia.');
          return prev;
        }
        return { ...prev, step: 'horario' };
      }
      if (prev.step === 'horario') {
        if (prev.startTime >= prev.endTime) {
          setError('O horário inicial precisa ser antes do final.');
          return prev;
        }
        return { ...prev, step: 'preview' };
      }
      return prev;
    });
  };

  const handleConfirm = async () => {
    setError(null);
    try {
      await onConfirm({
        mode: result.mode === 'scheduled' ? 'scheduled' : 'always_on',
        scheduleDays: result.scheduleDays,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar. Tente novamente.');
    }
  };

  const toggleDay = (key: AiScheduleDayKey) => {
    setState((prev) => {
      const set = new Set(prev.selectedDays);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return { ...prev, selectedDays: AI_SCHEDULE_DAY_KEYS.filter((k) => set.has(k)) };
    });
  };

  const applyDayPreset = (days: AiScheduleDayKey[]) => {
    setState((prev) => ({ ...prev, selectedDays: [...days] }));
  };

  const applyHourPreset = (start: string, end: string) => {
    setState((prev) => ({ ...prev, startTime: start, endTime: end }));
  };

  const step = state.step;
  const stepIndex = step === 'cenario' ? 1 : step === 'dias' ? 2 : step === 'horario' ? 3 : 4;
  const totalSteps = state.scenario === 'ai_always' ? 2 : 4;
  const dayQuestionLabel = state.scenario === 'human_covers_business'
    ? 'Em quais dias VOCÊ (ou sua equipe) atende?'
    : 'Em quais dias a IA deve atender?';
  const hourQuestionLabel = state.scenario === 'human_covers_business'
    ? 'Em qual horário você atende?'
    : 'Em qual horário a IA deve atender?';

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] p-3 space-y-3">
      {/* Progress strip */}
      <div className="flex items-center justify-between text-[11px] text-[var(--color-ink-muted)]">
        <span>
          Passo {state.scenario === 'ai_always' && step === 'preview' ? 2 : stepIndex} de {totalSteps}
        </span>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
          >
            Cancelar
          </button>
        )}
      </div>

      {step === 'cenario' && (
        <div className="space-y-2">
          <p className="text-[14px] font-semibold">Como você quer que a IA funcione?</p>
          <div className="space-y-2">
            {SCENARIOS.map((option) => {
              const Icon = option.icon;
              const active = state.scenario === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setScenario(option.value)}
                  disabled={saving}
                  className={`w-full text-left rounded-xl border px-3 py-3 transition-colors flex gap-3 ${
                    active
                      ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]/50'
                      : 'border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-brand)]/40'
                  } disabled:opacity-50`}
                >
                  <span className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                    active ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]'
                  }`}>
                    <Icon className="w-4 h-4" strokeWidth={2} />
                  </span>
                  <span className="min-w-0">
                    <p className="text-[13.5px] font-semibold">{option.title}</p>
                    <p className="text-[12px] text-[var(--color-ink-muted)] mt-0.5">{option.description}</p>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === 'dias' && (
        <div className="space-y-3">
          <p className="text-[14px] font-semibold">{dayQuestionLabel}</p>
          <div className="flex flex-wrap gap-1.5">
            {AI_SCHEDULE_DAY_KEYS.map((key) => {
              const active = state.selectedDays.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleDay(key)}
                  disabled={saving}
                  className={`px-3 py-1.5 rounded-full text-[12.5px] font-medium border transition-colors ${
                    active
                      ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white'
                      : 'border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-brand)]/40'
                  } disabled:opacity-50`}
                >
                  {WIZARD_DAY_LABELS[key]}
                </button>
              );
            })}
          </div>
          <div className="space-y-1">
            <p className="text-[11px] text-[var(--color-ink-faint)] uppercase tracking-wide">Atalhos</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_DAY_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyDayPreset(preset.days)}
                  disabled={saving}
                  className="px-3 py-1 rounded-full text-[11.5px] border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-brand)] hover:border-[var(--color-brand)]/40 disabled:opacity-50"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 'horario' && (
        <div className="space-y-3">
          <p className="text-[14px] font-semibold">{hourQuestionLabel}</p>
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className={LABEL}>Das</span>
              <input
                type="time"
                value={state.startTime}
                onChange={(e) => setState((prev) => ({ ...prev, startTime: e.target.value }))}
                disabled={saving}
                className={FIELD}
              />
            </label>
            <label>
              <span className={LABEL}>até</span>
              <input
                type="time"
                value={state.endTime}
                onChange={(e) => setState((prev) => ({ ...prev, endTime: e.target.value }))}
                disabled={saving}
                className={FIELD}
              />
            </label>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] text-[var(--color-ink-faint)] uppercase tracking-wide">Atalhos</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_HOUR_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyHourPreset(preset.start, preset.end)}
                  disabled={saving}
                  className="px-3 py-1 rounded-full text-[11.5px] border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-brand)] hover:border-[var(--color-brand)]/40 disabled:opacity-50"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          {state.scenario === 'human_covers_business' && (
            <p className="text-[11.5px] text-[var(--color-ink-muted)] bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg px-2.5 py-1.5">
              Dias <em>sem expediente humano</em> ficam com a IA ligada 24h automaticamente.
            </p>
          )}
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-3">
          <p className="text-[14px] font-semibold">Conferir antes de salvar</p>
          <p className="text-[12.5px] text-[var(--color-ink-muted)]">{summary.headline}</p>
          <ScheduleVisualPreview
            scheduleDays={result.scheduleDays}
            allActive={result.mode === 'always_on'}
          />
          <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 space-y-0.5">
            {summary.lines.map((line) => (
              <div key={line.day} className="flex items-center justify-between text-[12px]">
                <span className="text-[var(--color-ink-muted)] w-12">{WIZARD_DAY_LABELS[line.day]}</span>
                <span className="text-[var(--color-ink)] text-right flex-1">{line.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-[12px] text-[var(--color-alert)]">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        {step !== 'cenario' && (
          <button
            type="button"
            onClick={goBack}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] text-[12.5px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-50"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar
          </button>
        )}
        {step === 'preview' ? (
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] disabled:opacity-50 text-white py-2.5 rounded-lg text-[13.5px] font-semibold transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? 'Salvando...' : 'Confirmar agenda'}
          </button>
        ) : step !== 'cenario' && (
          <button
            type="button"
            onClick={goNext}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-1 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] disabled:opacity-50 text-white py-2.5 rounded-lg text-[13.5px] font-semibold transition-colors"
          >
            Continuar <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
