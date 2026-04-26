import { useEffect, useState } from 'react';

interface Props {
  /** ISO timestamp when the conversation entered escalated state. */
  escalatedAt: string | null | undefined;
  className?: string;
}

function elapsedLabel(ms: number): string {
  if (ms < 60_000) return 'agora';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const remMin = mins % 60;
    return remMin === 0 ? `há ${hours}h` : `há ${hours}h${String(remMin).padStart(2, '0')}`;
  }
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

function colorTokenFor(ms: number): string {
  if (ms < 2 * 60_000) return 'var(--color-brand-deep)';
  if (ms < 10 * 60_000) return 'var(--color-warn)';
  return 'var(--color-alert)';
}

/**
 * Live-updating "há Xmin" pill for an escalated conversation. Re-renders every
 * 30 seconds — fine-grained enough to feel reactive without burning CPU.
 */
export function SlaTimer({ escalatedAt, className = '' }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!escalatedAt) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [escalatedAt]);

  if (!escalatedAt) return null;

  const startedAt = new Date(escalatedAt).getTime();
  if (Number.isNaN(startedAt)) return null;
  const elapsed = Math.max(0, now - startedAt);

  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold tabular-nums ${className}`}
      style={{ color: colorTokenFor(elapsed) }}
      title={`Escalado em ${new Date(escalatedAt).toLocaleString('pt-BR')}`}
    >
      {elapsedLabel(elapsed)}
    </span>
  );
}
