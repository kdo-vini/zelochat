interface ZeloChatLogoProps {
  size?: number;
  variant?: 'light' | 'dark';
  showWordmark?: boolean;
  className?: string;
}

export function ZeloChatLogo({
  size = 36,
  variant = 'dark',
  showWordmark = true,
  className = '',
}: ZeloChatLogoProps) {
  const wordmarkColor = variant === 'light' ? '#FFFFFF' : '#0B1120';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M16 2C8.268 2 2 7.82 2 15c0 2.51.78 4.84 2.11 6.79L2 30l8.38-2.13A15.9 15.9 0 0 0 16 28c7.732 0 14-5.82 14-13S23.732 2 16 2z"
          fill="#25D366"
        />
        <circle cx="11" cy="15" r="1.6" fill="white" />
        <circle cx="16" cy="15" r="1.6" fill="white" />
        <circle cx="21" cy="15" r="1.6" fill="white" />
      </svg>
      {showWordmark && (
        <span
          className="text-[18px] font-bold tracking-tight"
          style={{ color: wordmarkColor }}
        >
          ZeloChat
        </span>
      )}
    </div>
  );
}
