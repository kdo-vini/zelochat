import type { ChatAttachment, ChatSession } from '../types';

type SessionsResponse = { sessions: ChatSession[] };
type SessionResponse = { session: ChatSession };
type SendMessagePayload = {
  message?: string;
  attachment?: ChatAttachment;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error((body as { error?: string }).error || `HTTP ${response.status}`);
  }

  return body as T;
}

function authHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function bindEmpresa(token: string): Promise<void> {
  const response = await fetch('/api/bind-empresa', {
    method: 'POST',
    headers: authHeaders(token),
  });

  await parseResponse(response);
}

export async function getSessions(token: string): Promise<ChatSession[]> {
  const response = await fetch('/api/sessions', {
    headers: authHeaders(token),
  });

  const body = await parseResponse<SessionsResponse>(response);
  return body.sessions;
}

export async function getSession(token: string, jid: string): Promise<ChatSession> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(jid)}`, {
    headers: authHeaders(token),
  });

  const body = await parseResponse<SessionResponse>(response);
  return body.session;
}

export async function sendMessage(
  token: string,
  to: string,
  payload: SendMessagePayload,
): Promise<void> {
  const response = await fetch('/api/send', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ to, ...payload }),
  });

  await parseResponse(response);
}

export async function markSessionRead(token: string, jid: string): Promise<void> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(jid)}/read`, {
    method: 'POST',
    headers: authHeaders(token),
  });

  await parseResponse(response);
}

export async function setSessionAutoReply(
  token: string,
  jid: string,
  enabled: boolean,
): Promise<void> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(jid)}/auto-reply`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ enabled }),
  });

  await parseResponse(response);
}

export async function deleteSession(token: string, jid: string): Promise<void> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(jid)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });

  await parseResponse(response);
}

export async function fetchProfilePicture(token: string, jid: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(jid)}/profile-picture`, {
      headers: authHeaders(token),
    });
    const body = await parseResponse<{ url: string | null }>(response);
    return body.url;
  } catch {
    return null;
  }
}

export async function updateSessionName(token: string, jid: string, name: string): Promise<void> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(jid)}/name`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ name }),
  });
  await parseResponse(response);
}
