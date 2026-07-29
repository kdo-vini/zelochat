import { useEffect, useRef, useState } from 'react';

interface NumberTickerProps {
  value: number;
  durationMs?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export function NumberTicker({
  value,
  durationMs = 1400,
  decimals = 0,
  prefix = '',
  suffix = '',
  className = '',
}: NumberTickerProps) {
  // Never render a misleading zero while the visibility observer is waiting
  // to start the optional animation. The value itself is the source of truth.
  const [display, setDisplay] = useState(value);
  const ref = useRef<HTMLSpanElement>(null);
  const startedRef = useRef(false);
  const previousValueRef = useRef(value);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    const from = previousValueRef.current;
    previousValueRef.current = value;

    // The first paint already contains the real value. Only animate later
    // prop changes; otherwise the ticker would briefly reset a visible price
    // back to zero when it enters the viewport.
    if (from === value) return;
    startedRef.current = false;

    if (reduceMotion) {
      setDisplay(value);
      return;
    }

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !startedRef.current) {
            startedRef.current = true;
            const start = performance.now();
            const to = value;
            const step = (now: number) => {
              const t = Math.min(1, (now - start) / durationMs);
              const eased = 1 - Math.pow(1 - t, 3);
              setDisplay(from + (to - from) * eased);
              if (t < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          }
        }
      },
      { threshold: 0.4 }
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [value, durationMs]);

  const formatted = display.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
