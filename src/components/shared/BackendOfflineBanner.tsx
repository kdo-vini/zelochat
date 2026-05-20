import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { apiFetch, apiUrl, subscribeBackendHealth } from '../../config';

const PROBE_INTERVAL_MS = 15_000;

/**
 * Top-of-screen banner shown when 3+ consecutive backend calls have failed
 * with a network-level error (backend down, reverse proxy dropped the connection,
 * device offline). Probes `/api/healthz` while shown so it auto-dismisses
 * the moment the backend recovers — no operator action needed.
 *
 * Intentionally minimal: this is *only* about transport reachability. HTTP
 * errors (4xx/5xx) still bubble to the caller's normal error handling, since
 * they mean the backend is alive.
 */
export function BackendOfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => subscribeBackendHealth(setOffline), []);

  useEffect(() => {
    if (!offline) return;
    let cancelled = false;

    const probe = async () => {
      try {
        // Going through apiFetch is what flips the offline flag on success.
        await apiFetch(apiUrl('/api/healthz'), { cache: 'no-store' });
      } catch {
        /* still offline — keep waiting; apiFetch already ticked the counter */
      }
      if (cancelled) return;
    };

    const id = window.setInterval(probe, PROBE_INTERVAL_MS);
    void probe();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [offline]);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 border-b border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-2 text-[13px] font-medium text-[var(--color-ink)]"
    >
      <WifiOff size={14} className="shrink-0" />
      <span>
        Estamos com instabilidade no servidor. Tentando reconectar automaticamente.
      </span>
    </div>
  );
}
