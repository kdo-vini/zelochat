import type { ReactNode } from 'react';

interface AnimatedShinyTextProps {
  children: ReactNode;
  className?: string;
}

export function AnimatedShinyText({
  children,
  className = '',
}: AnimatedShinyTextProps) {
  return (
    <span
      className={`inline-block bg-clip-text text-transparent ${className}`}
      style={{
        backgroundImage:
          'linear-gradient(110deg, var(--color-brand) 25%, #5BE89A 45%, #ffffff 55%, #5BE89A 65%, var(--color-brand) 85%)',
        backgroundSize: '200% 100%',
        animation: 'ast-sweep 4.5s linear infinite',
      }}
    >
      {children}
      <style>{`
        @keyframes ast-sweep {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-shiny] { animation: none !important; }
        }
      `}</style>
    </span>
  );
}
