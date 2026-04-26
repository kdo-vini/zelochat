interface Props {
  className?: string;
}

export function EscaladoBadge({ className = '' }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-[var(--color-alert)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ${className}`}
    >
      Escalado
    </span>
  );
}
