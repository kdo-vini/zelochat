import { useState } from 'react';

interface Props {
  unlocked: boolean;
  onUnlock: () => Promise<boolean>;
  onRequestNotifications?: () => Promise<unknown>;
  notificationPermission?: 'default' | 'granted' | 'denied' | 'unsupported';
}

const DISMISS_KEY = 'zelochat_sound_banner_dismissed';

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Single banner that primes both audio autoplay and the Notification API in
 * one click. Browsers tie both to a user gesture, so we batch them. After
 * unlock, the banner stays hidden via localStorage unless audio gets revoked.
 */
export function SoundUnlockBanner({
  unlocked,
  onUnlock,
  onRequestNotifications,
  notificationPermission,
}: Props) {
  const [dismissed, setDismissed] = useState<boolean>(isDismissed);
  const [busy, setBusy] = useState(false);

  if (unlocked) return null;
  if (dismissed) return null;

  const handleEnable = async () => {
    setBusy(true);
    try {
      await onUnlock();
      if (onRequestNotifications && notificationPermission === 'default') {
        await onRequestNotifications();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-2 text-[13px] text-[var(--color-ink)]">
      <span>
        Ative os alertas sonoros para ouvir avisos quando uma conversa for escalada para
        atendimento humano.
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleEnable}
          disabled={busy}
          className="rounded-md bg-[var(--color-brand)] px-3 py-1 text-[12px] font-semibold text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-50"
        >
          {busy ? 'Ativando…' : 'Ativar alertas'}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded-md px-2 py-1 text-[12px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          Agora não
        </button>
      </div>
    </div>
  );
}
