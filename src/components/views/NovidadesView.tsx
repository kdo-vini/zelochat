import React from 'react';
import { Zap, Wrench, Star, AlertCircle } from 'lucide-react';
import { CHANGELOG, type ChangeCategory, type ChangelogEntry } from '../../data/changelog';

const CATEGORY_CONFIG: Record<ChangeCategory, {
  label: string;
  icon: React.ElementType;
  bg: string;
  border: string;
  badge: string;
  badgeText: string;
}> = {
  big: {
    label: 'Grande novidade',
    icon: Star,
    bg: 'bg-[var(--color-brand-soft)]',
    border: 'border-[var(--color-brand)]',
    badge: 'bg-[var(--color-brand)] text-white',
    badgeText: '🚀 Grande novidade',
  },
  medium: {
    label: 'Melhoria',
    icon: Zap,
    bg: 'bg-[var(--color-surface)]',
    border: 'border-[var(--color-line)]',
    badge: 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]',
    badgeText: '✨ Melhoria',
  },
  minor: {
    label: 'Pequeno ajuste',
    icon: Wrench,
    bg: 'bg-[var(--color-surface)]',
    border: 'border-[var(--color-line)]',
    badge: 'bg-[var(--color-surface-muted)] text-[var(--color-ink-faint)]',
    badgeText: '🔧 Pequeno ajuste',
  },
  hotfix: {
    label: 'Correção urgente',
    icon: AlertCircle,
    bg: 'bg-[var(--color-alert-soft)]',
    border: 'border-[var(--color-alert)]',
    badge: 'bg-[var(--color-alert)] text-white',
    badgeText: '🔥 Correção urgente',
  },
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function ChangeCard({ entry }: { entry: ChangelogEntry }) {
  const cfg = CATEGORY_CONFIG[entry.category];
  const isBig = entry.category === 'big';

  return (
    <div className={`rounded-xl border ${cfg.bg} ${cfg.border} ${isBig ? 'p-5' : 'p-4'} transition-shadow hover:shadow-sm`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${cfg.badge}`}>
          {cfg.badgeText}
        </span>
        <span className="text-[11.5px] text-[var(--color-ink-faint)] whitespace-nowrap flex-shrink-0 mt-0.5">
          {formatDate(entry.date)}
        </span>
      </div>
      <h3 className={`font-semibold text-[var(--color-ink)] leading-snug ${isBig ? 'text-[16px] mb-1.5' : 'text-[14px] mb-1'}`}>
        {entry.title}
      </h3>
      <p className={`text-[var(--color-ink-muted)] leading-relaxed ${isBig ? 'text-[13.5px]' : 'text-[13px]'}`}>
        {entry.description}
      </p>
    </div>
  );
}

export function NovidadesView() {
  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--color-canvas)]">
      {/* Header */}
      <div className="px-6 py-5 border-b border-[var(--color-line)] flex-shrink-0 bg-[var(--color-surface)]">
        <h1 className="text-[18px] font-bold text-[var(--color-ink)]">Novidades</h1>
        <p className="text-[13px] text-[var(--color-ink-muted)] mt-0.5">
          O que mudou no ZeloChat — sempre em ordem do mais recente.
        </p>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-3">
          {CHANGELOG.map((entry, i) => (
            <ChangeCard key={i} entry={entry} />
          ))}
          <p className="text-center text-[12px] text-[var(--color-ink-faint)] pt-2 pb-4">
            Isso é tudo por enquanto — novas atualizações aparecem aqui. ✓
          </p>
        </div>
      </div>
    </div>
  );
}
