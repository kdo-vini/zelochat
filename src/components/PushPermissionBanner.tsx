import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { getPushStatus, subscribeToPush, type PushStatus } from '../services/pushNotifications';

const DISMISS_KEY = 'zelochat_push_prompt_dismissed';

interface Props {
  token: string | null;
}

export function PushPermissionBanner({ token }: Props) {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void getPushStatus(token).then((s) => { if (!cancelled) setStatus(s); });
    return () => { cancelled = true; };
  }, [token]);

  if (!token || dismissed) return null;
  if (status !== 'default') return null;

  const onEnable = async () => {
    if (!token) return;
    setWorking(true);
    try {
      const next = await subscribeToPush(token);
      setStatus(next);
      if (next === 'subscribed') {
        try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
      }
    } catch {
      // ignore — user can try again from settings
    } finally {
      setWorking(false);
    }
  };

  const onDismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
  };

  return (
    <div className="m-3 flex items-start gap-3 rounded-xl border border-[var(--color-brand-soft)] bg-[var(--color-brand-soft)]/40 px-3 py-2.5">
      <Bell className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-brand-deep)]" strokeWidth={1.8} />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold text-[var(--color-ink)]">Receba alertas mesmo com o app fechado</p>
        <p className="mt-0.5 text-[11.5px] text-[var(--color-ink-muted)]">Toque em "Ativar" e o navegador vai pedir permissão.</p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void onEnable()}
            disabled={working}
            className="rounded-lg bg-[var(--color-brand)] px-3 py-1 text-[11.5px] font-semibold text-white shadow-sm transition-colors hover:bg-[var(--color-brand-deep)] disabled:opacity-60"
          >
            {working ? 'Aguarde…' : 'Ativar'}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="text-[11.5px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            Agora não
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Fechar"
        className="rounded-lg p-1 text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
