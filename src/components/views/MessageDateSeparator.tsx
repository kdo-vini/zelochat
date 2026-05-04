import React from 'react';

interface MessageDateSeparatorProps {
  label: string;
}

/**
 * Renders a horizontal divider with a centered date label — "Hoje", "Ontem", etc.
 * Uses forwardRef so ChatView can register it with an IntersectionObserver / scroll handler.
 */
export const MessageDateSeparator = React.forwardRef<HTMLDivElement, MessageDateSeparatorProps>(
  ({ label }, ref) => (
    <div
      ref={ref}
      className="my-3 flex items-center gap-3 px-2"
      role="separator"
      aria-label={label}
      data-date-separator
      data-label={label}
    >
      <div className="h-px flex-1 bg-[var(--color-line)]" />
      <span className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">{label}</span>
      <div className="h-px flex-1 bg-[var(--color-line)]" />
    </div>
  ),
);

MessageDateSeparator.displayName = 'MessageDateSeparator';
