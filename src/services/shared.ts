import { apiUrl, apiFetch, WaServerOfflineError } from '../config';

export function authHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((body as { error?: string }).error || `HTTP ${response.status}`);
  }
  return body as T;
}

export async function fetchJson<T>(
  path: string,
  token: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  let response: Response;
  try {
    response = await apiFetch(apiUrl(path), {
      method: options?.method ?? 'GET',
      headers: authHeaders(token),
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    if (err instanceof WaServerOfflineError) {
      throw err;
    }
    throw new Error('Falha ao conectar no servidor. Tente novamente.');
  }
  return parseResponse<T>(response);
}
