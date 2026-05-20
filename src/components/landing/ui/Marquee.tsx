import type { ReactNode } from 'react';

interface MarqueeProps {
  children: ReactNode;
  reverse?: boolean;
  pauseOnHover?: boolean;
  className?: string;
  durationSeconds?: number;
}

export function Marquee({
  children,
  reverse = false,
  pauseOnHover = true,
  className = '',
  durationSeconds = 40,
}: MarqueeProps) {
  return (
    <div className={`group relative flex overflow-hidden ${className}`}>
      <div
        className="flex shrink-0 items-stretch gap-4 pr-4"
        style={{
          animation: `mq-scroll ${durationSeconds}s linear infinite`,
          animationDirection: reverse ? 'reverse' : 'normal',
          animationPlayState: 'running',
        }}
        data-marquee-track
      >
        {children}
      </div>
      <div
        aria-hidden="true"
        className="flex shrink-0 items-stretch gap-4 pr-4"
        style={{
          animation: `mq-scroll ${durationSeconds}s linear infinite`,
          animationDirection: reverse ? 'reverse' : 'normal',
        }}
        data-marquee-track
      >
        {children}
      </div>
      <style>{`
        @keyframes mq-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-100%); }
        }
        ${
          pauseOnHover
            ? `.group:hover [data-marquee-track] { animation-play-state: paused; }`
            : ''
        }
        @media (prefers-reduced-motion: reduce) {
          [data-marquee-track] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
