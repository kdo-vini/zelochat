/**
 * Central API base URL configuration.
 * - In production (Dokploy, same-origin): no VITE_API_URL needed; uses window.location.origin
 * - In container/self-hosted production with VITE_API_URL set: routes there
 * - In dev: explicit hostname:3001
 */
const envUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');
const isLocalDevHost =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.port === '3000';

const originApiBase = window.location.origin.replace(/\/$/, '');
const directDevApiBase = `http://${window.location.hostname}:3001`;

export const API_BASE: string =
  envUrl && envUrl.length > 0
    ? envUrl
    : isLocalDevHost
      ? directDevApiBase
      : originApiBase;

export const WS_URL: string = (() => {
  if (envUrl) {
    return envUrl.replace(/^http/, 'ws') + '/ws';
  }
  if (isLocalDevHost) {
    return `ws://${window.location.hostname}:3001/ws`;
  }
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}/ws`;
})();

/** Prefixes a relative `/api/...` path with the API base. */
export const apiUrl = (path: string): string =>
  `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

/**
 * Thrown when the backend (Dokploy/WhatsApp server) is unreachable —
 * usually because the server is offline, the domain isn't configured,
 * or CORS is blocking the request.
 */
export class WaServerOfflineError extends Error {
  constructor(message = 'Servidor WhatsApp offline. Verifique se o servidor está ativo e tente novamente.') {
    super(message);
    this.name = 'WaServerOfflineError';
  }
}

/**
 * Backend-health observer. `apiFetch` reports every call's outcome so that the
 * UI can surface a single global "servidor instável" banner instead of every
 * caller racing to toast its own error. Threshold of 3 consecutive failures
 * avoids flapping on a single dropped request; one success flips back to
 * online immediately.
 *
 * Failures here are *transport-level* only (TypeError / network / CORS-block /
 * reverse-proxy dropping the connection). HTTP 4xx/5xx responses are NOT a
 * health signal — they mean the backend is alive and is choosing to reject.
 */
const BACKEND_OFFLINE_THRESHOLD = 3;
let consecutiveFailures = 0;
let backendOffline = false;
const healthListeners = new Set<(offline: boolean) => void>();

function setBackendOffline(next: boolean) {
  if (backendOffline === next) return;
  backendOffline = next;
  healthListeners.forEach((fn) => {
    try { fn(next); } catch { /* ignore listener throws */ }
  });
}

export function subscribeBackendHealth(fn: (offline: boolean) => void): () => void {
  healthListeners.add(fn);
  fn(backendOffline);
  return () => { healthListeners.delete(fn); };
}

export function getBackendOffline(): boolean {
  return backendOffline;
}

/**
 * Wraps `fetch` so that network-level failures (TypeError: Failed to fetch)
 * surface as a user-friendly "servidor offline" error instead of a raw browser message.
 * Use this for any call to the backend (`/api/*`).
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(input, init);
    consecutiveFailures = 0;
    setBackendOffline(false);
    return res;
  } catch (err) {
    if (err instanceof TypeError) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= BACKEND_OFFLINE_THRESHOLD) {
        setBackendOffline(true);
      }
      throw new WaServerOfflineError();
    }
    throw err;
  }
}
