interface BorderBeamProps {
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
  className?: string;
}

export function BorderBeam({
  size = 220,
  duration = 8,
  delay = 0,
  colorFrom = '#25D366',
  colorTo = '#60A5FA',
  className = '',
}: BorderBeamProps) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 rounded-[inherit] overflow-hidden ${className}`}
      style={{
        ['--bb-size' as string]: `${size}px`,
        ['--bb-duration' as string]: `${duration}s`,
        ['--bb-delay' as string]: `${delay}s`,
        ['--bb-from' as string]: colorFrom,
        ['--bb-to' as string]: colorTo,
      }}
    >
      <div
        className="absolute inset-0 rounded-[inherit]"
        style={{
          padding: '1px',
          background: `conic-gradient(from 0deg, transparent 0%, var(--bb-from) 12%, var(--bb-to) 18%, transparent 25%, transparent 100%)`,
          WebkitMask:
            'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          animation: 'bb-spin var(--bb-duration) linear infinite',
          animationDelay: 'var(--bb-delay)',
        }}
      />
      <style>{`
        @keyframes bb-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-bb] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
