import type {
  BuiltinTriggerInfo,
  ChatAttachment,
  ChatSession,
  EscalationEvent,
  Trigger,
  TriggerKind,
} from '../types';
import { apiUrl, apiFetch } from '../config';

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
  const response = await apiFetch(apiUrl('/api/bind-empresa'), {
    method: 'POST',
    headers: authHeaders(token),
  });

  await parseResponse(response);
}

export async function getSessions(token: string): Promise<ChatSession[]> {
  const response = await apiFetch(apiUrl('/api/sessions'), {
    headers: authHeaders(token),
  });

  const body = await parseResponse<SessionsResponse>(response);
  return body.sessions;
}

export async function getSession(token: string, jid: string): Promise<ChatSession> {
  const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(jid)}`), {
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
  const response = await apiFetch(apiUrl('/api/send'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ to, ...payload }),
  });

  await parseResponse(response);
}

export async function markSessionRead(token: string, jid: string): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(jid)}/read`), {
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
  const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(jid)}/auto-reply`), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ enabled }),
  });

  await parseResponse(response);
}

export async function deleteSession(token: string, jid: string): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(jid)}`), {
    method: 'DELETE',
    headers: authHeaders(token),
  });

  await parseResponse(response);
}

export async function fetchProfilePicture(token: string, jid: string): Promise<string | null> {
  try {
    const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(jid)}/profile-picture`), {
      headers: authHeaders(token),
    });
    const body = await parseResponse<{ url: string | null }>(response);
    return body.url;
  } catch {
    return null;
  }
}

export async function listTriggers(token: string): Promise<Trigger[]> {
  const response = await apiFetch(apiUrl('/api/triggers'), {
    headers: authHeaders(token),
  });
  const body = await parseResponse<{ triggers: Trigger[] }>(response);
  return body.triggers;
}

export async function createTrigger(token: string, naturalInput: string): Promise<Trigger> {
  const response = await apiFetch(apiUrl('/api/triggers'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ naturalInput }),
  });
  const body = await parseResponse<{ trigger: Trigger }>(response);
  return body.trigger;
}

export async function updateTrigger(
  token: string,
  id: string,
  patch: { name?: string; conditionDescription?: string; active?: boolean; kind?: TriggerKind },
): Promise<Trigger> {
  const response = await apiFetch(apiUrl(`/api/triggers/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  });
  const body = await parseResponse<{ trigger: Trigger }>(response);
  return body.trigger;
}

export async function deleteTrigger(token: string, id: string): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/triggers/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  await parseResponse(response);
}

export async function updateSessionName(token: string, jid: string, name: string): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(jid)}/name`), {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ name }),
  });
  await parseResponse(response);
}

export async function getAiEnabled(token: string): Promise<boolean> {
  const response = await apiFetch(apiUrl('/api/ai-enabled'), {
    headers: authHeaders(token),
  });
  const body = await parseResponse<{ enabled: boolean }>(response);
  return body.enabled !== false;
}

export async function setAiEnabled(token: string, enabled: boolean): Promise<void> {
  const response = await apiFetch(apiUrl('/api/ai-enabled'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ enabled }),
  });
  await parseResponse(response);
}

// --- Escalation ---

export async function listEscalationEvents(
  token: string,
  jid: string,
): Promise<EscalationEvent[]> {
  const response = await apiFetch(
    apiUrl(`/api/sessions/${encodeURIComponent(jid)}/escalation-events`),
    { headers: authHeaders(token) },
  );
  const body = await parseResponse<{ events: EscalationEvent[] }>(response);
  return body.events;
}

export async function resolveSession(token: string, jid: string): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/sessions/${encodeURIComponent(jid)}/resolve`),
    { method: 'POST', headers: authHeaders(token) },
  );
  await parseResponse(response);
}

export async function escalateSessionManually(
  token: string,
  jid: string,
  reason?: string,
): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/sessions/${encodeURIComponent(jid)}/escalate`),
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ reason }),
    },
  );
  await parseResponse(response);
}

export async function acknowledgeSession(token: string, jid: string): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/sessions/${encodeURIComponent(jid)}/acknowledge`),
    { method: 'POST', headers: authHeaders(token) },
  );
  await parseResponse(response);
}

export async function getOpenEscalationCount(token: string): Promise<number> {
  const response = await apiFetch(apiUrl('/api/escalations/open-count'), {
    headers: authHeaders(token),
  });
  const body = await parseResponse<{ count: number }>(response);
  return body.count ?? 0;
}

export async function listBuiltinTriggers(token: string): Promise<BuiltinTriggerInfo[]> {
  const response = await apiFetch(apiUrl('/api/triggers/builtin'), {
    headers: authHeaders(token),
  });
  const body = await parseResponse<{ builtins: BuiltinTriggerInfo[] }>(response);
  return body.builtins;
}

export async function setBuiltinTriggerDisabled(
  token: string,
  builtinId: string,
  disabled: boolean,
): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/triggers/builtin/${encodeURIComponent(builtinId)}`),
    {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ disabled }),
    },
  );
  await parseResponse(response);
}
