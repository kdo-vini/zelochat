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
      <img
        src="/icon-192.png"
        width={size}
        height={size}
        alt="ZeloChat"
        aria-hidden="true"
        style={{ objectFit: 'contain' }}
      />
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
