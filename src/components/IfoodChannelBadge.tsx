type IfoodChannelBadgeProps = {
  displayId?: string | null;
};

export function IfoodChannelBadge({ displayId }: IfoodChannelBadgeProps) {
  const reference = typeof displayId === 'string' ? displayId.trim() : '';
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5"
      aria-label={reference ? `Canal iFood, pedido ${reference}` : 'Canal iFood'}
    >
      <span
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--color-line)] bg-[var(--color-surface)]"
        aria-hidden="true"
      >
        <img src="/ifood-logo.png" alt="" width={24} height={24} className="h-[82%] w-[82%] object-contain" />
      </span>
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
        iFood
        {reference ? (
          <span className="normal-case tracking-normal text-[var(--color-ink)] tabular-nums">#{reference}</span>
        ) : null}
      </span>
    </span>
  );
}
