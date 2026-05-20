import { useRef, type ReactNode, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';

interface MagicCardProps {
  children: ReactNode;
  className?: string;
  gradientColor?: string;
  gradientOpacity?: number;
}

export function MagicCard({
  children,
  className = '',
  gradientColor = 'rgba(37,211,102,0.18)',
  gradientOpacity = 1,
}: MagicCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mc-x', `${e.clientX - rect.left}px`);
    el.style.setProperty('--mc-y', `${e.clientY - rect.top}px`);
    el.style.setProperty('--mc-opacity', '1');
  };

  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--mc-opacity', '0');
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={`relative overflow-hidden ${className}`}
      style={
        {
          ['--mc-color' as string]: gradientColor,
          ['--mc-base-opacity' as string]: String(gradientOpacity),
        } as CSSProperties
      }
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: 'var(--mc-opacity, 0)',
          background:
            'radial-gradient(360px circle at var(--mc-x, 50%) var(--mc-y, 50%), var(--mc-color), transparent 60%)',
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
