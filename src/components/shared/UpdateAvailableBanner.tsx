import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles } from 'lucide-react';
import { APP_VERSION, normalizeVersion } from '../../version';
import { apiUrl } from '../../config';

const ACTIVE_CHECK_INTERVAL_MS = 90_000;
const IDLE_CHECK_INTERVAL_MS = 5 * 60_000;
const INITIAL_DELAY_MS = 20_000;
const LATER_DELAY_MS = 2 * 60 * 60_000;
const RECENT_REFRESH_SUPPRESSION_MS = 5 * 60_000;
const CHANNEL_NAME = 'zelochat-app-version';
const STORAGE_DEFERRED_VERSION = 'zelochat_update_deferred_version';
const STORAGE_DEFERRED_UNTIL = 'zelochat_update_deferred_until';
const SESSION_REFRESH_TARGET = 'zelochat_update_refresh_target';
const SESSION_REFRESH_AT = 'zelochat_update_refresh_at';
const URL_VERSION_PARAM = 'appVersion';

function safeGet(storage: Storage, key: string): string | null {
  try { return storage.getItem(key); } catch { return null; }
}
function safeSet(storage: Storage, key: string, value: string): void {
  try { storage.setItem(key, value); } catch { /* quota / private mode */ }
}
function safeRemove(storage: Storage, key: string): void {
  try { storage.removeItem(key); } catch { /* ignore */ }
}

function userIsTyping(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  const tag = active.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (active.isContentEditable) return true;
  return Boolean(active.closest?.('[contenteditable="true"]'));
}

function hasOpenModal(): boolean {
  return Boolean(
    document.querySelector(
      'dialog[open], [aria-modal="true"], [data-update-blocking="true"]'
    )
  );
}

function removeRefreshVersionParam(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(URL_VERSION_PARAM)) return;
    url.searchParams.delete(URL_VERSION_PARAM);
    window.history.replaceState(
      window.history.state,
      document.title,
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {
    /* ignore malformed URL / unsupported history */
  }
}

/**
 * Polls /api/version and prompts the operator to refresh when the backend
 * reports a different build than the one baked into this bundle.
 *
 * Mirrors the ZeloPDV banner (same UX, same defer-2h, same multi-tab
 * BroadcastChannel sync) but drops the PWA/service-worker code path — this
 * repo doesn't register a service worker, so a plain location.reload is the
 * full refresh.
 *
 * Suppressed entirely in dev (`import.meta.env.DEV`): there's no version
 * injection in dev (both sides fall back to package.json's 0.0.0), so the
 * comparison is meaningless and the banner would never be meaningful anyway.
 */
export function UpdateAvailableBanner() {
  const [visible, setVisible] = useState(false);
  const [pendingVersion, setPendingVersion] = useState('');
  const checkingRef = useRef(false);
  const pollTimerRef = useRef<number | null>(null);
  const promptTimerRef = useRef<number | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);

  const currentVersion = normalizeVersion(APP_VERSION);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    if (!currentVersion) return;

    // If we previously stashed "refreshing to vX" and we ARE on vX now, the
    // refresh succeeded — clear the guard so future updates can prompt again.
    const storedTarget = safeGet(sessionStorage, SESSION_REFRESH_TARGET);
    if (storedTarget && storedTarget === currentVersion) {
      safeRemove(sessionStorage, SESSION_REFRESH_TARGET);
      safeRemove(sessionStorage, SESSION_REFRESH_AT);
    }
    // appVersion is only a temporary cache-bust for the navigation request.
    // Once the app is mounted, keep the operator's URL clean.
    removeRefreshVersionParam();

    function wasRecentlyRefreshedFor(version: string): boolean {
      const target = safeGet(sessionStorage, SESSION_REFRESH_TARGET);
      const at = Number(safeGet(sessionStorage, SESSION_REFRESH_AT) || 0);
      return target === version && Date.now() - at < RECENT_REFRESH_SUPPRESSION_MS;
    }

    function isDeferred(version: string): boolean {
      if (safeGet(localStorage, STORAGE_DEFERRED_VERSION) !== version) return false;
      return Number(safeGet(localStorage, STORAGE_DEFERRED_UNTIL) || 0) > Date.now();
    }

    function schedulePromptWhenSafe(version: string): void {
      if (promptTimerRef.current) window.clearTimeout(promptTimerRef.current);
      promptTimerRef.current = window.setTimeout(() => {
        if (isDeferred(version) || wasRecentlyRefreshedFor(version)) return;
        if (userIsTyping() || hasOpenModal()) {
          schedulePromptWhenSafe(version);
          return;
        }
        setPendingVersion(version);
        setVisible(true);
      }, 1200);
    }

    function announceUpdate(rawVersion: unknown, _source: string): void {
      const normalized = normalizeVersion(rawVersion);
      if (!normalized || normalized === currentVersion) return;
      if (wasRecentlyRefreshedFor(normalized) || isDeferred(normalized)) return;
      bcRef.current?.postMessage({ type: 'update-available', version: normalized });
      schedulePromptWhenSafe(normalized);
    }

    async function checkForUpdate(source: string): Promise<void> {
      if (checkingRef.current || !navigator.onLine) return;
      checkingRef.current = true;
      try {
        const response = await fetch(`${apiUrl('/api/version')}?t=${Date.now()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
        });
        if (!response.ok) return;
        const data = await response.json();
        announceUpdate(data?.version, source);
      } catch {
        /* offline / transient — next tick will retry */
      } finally {
        checkingRef.current = false;
      }
    }

    function startPolling(): void {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      const interval = document.visibilityState === 'visible'
        ? ACTIVE_CHECK_INTERVAL_MS
        : IDLE_CHECK_INTERVAL_MS;
      pollTimerRef.current = window.setInterval(() => checkForUpdate('interval'), interval);
    }

    if ('BroadcastChannel' in window) {
      bcRef.current = new BroadcastChannel(CHANNEL_NAME);
      bcRef.current.onmessage = (event) => {
        const { type, version } = (event.data || {}) as { type?: string; version?: string };
        if (!version || normalizeVersion(version) === currentVersion) return;
        if (type === 'update-available') schedulePromptWhenSafe(version);
        if (type === 'deferred' || type === 'refreshing') setVisible(false);
      };
    }

    const onVisibility = () => {
      startPolling();
      if (document.visibilityState === 'visible') checkForUpdate('visibility');
    };
    const onFocus = () => checkForUpdate('focus');
    const onOnline = () => checkForUpdate('online');

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    startPolling();
    const initial = window.setTimeout(() => checkForUpdate('initial'), INITIAL_DELAY_MS);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      if (promptTimerRef.current) window.clearTimeout(promptTimerRef.current);
      window.clearTimeout(initial);
      bcRef.current?.close();
      bcRef.current = null;
    };
  }, [currentVersion]);

  function refreshNow(): void {
    if (!pendingVersion) return;
    safeSet(sessionStorage, SESSION_REFRESH_TARGET, pendingVersion);
    safeSet(sessionStorage, SESSION_REFRESH_AT, String(Date.now()));
    bcRef.current?.postMessage({ type: 'refreshing', version: pendingVersion });
    const url = new URL(window.location.href);
    url.searchParams.set(URL_VERSION_PARAM, pendingVersion.slice(0, 12));
    window.location.replace(url.toString());
  }

  function later(): void {
    if (pendingVersion) {
      safeSet(localStorage, STORAGE_DEFERRED_VERSION, pendingVersion);
      safeSet(localStorage, STORAGE_DEFERRED_UNTIL, String(Date.now() + LATER_DELAY_MS));
      bcRef.current?.postMessage({ type: 'deferred', version: pendingVersion });
    }
    setVisible(false);
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.section
          role="status"
          aria-live="polite"
          initial={{ y: 18, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="fixed bottom-4 right-4 z-[120] grid w-[min(31rem,calc(100vw-2rem))] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-2xl backdrop-blur-md max-md:bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] max-md:left-3 max-md:right-3 max-md:w-auto max-md:grid-cols-[auto_minmax(0,1fr)] max-md:items-start"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
            <Sparkles size={18} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <strong className="block text-[14px] font-semibold leading-tight text-[var(--color-ink)]">
              Nova versão disponível
            </strong>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--color-ink-muted)]">
              Recarregue para receber as últimas melhorias.
            </span>
          </div>
          <div className="flex items-center gap-2 max-md:col-span-2 max-md:w-full max-md:justify-end">
            <button
              type="button"
              onClick={later}
              className="h-9 rounded-lg border border-[var(--color-line)] bg-transparent px-3 text-[13px] font-semibold text-[var(--color-ink-muted)] transition hover:bg-[var(--color-surface-muted)] max-md:flex-1"
            >
              Depois
            </button>
            <button
              type="button"
              onClick={refreshNow}
              className="h-9 rounded-lg border border-[var(--color-brand)] bg-[var(--color-brand)] px-3 text-[13px] font-semibold text-white transition hover:bg-[var(--color-brand-deep)] hover:border-[var(--color-brand-deep)] max-md:flex-1"
            >
              Atualizar agora
            </button>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
