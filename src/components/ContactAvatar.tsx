import { useState } from 'react';
import { User } from 'lucide-react';

interface ContactAvatarProps {
  url?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** Derives a stable background color from a name string via a simple hash. */
function nameToColor(name: string): string {
  const palette = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f97316',
    '#eab308', '#22c55e', '#14b8a6', '#3b82f6',
    '#ef4444', '#a855f7',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (Math.imul(31, hash) + name.charCodeAt(i)) | 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

/** Returns up to two initials from a name. */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

const SIZE_MAP: Record<NonNullable<ContactAvatarProps['size']>, { box: string; text: string; icon: string }> = {
  sm: { box: 'w-8 h-8',   text: 'text-[11px]', icon: 'w-4 h-4' },
  md: { box: 'w-10 h-10', text: 'text-[13px]', icon: 'w-[18px] h-[18px]' },
  lg: { box: 'w-14 h-14', text: 'text-[18px]', icon: 'w-6 h-6' },
};

/**
 * Renders a contact avatar with automatic fallback to initials when the
 * profile picture URL is missing or returns a 404 (expired Whatsmiau URLs).
 *
 * size variants: sm = 32px, md = 40px, lg = 56px
 */
export function ContactAvatar({ url, name, size = 'md', className = '' }: ContactAvatarProps) {
  const [failed, setFailed] = useState(false);
  const { box, text, icon } = SIZE_MAP[size];

  const showImage = !!url && !failed;
  const initials = getInitials(name);
  const hasValidName = name.trim().length > 0 && initials !== '?';

  return (
    <div
      className={`flex-shrink-0 rounded-full flex items-center justify-center overflow-hidden border border-[var(--color-line)] ${box} ${className}`}
      title={name}
    >
      {showImage ? (
        <img
          src={url}
          alt={name}
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : hasValidName ? (
        <span
          className={`font-semibold text-white leading-none select-none w-full h-full flex items-center justify-center ${text}`}
          style={{ backgroundColor: nameToColor(name) }}
          aria-label={name}
        >
          {initials}
        </span>
      ) : (
        <span className="w-full h-full flex items-center justify-center bg-[var(--color-surface-muted)]">
          <User className={`${icon} text-[var(--color-ink-faint)]`} strokeWidth={1.8} />
        </span>
      )}
    </div>
  );
}
