import type { ReactNode } from 'react';

interface Props {
  className?: string;
  children?: ReactNode;
}

export function ZeloPDVLink({ className, children }: Props) {
  return (
    <a
      href="https://zelopdv.com.br"
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? 'text-[var(--color-brand)] font-medium hover:underline'}
    >
      {children ?? 'ZeloPDV'}
    </a>
  );
}
