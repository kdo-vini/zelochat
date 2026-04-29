/**
 * Central API base URL configuration.
 * - In production (Vercel): uses VITE_API_URL → Railway backend
 * - In dev: same-origin or explicit hostname:3001
 */
const envUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');

export const API_BASE: string =
  envUrl && envUrl.length > 0
    ? envUrl
    : `http://${window.location.hostname}:3001`;

export const WS_URL: string = (() => {
  if (envUrl) {
    return envUrl.replace(/^http/, 'ws') + '/ws';
  }
  return `ws://${window.location.hostname}:3001/ws`;
})();

/** Prefixes a relative `/api/...` path with the API base. */
export const apiUrl = (path: string): string =>
  `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

/**
 * Thrown when the backend (Railway/WhatsApp server) is unreachable —
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
 * Callback registered by AuthContext that refreshes the Supabase session and
 * returns the new access token, or null if refresh fails (in which case it
 * also signs the user out). Set once on mount, cleared on unmount.
 */
type TokenRefresher = () => Promise<string | null>;
let _tokenRefresher: TokenRefresher | null = null;

export function setTokenRefresher(fn: TokenRefresher | null): void {
  _tokenRefresher = fn;
}

/**
 * Wraps `fetch` so that:
 * 1. Network-level failures surface as WaServerOfflineError.
 * 2. A 401 response triggers a one-shot token refresh (via the callback
 *    registered by AuthContext) and retries the original request with the
 *    new Authorization header. If the refresh fails the 401 is returned as-is
 *    so the caller's `parseResponse` can surface it to the user.
 *    The `_retried` param prevents infinite retry loops.
 */
export async function apiFetch(
  input: string,
  init?: RequestInit,
  _retried = false,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    if (err instanceof TypeError) {
      throw new WaServerOfflineError();
    }
    throw err;
  }

  if (res.status === 401 && !_retried && _tokenRefresher) {
    const newToken = await _tokenRefresher().catch(() => null);
    if (newToken) {
      const existingHeaders = (init?.headers ?? {}) as Record<string, string>;
      const newInit: RequestInit = {
        ...init,
        headers: { ...existingHeaders, Authorization: `Bearer ${newToken}` },
      };
      return apiFetch(input, newInit, true);
    }
  }

  return res;
}
