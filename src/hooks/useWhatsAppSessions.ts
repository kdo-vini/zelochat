import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AudioTranscriptStatus,
  ChatAttachment,
  ChatMessage,
  ChatSession,
  EscalationEvent,
  SessionStatus,
} from '../types';
import { WS_URL } from '../config';
import {
  acknowledgeSession as acknowledgeSessionApi,
  archiveSessions as archiveSessionsApi,
  bindEmpresa,
  bulkDeleteSessions as bulkDeleteSessionsApi,
  deleteMessage as deleteMessageApi,
  deleteSession as deleteSessionApi,
  escalateSessionManually as escalateSessionManuallyApi,
  fetchProfilePicture as fetchProfilePictureApi,
  getSession,
  getSessions,
  markSessionRead,
  markSessionsRead,
  resolveSession as resolveSessionApi,
  sendMessage,
  setSessionAutoReply,
  setSessionPinned as setSessionPinnedApi,
  updateSessionName as updateSessionNameApi,
} from '../services/waApi';

type SessionEventPayload = {
  sessionId: string;
  customerName?: string;
  customerPhone?: string;
  message: ChatMessage;
  autoReply?: boolean;
  unreadCount?: number;
  lastMessage?: string;
  lastMessageTime?: string;
};

type EscalationTriggeredPayload = {
  sessionId: string;
  empresaId: string;
  event: EscalationEvent;
  sessionStatus: SessionStatus;
  escalatedAt: string;
};

type EscalationResolvedPayload = {
  sessionId: string;
  empresaId: string;
  resolvedAt: string;
  resolvedCount: number;
};

type SessionStatusChangedPayload = {
  sessionId: string;
  empresaId: string;
  status: SessionStatus;
  escalatedAt?: string | null;
};

type MessageUpdatePayload = {
  sessionId: string;
  messageId: string;
  patch: {
    audio_transcript?: string | null;
    audio_transcript_status?: AudioTranscriptStatus | null;
  };
};

type MessageDeletedPayload = {
  sessionId: string;
  messageId: string;
  dbMessageId?: string | null;
};

type WsEvent =
  | { type: 'auth_ok'; data: { empresaId: string } }
  | { type: 'message'; data: SessionEventPayload }
  | { type: 'message_sent'; data: SessionEventPayload }
  | { type: 'message_update'; data: MessageUpdatePayload }
  | { type: 'message_deleted'; data: MessageDeletedPayload }
  | { type: 'contact_update'; data: { remoteJid: string, pushName: string, profilePicUrl?: string } }
  | { type: 'escalation_triggered'; data: EscalationTriggeredPayload }
  | { type: 'escalation_resolved'; data: EscalationResolvedPayload }
  | { type: 'session_status_changed'; data: SessionStatusChangedPayload }
  | { type: 'session_read'; data: { sessionId: string; unreadCount: number } }
  | { type: 'session_pinned'; data: { sessionId: string; pinned: boolean } }
  | { type: 'qr' | 'connection'; data: unknown };

export interface EscalationNotice {
  sessionId: string;
  event: EscalationEvent;
  reEscalated: boolean;
  receivedAt: number;
}

function upsertMessage(messages: ChatMessage[], next: ChatMessage): ChatMessage[] {
  if (messages.some((message) => message.id === next.id)) {
    return messages;
  }

  return [...messages, next];
}

function removeMessage(messages: ChatMessage[], payload: Pick<MessageDeletedPayload, 'messageId' | 'dbMessageId'>): ChatMessage[] {
  return messages.filter((message) =>
    message.id !== payload.dbMessageId &&
    message.id !== payload.messageId &&
    message.waMessageId !== payload.messageId,
  );
}

function applyDeletedMessage(session: ChatSession, payload: MessageDeletedPayload): ChatSession {
  const messages = removeMessage(session.messages ?? [], payload);
  if (messages.length === (session.messages ?? []).length) return session;

  const latest = messages.at(-1);
  return {
    ...session,
    messages,
    lastMessage: latest?.preview ?? '',
    lastMessageTime: latest?.timestamp ?? session.lastMessageTime,
  };
}

function mergeSessions(previous: ChatSession[], incoming: ChatSession[]): ChatSession[] {
  const previousById = new Map(previous.map((session) => [session.id, session]));

  return incoming.map((session) => {
    const existing = previousById.get(session.id);
    return {
      ...session,
      messages: existing?.messages ?? session.messages ?? [],
      alerts: existing?.alerts ?? session.alerts,
    };
  });
}

function reorderSessionToTop(sessions: ChatSession[], sessionId: string): ChatSession[] {
  const index = sessions.findIndex((session) => session.id === sessionId);
  if (index <= 0) {
    return resortByEscalation(sessions);
  }

  const next = [...sessions];
  const [session] = next.splice(index, 1);
  next.unshift(session);
  return resortByEscalation(next);
}

/**
 * Pin escalated sessions to the top, ordered by oldest escalation first
 * (longest-waiting on top — that's the SLA-critical one). Non-escalated
 * sessions keep their existing order below. Stable for non-escalated rows.
 */
function resortByEscalation(sessions: ChatSession[]): ChatSession[] {
  let hasEscalation = false;
  for (const s of sessions) {
    if (s.status === 'escalated') {
      hasEscalation = true;
      break;
    }
  }
  if (!hasEscalation) return sessions;

  const escalated: ChatSession[] = [];
  const rest: ChatSession[] = [];
  for (const s of sessions) {
    if (s.status === 'escalated') escalated.push(s);
    else rest.push(s);
  }
  escalated.sort((a, b) => {
    const ta = a.escalatedAt ? new Date(a.escalatedAt).getTime() : 0;
    const tb = b.escalatedAt ? new Date(b.escalatedAt).getTime() : 0;
    return ta - tb; // oldest first
  });
  return [...escalated, ...rest];
}

export function useWhatsAppSessions(token: string | null) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEscalation, setLastEscalation] = useState<EscalationNotice | null>(null);
  const [waConnected, setWaConnected] = useState<boolean | null>(null);
  // P1.33 — track the WebSocket layer separately from the WhatsApp/Whatsmiau
  // connection. The previous state machine only flipped on explicit
  // `connection` events from the server, so when the WS itself dropped the
  // operator's UI showed stale "Conectado". Now `wsConnected` is true only
  // while the socket is open; AppShell reads it to render a "Reconectando…"
  // pill.
  const [wsConnected, setWsConnected] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const connectedAtRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!token) {
      setSessions([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await bindEmpresa(token);
      const nextSessions = await getSessions(token);
      setSessions((previous) => mergeSessions(previous, nextSessions));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as conversas.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const hydrateSession = useCallback(async (jid: string) => {
    if (!token || !jid) return;

    try {
      const session = await getSession(token, jid);
      setSessions((previous) => {
        const seen = new Set<string>();
        let replaced = false;

        const next = previous.reduce((acc: ChatSession[], item) => {
          if (item.id !== session.id && item.id !== jid) {
            acc.push(item);
            return acc;
          }

          if (!seen.has(session.id)) {
            acc.push({
              ...item,
              ...session,
              messages: session.messages ?? item.messages ?? [],
              alerts: item.alerts ?? session.alerts,
            });
            seen.add(session.id);
            replaced = true;
          }
          return acc;
        }, []);

        return replaced ? next : [session, ...previous];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível abrir a conversa.');
    }
  }, [token]);

  const send = useCallback(async (
    jid: string,
    params: { text?: string; attachment?: ChatAttachment },
  ) => {
    if (!token) {
      throw new Error('Faça login para enviar mensagens.');
    }

    await sendMessage(token, jid, {
      message: params.text,
      attachment: params.attachment,
    });
  }, [token]);

  const toggleAutoReply = useCallback(async (jid: string, enabled: boolean) => {
    if (!token) {
      throw new Error('Faça login para alterar o modo de atendimento.');
    }

    setSessions((previous) =>
      previous.map((session) =>
        session.id === jid ? { ...session, autoReply: enabled } : session,
      ),
    );

    try {
      await setSessionAutoReply(token, jid, enabled);
    } catch (error) {
      setSessions((previous) =>
        previous.map((session) =>
          session.id === jid ? { ...session, autoReply: !enabled } : session,
        ),
      );
      throw error;
    }
  }, [token]);

  const deleteSession = useCallback(async (jid: string) => {
    if (!token) {
      throw new Error('Faça login para excluir conversas.');
    }

    await deleteSessionApi(token, jid);
    setSessions((prev) => prev.filter((s) => s.id !== jid));
  }, [token]);

  const deleteMessage = useCallback(async (jid: string, message: ChatMessage) => {
    if (!token) {
      throw new Error('Faca login para apagar mensagens.');
    }
    if (!message.waMessageId) {
      throw new Error('Esta mensagem ainda nao tem o ID do WhatsApp para apagar para todos.');
    }

    const payload: MessageDeletedPayload = {
      sessionId: jid,
      messageId: message.waMessageId,
      dbMessageId: message.id,
    };

    setSessions((previous) =>
      previous.map((session) =>
        session.id === jid ? applyDeletedMessage(session, payload) : session,
      ),
    );

    try {
      await deleteMessageApi(token, message.waMessageId, {
        remoteJid: jid,
        fromMe: message.role === 'assistant',
        dbMessageId: message.id,
      });
    } catch (error) {
      void hydrateSession(jid);
      throw error;
    }
  }, [hydrateSession, token]);

  const fetchProfilePicture = useCallback(async (jid: string): Promise<string | null> => {
    if (!token) return null;
    return fetchProfilePictureApi(token, jid);
  }, [token]);

  const updateSessionName = useCallback(async (jid: string, name: string) => {
    if (!token) throw new Error('Faça login para editar o perfil.');
    await updateSessionNameApi(token, jid, name);
    setSessions((prev) =>
      prev.map((s) => s.id === jid ? { ...s, customerName: name } : s),
    );
  }, [token]);

  const resolveEscalation = useCallback(async (jid: string) => {
    if (!token) throw new Error('Faça login para resolver a conversa.');
    await resolveSessionApi(token, jid);
    setSessions((previous) =>
      previous.map((session) =>
        session.id === jid
          ? { ...session, status: 'resolved' as SessionStatus, escalatedAt: null }
          : session,
      ),
    );
  }, [token]);

  const escalateManually = useCallback(async (jid: string, reason?: string) => {
    if (!token) throw new Error('Faça login para escalar.');
    await escalateSessionManuallyApi(token, jid, reason);
  }, [token]);

  const acknowledgeEscalation = useCallback(async (jid: string) => {
    if (!token) return;
    try {
      await acknowledgeSessionApi(token, jid);
      setSessions((previous) =>
        previous.map((session) =>
          session.id === jid && session.status === 'escalated'
            ? { ...session, acknowledgedAt: session.acknowledgedAt ?? new Date().toISOString() }
            : session,
        ),
      );
    } catch {
      // best-effort — acknowledgment is purely metric
    }
  }, [token]);

  const dismissEscalation = useCallback(() => setLastEscalation(null), []);

  const markRead = useCallback(async (jid: string) => {
    if (!jid) return;

    setSessions((previous) =>
      previous.map((session) =>
        session.id === jid ? { ...session, unreadCount: 0 } : session,
      ),
    );

    if (!token) return;

    try {
      await markSessionRead(token, jid);
    } catch {
      // Local optimistic update is enough for the current session list.
    }
  }, [token]);

  const markManyRead = useCallback(async (jids: string[]) => {
    const targets = jids.filter(Boolean);
    if (targets.length === 0) return;

    const targetSet = new Set(targets);
    setSessions((previous) =>
      previous.map((session) =>
        targetSet.has(session.id) ? { ...session, unreadCount: 0 } : session,
      ),
    );

    if (!token) return;
    try {
      await markSessionsRead(token, targets);
    } catch {
      // Best-effort; the optimistic state already reflects the intent.
    }
  }, [token]);

  const bulkArchive = useCallback(async (jids: string[]) => {
    const targets = jids.filter(Boolean);
    if (targets.length === 0 || !token) return;
    await archiveSessionsApi(token, targets);
    const targetSet = new Set(targets);
    setSessions((previous) =>
      previous.map((session) =>
        targetSet.has(session.id)
          ? { ...session, status: 'archived' as SessionStatus, escalatedAt: null }
          : session,
      ),
    );
  }, [token]);

  const bulkDelete = useCallback(async (jids: string[]) => {
    const targets = jids.filter(Boolean);
    if (targets.length === 0 || !token) return;
    await bulkDeleteSessionsApi(token, targets);
    const targetSet = new Set(targets);
    setSessions((previous) => previous.filter((session) => !targetSet.has(session.id)));
  }, [token]);

  const togglePin = useCallback(async (jid: string) => {
    if (!jid || !token) return;
    let nextPinned = false;
    setSessions((previous) =>
      previous.map((session) => {
        if (session.id !== jid) return session;
        nextPinned = !session.pinned;
        return { ...session, pinned: nextPinned };
      }),
    );
    try {
      await setSessionPinnedApi(token, jid, nextPinned);
    } catch (error) {
      // Roll back on failure so the UI matches server state.
      setSessions((previous) =>
        previous.map((session) =>
          session.id === jid ? { ...session, pinned: !nextPinned } : session,
        ),
      );
      throw error;
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!token) {
      wsRef.current?.close();
      wsRef.current = null;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      return;
    }

    const wsUrl = WS_URL;
    let disposed = false;
    reconnectAttemptRef.current = 0;
    connectedAtRef.current = 0;

    const connect = () => {
      if (disposed) return;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (disposed || wsRef.current !== ws) return;

        try {
          const parsed = JSON.parse(event.data) as WsEvent;

          if (parsed.type === 'auth_ok') {
            connectedAtRef.current = Date.now();
            setWsConnected(true);
            // Re-bind empresa on every (re)connect so server restarts don't break message routing
            void bindEmpresa(token);
            return;
          }

          if (parsed.type === 'escalation_triggered') {
            const data = parsed.data;
            setSessions((previous) => {
              const next = previous.map((session) =>
                session.id === data.sessionId
                  ? {
                      ...session,
                      status: 'escalated' as SessionStatus,
                      escalatedAt: data.escalatedAt,
                      autoReply: false,
                    }
                  : session,
              );
              return resortByEscalation(next);
            });
            setLastEscalation({
              sessionId: data.sessionId,
              event: data.event,
              reEscalated: false,
              receivedAt: Date.now(),
            });
            return;
          }

          if (parsed.type === 'escalation_resolved') {
            const data = parsed.data;
            setSessions((previous) =>
              previous.map((session) =>
                session.id === data.sessionId
                  ? { ...session, status: 'resolved', escalatedAt: null }
                  : session,
              ),
            );
            return;
          }

          if (parsed.type === 'session_status_changed') {
            const data = parsed.data;
            setSessions((previous) =>
              previous.map((session) =>
                session.id === data.sessionId
                  ? {
                      ...session,
                      status: data.status,
                      escalatedAt: data.escalatedAt ?? session.escalatedAt,
                    }
                  : session,
              ),
            );
            return;
          }

          if (parsed.type === 'session_read') {
            const data = parsed.data;
            setSessions((previous) =>
              previous.map((session) =>
                session.id === data.sessionId
                  ? { ...session, unreadCount: data.unreadCount }
                  : session,
              ),
            );
            return;
          }

          if (parsed.type === 'session_pinned') {
            const data = parsed.data;
            setSessions((previous) =>
              previous.map((session) =>
                session.id === data.sessionId
                  ? { ...session, pinned: data.pinned }
                  : session,
              ),
            );
            return;
          }

          if (parsed.type === 'message_update') {
            const { sessionId, messageId, patch } = parsed.data;
            setSessions((previous) =>
              previous.map((session) =>
                session.id === sessionId
                  ? {
                      ...session,
                      messages: session.messages.map((m) =>
                        m.id === messageId ? { ...m, ...patch } : m,
                      ),
                    }
                  : session,
              ),
            );
            return;
          }

          if (parsed.type === 'message_deleted') {
            const data = parsed.data;
            setSessions((previous) =>
              previous.map((session) =>
                session.id === data.sessionId ? applyDeletedMessage(session, data) : session,
              ),
            );
            return;
          }

          if (parsed.type === 'contact_update') {
            setSessions((previous) => previous.map((session) => 
              session.id === (parsed.data as any).remoteJid && (parsed.data as any).profilePicUrl
                ? { ...session, profilePicUrl: (parsed.data as any).profilePicUrl, customerName: (parsed.data as any).pushName || session.customerName }
                : session
            ));
            return;
          }

          if (parsed.type === 'connection') {
            const status = parsed.data as string;
            setWaConnected(status === 'connected');
            return;
          }

          if (parsed.type !== 'message' && parsed.type !== 'message_sent') {
            return;
          }

          const payload = parsed.data;
          const nextLastMessage = payload.lastMessage ?? payload.message.content;
          const nextLastMessageTime = payload.lastMessageTime ?? payload.message.timestamp;

          setSessions((previous) => {
            const existing = previous.find((session) => session.id === payload.sessionId);
            const nextSession: ChatSession = existing
              ? {
                  ...existing,
                  customerName: payload.customerName ?? existing.customerName,
                  customerPhone: payload.customerPhone ?? existing.customerPhone,
                  lastMessage: nextLastMessage,
                  lastMessageTime: nextLastMessageTime,
                  unreadCount:
                    parsed.type === 'message'
                      ? payload.unreadCount ?? existing.unreadCount + 1
                      : existing.unreadCount,
                  autoReply: payload.autoReply ?? existing.autoReply,
                  messages: upsertMessage(existing.messages ?? [], payload.message),
                }
              : {
                  id: payload.sessionId,
                  customerName: payload.customerName ?? payload.sessionId,
                  customerPhone: payload.customerPhone ?? '',
                  lastMessage: nextLastMessage,
                  lastMessageTime: nextLastMessageTime,
                  unreadCount: parsed.type === 'message' ? payload.unreadCount ?? 1 : 0,
                  messages: [payload.message],
                  status: 'active',
                  autoReply: payload.autoReply ?? true,
                };

            const merged = existing
              ? previous.map((session) =>
                  session.id === payload.sessionId ? nextSession : session,
                )
              : [nextSession, ...previous];

            return reorderSessionToTop(merged, payload.sessionId);
          });
        } catch {
          // Ignore malformed WS payloads.
        }
      };

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (disposed) return;
        // Reset backoff counter when the connection was stable for ≥10s
        const stableMs = connectedAtRef.current > 0 ? Date.now() - connectedAtRef.current : 0;
        if (stableMs >= 10_000) reconnectAttemptRef.current = 0;
        connectedAtRef.current = 0;
        const attempt = reconnectAttemptRef.current++;
        // Exponential: 1s→2s→4s→8s→16s→30s cap, ±25% jitter to stagger tabs
        const base = Math.min(1_000 * 2 ** attempt, 30_000);
        const jitter = 0.75 + Math.random() * 0.5;
        reconnectRef.current = setTimeout(connect, Math.round(base * jitter));
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [token]);

  return {
    sessions,
    loading,
    error,
    refresh,
    hydrateSession,
    send,
    markRead,
    markManyRead,
    bulkArchive,
    bulkDelete,
    togglePin,
    toggleAutoReply,
    deleteSession,
    deleteMessage,
    fetchProfilePicture,
    updateSessionName,
    lastEscalation,
    dismissEscalation,
    resolveEscalation,
    escalateManually,
    acknowledgeEscalation,
    waConnected,
    wsConnected,
  };
}
