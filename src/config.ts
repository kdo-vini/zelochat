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
 * Wraps `fetch` so that network-level failures (TypeError: Failed to fetch)
 * surface as a user-friendly "servidor offline" error instead of a raw browser message.
 * Use this for any call to the backend (`/api/*`).
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (err instanceof TypeError) {
      throw new WaServerOfflineError();
    }
    throw err;
  }
}
