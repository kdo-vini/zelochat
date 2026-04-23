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
