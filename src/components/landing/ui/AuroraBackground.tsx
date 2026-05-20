import type { ReactNode } from 'react';

interface AuroraBackgroundProps {
  children?: ReactNode;
  className?: string;
  intensity?: 'subtle' | 'normal' | 'strong';
}

export function AuroraBackground({
  children,
  className = '',
  intensity = 'normal',
}: AuroraBackgroundProps) {
  const opacity =
    intensity === 'subtle' ? 0.35 : intensity === 'strong' ? 0.75 : 0.55;

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-0"
        style={{ opacity }}
      >
        <div
          className="absolute -top-1/3 left-1/2 -translate-x-1/2 w-[140%] h-[80%]"
          style={{
            background:
              'radial-gradient(ellipse 60% 50% at 30% 40%, rgba(37,211,102,0.35) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 70% 50%, rgba(96,165,250,0.18) 0%, transparent 60%), radial-gradient(ellipse 40% 30% at 50% 80%, rgba(167,139,250,0.18) 0%, transparent 60%)',
            filter: 'blur(48px)',
            animation: 'aurora-shift 14s ease-in-out infinite',
          }}
        />
      </div>

      <style>{`
        @keyframes aurora-shift {
          0%, 100% { transform: translate(-50%, 0) rotate(0deg) scale(1); }
          33% { transform: translate(-48%, -2%) rotate(2deg) scale(1.05); }
          66% { transform: translate(-52%, 2%) rotate(-2deg) scale(0.98); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-aurora] { animation: none !important; }
        }
      `}</style>

      <div className="relative z-10">{children}</div>
    </div>
  );
}
