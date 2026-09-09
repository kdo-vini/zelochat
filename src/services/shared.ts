export function authHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

// Fixed PT-BR fallback shown when the server response has no friendly
// message. Never surface "HTTP ${status}" or other raw technical detail to
// the operator — see server/router.ts's friendlyServerErrorMessage for the
// server-side counterpart.
const GENERIC_ERROR_MESSAGE = 'Não foi possível concluir a ação. Tente novamente em instantes.';

export async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (body as { error?: string }).error;
    throw new Error(message && message.trim() ? message : GENERIC_ERROR_MESSAGE);
  }
  return body as T;
}
