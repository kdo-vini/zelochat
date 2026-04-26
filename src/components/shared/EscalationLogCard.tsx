import type { EscalationEvent, EscalationReasonCategory } from '../../types';

interface Props {
  events: EscalationEvent[];
  loading?: boolean;
}

const REASON_LABEL_PT: Record<EscalationReasonCategory, string> = {
  frustration: 'Frustração',
  complaint: 'Reclamação',
  explicit_human_request: 'Solicitação de humano',
  repeated_ai_failure: 'Falha repetida da IA',
  offensive_language: 'Linguagem ofensiva',
  manual: 'Escalação manual',
  custom: 'Gatilho personalizado',
};

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function EscalationLogCard({ events, loading = false }: Props) {
  return (
    <section className="space-y-2">
      <header className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
          Histórico de escalações
        </h3>
        {events.length > 0 && (
          <span className="text-[10px] text-[var(--color-ink-muted)]">{events.length}</span>
        )}
      </header>

      {loading && events.length === 0 ? (
        <p className="text-[12px] text-[var(--color-ink-muted)]">Carregando…</p>
      ) : events.length === 0 ? (
        <p className="rounded-lg bg-[var(--color-surface-muted)] px-3 py-2 text-[12px] text-[var(--color-ink-muted)]">
          Nenhuma escalação registrada para este contato.
        </p>
      ) : (
        <ul className="space-y-2">
          {events.map((evt) => {
            const isOpen = !evt.resolvedAt;
            return (
              <li
                key={evt.id}
                className={`rounded-lg border px-3 py-2 ${
                  isOpen
                    ? 'border-[var(--color-alert)] bg-[var(--color-alert-soft)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[var(--color-ink)]">
                    {REASON_LABEL_PT[evt.reasonCategory] ?? evt.reasonCategory}
                  </span>
                  <span className="text-[10px] text-[var(--color-ink-muted)]">
                    {formatTimestamp(evt.triggeredAt)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
                  Gatilho: <span className="font-medium text-[var(--color-ink)]">{evt.triggerName}</span>
                </p>
                {evt.reasonText && (
                  <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">{evt.reasonText}</p>
                )}
                {evt.customerMessageExcerpt && (
                  <p className="mt-1 text-[11px] italic text-[var(--color-ink-muted)]">
                    "{evt.customerMessageExcerpt}"
                  </p>
                )}
                {evt.resolvedAt && (
                  <p className="mt-1 text-[10px] text-[var(--color-brand-deep)]">
                    Resolvido em {formatTimestamp(evt.resolvedAt)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
